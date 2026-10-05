const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installElectronStub } = require("./harness/electronStub.js");

installElectronStub();
const AudioStorageManager = require("../../src/helpers/audioStorage.js");

test("bulk audio deletion reports partial failures and only deleted database IDs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-delete-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = Object.create(AudioStorageManager.prototype);
  manager.audioDir = dir;
  const good = path.join(dir, "OpenWhispr-10.webm");
  const blocked = path.join(dir, "OpenWhispr-11.webm");
  const legacy = path.join(dir, "11.webm");
  fs.writeFileSync(good, "ok");
  fs.writeFileSync(legacy, "old copy");
  fs.writeFileSync(blocked, "keep");
  const unlink = fs.unlinkSync;
  fs.unlinkSync = (file) => {
    if (file === blocked) throw new Error("access denied");
    return unlink(file);
  };
  let result;
  try {
    result = manager.deleteAllAudio();
  } finally {
    fs.unlinkSync = unlink;
  }
  assert.deepEqual(result, { deleted: 2, deletedIds: ["10"], failed: true });
  assert.equal(
    fs.existsSync(legacy),
    false,
    "one deleted file cannot clear an ID with another remaining file"
  );
  assert.equal(fs.existsSync(good), false);
  assert.equal(fs.existsSync(blocked), true);
});
