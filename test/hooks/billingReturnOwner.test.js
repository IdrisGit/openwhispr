const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("a remaining usage owner refreshes when checkout's Settings owner unmounts", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__usageCalls;
    delete globalThis.__usageAuth;
  });
  const listeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
      },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
      electronAPI: {
        cloudCheckout: async () => ({ success: true, url: "https://stripe.test/checkout" }),
        openExternal: async () => ({ success: true }),
      },
    },
  });
  const container = installHookDom(t);
  globalThis.__usageCalls = [];
  globalThis.__usageAuth = { isLoaded: true, isSignedIn: true, user: { id: "account-a" } };
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-billing-return-test-",
    mockModules: {
      "/useAuth": `export const useAuth = () => globalThis.__usageAuth;`,
      "/lib/auth": `export const withSessionRefresh = (fn) => fn();`,
      "/lib/authRequestContext": `export const getValidatedAuthGeneration = () => 7; export const getBoundSessionGeneration = id => id === "account-a" ? 7 : null;`,
      "/lib/usageStore": `
        const state = { status: "success", data: { isSubscribed: false, entitlementSources: { personal: false, workspaceIds: [] } } };
        export const getUsageState = () => state;
        export const subscribeUsage = () => () => {};
        export const setUsageAccount = (id) => globalThis.__usageCalls.push(["account", id]);
        export const loadUsage = async (_fn, opts) => globalThis.__usageCalls.push(["load", Boolean(opts?.force)]);
        export const retryUsage = async () => {};
        export const watchForUpgrade = async () => {};
        export const isPastDueUsage = () => false;
      `,
    },
  });
  const { useUsage } = await vite.ssrLoadModule("/hooks/useUsage.ts");
  let settingsUsage;
  function Owner({ settings }) {
    const usage = useUsage();
    if (settings) settingsUsage = usage;
    return null;
  }
  function App({ showSettings }) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Owner, { settings: false }),
      showSettings && React.createElement(Owner, { settings: true })
    );
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(App, { showSettings: true })));
  await React.act(async () => settingsUsage.openCheckout({ plan: "annual", tier: "pro" }));
  await React.act(async () => root.render(React.createElement(App, { showSettings: false })));
  globalThis.__usageCalls.length = 0;
  for (const listener of listeners.get("focus")) listener();
  assert.deepEqual(globalThis.__usageCalls, [["load", true]]);
});
