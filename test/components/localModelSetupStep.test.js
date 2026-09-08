const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const FIRST_LLM = "qwen3.5-4b-q4_k_m";
const SECOND_LLM = "qwen3.5-2b-q4_k_m";

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : findElement(node.props?.children, predicate);
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object") return textContent(node.props?.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}

async function createSetupHarness(
  t,
  { assistant = false, provider = assistant ? "qwen" : "whisper", installed = {} } = {}
) {
  let unmount = async () => {};
  t.after(() => unmount());
  const listeners = { whisper: new Set(), parakeet: new Set(), llm: new Set() };
  const inventory = {
    whisper: new Set(installed.whisper),
    parakeet: new Set(installed.parakeet),
    llm: new Set(installed.llm),
  };
  const requests = new Map();
  const events = new EventTarget();
  const subscribe = (family) => (listener) => {
    listeners[family].add(listener);
    return () => listeners[family].delete(listener);
  };
  const startDownload = (family) => (modelId) =>
    new Promise((resolve) => requests.set(modelId, { family, resolve }));
  installBrowserGlobals(t, {
    window: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      electronAPI: {
        getPlatform: () => "linux",
        listWhisperModels: async () => ({
          success: true,
          models: [...inventory.whisper].map((model) => ({ model, downloaded: true })),
        }),
        listParakeetModels: async () => ({
          success: true,
          models: [...inventory.parakeet].map((model) => ({ model, downloaded: true })),
        }),
        modelGetAll: async () =>
          [...inventory.llm].map((id) => ({ id, isDownloaded: true, isDownloading: false })),
        modelGetActiveDownloads: async () => [],
        downloadWhisperModel: startDownload("whisper"),
        downloadParakeetModel: startDownload("parakeet"),
        modelDownload: startDownload("llm"),
        onWhisperDownloadProgress: subscribe("whisper"),
        onParakeetDownloadProgress: subscribe("parakeet"),
        onModelDownloadProgress: subscribe("llm"),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-local-setup-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key) => key;
        export function useTranslation() { return { t }; }
        export const initReactI18next = { type: "3rdParty", init() {} };
      `,
      "/ProviderConnectionTest": `export default function ProviderConnectionTest() { return null; }`,
      "/ui/ProviderIcon": `export function ProviderIcon() { return null; }`,
    },
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    localTranscriptionProvider: provider === "nvidia" ? "nvidia" : "whisper",
    whisperModel: "",
    parakeetModel: "",
    chatAgentProvider: assistant ? provider : "qwen",
    chatAgentModel: "",
    chatAgentMode: "local",
  });
  const { LocalModelSetupStep } = await vite.ssrLoadModule(
    "/components/onboarding/ProviderSetupStep.tsx"
  );
  const { ToastContext } = await vite.ssrLoadModule("/components/ui/useToast.ts");
  const pending = await vite.ssrLoadModule("/components/onboarding/pendingLocalModels.ts");
  let tree;
  let ready = false;
  const props = {
    stepId: assistant ? "local-assistant" : "local-dictation",
    onReadinessChange: (value) => {
      ready = value;
    },
    onProceed() {},
    onSkip() {},
  };
  function Harness() {
    // Execute the real component and hooks with React lifecycle, while leaving
    // native controls unmounted: their returned handlers are the test boundary.
    tree = LocalModelSetupStep(props);
    return null;
  }
  const root = createRoot(container);
  const toast = { toast: () => "test-toast" };
  await React.act(async () => {
    root.render(
      React.createElement(ToastContext.Provider, { value: toast }, React.createElement(Harness))
    );
  });
  unmount = async () => {
    await React.act(async () => root.unmount());
  };

  const row = (modelId) => {
    const element = findElement(tree, (node) => node.type === "div" && node.key === modelId);
    assert.ok(element, `model row ${modelId} is visible`);
    return element;
  };
  const click = async (modelId, action) => {
    const button = findElement(
      row(modelId),
      (node) => typeof node.props?.onClick === "function" && textContent(node) === action
    );
    assert.ok(button, `${action} is available for ${modelId}: ${textContent(row(modelId))}`);
    await React.act(async () => button.props.onClick());
  };
  const progress = async (modelId, percentage, phase = "progress") => {
    const family = requests.get(modelId).family;
    const event =
      family === "llm"
        ? { modelId, type: phase, progress: percentage, downloadedSize: percentage, totalSize: 100 }
        : {
            model: modelId,
            type: phase,
            percentage,
            downloaded_bytes: percentage,
            total_bytes: 100,
          };
    await React.act(async () => {
      for (const listener of listeners[family]) listener({}, event);
    });
  };
  const complete = async (modelId, beforeResponse) => {
    const request = requests.get(modelId);
    assert.ok(request, `download ${modelId} started`);
    inventory[request.family].add(modelId);
    await React.act(async () => {
      await beforeResponse?.();
      request.resolve({ success: true });
    });
  };
  return {
    store: useSettingsStore,
    pending,
    row,
    click,
    progress,
    complete,
    ready: () => ready,
    canProceed: () =>
      !findElement(
        tree,
        (node) =>
          typeof node.props?.onClick === "function" &&
          textContent(node) === "onboarding.rehaul.provider.proceed"
      ).props.disabled,
  };
}

for (const fixture of [
  { family: "whisper", provider: "whisper", modelId: "base", setting: "whisperModel" },
  {
    family: "parakeet",
    provider: "nvidia",
    modelId: "parakeet-tdt-0.6b-v3",
    setting: "parakeetModel",
  },
  { family: "llm", provider: "qwen", modelId: FIRST_LLM, setting: "chatAgentModel" },
]) {
  test(`Use selects an installed ${fixture.family} model without a pending download`, async (t) => {
    const setup = await createSetupHarness(t, {
      assistant: fixture.family === "llm",
      provider: fixture.provider,
      installed: { [fixture.family]: [fixture.modelId] },
    });
    assert.equal(setup.canProceed(), false);
    await setup.click(fixture.modelId, "onboarding.rehaul.local.use");
    assert.equal(setup.store.getState()[fixture.setting], fixture.modelId);
    assert.equal(setup.ready(), true);
    assert.equal(setup.canProceed(), true);
  });
}

test("an explicit installed-model choice supersedes an earlier pending download", async (t) => {
  const setup = await createSetupHarness(t, { assistant: true, installed: { llm: [SECOND_LLM] } });
  await setup.click(FIRST_LLM, "onboarding.rehaul.local.download");
  await setup.click(SECOND_LLM, "onboarding.rehaul.local.use");
  assert.equal(setup.pending.hasPendingLocalModels(), false);
  await setup.complete(FIRST_LLM);
  assert.equal(setup.store.getState().chatAgentModel, SECOND_LLM);
  assert.equal(setup.ready(), true);
});

test("completion enables Proceed after the background tray consumes the pending selection", async (t) => {
  const setup = await createSetupHarness(t, { assistant: true });
  await setup.click(FIRST_LLM, "onboarding.rehaul.local.download");
  localStorage.setItem("localSetupPending", "true");
  await setup.complete(FIRST_LLM, () => {
    // The tray receives the terminal event before the initiating IPC resolves.
    const selection = setup.pending.consumePendingLocalModel("assistant", FIRST_LLM);
    assert.ok(selection);
    const store = setup.store.getState();
    store.setChatAgentProvider(selection.provider);
    store.setChatAgentModel(selection.modelId);
  });
  assert.equal(setup.store.getState().chatAgentModel, FIRST_LLM);
  assert.equal(setup.ready(), true);
  assert.equal(setup.canProceed(), true);
});

test("simultaneous assistant downloads display their own progress", async (t) => {
  const setup = await createSetupHarness(t, { assistant: true });
  await setup.click(FIRST_LLM, "onboarding.rehaul.local.download");
  await setup.click(SECOND_LLM, "onboarding.rehaul.local.download");
  await setup.progress(FIRST_LLM, 10);
  await setup.progress(SECOND_LLM, 80);
  assert.match(textContent(setup.row(FIRST_LLM)), /10%/);
  assert.match(textContent(setup.row(SECOND_LLM)), /80%/);
});

test("the most recently started assistant download owns pending selection", async (t) => {
  const setup = await createSetupHarness(t, { assistant: true });
  await setup.click(FIRST_LLM, "onboarding.rehaul.local.download");
  await setup.click(SECOND_LLM, "onboarding.rehaul.local.download");
  assert.equal(setup.pending.readPendingLocalModels().assistant.modelId, SECOND_LLM);
  await setup.complete(FIRST_LLM);
  assert.equal(setup.store.getState().chatAgentModel, "");
  await setup.complete(SECOND_LLM);
  assert.equal(setup.store.getState().chatAgentModel, SECOND_LLM);
  assert.equal(setup.ready(), true);
});

test("a refused concurrent Whisper download preserves the original pending selection", async (t) => {
  const setup = await createSetupHarness(t);
  await setup.click("base", "onboarding.rehaul.local.download");
  await setup.click("small", "onboarding.rehaul.local.download");
  assert.equal(setup.pending.readPendingLocalModels().dictation.modelId, "base");
  await setup.complete("base");
  assert.equal(setup.store.getState().whisperModel, "base");
  assert.equal(setup.ready(), true);
});
