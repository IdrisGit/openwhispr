const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("Speech tab switches preserve hidden panels without rerendering them", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__selectSpeechTab;
    delete globalThis.__selectedSpeechTab;
    delete globalThis.__speechTabProviders;
    delete globalThis.__speechT;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  globalThis.__speechT = (key) => key;
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-speech-tabs-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        export function useTranslation() { return { t: globalThis.__speechT }; }
        export const initReactI18next = { type: "3rdParty", init() {} };
      `,
      "/ui/ProviderTabs": `
        export function ProviderTabs({ onSelect, selectedId, providers }) {
          globalThis.__selectSpeechTab = onSelect;
          globalThis.__selectedSpeechTab = selectedId;
          globalThis.__speechTabProviders = providers;
          return null;
        }
      `,
    },
  });
  const { default: SpeechToTextTabs } = await vite.ssrLoadModule(
    "/components/settings/SpeechToTextTabs.tsx"
  );

  let dictationRenders = 0;
  let noteRenders = 0;
  let uploadRenders = 0;
  let setModelVersion;
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
  await React.act(async () =>
    root.render(
      React.createElement(SpeechToTextTabs, {
        dictation: React.createElement(Dictation),
        noteRecording: React.createElement(Note),
        upload: React.createElement(Upload),
      })
    )
  );
  assert.deepEqual([dictationRenders, noteRenders, uploadRenders], [1, 1, 1]);
  await React.act(async () => globalThis.__selectSpeechTab("noteRecording"));
  await React.act(async () => setModelVersion(1));
  assert.equal(dictationRenders, 2, "hidden picker still receives live updates");
  await React.act(async () => globalThis.__selectSpeechTab("upload"));
  await React.act(async () => globalThis.__selectSpeechTab("dictation"));
  assert.deepEqual([dictationRenders, noteRenders, uploadRenders], [2, 1, 1]);
  const providersBeforeParentUpdate = globalThis.__speechTabProviders;
  await React.act(async () =>
    root.render(
      React.createElement(SpeechToTextTabs, {
        dictation: React.createElement(Dictation),
        noteRecording: React.createElement(Note),
        upload: React.createElement(Upload),
      })
    )
  );
  assert.equal(dictationRenders, 3, "parent settings changes still reach the picker");
  assert.equal(
    globalThis.__speechTabProviders,
    providersBeforeParentUpdate,
    "unchanged tab descriptors do not restart the indicator observer"
  );
  globalThis.__speechT = (key) => `translated:${key}`;
  await React.act(async () =>
    root.render(
      React.createElement(SpeechToTextTabs, {
        dictation: React.createElement(Dictation),
        noteRecording: React.createElement(Note),
        upload: React.createElement(Upload),
      })
    )
  );
  assert.notEqual(globalThis.__speechTabProviders, providersBeforeParentUpdate);
  assert.match(globalThis.__speechTabProviders[0].name, /^translated:/);
  const request = {};
  await React.act(async () =>
    root.render(
      React.createElement(SpeechToTextTabs, {
        initialTab: "upload",
        request,
        dictation: React.createElement(Dictation),
        noteRecording: React.createElement(Note),
        upload: React.createElement(Upload),
      })
    )
  );
  assert.equal(globalThis.__selectedSpeechTab, "upload");
  await React.act(async () => globalThis.__selectSpeechTab("dictation"));
  await React.act(async () =>
    root.render(
      React.createElement(SpeechToTextTabs, {
        initialTab: "upload",
        request: {},
        dictation: React.createElement(Dictation),
        noteRecording: React.createElement(Note),
        upload: React.createElement(Upload),
      })
    )
  );
  assert.equal(globalThis.__selectedSpeechTab, "upload", "repeat route restores requested tab");
});
