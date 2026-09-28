const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const fs = require("node:fs");
const path = require("node:path");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("General microphone refresh and device listener keep their mount lifetime", async (t) => {
  let root;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__generalRefresh;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  const calls = { enumerate: 0, permission: 0, added: 0, removed: 0, defaults: 0 };
  let deviceChanged;
  let refresh;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async enumerateDevices() {
          calls.enumerate++;
          return [{ kind: "audioinput", deviceId: "mic", label: "USB microphone" }];
        },
        async getUserMedia() {
          calls.permission++;
          throw Error("must not ask for permission when labels exist");
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
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        async getSystemDefaultMicrophone() {
          calls.defaults++;
          return { name: "USB microphone" };
        },
      },
    },
  });
  const container = installHostDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-general-controls-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = (key) => key; export function useTranslation() { return { t }; }`,
      "../icons": `export const RefreshCw = () => null; export const Mic = () => null;`,
      "/stores/settingsStore": `export const MIC_WARM_HOLD_CHOICES = [0];`,
      "./button": `
        import React from "react";
        export const Button = ({children, onClick, ...props}) => {
          globalThis.__generalRefresh = onClick;
          return React.createElement("button", props, children);
        };
      `,
      "./select": `
        import React from "react";
        export const Select = ({children}) => React.createElement("div", null, children);
        export const SelectTrigger = ({children, ...props}) => React.createElement("button", props, children);
        export const SelectValue = ({children}) => React.createElement("span", null, children);
        export const SelectContent = ({children}) => children;
        export const SelectItem = ({children}) => children;
      `,
    },
  });
  const { MicrophoneSettings } = await vite.ssrLoadModule("/components/ui/MicrophoneSettings.tsx");
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(MicrophoneSettings, {
        microphoneSelectionMode: "system",
        selectedMicDeviceId: "",
        selectedMicDeviceLabel: "",
        micWarmHoldSeconds: 0,
        onSelectionModeChange() {},
        onDeviceSelect() {},
        onMicWarmHoldSecondsChange() {},
      })
    )
  );
  assert.deepEqual(calls, { enumerate: 1, permission: 0, added: 1, removed: 0, defaults: 1 });
  refresh = globalThis.__generalRefresh;
  assert.equal(typeof refresh, "function");
  assert.match(container.textContent, /microphoneSettings.inputDevice/);
  await React.act(async () => refresh());
  await React.act(async () => deviceChanged());
  assert.deepEqual(calls, { enumerate: 3, permission: 0, added: 1, removed: 0, defaults: 3 });
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(calls.removed, 1);
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
