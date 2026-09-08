const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createDownloadRenderer(t, electronAPI) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: { electronAPI, dispatchEvent() {} },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-model-download-errors-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key) => key;
        export function useTranslation() { return { t }; }
      `,
      "/components/ui/useToast": `
        const context = { toast() {} };
        export function useToast() { return context; }
      `,
      "/stores/settingsStore": `
        export function clearMissingLocalModelSelections() {}
        export function isCloudCleanupMode() { return false; }
        export function getSettings() { return {}; }
      `,
      "/ProviderSetupStep": `export const SETUP_CARD_CLASS = "";`,
      "/ui/ProviderIcon": `export function ProviderIcon() { return null; }`,
    },
  });
  return {
    vite,
    async render(Component) {
      root ??= createRoot(container);
      await React.act(async () => root.render(React.createElement(Component)));
    },
    async unmount() {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}

function findRetryButtons(children) {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    const matches = child.props.children === "common.retry" ? [child] : [];
    return [...matches, ...findRetryButtons(child.props.children)];
  });
}

test("required models with identical errors wait for explicit retry independently", async (t) => {
  const tinyResponse = deferred();
  const baseResponse = deferred();
  const retryResponse = deferred();
  const tinyRefresh = deferred();
  const baseRefresh = deferred();
  const requests = [];
  let refreshCount = 0;
  const renderer = await createDownloadRenderer(t, {
    onWhisperDownloadProgress: () => () => {},
    onParakeetDownloadProgress: () => () => {},
    modelGetActiveDownloads: async () => [],
    downloadWhisperModel(modelId) {
      requests.push(modelId);
      if (modelId === "tiny") return tinyResponse.promise;
      return requests.length === 2 ? baseResponse.promise : retryResponse.promise;
    },
  });
  const { RequiredModelDownloadStep } = await renderer.vite.ssrLoadModule(
    "/components/onboarding/RequiredModelDownloadStep.tsx"
  );
  const required = ["tiny", "base"];
  const props = {
    required,
    missing: required,
    loading: false,
    refresh: () => (++refreshCount === 1 ? tinyRefresh.promise : baseRefresh.promise),
    onProceed() {},
  };
  let tree;
  function Harness() {
    tree = RequiredModelDownloadStep(props);
    return null;
  }
  await renderer.render(Harness);
  assert.deepEqual(requests, ["tiny"]);

  const failure = { success: false, code: "ENOTFOUND", error: "ENOTFOUND" };
  await React.act(async () => tinyResponse.resolve(failure));
  await React.act(async () => tinyRefresh.resolve());
  assert.deepEqual(requests, ["tiny", "base"]);

  await React.act(async () => baseResponse.resolve(failure));
  await React.act(async () => baseRefresh.resolve());
  assert.deepEqual(requests, ["tiny", "base"], "failed downloads must not restart automatically");
  const retryButtons = findRetryButtons(tree);
  assert.equal(retryButtons.length, 2, "each failed model needs its own Retry control");

  await React.act(async () => retryButtons[1].props.onClick());
  assert.deepEqual(requests, ["tiny", "base", "base"]);
  assert.equal(findRetryButtons(tree).length, 1, "retrying base preserves tiny's failure");

  await React.act(async () => retryResponse.resolve(failure));
  assert.deepEqual(requests, ["tiny", "base", "base"]);
  assert.equal(findRetryButtons(tree).length, 2);
});

test("remount restores concurrent LLM downloads and cancellation settles only its model", async (t) => {
  let activeDownloads = [
    {
      modelType: "llm",
      modelId: "model-a",
      phase: "downloading",
      progress: 20,
      downloadedBytes: 200,
      totalBytes: 1000,
      sequence: 1,
    },
    {
      modelType: "llm",
      modelId: "model-b",
      phase: "downloading",
      progress: 30,
      downloadedBytes: 300,
      totalBytes: 1000,
      sequence: 2,
    },
  ];
  const listeners = new Set();
  const cancellations = [];
  let refreshes = 0;
  const renderer = await createDownloadRenderer(t, {
    modelGetActiveDownloads: async () => activeDownloads,
    onModelDownloadProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async modelCancelDownload(modelId) {
      cancellations.push(modelId);
      return { success: true };
    },
  });
  const { useModelDownload } = await renderer.vite.ssrLoadModule("/hooks/useModelDownload.ts");
  let download;
  function Harness() {
    download = useModelDownload({
      modelType: "llm",
      onDownloadComplete() {
        refreshes += 1;
      },
    });
    return null;
  }

  await renderer.render(Harness);
  assert.deepEqual(Object.keys(download.downloads), ["model-a", "model-b"]);
  await renderer.unmount();
  assert.equal(listeners.size, 0);

  activeDownloads = [
    { ...activeDownloads[0], progress: 40, downloadedBytes: 400, sequence: 3 },
    { ...activeDownloads[1], progress: 50, downloadedBytes: 500, sequence: 4 },
  ];
  await renderer.render(Harness);
  assert.equal(download.downloads["model-a"].progress, 40);
  assert.equal(download.downloads["model-b"].progress, 50);

  await React.act(async () => download.cancelDownload("model-a"));
  assert.deepEqual(cancellations, ["model-a"]);
  assert.equal(download.isCancellingModel("model-a"), true);
  assert.equal(download.isCancellingModel("model-b"), false);

  await React.act(async () => {
    for (const listener of listeners) {
      listener(null, {
        type: "error",
        modelId: "model-a",
        error: "Download cancelled by user",
        code: "DOWNLOAD_CANCELLED",
        sequence: 5,
      });
    }
  });
  assert.deepEqual(Object.keys(download.downloads), ["model-b"]);
  assert.equal(download.isCancellingModel("model-a"), false);
  assert.deepEqual(download.downloadErrors, {});

  await React.act(async () => {
    for (const listener of listeners) {
      listener(null, { type: "complete", modelId: "model-b", progress: 100, sequence: 6 });
    }
  });
  assert.equal(download.isDownloading, false);
  assert.equal(refreshes, 2);
});
