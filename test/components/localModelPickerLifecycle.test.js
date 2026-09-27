const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("retained local picker loads disk state once per mount and balances progress listeners", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__localPickerCards;
  });
  let inventory = 0;
  let hydration = 0;
  let registrations = 0;
  let cleanups = 0;
  const listeners = new Set();
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        modelGetAll: async () => {
          inventory++;
          return [{ id: "local-one", isDownloaded: true }];
        },
        modelGetActiveDownloads: async () => {
          hydration++;
          return [
            {
              modelType: "llm",
              modelId: "local-one",
              sequence: 1,
              phase: "downloading",
              progress: 42,
            },
          ];
        },
        onModelDownloadProgress: (listener) => {
          registrations++;
          listeners.add(listener);
          return () => {
            cleanups++;
            listeners.delete(listener);
          };
        },
      },
    },
  });
  const container = installHostDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-local-picker-lifecycle-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key) => key;
        export function useTranslation() { return { t }; }
      `,
      "/ui/ProviderTabs": `export const ProviderTabs = () => null;`,
      "/ui/DownloadProgressBar": `export const DownloadProgressBar = () => null;`,
      "/ui/dialog": `export const ConfirmDialog = () => null;`,
      "/ui/ModelCardList": `
        export default function ModelCardList({ models }) {
          globalThis.__localPickerCards = models;
          return null;
        }
      `,
      "/hooks/useDialogs": `
        const showAlertDialog = () => {};
        const showConfirmDialog = () => {};
        const hideConfirmDialog = () => {};
        export function useDialogs() {
          return { confirmDialog: { open: false }, showAlertDialog, showConfirmDialog, hideConfirmDialog };
        }
      `,
      "/components/ui/useToast": `
        const context = { toast() {} };
        export function useToast() { return context; }
      `,
      "/stores/settingsStore": `export function clearMissingLocalModelSelections() {}`,
      "/utils/providerIcons": `
        export function getProviderIcon() { return ""; }
        export function isMonochromeProvider() { return false; }
      `,
    },
  });
  const { default: LocalModelPicker } = await vite.ssrLoadModule(
    "/components/LocalModelPicker.tsx"
  );
  const providers = [
    { id: "local", name: "Local", models: [{ id: "local-one", name: "One", size: "1 MB" }] },
  ];
  const renderPicker = async (onModelSelect, selectedModel = "") =>
    React.act(async () =>
      root.render(
        React.createElement(LocalModelPicker, {
          providers,
          selectedModel,
          selectedProvider: "local",
          onModelSelect,
          onProviderSelect() {},
          modelType: "llm",
        })
      )
    );

  root = createRoot(container);
  await renderPicker(() => {});
  assert.deepEqual(
    [inventory, hydration, registrations, cleanups, listeners.size],
    [1, 1, 1, 0, 1]
  );
  assert.equal(globalThis.__localPickerCards[0].isDownloaded, true);
  assert.equal(globalThis.__localPickerCards[0].isDownloading, true);

  for (let i = 0; i < 3; i++) await renderPicker(() => {});
  assert.deepEqual(
    [inventory, hydration, registrations, cleanups, listeners.size],
    [1, 1, 1, 0, 1],
    "callback-only tab/section renders do not re-query inventory or multiply listeners"
  );

  await React.act(async () => root.unmount());
  root = null;
  assert.deepEqual([registrations, cleanups, listeners.size], [1, 1, 0]);

  root = createRoot(container);
  await renderPicker(() => {});
  assert.deepEqual(
    [inventory, hydration, registrations, cleanups, listeners.size],
    [2, 2, 2, 1, 1],
    "a late-mounted picker hydrates disk and active-download state once"
  );
  await React.act(async () => root.unmount());
  root = null;
  assert.deepEqual([registrations, cleanups, listeners.size], [2, 2, 0]);

  let resolveInventory;
  globalThis.window.electronAPI.modelGetAll = () =>
    new Promise((resolve) => (resolveInventory = resolve));
  let staleSelections = 0;
  let latestSelections = 0;
  root = createRoot(container);
  await renderPicker(() => staleSelections++, "local-one");
  await renderPicker(() => latestSelections++, "local-one");
  await React.act(async () => resolveInventory([]));
  assert.deepEqual([staleSelections, latestSelections], [0, 1]);
});
