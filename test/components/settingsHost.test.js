const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("Settings opens route correctly without rerendering the stable ControlPanel child", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__gpuBannerOptions;
    delete globalThis.__settingsModalProps;
  });
  let keydown;
  let showSettingsFromMain;
  installBrowserGlobals(t, {
    window: {
      addEventListener(type, listener) {
        if (type === "keydown") keydown = listener;
      },
      removeEventListener(type, listener) {
        if (type === "keydown" && keydown === listener) keydown = undefined;
      },
      electronAPI: {
        getPlatform: () => "linux",
        onShowSettings(listener) {
          showSettingsFromMain = listener;
          return () => {
            showSettingsFromMain = undefined;
          };
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-host-test-",
    noExternal: ["react-i18next"],
    resolveAlias: { "@": path.resolve(__dirname, "../../src") },
    mockModules: {
      "react-i18next": `
        export function useTranslation() { return { t: (key) => key }; }
        export const initReactI18next = { type: "3rdParty", init() {} };
      `,
      "/hooks/usePolicy": `export function usePolicySnapshot() { return {}; }`,
      "/hooks/useGpuBannerAvailability": `
        const EMPTY = { transcription: false, intelligence: null };
        export function useGpuBannerAvailability(options) {
          globalThis.__gpuBannerOptions = options;
          return EMPTY;
        }
      `,
      "/stores/policyStore": `export function usePolicyStore() { return true; }`,
      "/stores/settingsStore": `
        const settings = {
          useLocalWhisper: false,
          localTranscriptionProvider: "whisper",
          useCleanupModel: false,
          cleanupMode: "openwhispr",
          useDictationAgent: false,
          dictationAgentMode: "openwhispr"
        };
        export function selectPolicyEffectiveSettings() { return settings; }
        export function useSettingsStore(selector) { return selector(settings); }
      `,
      "/SettingsModal": `
        export default function SettingsModal(props) {
          globalThis.__settingsModalProps = props;
          return null;
        }
      `,
    },
  });
  const { SettingsHost } = await vite.ssrLoadModule("/components/SettingsHost.tsx");
  const { useOpenSettings } = await vite.ssrLoadModule("/components/SettingsHostContext.ts");
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let openSettings;
  let childRenders = 0;
  function ControlPanelProbe() {
    childRenders += 1;
    openSettings = useOpenSettings();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => {
    root.render(
      React.createElement(
        SettingsHost,
        { initialSection: "transcription" },
        React.createElement(ControlPanelProbe)
      )
    );
    await flush();
  });
  assert.equal(globalThis.__settingsModalProps.initialSection, "transcription");
  assert.equal(childRenders, 1);

  await React.act(async () => globalThis.__settingsModalProps.onOpenChange(false));
  assert.equal(globalThis.__gpuBannerOptions.settingsOpen, false);
  await React.act(async () => {
    openSettings("intelligence");
    await flush();
  });
  assert.equal(globalThis.__settingsModalProps.initialSection, "intelligence");

  await React.act(async () => globalThis.__settingsModalProps.onOpenChange(false));
  await React.act(async () => {
    let prevented = false;
    keydown({ ctrlKey: true, key: ",", preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    await flush();
  });
  assert.equal(globalThis.__settingsModalProps.initialSection, undefined);

  await React.act(async () => globalThis.__settingsModalProps.onOpenChange(false));
  await React.act(async () => {
    showSettingsFromMain();
    await flush();
  });
  assert.equal(globalThis.__gpuBannerOptions.settingsOpen, true);
  assert.equal(childRenders, 1, "Settings visibility never rerenders unchanged history");

  await React.act(async () => root.unmount());
  root = null;
  assert.equal(keydown, undefined);
  assert.equal(showSettingsFromMain, undefined);
});
