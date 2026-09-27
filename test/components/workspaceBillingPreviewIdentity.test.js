const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function extractFunction(file, name) {
  const tree = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      declaration = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, name);
  return (
    ts.transpileModule(declaration, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + `\n${name}`
  );
}

test("a demoted owner cannot confirm a previously quoted seat increase", async () => {
  const calls = [];
  const confirmSeatIncrease = vm.runInNewContext(
    extractFunction("src/components/settings/WorkspaceBillingCard.tsx", "confirmSeatIncrease"),
    {
      isOwner: false,
      canAddSeats: true,
      busy: null,
      seatPreview: { next_quantity: 3 },
      workspace: { id: "ws-1" },
      WorkspacesService: { updateSeats: async () => calls.push("update") },
      setBusy() {},
      setSeatPreview() {},
      refresh: async () => {},
      toast() {},
      t: (key) => key,
    }
  );
  await confirmSeatIncrease();
  assert.deepEqual(calls, []);
});

test("Enterprise upgrade requires a preview for the currently selected eligible workspace", async () => {
  assert.match(
    fs.readFileSync("src/components/settings/EnterpriseCheckoutDialog.tsx", "utf8"),
    /upgradePreviewResult\?\.workspaceId === selectedId/
  );
  const calls = [];
  const handleUpgrade = vm.runInNewContext(
    extractFunction("src/components/settings/EnterpriseCheckoutDialog.tsx", "handleUpgrade"),
    {
      submitting: false,
      isUpgrade: true,
      selected: { id: "ws-2", name: "Second" },
      upgradePreview: null, // old preview belongs to ws-1; derived view must be null
      WorkspacesService: { upgradeToEnterprise: async () => calls.push("upgrade") },
      setSubmitting() {},
      refresh: async () => {},
      onRefreshEntitlement: async () => {},
      toast() {},
      onOpenChange() {},
      t: (key) => key,
    }
  );
  await handleUpgrade();
  assert.deepEqual(calls, []);
});
