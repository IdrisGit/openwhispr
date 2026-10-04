const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

for (const failure of ["read", "default", "serialize"]) {
  test(`storage ${failure} failure stays recoverable without losing sequential object updates`, async (t) => {
    let root;
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
    });
    const { storage } = installBrowserGlobals(t);
    const container = installHookDom(t);
    const get = storage.getItem;
    const set = storage.setItem;
    let calls = 0;
    let rejecting = true;
    if (failure === "read")
      storage.getItem = () => {
        throw new Error("fake denied");
      };
    storage.setItem = (...args) => {
      calls++;
      if (failure === "default" && rejecting) throw new Error("fake denied");
      return set(...args);
    };
    const serialize = (value) => {
      if (failure === "serialize" && rejecting) throw new Error("fake bad serializer");
      return `custom:${JSON.stringify(value)}`;
    };
    const vite = await createRendererServer(t);
    const { useLocalStorage } = await vite.ssrLoadModule("/hooks/useLocalStorage.ts");
    let preference;
    function Owner() {
      preference = useLocalStorage(
        "custom",
        { count: 0 },
        { serialize, deserialize: (value) => JSON.parse(value.slice(7)) }
      );
      return null;
    }
    root = createRoot(container);
    await React.act(async () =>
      root.render(React.createElement(React.StrictMode, null, React.createElement(Owner)))
    );
    assert.deepEqual(preference[0], { count: 0 });
    assert.equal(get("custom"), null);
    assert.equal(
      calls,
      failure === "default" ? 1 : 0,
      "only a missing, serializable default attempts persistence at commit"
    );
    storage.getItem = get;
    rejecting = false;
    await React.act(async () => {
      preference[1]((value) => ({ count: value.count + 1 }));
      preference[1]((value) => ({ count: value.count + 1 }));
      preference[1]((value) => ({ count: value.count + 1 }));
    });
    assert.deepEqual(preference[0], { count: 3 });
    assert.equal(get("custom"), 'custom:{"count":3}');
    await React.act(async () =>
      root.render(React.createElement(React.StrictMode, null, React.createElement(Owner)))
    );
    assert.equal(get("custom"), 'custom:{"count":3}');
    const error = console.error;
    console.error = () => {};
    try {
      await React.act(async () =>
        preference[1](() => {
          throw new Error("fake updater failure");
        })
      );
      assert.deepEqual(preference[0], { count: 3 });
    } finally {
      console.error = error;
    }
  });
}
