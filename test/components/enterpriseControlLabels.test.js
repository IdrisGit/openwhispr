const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function mountDom(t) {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const windowBefore = globalThis.window;
  const documentBefore = globalThis.document;
  const actBefore = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const rafBefore = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = dom.requestAnimationFrame.bind(dom);
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container);
  t.after(async () => {
    globalThis.window = dom;
    globalThis.document = dom.document;
    await React.act(async () => root.unmount());
    globalThis.window = windowBefore;
    globalThis.document = documentBefore;
    globalThis.IS_REACT_ACT_ENVIRONMENT = actBefore;
    globalThis.requestAnimationFrame = rafBefore;
    delete globalThis.__controlLabels;
    await dom.happyDOM.close();
  });
  return { dom, container, root };
}

const translations = require("../../src/locales/en/translation.json");
const translate = (key) => {
  const value = key.split(".").reduce((object, part) => object?.[part], translations);
  assert.equal(typeof value, "string", `existing translation: ${key}`);
  return value;
};

test("real Enterprise and GPU controls have field-specific names across retained instances", async (t) => {
  const { root, container } = await mountDom(t);
  globalThis.__controlLabels = { t: translate };
  globalThis.window.electronAPI = {
    listGpus: async () => [
      { index: 0, uuid: "GPU-one", name: "One", vramMb: 8192 },
      { index: 1, uuid: "GPU-two", name: "Two", vramMb: 8192 },
    ],
    getGpuDeviceIndex: async () => "GPU-two",
  };
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-enterprise-labels-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({t: globalThis.__controlLabels.t});`,
      "/stores/settingsStore": `
        import { create } from "zustand";
        const initial = { bedrockAuthMode: "keys", bedrockRegion: "us-east-1", bedrockProfile: "work", bedrockAccessKeyId: "fake-access", bedrockSecretAccessKey: "fake-secret", bedrockSessionToken: "", azureEndpoint: "", azureApiKey: "", azureDeploymentName: "", azureApiVersion: "", vertexAuthMode: "apikey", vertexProject: "", vertexLocation: "us-central1", vertexApiKey: "" };
        export const useSettingsStore = create(set => ({ ...initial, ...Object.fromEntries(Object.keys(initial).map(key => ["set" + key[0].toUpperCase() + key.slice(1), value => set({[key]: value})])) }));
        globalThis.__controlLabels.store = useSettingsStore;
      `,
      "/models/ModelRegistry": `export const REASONING_PROVIDERS = {};`,
      "/utils/providerIcons": `export const getProviderIcon = () => ""; export const isMonochromeProvider = () => false;`,
      "/ui/ModelCardList": `export default function Stub() { return null; }`,
      "/ui/SearchableModelList": `export default function Stub() { return null; }`,
      "/TestConnectionButton": `export default function Stub() { return null; }`,
    },
  });
  const { default: Enterprise } = await vite.ssrLoadModule(
    "/components/EnterpriseProviderConfig.tsx"
  );
  const { default: Gpu } = await vite.ssrLoadModule("/components/settings/GpuDeviceSelector.tsx");
  await React.act(async () =>
    root.render(
      React.createElement(
        React.Fragment,
        null,
        ...["bedrock", "azure", "vertex", "bedrock"].map((provider, index) =>
          React.createElement(
            "div",
            { key: index, hidden: index === 3 },
            React.createElement(Enterprise, {
              provider,
              reasoningModel: "model",
              setReasoningModel() {},
            })
          )
        ),
        React.createElement(Gpu, { purpose: "transcription" }),
        React.createElement(Gpu, { purpose: "intelligence" })
      )
    )
  );
  const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, "retained copies use unique IDs");
  for (const input of container.querySelectorAll("input")) {
    assert.ok(
      input.getAttribute("aria-label") || input.labels.length,
      `named input: ${input.placeholder}`
    );
  }
  for (const select of container.querySelectorAll("select")) {
    assert.ok(select.getAttribute("aria-label") || select.labels.length);
  }
  const access = container.querySelector('button[aria-label^="Access Key ID:"]');
  await React.act(async () => access.click());
  assert.equal(
    container.querySelector('input[aria-label="Access Key ID"]').labels[0].textContent.trim(),
    "Access Key ID"
  );
  await React.act(async () =>
    globalThis.__controlLabels.store.setState({ bedrockAuthMode: "sso" })
  );
  assert.ok(
    [...container.querySelectorAll("input")].some(
      (input) => input.labels[0]?.textContent.trim() === "Profile Name"
    )
  );
  assert.equal(container.querySelector('select[aria-label="Transcription GPU"]').value, "GPU-two");
  assert.equal(container.querySelector('select[aria-label="Intelligence GPU"]').value, "GPU-two");
});
