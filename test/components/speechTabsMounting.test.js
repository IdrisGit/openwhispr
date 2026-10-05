const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("Speech tab actions keep all three panels mounted and live at once", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    for (const key of ["__selectSpeechTab", "__selectedSpeechTab"]) delete globalThis[key];
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-speech-tabs-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return {t: (key) => key}; } export const initReactI18next = { type: "3rdParty", init() {} };`,
      "/ui/ProviderTabs": `export function ProviderTabs({onSelect, selectedId}) { globalThis.__selectSpeechTab = onSelect; globalThis.__selectedSpeechTab = selectedId; return null; }`,
    },
  });
  const { default: SpeechToTextTabs } = await vite.ssrLoadModule(
    "/components/settings/SpeechToTextTabs.tsx"
  );
  const { createSettingsNavigationStore } = await vite.ssrLoadModule(
    "/stores/settingsNavigationStore.ts"
  );
  const navigation = createSettingsNavigationStore("speechToText");
  let dictationRenders = 0,
    noteRenders = 0,
    uploadRenders = 0,
    setModelVersion;
  function Dictation() {
    const [modelVersion, update] = React.useState(0);
    setModelVersion = update;
    dictationRenders++;
    return React.createElement("span", null, modelVersion);
  }
  function Note() {
    noteRenders++;
    return React.createElement("span", null, "note");
  }
  function Upload() {
    uploadRenders++;
    return React.createElement("span", null, "upload");
  }
  root = createRoot(container);
  const render = () =>
    React.act(async () =>
      root.render(
        React.createElement(SpeechToTextTabs, {
          navigation,
          dictation: React.createElement(Dictation),
          noteRecording: React.createElement(Note),
          upload: React.createElement(Upload),
        })
      )
    );
  await render();
  assert.deepEqual([dictationRenders, noteRenders, uploadRenders], [1, 1, 1], "all three panels mount");
  await React.act(async () => globalThis.__selectSpeechTab("noteRecording"));
  await React.act(async () => setModelVersion(1));
  assert.equal(dictationRenders, 2, "the hidden picker still receives live updates");
  await React.act(async () => globalThis.__selectSpeechTab("upload"));
  await React.act(async () => globalThis.__selectSpeechTab("dictation"));
  assert.deepEqual([dictationRenders, noteRenders, uploadRenders], [2, 1, 1], "tab switches remount nothing");
});
