const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "../../src/components/SettingsPage.tsx"), "utf8");
const handlers = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");

test("System does not report a partial wipe as success or clear surviving model selections", () => {
  assert.match(
    page,
    /if \(anyFailed\) \{\s*\/\/ A partial deletion[^]*?reconcileLocalModelSelections\(\)/
  );
  assert.match(
    page,
    /const result = await window\.electronAPI\?\.cleanupApp\(\);\s*showAlertDialog\(\{\s*title: t\(\s*result\?\.success/
  );
  assert.match(
    handlers,
    /if \(result && !result\.success\) errors\.push\("Parakeet models: deletion incomplete"\)/
  );
  assert.match(handlers, /if \(this\.audioStorageManager\.deleteAllAudio\(\)\.failed\)/);
});
