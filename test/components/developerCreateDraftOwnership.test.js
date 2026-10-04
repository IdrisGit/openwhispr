const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

test("late key creation retains the one-time secret without erasing a reopened create draft", async (t) => {
  const { dom, render } = await mountAuditDom(t);
  const pending = deferred();
  globalThis.__createKeyPending = pending.promise;
  t.after(() => delete globalThis.__createKeyPending);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next", "@radix-ui/react-dialog"],
    mockModules: {
      "react-i18next": `export const useTranslation=()=>({t:key=>key});`,
      "/ui/useToast": `export const useToast=()=>({toast(){}});`,
      "/services/WorkspaceApiKeysService": `export const WorkspaceApiKeysService={list:async()=>[],create:()=>globalThis.__createKeyPending};`,
    },
  });
  const { default: Developer } = await vite.ssrLoadModule(
    "/components/settings/WorkspaceDeveloperTab.tsx"
  );
  await render(
    React.createElement(Developer, { workspace: { id: "fake-workspace", role: "owner" } })
  );
  const click = (text) =>
    React.act(async () =>
      [...dom.document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === text)
        .click()
    );
  const edit = (value) =>
    React.act(async () => {
      const el = dom.document.querySelector("#key-name");
      el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))].onChange({
        target: { value },
      });
    });
  await click("settingsPage.workspace.developer.new");
  await edit("opening draft");
  await click("settingsPage.workspace.developer.scopes.notes.read");
  await React.act(async () =>
    dom.document
      .querySelector("form")
      .dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }))
  );
  await click("common.close");
  await click("settingsPage.workspace.developer.new");
  await edit("new genuine draft");
  await React.act(async () =>
    pending.resolve({ id: "fake", key: "fake-test-only-retained", name: "opening draft" })
  );
  assert.ok(dom.document.body.textContent.includes("fake-test-only-retained"));
  await click("common.done");
  assert.equal(dom.document.querySelector("#key-name").value, "new genuine draft");
  assert.equal(localStorage.length, 0);
});
