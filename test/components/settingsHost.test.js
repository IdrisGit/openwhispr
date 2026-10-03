const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { useStore } = require("zustand");
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
      "/stores/policyStore": `import {create} from "zustand"; export const usePolicyStore = create(() => ({status: "unmanaged", policy: null, appVersion: null}));`,
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
  const { GpuAccelerationBanner } = await vite.ssrLoadModule(
    "/components/GpuAccelerationBanner.tsx"
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let openSettings;
  let childRenders = 0;
  function ControlPanelProbe({ navigation }) {
    childRenders += 1;
    openSettings = useStore(navigation, (state) => state.openSettings);
    return React.createElement(GpuAccelerationBanner, { navigation });
  }
  root = createRoot(container);
  await React.act(async () => {
    root.render(
      React.createElement(SettingsHost, { initialSection: "transcription" }, (navigation) =>
        React.createElement(ControlPanelProbe, { navigation })
      )
    );
    await flush();
  });
  // React.lazy's mocked module may resolve after the initial Suspense commit.
  for (let i = 0; i < 50 && !globalThis.__settingsModalProps; i++) {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.equal(globalThis.__settingsModalProps.navigation.getState().section, "speechToText");
  assert.equal(globalThis.__settingsModalProps.navigation.getState().speechTab, "dictation");
  assert.equal(childRenders, 1);

  await React.act(async () => globalThis.__settingsModalProps.onOpenChange(false));
  assert.equal(globalThis.__gpuBannerOptions.settingsOpen, false);
  await React.act(async () => {
    openSettings("intelligence");
    await flush();
  });
  assert.equal(globalThis.__settingsModalProps.navigation.getState().section, "llms");
  const navigation = globalThis.__settingsModalProps.navigation;
  await React.act(async () => navigation.getState().selectLlmTab("noteFormatting"));
  await React.act(async () => openSettings("intelligence"));
  assert.equal(
    navigation.getState().llmTab,
    "dictationCleanup",
    "repeat alias restores its requested tab"
  );
  await React.act(async () => navigation.getState().selectLlmTab("dictationTranslation"));
  await React.act(async () => openSettings());
  assert.equal(
    navigation.getState().llmTab,
    "dictationTranslation",
    "plain open leaves selection alone"
  );

  await React.act(async () => globalThis.__settingsModalProps.onOpenChange(false));
  await React.act(async () => {
    let prevented = false;
    keydown({ ctrlKey: true, key: ",", preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    await flush();
  });
  assert.equal(globalThis.__settingsModalProps.navigation.getState().section, "account");

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
