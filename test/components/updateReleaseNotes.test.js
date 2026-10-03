const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("real retained updater renders metadata as inert text across events and locales", async (t) => {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const before = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container);
  t.after(async () => {
    globalThis.window = dom;
    globalThis.document = dom.document;
    await React.act(async () => root.unmount());
    Object.assign(globalThis, {
      window: before.window,
      document: before.document,
      IS_REACT_ACT_ENVIRONMENT: before.act,
    });
    delete globalThis.__releaseNotes;
    await dom.happyDOM.close();
  });
  let available, progress, downloaded;
  let subscriptions = 0,
    disposals = 0;
  const listen = (setter) => (callback) => {
    setter(callback);
    subscriptions++;
    return () => disposals++;
  };
  globalThis.window.electronAPI = {
    getUpdateStatus: async () => ({
      updateAvailable: false,
      updateDownloaded: false,
      isDevelopment: false,
      isSupported: true,
    }),
    getUpdateInfo: async () => null,
    getAppVersion: async () => ({ version: "1.0" }),
    onUpdateAvailable: listen((cb) => (available = cb)),
    onUpdateDownloaded: listen((cb) => (downloaded = cb)),
    onUpdateDownloadProgress: listen((cb) => (progress = cb)),
  };
  globalThis.__releaseNotes = { language: "en" };
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({t: (key, options) => globalThis.__releaseNotes.language + ':' + key + (options?.progress ?? '')});`,
      "/stores/settingsStore": `export const useSettingsStore = selector => selector({autoUpdatesEnabled: true, setAutoUpdatesEnabled() {}});`,
      "/ui/useToast": `export const useToast = () => ({toast() {}});`,
    },
  });
  const { default: Updates } = await vite.ssrLoadModule("/components/settings/SystemUpdates.tsx");
  const props = { showAlertDialog() {}, showConfirmDialog() {} };
  const render = (active) =>
    React.act(async () => root.render(React.createElement(Updates, { ...props, active })));
  await render(true);
  const malicious =
    '<script>window.bad=true</script><img src="bad" onerror="bad()"><a href="javascript:bad()">run</a><iframe srcdoc="bad"></iframe>';
  for (const [notes, expected] of [
    [malicious, malicious],
    [
      "<ul><li>Ordinary <strong>notes</strong></li></ul>\nnext line",
      "<ul><li>Ordinary <strong>notes</strong></li></ul>\nnext line",
    ],
    [
      [
        { version: "2", note: "First" },
        { version: "1", note: "Second" },
        { note: null },
        { note: { bad: true } },
        null,
      ],
      "First\n\nSecond",
    ],
    [null, ""],
    ["", ""],
    ["  ", ""],
    [{ bad: true }, ""],
  ]) {
    await React.act(async () => available(null, { version: "2", releaseNotes: notes }));
    assert.equal(container.querySelector(".whitespace-pre-wrap")?.textContent ?? "", expected);
    assert.equal(container.querySelector("script, img, iframe, a"), null);
  }
  await render(false);
  await React.act(async () => {
    available(null, { version: "2", releaseNotes: malicious });
    progress(null, { percent: 42 });
  });
  assert.ok(container.firstChild.hidden);
  assert.ok(container.textContent.includes("42"));
  assert.equal(container.querySelector(".whitespace-pre-wrap").textContent, malicious);
  globalThis.__releaseNotes.language = "fr";
  await React.act(async () => downloaded(null, { version: "2", releaseNotes: "Safe notes" }));
  await render(true);
  assert.ok(container.textContent.includes("fr:settingsPage.general.updates.whatsNew"));
  assert.equal(container.querySelector(".whitespace-pre-wrap").textContent, "Safe notes");
  assert.equal(subscriptions, 3);
  await React.act(async () => root.unmount());
  assert.equal(disposals, 3);
});
