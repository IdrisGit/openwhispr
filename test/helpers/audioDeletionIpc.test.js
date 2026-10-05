const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const os = require("node:os");

// Load/register the real handler without starting Electron or constructing managers.
test("delete-all-audio preserves filesystem outcomes and reports DB reconciliation failure", async (t) => {
  const modulePath = require.resolve("../../src/helpers/ipcHandlers");
  const originalLoad = Module._load;
  const handlers = new Map();
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      getName: () => "test",
      getVersion: () => "0.0.0",
      isPackaged: false,
      on() {},
      requestSingleInstanceLock: () => true,
    },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeHandler() {} },
    net: { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
    BrowserWindow: class {
      static getAllWindows() {
        return [];
      }
      static fromWebContents() {
        return null;
      }
    },
    shell: {},
    dialog: {},
    clipboard: {},
    nativeImage: {},
    globalShortcut: {},
    utilityProcess: {},
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    session: { fromPartition: () => ({}) },
    MessageChannelMain: class {},
  };
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    if (parent?.filename === modulePath && request === "./debugLogger") {
      return new Proxy({}, { get: () => () => {} });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  });
  function inert() {
    return new Proxy(function () {}, {
      get: (_target, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
    });
  }
  let diskResult;
  let dbFails = false;
  const cleared = [];
  const target = {
    audioStorageManager: { deleteAllAudio: () => diskResult },
    databaseManager: {
      clearAudioFlags(ids) {
        cleared.push(ids);
        if (dbFails) throw new Error("database closed");
        return { success: true };
      },
    },
  };
  const IPCHandlers = require(modulePath);
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, key) => (key in value ? value[key] : inert()),
    })
  );
  const remove = handlers.get("delete-all-audio");
  assert.equal(typeof remove, "function");
  for (const [failed, failDb] of [
    [false, false],
    [false, true],
    [true, false],
  ]) {
    diskResult = Object.freeze({ deleted: 2, deletedIds: ["4", "8"], failed });
    dbFails = failDb;
    const result = await remove();
    assert.deepEqual(result, { ...diskResult, failed: failed || failDb });
    assert.deepEqual(cleared.at(-1), ["4", "8"], "only actual deleted IDs reach the DB");
  }
  const before = cleared.length;
  diskResult = { deleted: 1, deletedIds: [], failed: true };
  assert.deepEqual(await remove(), diskResult);
  assert.equal(cleared.length, before, "legacy/no-ID outcomes do not clear unrelated flags");
});
