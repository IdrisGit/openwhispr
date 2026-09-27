const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/auth.ts", "utf8");
const tree = ts.createSourceFile("auth.ts", source, ts.ScriptTarget.Latest, true);
const declaration = tree.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "hasCredentialAccount"
);
assert.ok(declaration);
const functionCode = ts.transpileModule(declaration.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test("credential availability is rechecked for the next profile, even after a previous lookup finishes late", async () => {
  let resolveFirst;
  let calls = 0;
  const authClient = {
    listAccounts: () => {
      calls++;
      return calls === 1
        ? new Promise((resolve) => (resolveFirst = resolve))
        : Promise.resolve({ data: [{ providerId: "credential" }] });
    },
  };
  const hasCredentialAccount = vm.runInNewContext(`${functionCode}\nhasCredentialAccount`, {
    authClient,
    exports: {},
  });

  const oldProfile = hasCredentialAccount();
  assert.equal(await hasCredentialAccount(), true);
  resolveFirst({ data: [{ providerId: "google" }] });
  assert.equal(await oldProfile, false);
  assert.equal(await hasCredentialAccount(), true);
  assert.equal(calls, 3);
});
