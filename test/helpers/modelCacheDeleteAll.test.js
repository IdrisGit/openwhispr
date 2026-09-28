const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installElectronStub } = require("./harness/electronStub.js");

installElectronStub();
const WhisperManager = require("../../src/helpers/whisper.js");
const ParakeetManager = require("../../src/helpers/parakeet.js");

test("bulk model deletion reports a surviving Whisper or Parakeet model", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-model-delete-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const whisperDir = path.join(dir, "whisper");
  fs.mkdirSync(whisperDir);
  const whisperFile = path.join(whisperDir, "blocked.bin");
  fs.writeFileSync(whisperFile, "model");
  const whisper = Object.create(WhisperManager.prototype);
  whisper.getModelsDir = () => whisperDir;
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file === whisperFile) throw new Error("access denied");
    return unlink(file);
  };
  try {
    const result = await whisper.deleteAllWhisperModels();
    assert.equal(result.success, false);
    assert.equal(result.deleted_count, 0);
  } finally {
    fs.promises.unlink = unlink;
  }

  const parakeetDir = path.join(dir, "parakeet");
  const modelDir = path.join(parakeetDir, "blocked");
  fs.mkdirSync(modelDir, { recursive: true });
  const parakeet = Object.create(ParakeetManager.prototype);
  parakeet.getModelsDir = () => parakeetDir;
  parakeet._getModelWeightsSize = () => 5;
  const rm = fs.rmSync;
  fs.rmSync = (file, options) => {
    if (file === modelDir) throw new Error("access denied");
    return rm(file, options);
  };
  try {
    const result = await parakeet.deleteAllParakeetModels();
    assert.equal(result.success, false);
    assert.equal(result.deleted_count, 0);
    assert.equal(result.freed_bytes, 0);
  } finally {
    fs.rmSync = rm;
  }
  assert.equal(fs.existsSync(modelDir), true);
});
