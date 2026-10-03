const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const tree = ts.createSourceFile(
  "CreateWorkspaceDialog.tsx",
  fs.readFileSync("src/components/CreateWorkspaceDialog.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let source;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmit")
    source = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(source);
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test("a workspace created for the previous account cannot become active or start the invite chain", async () => {
  const calls = [];
  const handler = vm.runInNewContext(`${code}\nhandleSubmit`, {
    name: "Old account",
    submitting: false,
    capture: () => ({ isCurrent: () => false, isAccountCurrent: () => false }),
    createWorkspace: async () => null,
    setSubmitting: () => {},
    setActive: () => calls.push("active"),
    onOpenChange: () => calls.push("closed"),
    onCreated: () => calls.push("invited"),
    toast: () => calls.push("toast"),
    t: (key) => key,
  });
  await handler({ preventDefault() {} });
  assert.deepEqual(calls, [], "obsolete account completion cannot close a replacement session");
});
