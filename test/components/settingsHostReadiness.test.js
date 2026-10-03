const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

test("a pending native request is delivered at host commit, while disposed readiness/results cannot consume it", async (t) => {
  const { dom, root } = await mountAuditDom(t);
  const reads = [],
    listeners = [],
    ready = [],
    acks = [];
  let currentListener;
  dom.electronAPI = {
    getPlatform: () => "linux",
    onShowSettings(listener) {
      listeners.push(listener);
      currentListener = listener;
      return () => {
        if (currentListener === listener) currentListener = null;
      };
    },
    getSettingsDocumentId() {
      const request = deferred();
      reads.push(request);
      return request.promise;
    },
    setSettingsHostReady(hostId, value, documentId) {
      ready.push({ hostId, value, documentId });
      if (value) currentListener({ hostId, requestId: 10 });
    },
    acknowledgeSettingsOpen(hostId, requestId) {
      acks.push({ hostId, requestId });
    },
  };
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t=key=>key;export const useTranslation=()=>({t});`,
      "/hooks/usePolicy": `export const usePolicySnapshot=()=>({});`,
      "/stores/policyStore": `import {create} from "zustand";export const usePolicyStore=create(()=>({status:"unmanaged",policy:null}));`,
      "/SettingsModal": `export default ()=>null;`,
    },
  });
  const { SettingsHost } = await vite.ssrLoadModule("/components/SettingsHost.tsx");
  const stores = [];
  const child = (navigation) => {
    stores.push(navigation);
    return null;
  };
  await React.act(async () =>
    root.render(React.createElement(SettingsHost, { key: "old" }, child))
  );
  await React.act(async () => root.render(null));
  await React.act(async () =>
    root.render(React.createElement(SettingsHost, { key: "new" }, child))
  );
  await React.act(async () => reads[0].resolve(1));
  assert.equal(ready.length, 0, "late document read cannot revive a disposed host");
  await React.act(async () => reads[1].resolve(1));
  assert.equal(ready.length, 1);
  assert.equal(stores.at(-1).getState().section, "account");
  assert.equal(acks.length, 1);
  const oldAckCount = acks.length;
  const oldHost = ready[0].hostId;
  await React.act(async () => root.render(null));
  await React.act(async () => listeners[1]({ hostId: oldHost, requestId: 11 }));
  assert.equal(acks.length, oldAckCount, "already queued callback cannot consume after cleanup");
  assert.equal(ready.at(-1).value, false);
  assert.equal(currentListener, null);
});
