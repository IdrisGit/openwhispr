const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { create } = require("zustand");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("sidebar navigation preserves layout identity; resize updates active and retained controls", async (t) => {
  let root;
  const resizeBefore = globalThis.ResizeObserver;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    if (resizeBefore === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = resizeBefore;
    delete globalThis.__layoutTest;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const state = (globalThis.__layoutTest = {
    probes: {},
    listeners: new Map(),
    observers: [],
    selections: {},
    mounts: {},
    cleanups: {},
  });
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      state.observers.push(this);
    }
    observe(node) {
      this.node = node;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  state.store = create(() => ({
    locale: "en",
    values: {},
    useCleanupModel: true,
    setUseCleanupModel() {},
    autoUpdatesEnabled: true,
    setAutoUpdatesEnabled() {},
  }));
  const noop = () => {};
  const version = async () => "";
  state.updater = {
    status: { isDevelopment: false, isSupported: true },
    getAppVersion: version,
  };
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-layout-",
    noExternal: ["react-i18next", "@radix-ui/react-dialog"],
    mockModules: {
      "react-i18next": `
        import React from "react";
        export const useTranslation = () => {
          const locale = globalThis.__layoutTest.store(s => s.locale);
          const t = React.useCallback(key => locale + ":" + key, [locale]);
          return {t};
        };
      `,
      "@radix-ui/react-dialog": `
        import React from "react";
        export const Root = ({open, children}) => open ? children : null;
        export const Portal = ({children}) => children;
        export const Content = ({children, ref}) => React.createElement("div", {ref}, children);
        export const Overlay = () => null;
        export const Close = ({children}) => React.createElement("button", null, children);
        export const Title = ({children}) => React.createElement("h2", null, children);
      `,
      "/components/icons": [
        "X",
        "FileAudio",
        "Mic",
        "Upload",
        "BookOpen",
        "Languages",
        "MessageSquare",
        "Sparkles",
        "Wand2",
        "Download",
        "RefreshCw",
      ]
        .map((name) => `export const ${name} = () => null;`)
        .join("\n"),
      "/ui/useDismissGuard": `export const useDismissGuard = () => ({registerContent: undefined, shouldBlockDismiss: () => false});`,
      "/ui/InfoBox": `export const InfoBox = ({children}) => children;`,
      "/stores/settingsStore": `export const useSettingsStore = globalThis.__layoutTest.store;`,
      "/stores/policyStore": `export const usePolicyStore = selector => selector({agentAllowed: true});`,
      "/stores/policyRules": `export const isAgentAllowed = state => state.agentAllowed;`,
      "/ui/ProviderTabs": `export const ProviderTabs = ({providers, onSelect}) => { globalThis.__layoutTest.selections[providers[0].id] = onSelect; return null; };`,
      "/ui/useToast": `export const useToast = () => ({toast() {}});`,
      "/ui/PromptStudio": `export default function PromptStudio() { return null; }`,
      "/GpuDeviceSelector": `export default function GpuDeviceSelector() { return null; }`,
      "/InferenceConfigEditor": `import React from "react"; export default function Editor({scope}) { return React.createElement(globalThis.__layoutTest.Probe, {id: scope}); }`,
      "/DictationAgentSettings": `import React from "react"; export default function Agent() { return React.createElement(globalThis.__layoutTest.Probe, {id: "agent"}); }`,
      "/DictationTranslationSettings": `export default function Translation() { return null; }`,
      "/ChatAgentSettings": `export default function Chat() { return null; }`,
      "/ui/toggle": `import React from "react"; export const Toggle = ({ariaLabel}) => ariaLabel.includes("automaticUpdates") ? React.createElement(globalThis.__layoutTest.Probe, {id: "system"}) : null;`,
      "/hooks/useUpdater": `export const useUpdater = () => globalThis.__layoutTest.updater;`,
      "/ui/button": `import React from "react"; export const Button = ({children, size, variant, ...props}) => React.createElement("button", props, children);`,
      "/ui/badge": `export const Badge = ({children}) => children;`,
    },
  });
  const { default: SidebarModal } = await vite.ssrLoadModule("/components/ui/SidebarModal.tsx");
  const { useSettingsLayout } = await vite.ssrLoadModule("/components/ui/useSettingsLayout.ts");
  const { SettingsRow, SettingsPanelRow } = await vite.ssrLoadModule(
    "/components/ui/SettingsSection.tsx"
  );
  const { useTranslation } = await vite.ssrLoadModule("react-i18next");
  const { default: Speech } = await vite.ssrLoadModule("/components/settings/SpeechToTextTabs.tsx");
  const { default: Llms } = await vite.ssrLoadModule("/components/settings/LlmsSection.tsx");
  const { default: System } = await vite.ssrLoadModule("/components/settings/SystemUpdates.tsx");

  function Probe({ id }) {
    const layout = useSettingsLayout();
    const { t: translate } = useTranslation();
    const value = state.store((s) => s.values[id] ?? "");
    const [draft, setDraft] = React.useState("");
    const [progress, setProgress] = React.useState(0);
    state.probes[id] = {
      layout,
      draft,
      progress,
      value,
      setDraft,
      renders: (state.probes[id]?.renders ?? 0) + 1,
    };
    React.useEffect(() => {
      state.mounts[id] = (state.mounts[id] ?? 0) + 1;
      state.listeners.set(id, () => setProgress((p) => p + 1));
      return () => {
        state.cleanups[id] = (state.cleanups[id] ?? 0) + 1;
        state.listeners.delete(id);
      };
    }, [id]);
    return React.createElement(
      SettingsPanelRow,
      { className: "probe-" + id },
      React.createElement(
        SettingsRow,
        { label: translate(id) },
        React.createElement("span", null, draft + value + progress)
      )
    );
  }
  state.Probe = Probe;
  const { createSettingsNavigationStore } = await vite.ssrLoadModule(
    "/stores/settingsNavigationStore.ts"
  );
  const speechNavigation = createSettingsNavigationStore("speechToText");
  const llmNavigation = createSettingsNavigationStore("llms");
  // Stable content supplied from outside the stateful sidebar isolates context broadcasts
  // from ordinary ancestor reconstruction. These are the actual retained panel shells.
  const content = React.createElement(
    React.Fragment,
    null,
    React.createElement(Speech, {
      navigation: speechNavigation,
      dictation: React.createElement(Probe, { id: "dictation" }),
      noteRecording: React.createElement(Probe, { id: "noteRecording" }),
      upload: React.createElement(Probe, { id: "upload" }),
    }),
    React.createElement(Llms, { navigation: llmNavigation }),
    React.createElement(System, { active: true, showAlertDialog: noop, showConfirmDialog: noop })
  );
  root = createRoot(container);
  const render = async (section, open = true) =>
    React.act(async () =>
      root.render(
        React.createElement(SidebarModal, {
          open,
          onOpenChange: noop,
          title: "Settings",
          sidebarItems: [
            { id: "speech", label: "Speech", icon: noop },
            { id: "llms", label: "Models", icon: noop },
          ],
          activeSection: section,
          onSectionChange: noop,
          children: content,
        })
      )
    );
  const resize = (width) =>
    React.act(async () => state.observers.at(-1).callback([{ contentRect: { width } }]));
  const counts = () =>
    Object.fromEntries(Object.entries(state.probes).map(([id, p]) => [id, p.renders]));
  function descendants(node) {
    return [node, ...node.childNodes.flatMap(descendants)];
  }
  const row = (id) =>
    descendants(container).find((node) =>
      node
        .getAttribute("class")
        ?.split(" ")
        .includes("probe-" + id)
    );

  await render("speech");
  await React.act(async () => state.selections.dictationCleanup("dictationAgent"));
  await React.act(async () => {
    state.probes.dictationCleanup.setDraft("unsaved");
    state.probes.dictation.setDraft("speech draft");
  });
  const mounts = { ...state.mounts };
  const observer = state.observers.at(-1);
  assert.ok(observer.node);
  const regular = state.probes.dictation.layout;
  const beforeNavigation = counts();
  await render("llms");
  await render("speech");
  assert.deepEqual(
    counts(),
    beforeNavigation,
    "navigation must not broadcast unchanged context to stable children"
  );
  assert.equal(state.probes.dictation.layout, regular);
  assert.equal(state.observers.length, 1, "sidebar updates retain the observer callback ref");
  await resize(900);
  assert.deepEqual(counts(), beforeNavigation);

  await resize(799);
  for (const [id, probe] of Object.entries(state.probes)) {
    assert.equal(probe.layout.isCompact, true, "active and hidden layout consumers update");
    assert.notEqual(probe.layout, regular);
    assert.match(row(id).getAttribute("class"), /px-3 py-2.5/);
    assert.match(row(id).firstChild.getAttribute("class"), /flex-col/);
  }
  const compact = state.probes.dictation.layout;
  const beforeSameMode = counts();
  await resize(650);
  await render("llms");
  assert.deepEqual(counts(), beforeSameMode);
  assert.equal(state.probes.dictation.layout, compact);
  assert.equal(state.probes.dictationCleanup.draft, "unsaved");

  await React.act(async () => state.store.setState({ values: { dictationCleanup: "new model" } }));
  assert.equal(
    state.probes.dictationCleanup.value,
    "new model",
    "hidden editor keeps its own subscription"
  );
  assert.equal(state.probes.dictation.layout, compact);
  await React.act(async () => state.store.setState({ locale: "fr" }));
  assert.match(container.textContent, /fr:dictationCleanup/);
  assert.equal(state.probes.dictationCleanup.draft, "unsaved");
  for (const listener of state.listeners.values()) await React.act(async () => listener());
  for (const probe of Object.values(state.probes)) assert.equal(probe.progress, 1);
  assert.deepEqual(
    state.mounts,
    mounts,
    "navigation/resize/locale/store writes never remount retained work"
  );
  assert.deepEqual(state.cleanups, {});

  await resize(800);
  for (const [id, probe] of Object.entries(state.probes)) {
    assert.equal(probe.layout.isCompact, false);
    assert.match(row(id).getAttribute("class"), /px-4 py-3/);
    assert.match(row(id).firstChild.getAttribute("class"), /justify-between/);
  }
  await resize(0);
  assert.equal(
    state.probes.dictation.layout.isCompact,
    false,
    "zero width retains the existing regular-mode rule"
  );
  await render("speech", false);
  assert.equal(observer.disconnected, true);
  assert.equal(state.listeners.size, 0);
  assert.deepEqual(state.cleanups, mounts);
  await render("speech");
  assert.equal(state.observers.length, 2, "reopen observes the new container");
  assert.equal(state.probes.dictation.draft, "", "closing resets local drafts as before");
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(state.observers.at(-1).disconnected, true);
  assert.equal(state.listeners.size, 0);
});
