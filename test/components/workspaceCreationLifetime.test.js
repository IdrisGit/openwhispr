const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

test("successful workspace creation follows the mounted dialog session and account", async (t) => {
  const { dom, render } = await mountAuditDom(t);
  const seen = (globalThis.__workspaceCreation = { requests: [], active: [], toasts: [] });
  seen.create = (name) => {
    const request = { ...deferred(), name };
    seen.requests.push(request);
    return request.promise;
  };
  t.after(() => delete globalThis.__workspaceCreation);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next", "@radix-ui/react-dialog"],
    mockModules: {
      "react-i18next": `export const useTranslation=()=>({t:key=>key});`,
      "/stores/workspaceStore": `const state={
        createWorkspace:name=>globalThis.__workspaceCreation.create(name),
        setActiveWorkspaceId:id=>globalThis.__workspaceCreation.active.push(id),
      };export const useWorkspaceStore=selector=>selector(state);`,
      "/ui/useToast": `export const useToast=()=>({toast:value=>globalThis.__workspaceCreation.toasts.push(value)});`,
    },
  });
  const { default: Dialog } = await vite.ssrLoadModule("/components/CreateWorkspaceDialog.tsx");
  const auth = await vite.ssrLoadModule("/lib/authRequestContext.ts");
  const closed = [],
    created = [],
    reconciled = [];
  const draw = (open, defaultName) =>
    render(
      React.createElement(Dialog, {
        open,
        defaultName,
        onOpenChange: (value) => closed.push(value),
        onCreated: (id) => created.push(id),
        onReconciled: (id) => reconciled.push(id),
      })
    );
  const submit = () =>
    React.act(async () => {
      dom.document
        .querySelector("form")
        .dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
    });
  const finish = (id) => React.act(async () => seen.requests.at(-1).resolve({ id, name: id }));

  await draw(true, "Old draft");
  await submit();
  assert.equal(seen.requests[0].name, "Old draft");
  await draw(false);
  await draw(true, "Replacement draft");
  await finish("obsolete-session");
  assert.deepEqual(
    seen.active,
    [],
    "successful old creation must reach and fail the session guard"
  );
  assert.deepEqual(closed, []);
  assert.deepEqual(created, []);
  assert.deepEqual(seen.toasts, []);
  assert.deepEqual(
    reconciled,
    ["obsolete-session"],
    "completed same-account writes still reconcile"
  );
  assert.equal(dom.document.querySelector("input").value, "Replacement draft");

  await submit();
  await finish("current-session");
  assert.deepEqual(seen.active, ["current-session"]);
  assert.deepEqual(closed, [false]);
  assert.deepEqual(created, ["current-session"]);
  assert.equal(seen.toasts.length, 1, "the current successful session publishes feedback");

  await draw(false);
  await draw(true, "Old account");
  await submit();
  await React.act(async () => auth.observeAuthTokenStateEvent({ generation: 2, hasToken: true }));
  await draw(true, "New account draft");
  await finish("obsolete-account");
  assert.deepEqual(seen.active, ["current-session"]);
  assert.deepEqual(created, ["current-session"]);
  assert.deepEqual(closed, [false]);
  assert.equal(seen.toasts.length, 1);
  assert.deepEqual(reconciled, ["obsolete-session", "current-session"]);
  assert.equal(dom.document.querySelector("input").value, "New account draft");
});
