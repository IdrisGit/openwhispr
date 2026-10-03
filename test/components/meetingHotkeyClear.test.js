const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the actual Hotkeys owner callbacks without loading unrelated settings panels.
const filename = path.join(__dirname, "../../src/components/settings/HotkeysSection.tsx");
const source = ts.createSourceFile(
  filename,
  fs.readFileSync(filename, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let clearCallback;
let commitAgentCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "commitAgentHotkey") {
    commitAgentCallback = node.initializer.getText(source);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "HotkeyListInput") {
    const attributes = node.attributes.properties;
    const value = attributes.find((attribute) => attribute.name?.getText(source) === "value");
    if (value?.initializer?.expression?.getText(source) === "meetingKey") {
      clearCallback = attributes
        .find((attribute) => attribute.name?.getText(source) === "onClear")
        .initializer.expression.getText(source);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(clearCallback, "meeting shortcut must expose its clear callback");

test("agent shortcut adapter preserves structured failures and returns a rollback boolean", async () => {
  assert.ok(commitAgentCallback);
  const alerts = [];
  const pending = [];
  const { outputText } = ts.transpileModule(`const commit = ${commitAgentCallback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  const commit = vm.runInNewContext(`${outputText}\ncommit;`, {
    setIsAgentHotkeyCommitting: (value) => pending.push(value),
    showAlertDialog: (alert) => alerts.push(alert),
    t: (key) => key,
  });
  for (const response of [
    { success: false, message: "Main's translated reason" },
    { success: false },
    { success: true },
  ]) {
    const result = await commit(async (key) => {
      assert.equal(key, "F9");
      return response;
    }, "F9");
    assert.equal(result, response.success);
  }
  assert.deepEqual(
    alerts.map((alert) => alert.description),
    ["Main's translated reason", "hooks.hotkeyRegistration.errors.failedToRegister"]
  );
  await assert.rejects(
    commit(async () => {
      throw Error("IPC failed");
    }, "F9"),
    /IPC failed/
  );
  assert.deepEqual(pending, [true, false, true, false, true, false, true, false]);
});

for (const [label, response] of [
  ["failed removal", { success: false }],
  ["unavailable IPC", undefined],
  ["rejected IPC", "reject"],
  ["successful removal", { success: true }],
]) {
  test(`meeting shortcut clear handles ${label}`, async () => {
    let meetingKey = "F7";
    const alerts = [];
    const registerMeetingHotkey = async (hotkey) => {
      assert.equal(hotkey, "");
      if (response === "reject") throw Error("IPC failed");
      return response;
    };
    const context = {
      window: { electronAPI: { registerMeetingHotkey } },
      setMeetingKey: (hotkey) => {
        meetingKey = hotkey;
      },
      showAlertDialog: (alert) => alerts.push(alert),
      t: (key) => key,
    };
    const { outputText } = ts.transpileModule(`const clear = ${clearCallback};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    const clear = vm.runInNewContext(`${outputText}\nclear;`, context);

    const result = await clear();

    if (response?.success) {
      assert.equal(result, true);
      assert.equal(meetingKey, "");
      assert.equal(alerts.length, 0);
    } else {
      assert.equal(result, false, "HotkeyListInput needs false to roll back the removed row");
      assert.equal(meetingKey, "F7");
      assert.equal(alerts.length, 1);
    }
  });
}
