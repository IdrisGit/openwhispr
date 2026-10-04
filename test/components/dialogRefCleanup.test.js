const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom } = require("../lib/settingsAuditHarness");

test("real DialogContent composes caller cleanup on ref replacement and unmount", async (t) => {
  const { render } = await mountAuditDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["@radix-ui/react-dialog", "react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation=()=>({t:key=>key});`,
    },
  });
  const { Dialog, DialogContent, DialogTitle } = await vite.ssrLoadModule(
    "/components/ui/dialog.tsx"
  );
  const attached = [],
    cleaned = [];
  const ref = (id) => (node) => {
    if (!node) return;
    attached.push(id);
    return () => cleaned.push(id);
  };
  const one = ref("one"),
    two = ref("two");
  const node = (ref) =>
    React.createElement(
      Dialog,
      { open: true },
      React.createElement(
        DialogContent,
        { ref },
        React.createElement(DialogTitle, null, "fake title")
      )
    );
  await render(node(one));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.deepEqual(attached, ["one"]);
  await render(node(two));
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.deepEqual(cleaned, ["one"]);
  await render(null);
  assert.deepEqual(cleaned, ["one", "two"]);
});
