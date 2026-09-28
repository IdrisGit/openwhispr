const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const tree = ts.createSourceFile(
  "SettingsPage.tsx",
  fs.readFileSync("src/components/SettingsPage.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function extractCallback(name) {
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      const expression =
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(tree) === "useCallback"
          ? node.initializer.arguments[0]
          : node.initializer;
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        declaration = expression.getText(tree);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, name);
  return (
    ts.transpileModule(`const ${name} = ${declaration};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + `\n${name}`
  );
}

function context(overrides = {}) {
  const calls = [];
  let generation = 7;
  let resolvePreview;
  const usage = {
    status: "success",
    previewSwitchPlan: () => new Promise((resolve) => (resolvePreview = resolve)),
    switchPlan: async (opts) => {
      calls.push(opts);
      return { success: true };
    },
  };
  const state = {
    calls,
    usage,
    getValidatedAuthGeneration: () => generation,
    setGeneration: (value) => (generation = value),
    resolvePreview: (value) => resolvePreview(value),
    setPreviewLoading() {},
    setSwitchPreview: (value) => calls.push(value),
    toast() {},
    t: (key) => key,
    user: { id: "account-a" },
    isSignedIn: true,
    switchPreview: null,
    ...overrides,
  };
  return state;
}

test("a late plan preview from an old credential cannot open confirmation", async () => {
  const ctx = context();
  const preview = vm.runInNewContext(extractCallback("handleSwitchPlan"), ctx);
  const pending = preview("annual", "pro");
  ctx.setGeneration(8);
  ctx.resolvePreview({ success: true, immediateAmount: 500 });
  await pending;
  assert.deepEqual(ctx.calls, []);
});

test("confirmation uses only the account and credential that produced its price preview", async () => {
  const preview = { accountId: "account-a", authGeneration: 7, plan: "annual", tier: "pro" };
  const stale = context({ user: { id: "account-b" }, switchPreview: preview });
  await vm.runInNewContext(extractCallback("confirmSwitchPlan"), stale)();
  assert.deepEqual(stale.calls, [null]);

  const current = context({ switchPreview: preview });
  await vm.runInNewContext(extractCallback("confirmSwitchPlan"), current)();
  assert.equal(current.calls[0], null);
  assert.deepEqual({ ...current.calls[1] }, { plan: "annual", tier: "pro" });
});
