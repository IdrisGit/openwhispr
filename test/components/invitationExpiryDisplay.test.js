const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const i18next = require("i18next");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

const locales = ["en", "ar", "de", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
const options = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

test("invitation expiry is a stable absolute local date/time across clock boundaries and all installed locales", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const originalTZ = process.env.TZ;
  const originalNow = Date.now;
  t.after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
    Date.now = originalNow;
    delete globalThis.__expiryI18n;
  });
  process.env.TZ = "UTC";
  const i18n = i18next.createInstance();
  const resources = Object.fromEntries(
    locales.map((locale) => [
      locale,
      { translation: require(`../../src/locales/${locale}/translation.json`) },
    ])
  );
  await i18n.init({ lng: "en", resources, interpolation: { escapeValue: false } });
  globalThis.__expiryI18n = i18n;
  const expiry = "2026-10-04T00:30:00.000Z";
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({t: globalThis.__expiryI18n.t.bind(globalThis.__expiryI18n), i18n: globalThis.__expiryI18n});`,
      "/stores/workspaceStore": `const state = {membersByWorkspace: {}, refreshMembers: async () => {}, refresh: async () => {}}; export const EMPTY_WORKSPACE_MEMBERS = []; export const useWorkspaceStore = selector => selector(state);`,
      "/services/InvitationsService": `export const InvitationsService = {list: async () => [{id: "invite-a", email: "fake@example.test", expires_at: "${expiry}", workspace_role: "member"}]};`,
      "/services/WorkspacesService": `export const WorkspacesService = {listJoinRequests: async () => []};`,
      "/hooks/useDialogs": `export const useDialogs = () => ({confirmDialog: {open: false}});`,
      "/ui/useToast": `export const useToast = () => ({toast() {}});`,
      "/ui/dialog": `export const ConfirmDialog = () => null;`,
      "/InviteTeammateDialog": `export default () => null;`,
    },
  });
  const { default: Members } = await vite.ssrLoadModule(
    "/components/settings/WorkspaceMembersTab.tsx"
  );
  const workspace = { id: "workspace-a", name: "A", role: "owner", seats: 1 };
  root = createRoot(container);
  const render = () =>
    React.act(async () =>
      root.render(
        React.createElement(React.StrictMode, null, React.createElement(Members, { workspace }))
      )
    );
  await render();
  const before = container.textContent;
  for (const clock of ["2026-10-03T00:29:59Z", "2026-10-04T00:30:00Z", "2026-10-05T00:30:01Z"]) {
    Date.now = () => Date.parse(clock);
    await render();
    assert.equal(container.textContent, before);
  }
  for (const timezone of ["UTC", "America/Los_Angeles"]) {
    process.env.TZ = timezone;
    for (const locale of locales) {
      await i18n.changeLanguage(locale);
      await render();
      const date = new Date(expiry).toLocaleString(locale, options);
      assert.ok(
        container.textContent.includes(
          i18n.t("settingsPage.workspace.invites.expiresOn", { date })
        ),
        `${locale}/${timezone} renders localized date, time and timezone`
      );
      assert.ok(container.textContent.includes(date));
    }
  }
});
