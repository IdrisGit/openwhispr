const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer } = require("../lib/rendererTestHarness");

test("Settings modal returns focus to its invoker without a Radix trigger", async (t) => {
  const documentBefore = globalThis.document;
  t.after(() => {
    if (documentBefore === undefined) delete globalThis.document;
    else globalThis.document = documentBefore;
    delete globalThis.__settingsDialogProps;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-a11y-modal-",
    noExternal: ["react-i18next", "@radix-ui/react-dialog"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return { t: (key) => key }; }`,
      "@radix-ui/react-dialog": `
        export const Root = ({children}) => children;
        export const Portal = Root;
        export const Overlay = () => null;
        export function Content({children, ...props}) {
          globalThis.__settingsDialogProps = props;
          return children;
        }
        export const Close = Root;
        export const Title = Root;
      `,
      "../icons": `export const X = () => null;`,
      "./InfoBox": `export const InfoBox = ({children}) => children;`,
    },
  });
  const { default: SidebarModal } = await vite.ssrLoadModule("/components/ui/SidebarModal.tsx");
  const html = renderToStaticMarkup(
    React.createElement(SidebarModal, {
      open: true,
      onOpenChange() {},
      title: "Settings",
      sidebarItems: [{ id: "general", label: "General", icon: () => null }],
      activeSection: "general",
      onSectionChange() {},
      children: React.createElement("span", null, "Content"),
    })
  );
  assert.match(html, /aria-current="page"/, "selected sidebar section is announced");
  assert.match(html, /focus-visible:ring/, "keyboard focus is visible on navigation buttons");

  const document = { body: {}, activeElement: null };
  globalThis.document = document;
  let restored = false;
  const invoker = {
    isConnected: true,
    focus() {
      restored = true;
      document.activeElement = this;
    },
  };
  document.activeElement = invoker;
  let prevented = false;
  globalThis.__settingsDialogProps.onOpenAutoFocus({
    preventDefault() {
      prevented = true;
    },
    currentTarget: {
      focus() {
        document.activeElement = this;
      },
    },
  });
  assert.equal(prevented, true);
  assert.notEqual(document.activeElement, invoker);
  globalThis.__settingsDialogProps.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(restored, true);
  assert.equal(document.activeElement, invoker);
});

test("shared provider choices announce their selection without claiming tab keyboard semantics", async (t) => {
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-a11y-choices-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return { t: (key) => key }; }`,
      "./ProviderIcon": `export const ProviderIcon = () => null;`,
    },
  });
  const { ProviderTabs } = await vite.ssrLoadModule("/components/ui/ProviderTabs.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProviderTabs, {
      providers: [
        { id: "local", name: "Local" },
        { id: "cloud", name: "Cloud", disabled: true },
      ],
      selectedId: "local",
      onSelect() {},
    })
  );
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /role="tab"/);
  assert.match(html, /focus-visible:ring/);
});

test("microphone controls have names without starting a device scan", async (t) => {
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-a11y-mic-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return { t: (key) => key }; }`,
      "../icons": `export const RefreshCw = () => null; export const Mic = () => null;`,
      "/stores/settingsStore": `export const MIC_WARM_HOLD_CHOICES = [0];`,
      "./select": `
        import React from "react";
        export const Select = ({children}) => children;
        export const SelectTrigger = ({children, ...props}) => React.createElement("button", props, children);
        export const SelectValue = ({children}) => React.createElement("span", null, children);
        export const SelectContent = ({children}) => children;
        export const SelectItem = ({children}) => children;
      `,
    },
  });
  const { MicrophoneSettings } = await vite.ssrLoadModule("/components/ui/MicrophoneSettings.tsx");
  const html = renderToStaticMarkup(
    React.createElement(MicrophoneSettings, {
      microphoneSelectionMode: "system",
      selectedMicDeviceId: "",
      selectedMicDeviceLabel: "",
      micWarmHoldSeconds: 0,
      onSelectionModeChange() {},
      onDeviceSelect() {},
      onMicWarmHoldSecondsChange() {},
    })
  );
  const labelId = html.match(/<span id="([^"]+)" class="text-sm font-medium text-foreground">/)[1];
  assert.match(html, /aria-label="common.refresh"/);
  assert.ok(html.includes(`aria-labelledby="${labelId} ${labelId}-trigger"`));
  assert.match(html, /aria-label="microphoneSettings.warmHold.label"/);
});
