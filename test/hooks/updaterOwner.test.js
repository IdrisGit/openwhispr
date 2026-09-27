const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

test("update hook shares listeners, but each mounted owner reads initial status", async (t) => {
  const calls = { status: 0, info: 0, listen: 0, dispose: 0 };
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getUpdateStatus: async () => {
          calls.status++;
          return {
            updateAvailable: false,
            updateDownloaded: false,
            isDevelopment: false,
            isSupported: true,
          };
        },
        getUpdateInfo: async () => {
          calls.info++;
          return null;
        },
        onUpdateAvailable: () => {
          calls.listen++;
          return () => calls.dispose++;
        },
      },
    },
  });
  const container = installHookDom(t);
  const { useUpdater } = require("../../src/hooks/useUpdater.ts");
  let root = createRoot(container);
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  function Owner() {
    useUpdater();
    return null;
  }
  const render = (second) =>
    React.act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Owner, { key: "control" }),
          second && React.createElement(Owner, { key: "settings" })
        )
      )
    );

  await render(false);
  assert.deepEqual(calls, { status: 1, info: 1, listen: 1, dispose: 0 });
  await render(true);
  assert.deepEqual(calls, { status: 2, info: 2, listen: 1, dispose: 0 });
  await render(false);
  assert.equal(calls.dispose, 0, "the control owner keeps the shared listener");
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(calls.dispose, 1);
});
