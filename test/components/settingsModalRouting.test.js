const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("explicit Settings actions route while open; plain opens and sidebar changes preserve tabs", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__settingsRoute;
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-routing-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return { t: (key) => key }; }`,
      "/hooks/useAuth": `export function useAuth() { return { isSignedIn: false }; }`,
      "/stores/policyStore": `export function usePolicyStore() { return false; }`,
      "/SettingsPage": `export default function SettingsPage({navigation}) { globalThis.__settingsRoute.navigation = navigation; return null; } export function AccountAvatar() { return null; }`,
      "/ui/SidebarModal": `export default function SidebarModal(props) { globalThis.__settingsRoute.sidebar = props; return props.children; }`,
    },
  });
  const { default: SettingsModal } = await vite.ssrLoadModule("/components/SettingsModal.tsx");
  const { createSettingsNavigationStore } = await vite.ssrLoadModule(
    "/stores/settingsNavigationStore.ts"
  );
  const navigation = createSettingsNavigationStore();
  const actions = navigation.getState();
  globalThis.__settingsRoute = {};
  root = createRoot(container);
  const open = (section) =>
    React.act(async () => {
      actions.openSettings(section);
      root.render(
        React.createElement(SettingsModal, { navigation, onOpenChange: actions.setSettingsOpen })
      );
    });
  await open("transcription");
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "speechToText");
  assert.equal(navigation.getState().speechTab, "dictation");
  assert.equal(globalThis.__settingsRoute.navigation, navigation);
  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("hotkeys"));
  await open();
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "hotkeys");
  await open("meetings");
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "llms");
  assert.equal(navigation.getState().llmTab, "noteFormatting");
  await React.act(async () => actions.selectLlmTab("dictationTranslation"));
  await open("meetings");
  assert.equal(navigation.getState().llmTab, "noteFormatting", "repeat alias restores its tab");
  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("general"));
  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("llms"));
  assert.equal(
    navigation.getState().llmTab,
    "noteFormatting",
    "ordinary section entry preserves selected tab"
  );
  await React.act(async () => actions.setSettingsOpen(false));
  await open();
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "account");
  assert.equal(navigation.getState().llmTab, null, "closed modal cannot retain live tab state");
});
