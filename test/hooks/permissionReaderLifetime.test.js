const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const pending = (queue) => new Promise((resolve, reject) => queue.push({ resolve, reject }));

test("permission reads cannot overwrite a newer grant or persist after cleanup", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const accessibility = [];
  const microphone = [];
  const paste = [];
  let opened = 0;
  let tracksStopped = 0;
  const { storage } = installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getPlatform: () => "darwin",
        checkAccessibilityPermission: () => pending(accessibility),
        checkMicrophoneAccess: () => pending(microphone),
        checkPasteTools: () => pending(paste),
        openAccessibilitySettings: async () => {
          opened++;
          return { success: true };
        },
      },
    },
  });
  const container = installHookDom(t);
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => tracksStopped++ }] }),
      },
    },
  });
  const intervalBefore = globalThis.setInterval;
  const clearBefore = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  t.after(() => {
    globalThis.setInterval = intervalBefore;
    globalThis.clearInterval = clearBefore;
    if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore);
    else delete globalThis.navigator;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-permission-readers-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = key => key; export const useTranslation = () => ({ t });`,
    },
  });
  const { usePermissions } = await vite.ssrLoadModule("/hooks/usePermissions.ts");
  let state;
  function Harness() {
    state = usePermissions();
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Harness)))
  );
  assert.equal(microphone.length, 2);
  await React.act(async () => state.requestMicPermission());
  assert.equal(tracksStopped, 1);
  await React.act(async () => {
    microphone[0].resolve({ granted: false });
    microphone[1].resolve({ granted: false });
    accessibility[1].resolve(true);
    accessibility[0].resolve(false);
    paste[1].resolve({ platform: "darwin", available: true, method: "fresh" });
    paste[0].resolve({ platform: "darwin", available: false, method: "old" });
  });
  assert.equal(storage.getItem("micPermissionGranted"), "true");
  assert.equal(storage.getItem("accessibilityPermissionGranted"), "true");
  assert.equal(state.pasteToolsInfo.method, "fresh");
  let first;
  let second;
  await React.act(async () => {
    first = state.checkPasteToolsAvailability();
    second = state.checkPasteToolsAvailability();
  });
  await React.act(async () =>
    paste[3].resolve({ platform: "darwin", available: true, method: "latest" })
  );
  await React.act(async () =>
    paste[2].resolve({ platform: "darwin", available: false, method: "obsolete" })
  );
  await Promise.all([first, second]);
  assert.equal(state.pasteToolsInfo.method, "latest");
  let request;
  await React.act(async () => {
    request = state.requestAccessibilityPermission();
  });
  await React.act(async () => root.unmount());
  root = null;
  await React.act(async () => accessibility[2].resolve(false));
  await request;
  assert.equal(opened, 0, "an obsolete permission read cannot open Settings or persist denial");
  assert.equal(storage.getItem("accessibilityPermissionGranted"), "true");
});

test("screen-context reads cannot undo a grant or advance a closed owner", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const checks = [];
  const grants = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getPlatform: () => "darwin",
        checkScreenRecordingAccess: () => pending(checks),
        requestScreenRecordingAccess: () => pending(grants),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-screen-readers-" });
  const { useScreenRecordingPermission } = await vite.ssrLoadModule(
    "/hooks/useScreenRecordingPermission.ts"
  );
  let state;
  function Harness() {
    state = useScreenRecordingPermission();
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Harness)))
  );
  let grant;
  await React.act(async () => {
    grant = state.request();
  });
  await React.act(async () => grants[0].resolve({ granted: true, supported: true }));
  assert.equal(await grant, true);
  await React.act(async () => {
    checks[0].resolve({ granted: false, supported: true });
    checks[1].resolve({ granted: false, supported: true });
  });
  assert.equal(state.granted, true);
  let refresh;
  await React.act(async () => {
    refresh = state.check();
  });
  await React.act(async () => checks[2].reject(new Error("unavailable")));
  await refresh;
  assert.equal(state.granted, true);
  await React.act(async () => {
    grant = state.request();
  });
  await React.act(async () => root.unmount());
  root = null;
  grants[1].resolve({ granted: true, supported: true });
  assert.equal(await grant, false);
});

test("system-audio requests supersede routine checks and failures preserve a grant", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const checks = [];
  const grants = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getPlatform: () => "darwin",
        checkSystemAudioAccess: () => pending(checks),
        requestSystemAudioAccess: () => pending(grants),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-system-audio-readers-" });
  const { useSystemAudioPermission } = await vite.ssrLoadModule(
    "/hooks/useSystemAudioPermission.ts"
  );
  let state;
  function Harness() {
    state = useSystemAudioPermission();
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(React.createElement(React.StrictMode, null, React.createElement(Harness)))
  );
  assert.equal(checks.length, 2);
  const denied = { mode: "native", granted: false, status: "denied" };
  await React.act(async () => checks[1].resolve(denied));
  let oldCheck;
  let grant;
  await React.act(async () => {
    oldCheck = state.check();
  });
  await React.act(async () => {
    grant = state.request();
  });
  await React.act(async () => grants[0].resolve({ ...denied, granted: true, status: "granted" }));
  assert.equal(await grant, true);
  await React.act(async () => {
    checks[2].resolve(denied);
    checks[0].resolve(denied);
  });
  await oldCheck;
  assert.equal(state.granted, true);
  let failed;
  await React.act(async () => {
    failed = state.check();
  });
  await React.act(async () => checks[3].reject(new Error("unavailable")));
  await failed;
  assert.equal(state.granted, true);
  assert.equal(state.isChecking, false);
  let lateGrant;
  await React.act(async () => {
    lateGrant = state.request();
  });
  await React.act(async () => root.unmount());
  root = null;
  grants[1].resolve({ ...denied, granted: true });
  assert.equal(
    await lateGrant,
    false,
    "a cleaned-up onboarding owner cannot advance on a late grant"
  );
});
