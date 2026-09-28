const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const fs = require("node:fs");
const path = require("node:path");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("native microphone controls hydrate together and preserve device behavior", async (t) => {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const originalDocument = globalThis.document;
  const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    globalThis.document = originalDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    await dom.happyDOM.close();
  });
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = { enumerate: 0, permission: 0, added: 0, removed: 0, defaults: 0, stopped: 0 };
  let deviceChanged;
  let devices = [{ kind: "audioinput", deviceId: "mic", label: "USB microphone" }];
  let readDevices = async () => devices;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async enumerateDevices() {
          calls.enumerate++;
          return readDevices();
        },
        async getUserMedia() {
          calls.permission++;
          return { getTracks: () => [{ stop: () => calls.stopped++ }] };
        },
        addEventListener(event, callback) {
          assert.equal(event, "devicechange");
          calls.added++;
          deviceChanged = callback;
        },
        removeEventListener(event, callback) {
          assert.equal(event, "devicechange");
          assert.equal(callback, deviceChanged);
          calls.removed++;
        },
      },
    },
  });
  let finishDefault;
  let defaultMic = () =>
    new Promise((resolve) => {
      finishDefault = resolve;
    });
  dom.electronAPI = {
    async getSystemDefaultMicrophone() {
      calls.defaults++;
      return defaultMic();
    },
  };
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-general-controls-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = key => key; export const useTranslation = () => ({t});`,
      "../icons": `export const RefreshCw = () => null; export const Mic = () => null;`,
      "/stores/settingsStore": `export const MIC_WARM_HOLD_CHOICES = [0, 10, 60, 900];`,
    },
  });
  const { MicrophoneSettings } = await vite.ssrLoadModule("/components/ui/MicrophoneSettings.tsx");
  const selections = [];
  const modes = [];
  const warmHolds = [];
  const props = {
    microphoneSelectionMode: "system",
    selectedMicDeviceId: "",
    selectedMicDeviceLabel: "",
    micWarmHoldSeconds: 0,
    onSelectionModeChange: (mode) => modes.push(mode),
    onDeviceSelect: (...args) => selections.push(args),
    onMicWarmHoldSecondsChange: (seconds) => warmHolds.push(seconds),
  };
  let commits = 0;
  root = createRoot(container);
  const render = (changes = {}) =>
    React.act(async () =>
      root.render(
        React.createElement(
          React.Profiler,
          { id: "mic", onRender: () => commits++ },
          React.createElement(MicrophoneSettings, { ...props, ...changes })
        )
      )
    );
  const input = () => container.querySelector("select[aria-labelledby]");
  const warmHold = () =>
    container.querySelector('select[aria-label="microphoneSettings.warmHold.label"]');
  const change = (select, value) =>
    React.act(async () => {
      select.value = value;
      select.dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
  await render();
  assert.equal(input().options.length, 2, "inventory waits for the complete hydration snapshot");
  const beforeHydration = commits;
  await React.act(async () => finishDefault({ name: "USB microphone" }));
  assert.equal(
    commits,
    beforeHydration + 1,
    "devices, default label and loading settle in one commit"
  );
  assert.equal(input().options.length, 3);
  assert.equal(input().value, "__system__");
  assert.match(input().selectedOptions[0].textContent, /USB microphone/);
  assert.ok(dom.document.getElementById(input().getAttribute("aria-labelledby")));
  assert.deepEqual(
    [...warmHold().options].map((option) => option.value),
    ["0", "10", "60", "900"]
  );
  assert.deepEqual(calls, {
    enumerate: 1,
    permission: 0,
    added: 1,
    removed: 0,
    defaults: 1,
    stopped: 0,
  });

  await change(input(), "mic");
  assert.deepEqual(selections, [["mic", "USB microphone"]]);
  assert.deepEqual(modes, ["specific"]);
  await change(input(), "__built-in__");
  await change(input(), "__system__");
  assert.deepEqual(modes, ["specific", "built-in", "system"]);
  await change(warmHold(), "60");
  assert.deepEqual(warmHolds, [60]);

  defaultMic = async () => ({ name: "USB microphone" });
  await React.act(async () =>
    container.querySelector('button[aria-label="common.refresh"]').click()
  );
  await React.act(async () => deviceChanged());
  assert.equal(calls.enumerate, 3);
  assert.equal(calls.permission, 0);
  assert.equal(calls.added, 1);

  await render({
    microphoneSelectionMode: "specific",
    selectedMicDeviceId: "missing",
    selectedMicDeviceLabel: "Missing",
  });
  assert.equal(input().value, "missing");
  assert.equal(
    input().selectedOptions[0].disabled,
    true,
    "missing devices must not silently display System Default"
  );
  devices = [{ kind: "audioinput", deviceId: "replacement", label: "Missing" }];
  await React.act(async () => deviceChanged());
  assert.deepEqual(
    selections.at(-1),
    ["replacement", "Missing"],
    "label-based device remapping survives"
  );

  let reads = 0;
  readDevices = async () =>
    ++reads === 1 ? [{ kind: "audioinput", deviceId: "mic", label: "" }] : devices;
  await React.act(async () => deviceChanged());
  assert.equal(calls.permission, 1);
  assert.equal(calls.stopped, 1, "permission-only streams are immediately released");
  readDevices = async () => {
    throw Error("permission denied");
  };
  await React.act(async () => deviceChanged());
  assert.match(container.textContent, /microphoneSettings.errors.unableToAccess/);
  readDevices = async () => devices;
  await React.act(async () => deviceChanged());
  assert.ok(input(), "refresh recovers the control after failure");

  const pending = [];
  defaultMic = () => new Promise((resolve) => pending.push(resolve));
  let first, second;
  await React.act(async () => {
    first = deviceChanged();
  });
  await React.act(async () => {
    second = deviceChanged();
  });
  const writesBefore = selections.length;
  await React.act(async () => {
    pending[1]({ name: "Newest" });
    await second;
  });
  await React.act(async () => {
    pending[0]({ name: "Old" });
    await first;
  });
  assert.equal(
    selections.length,
    writesBefore + 1,
    "only the latest reply may reconcile selection"
  );
  assert.match(input().options[0].textContent, /Newest/);
  let late;
  await React.act(async () => {
    late = deviceChanged();
  });
  const beforeClose = selections.length;
  await React.act(async () => root.unmount());
  root = null;
  await React.act(async () => {
    pending[2]({ name: "Late" });
    await late;
  });
  assert.equal(selections.length, beforeClose);
  assert.equal(calls.removed, calls.added);

  // Existing section-entry pins; these do not establish mounted request behavior.
  const settingsPage = fs.readFileSync(
    path.join(__dirname, "../../src/components/SettingsPage.tsx"),
    "utf8"
  );
  assert.match(settingsPage, /if \(activeSection !== "general"\) return;\s*readAutoStartState\(\)/);
  assert.match(
    settingsPage,
    /if \(activeSection !== "general" \|\| !noteFilesEnabled\) return;\s*window\.electronAPI\?\.noteFilesGetDefaultPath/
  );
  assert.match(settingsPage, /aria-label=\{t\("settingsPage\.general\.waylandPaste\.recheck"\)\}/);
});
