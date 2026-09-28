const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("account change resets a same-name profile draft and ignores its old credential lookup", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__profileLookup;
    delete globalThis.__profileInput;
    delete globalThis.__profileActions;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const actions = (globalThis.__profileActions = { buttons: [], saved: [], toasts: [] });
  const lookup = [];
  globalThis.__profileLookup = lookup;
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-profile-account-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({ t: (key) => key });`,
      "/lib/auth": `
        export const hasCredentialAccount = () => new Promise((resolve) => globalThis.__profileLookup.push(resolve));
        export const updateDisplayName = async name => { globalThis.__profileActions.saved.push(name); return globalThis.__profileActions.result ?? {}; };
        export const changePassword = async () => ({});
      `,
      "/components/icons": `export const AlertCircle = () => null; export const KeyRound = () => null; export const Loader2 = () => null;`,
      "/ui/button": `import React from "react"; export const Button = ({ children, ...props }) => { globalThis.__profileActions.buttons.push({children, ...props}); return React.createElement("button", props, children); };`,
      "/ui/input": `import React from "react"; export const Input = (props) => { if (props.dir === "auto") globalThis.__profileInput = props; return React.createElement("input", props); };`,
      "/ui/label": `import React from "react"; export const Label = ({ children, ...props }) => React.createElement("label", props, children);`,
      "/ui/SettingsSection": `
        import React from "react";
        export const SettingsPanel = ({ children }) => React.createElement("div", null, children);
        export const SettingsPanelRow = SettingsPanel;
        export const SettingsRow = SettingsPanel;
      `,
      "/ui/useToast": `export const useToast = () => ({ toast(value) {globalThis.__profileActions.toasts.push(value);} });`,
      "/ui/dialog": `
        import React from "react";
        const Wrapper = ({ children }) => React.createElement("div", null, children);
        export const Dialog = Wrapper;
        export const DialogContent = Wrapper;
        export const DialogHeader = Wrapper;
        export const DialogTitle = Wrapper;
        export const DialogDescription = Wrapper;
        export const DialogFooter = Wrapper;
      `,
    },
  });
  const { default: ProfileSection } = await vite.ssrLoadModule(
    "/components/settings/ProfileSection.tsx"
  );
  root = createRoot(container);
  const render = async (id) =>
    React.act(async () =>
      root.render(
        React.createElement(ProfileSection, { key: id, name: "Alex", onSessionRefresh() {} })
      )
    );

  await render("account-a");
  assert.equal(lookup.length, 1);
  await React.act(async () => globalThis.__profileInput.onChange({ target: { value: "Draft" } }));
  assert.equal(globalThis.__profileInput.value, "Draft");
  await render("account-b");
  assert.equal(globalThis.__profileInput.value, "Alex");
  assert.equal(lookup.length, 2);
  await React.act(async () => lookup[0](false));
  await React.act(async () => lookup[1](true));
  assert.match(container.textContent, /settingsPage.account.profile.password.change/);
  assert.equal(container.textContent.includes("Draft"), false);
  const save = () =>
    actions.buttons.findLast((b) => b.children === "settingsPage.account.profile.name.save");
  await React.act(async () => globalThis.__profileInput.onChange({ target: { value: " Grace " } }));
  await React.act(async () => save().onClick());
  assert.deepEqual(actions.saved, ["Grace"]);
  assert.equal(save().disabled, true, "successful save advances the dirty baseline");
  actions.result = { error: {} };
  await React.act(async () =>
    globalThis.__profileInput.onChange({ target: { value: "New draft" } })
  );
  await React.act(async () => save().onClick());
  assert.equal(actions.toasts.at(-1).variant, "destructive");
  assert.equal(actions.toasts.at(-1).description, "settingsPage.account.profile.errors.generic");
  assert.equal(save().disabled, false, "failed save leaves the draft retryable");
});
