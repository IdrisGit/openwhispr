const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("endpoint actions retain drafts, request ownership and current callbacks without event caches", async (t) => {
  let root;
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    delete globalThis.__endpoint;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const seen = (globalThis.__endpoint = { buttons: [] });
  const requests = [];
  globalThis.fetch = (url) => new Promise((resolve) => requests.push({ url, resolve }));
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-endpoint-actions-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = key => key; export const useTranslation = () => ({t});`,
      "/ui/input": `export function Input(p) { globalThis.__endpoint.input = p; return null; }`,
      "/ui/button": `export function Button(p) { globalThis.__endpoint.buttons.push(p); return null; }`,
      "/ui/ApiKeyInput": `export default () => null;`,
      "/ui/ModelCardList": `export default function List(p) {globalThis.__endpoint.list = p; return null;}`,
      "/ui/SearchableModelList": `export const MODEL_SEARCH_THRESHOLD = 100; export default () => null;`,
    },
  });
  const { default: Panel } = await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx");
  const writes = [];
  let setBase;
  function Owner() {
    const [baseUrl, update] = React.useState("https://first.example/v1");
    setBase = update;
    return React.createElement(Panel, {
      baseUrl,
      setBaseUrl: (value) => {
        writes.push(value);
        update(value);
      },
      apiKey: "",
      setApiKey() {},
      model: "chosen",
      setModel() {},
      defaultBaseUrl: "https://default.example/v1",
    });
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Owner)));
  assert.equal(requests.length, 1);
  const finish = (index, id) =>
    React.act(async () =>
      requests[index].resolve({ ok: true, json: async () => ({ data: [{ id }] }) })
    );
  await finish(0, "first");
  const click = (label) =>
    React.act(async () => seen.buttons.findLast((b) => b.children === label).onClick());
  await React.act(async () =>
    seen.input.onChange({ target: { value: " https://second.example/v1/ " } })
  );
  assert.equal(requests.length, 1, "typing does not fetch");
  await React.act(async () => seen.input.onBlur());
  assert.equal(writes.at(-1), "https://second.example/v1");
  assert.equal(requests.length, 2);
  await React.act(async () => setBase("https://third.example/v1"));
  assert.equal(requests.length, 3);
  await finish(2, "third");
  await finish(1, "stale-second");
  assert.equal(seen.list.models[0].value, "third");
  await click("common.refresh");
  assert.equal(requests.length, 4);
  await finish(3, "refreshed");
  await click("common.reset");
  assert.equal(writes.at(-1), "https://default.example/v1");
  assert.equal(requests.length, 5);
  await finish(4, "default");
  await React.act(async () =>
    seen.input.onChange({ target: { value: "https://applied.example/v1" } })
  );
  await click("reasoning.custom.applyAndRefresh");
  assert.equal(requests.length, 6);
  await finish(5, "applied");
  assert.equal(seen.list.models[0].value, "applied");
});
