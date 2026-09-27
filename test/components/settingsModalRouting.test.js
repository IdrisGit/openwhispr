const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("explicit Settings requests route while open; plain opens and sidebar changes do not reset selection", async (t) => {
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
      "/SettingsPage": `
        export default function SettingsPage(props) {
          globalThis.__settingsRoute.page = props;
          return null;
        }
        export function AccountAvatar() { return null; }
      `,
      "/ui/SidebarModal": `
        export default function SidebarModal(props) {
          globalThis.__settingsRoute.sidebar = props;
          return props.children;
        }
      `,
    },
  });
  const { default: SettingsModal } = await vite.ssrLoadModule("/components/SettingsModal.tsx");
  globalThis.__settingsRoute = {};
  root = createRoot(container);
  const render = async (request) =>
    React.act(async () =>
      root.render(
        React.createElement(SettingsModal, {
          open: true,
          onOpenChange() {},
          sectionRequest: request,
        })
      )
    );

  await render({ section: "transcription" });
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "speechToText");
  assert.equal(globalThis.__settingsRoute.page.initialSubTab, "dictation");

  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("hotkeys"));
  assert.equal(globalThis.__settingsRoute.page.initialSubTab, undefined);
  await render(undefined);
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "hotkeys");

  const request = { section: "meetings" };
  await render(request);
  assert.equal(globalThis.__settingsRoute.sidebar.activeSection, "llms");
  assert.equal(globalThis.__settingsRoute.page.initialSubTab, "noteFormatting");
  assert.equal(globalThis.__settingsRoute.page.subTabRequest, request);

  await React.act(async () => globalThis.__settingsRoute.sidebar.onSectionChange("general"));
  await render({ section: "meetings" });
  assert.equal(
    globalThis.__settingsRoute.sidebar.activeSection,
    "llms",
    "repeat deep link routes again"
  );
});
