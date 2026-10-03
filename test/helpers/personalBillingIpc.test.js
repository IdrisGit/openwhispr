const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  createCloudApiRequestHandler,
  captureAuthFence,
} = require("../../src/helpers/cloudApiRequest");

// Execute the production registration seams with the actual shared auth fence.
function setup() {
  const state = { token: "fake-A", generation: 7 };
  const requests = [],
    opened = [],
    handlers = new Map();
  const tokenStore = { getState: () => ({ ...state }) };
  let fetch = async () =>
    new Response(JSON.stringify({ url: "https://stripe.test/session", amount: 123 }));
  const handleCloudApiRequest = createCloudApiRequestHandler({
    getApiUrl: () => "https://api.test",
    getAppVersion: () => "1.2.3",
    tokenStore,
    proxyFetch: (...args) => {
      requests.push(args);
      return fetch(...args);
    },
  });
  const source = fs.readFileSync(require.resolve("../../src/helpers/ipcHandlers.js"), "utf8");
  const context = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    handleCloudApiRequest,
    tokenStore,
    captureAuthFence,
    URL,
    openExternalUrl: async (url) => opened.push(url),
  };
  const billing = source.slice(
    source.indexOf("    const requestBilling ="),
    source.indexOf('    ipcMain.handle("cloud-api-request"')
  );
  const opener = source.slice(
    source.indexOf('    ipcMain.handle("open-external"'),
    source.indexOf('    ipcMain.handle("get-auto-start-enabled"')
  );
  vm.runInNewContext(billing + opener, context);
  return { state, requests, opened, handlers, setFetch: (value) => (fetch = value) };
}

test("named personal billing channels preserve generation fences before dispatch and during fetch/body replies", async () => {
  for (const channel of [
    "cloud-checkout",
    "cloud-billing-portal",
    "cloud-switch-plan",
    "cloud-preview-switch",
  ]) {
    const h = setup();
    const invoke = (generation) =>
      channel === "cloud-billing-portal"
        ? h.handlers.get(channel)({}, generation)
        : h.handlers.get(channel)({}, { plan: "annual", tier: "business" }, generation);
    assert.equal((await invoke(undefined)).code, "AUTH_CONTEXT_UNVALIDATED");
    assert.equal((await invoke(6)).code, "AUTH_CONTEXT_CHANGED");
    assert.equal(h.requests.length, 0);
    let result = await invoke(7);
    assert.equal(result.success, true);
    assert.equal(result.url, "https://stripe.test/session");
    assert.equal(h.requests[0][1].headers.Authorization, "Bearer fake-A");
    assert.equal(h.requests[0][1].useSessionCookies, false);
    let finish;
    h.setFetch(() => new Promise((resolve) => (finish = resolve)));
    const pending = invoke(7);
    h.state.generation = 8;
    h.state.token = "fake-B";
    finish(new Response(JSON.stringify({ url: "https://stripe.test/obsolete" })));
    result = await pending;
    assert.equal(result.code, "AUTH_CONTEXT_CHANGED");
    assert.equal(result.url, undefined);
    h.state.token = null;
    assert.equal((await invoke(8)).code, "AUTH_CONTEXT_UNVALIDATED");
    h.state.token = "fake-B";
    let readBody;
    h.setFetch(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise((resolve) => (readBody = resolve)),
    }));
    const bodyPending = invoke(8);
    await Promise.resolve();
    await Promise.resolve();
    h.state.generation = 9;
    readBody({ url: "https://stripe.test/obsolete-body" });
    assert.equal((await bodyPending).code, "AUTH_CONTEXT_CHANGED");
  }
});

test("billing URL dispatch uses the same generation fence and leaves ordinary external links unchanged", async () => {
  const h = setup();
  const open = h.handlers.get("open-external");
  assert.equal((await open({}, "https://stripe.test/a", 6)).code, "AUTH_CONTEXT_CHANGED");
  assert.deepEqual(h.opened, []);
  assert.equal((await open({}, "https://stripe.test/a", 7)).success, true);
  assert.equal((await open({}, "javascript:bad()", 7)).success, false);
  assert.equal((await open({}, "https://docs.test")).success, true);
  assert.deepEqual(h.opened, ["https://stripe.test/a", "https://docs.test"]);
});
