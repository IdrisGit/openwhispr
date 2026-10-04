const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("SettingsModal wires its supplied navigation and sidebar actions", async (t) => {
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
  assert.equal(globalThis.__settingsRoute.navigation, navigation);
  assert.equal(globalThis.__settingsRoute.sidebar.onOpenChange, actions.setSettingsOpen);
  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("hotkeys"));
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "hotkeys");
  await React.act(async () => globalThis.__settingsRoute.sidebar.onOpenChange(false));
  globalThis.__settingsRoute = {};
  await React.act(async () =>
    root.render(
      React.createElement(SettingsModal, { navigation, onOpenChange: actions.setSettingsOpen })
    )
  );
  assert.deepEqual(
    globalThis.__settingsRoute,
    {},
    "closed navigation mounts neither host nor page"
  );
});
