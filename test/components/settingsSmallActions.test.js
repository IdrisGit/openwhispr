const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("small Settings controls use current commands, platform and keyboard selection", async (t) => {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const originalDocument = globalThis.document;
  const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    globalThis.document = originalDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct;
    globalThis.requestAnimationFrame = originalRaf;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    await dom.happyDOM.close();
  });
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => dom.requestAnimationFrame(callback);
  const copied = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => copied.push(text) } },
  });
  let platform = "linux";
  dom.electronAPI = { getPlatform: () => platform };
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-small-actions-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = key => key; export const useTranslation = () => ({t});`,
    },
  });
  const { CopyableCommand } = await vite.ssrLoadModule("/components/ui/CopyableCommand.tsx");
  const { default: Warning } = await vite.ssrLoadModule("/components/ui/MicPermissionWarning.tsx");
  const { default: Language } = await vite.ssrLoadModule("/components/ui/LanguageSelector.tsx");
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = createRoot(container);
  const render = (element) => React.act(async () => root.render(element));
  const feedbackTimers = [];
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay !== 2000) return originalTimeout(callback, delay, ...args);
    feedbackTimers.push(callback);
    return 0;
  });
  await render(React.createElement(CopyableCommand, { command: "first" }));
  await React.act(async () => container.querySelector("button").click());
  await render(React.createElement(CopyableCommand, { command: "second" }));
  await React.act(async () => container.querySelector("button").click());
  assert.deepEqual(copied, ["first", "second"]);
  assert.equal(container.querySelector("button").getAttribute("aria-label"), "Copied");
  await React.act(async () => feedbackTimers.forEach((callback) => callback()));
  assert.equal(container.querySelector("button").getAttribute("aria-label"), "Copy command");
  let sound = 0;
  let privacy = 0;
  for (platform of ["linux", "darwin", "win32"]) {
    await render(
      React.createElement(Warning, {
        error: null,
        onOpenSoundSettings: () => sound++,
        onOpenPrivacySettings: () => privacy++,
      })
    );
    const buttons = container.querySelectorAll("button");
    assert.equal(buttons.length, platform === "linux" ? 1 : 2);
    await React.act(async () => {
      for (const button of buttons) button.click();
    });
  }
  assert.deepEqual([sound, privacy], [3, 2]);
  const selected = [];
  await render(
    React.createElement(Language, {
      value: "en",
      onChange: (value) => selected.push(value),
      options: [
        { value: "en", label: "English", flag: "" },
        { value: "fr", label: "French", flag: "" },
      ],
    })
  );
  const trigger = container.querySelector('button[aria-haspopup="listbox"]');
  const key = (value) =>
    React.act(async () =>
      trigger.dispatchEvent(new dom.KeyboardEvent("keydown", { key: value, bubbles: true }))
    );
  await key("Enter");
  await key("ArrowDown");
  await key("Escape");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await key("Enter");
  await key("Enter");
  assert.deepEqual(selected, ["en"], "Escape resets the highlighted index before reopening");
});
