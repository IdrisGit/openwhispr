const Module = require("node:module");

// DatabaseManager requires electron at load time, which is unloadable under plain
// node, so the module loader hands it a stub whose userData path tests repoint.
// `ipcMain: true` exposes an ipcMain facade readable via getIpcHandlers(), plus an inert dialog.
let userDataDir = process.cwd();
let patched = false;
let ipcHandlers = null;

function installElectronStub({ ipcMain = false } = {}) {
  if (patched) return;
  patched = true;
  ipcHandlers = ipcMain ? new Map() : null;
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      const stub = {
        app: {
          getPath: () => userDataDir,
          getAppPath: () => process.cwd(),
          getName: () => "test",
          getVersion: () => "0.0.0",
          isPackaged: false,
          isReady: () => false,
          on() {},
          requestSingleInstanceLock: () => true,
        },
        dialog: {},
      };
      if (ipcHandlers) {
        stub.ipcMain = {
          handle: (name, fn) => ipcHandlers.set(name, fn),
          on() {},
          removeHandler() {},
        };
      }
      return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

// Must be set before DatabaseManager loads: it picks the dev database filename
// from NODE_ENV.
process.env.NODE_ENV = "test";

function setUserDataDir(dir) {
  if (typeof dir !== "string" || dir.length === 0) {
    throw new TypeError("setUserDataDir requires a non-empty path");
  }
  userDataDir = dir;
}

function getUserDataDir() {
  return userDataDir;
}

function getIpcHandlers() {
  if (!ipcHandlers) throw new Error("installElectronStub({ ipcMain: true }) first");
  return ipcHandlers;
}

module.exports = { installElectronStub, setUserDataDir, getUserDataDir, getIpcHandlers };
