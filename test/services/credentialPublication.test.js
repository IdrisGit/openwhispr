const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { BYOK_API_KEYS } = require("../../src/config/secretKeys");

// Separate Vite module graphs represent independent renderer JS/store/service owners.
test("two renderer owners see rotations/clears without TTL caching or immediate-save refill races", async (t) => {
  const owners = [],
    listeners = new Set(),
    saves = [],
    logs = [];
  t.after(() => {
    for (const owner of owners) owner.service.destroy();
    delete globalThis.__credentialLogs;
  });
  globalThis.__credentialLogs = logs;
  const values = new Map([
    ["openaiApiKey", "fake-old"],
    ["anthropicApiKey", "fake-independent"],
  ]);
  const versions = new Map();
  const api = Object.fromEntries(
    BYOK_API_KEYS.flatMap((k) => [
      [k.get, async () => values.get(k.storeKey) ?? ""],
      [
        k.save,
        (key) => {
          values.set(k.storeKey, key);
          const version = (versions.get(k.storeKey) ?? 0) + 1;
          versions.set(k.storeKey, version);
          for (const callback of listeners) callback({ key: k.storeKey, version });
          return new Promise((resolve) => saves.push({ field: k.storeKey, resolve }));
        },
      ],
    ])
  );
  api.onSecretKeyChanged = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  installBrowserGlobals(t, {
    initialStorage: { _dictationAgentSeeded: "1" },
    window: { electronAPI: api, dispatchEvent() {} },
  });
  for (let index = 0; index < 2; index++) {
    const vite = await createRendererServer(t, {
      mockModules: {
        "/i18n": `export const normalizeUiLanguage = value => value || "en"; export default {language: "en", changeLanguage: async () => {}};`,
        "/utils/agentName": `export const ensureAgentNameInDictionary = () => {};`,
        "/utils/logger": `const log = (...args) => globalThis.__credentialLogs?.push(args); export default {warn: log, debug: log, error: log, info: log, logReasoning: log};`,
      },
    });
    const { useSettingsStore: store, initializeSettings } = await vite.ssrLoadModule(
      "/stores/settingsStore.ts"
    );
    await initializeSettings();
    const { default: service } = await vite.ssrLoadModule("/services/ReasoningService.ts");
    owners.push({ store, service });
  }
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) =>
    timeout(delay === 1000 ? () => {} : fn, delay === 1000 ? 0 : delay, ...args)
  );
  const [one, two] = owners;
  assert.equal(await one.service.getApiKey("openai"), "fake-old");
  assert.equal(await two.service.getApiKey("openai"), "fake-old");
  one.store.getState().setOpenaiApiKey("fake-rotate");
  let settled = false;
  const immediate = one.service.getApiKey("openai").then((key) => {
    settled = true;
    return key;
  });
  await Promise.resolve();
  assert.equal(settled, false, "immediate inference waits for its dedicated publication request");
  assert.equal(
    await two.service.getApiKey("openai"),
    "fake-rotate",
    "other renderer never keeps a one-hour cache"
  );
  saves.at(-1).resolve({ success: true });
  assert.equal(await immediate, "fake-rotate");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(two.store.getState().openaiApiKey, "fake-rotate");
  assert.equal(two.store.getState().anthropicApiKey, "fake-independent");

  one.store.getState().setOpenaiApiKey("fake-overlap-old");
  const olderSave = saves.at(-1);
  one.store.getState().setOpenaiApiKey("fake-overlap-new");
  const newestSave = saves.at(-1);
  const latest = one.service.getApiKey("openai");
  newestSave.resolve({ success: true });
  olderSave.resolve({ success: false, code: "SECRET_PERSIST_FAILED" });
  assert.equal(await latest, "fake-overlap-new");
  assert.equal(await two.service.getApiKey("openai"), "fake-overlap-new");

  const publishOpenai = api.saveOpenAIKey;
  api.saveOpenAIKey = async () => {
    throw new Error("fake IPC publication failure");
  };
  one.store.getState().setOpenaiApiKey("fake-not-published");
  await assert.rejects(one.service.getApiKey("openai"), { code: "SECRET_PUBLICATION_FAILED" });
  assert.equal(await two.service.getApiKey("openai"), "fake-overlap-new");
  api.saveOpenAIKey = publishOpenai;
  one.store.getState().setOpenaiApiKey("fake-recovered");
  saves.at(-1).resolve({ success: true });
  assert.equal(await one.service.getApiKey("openai"), "fake-recovered");

  one.store.getState().setNoteFormattingCustomApiKey("fake-scope");
  saves.at(-1).resolve({ success: true });
  await new Promise(setImmediate);
  assert.equal(two.store.getState().noteFormattingCustomApiKey, "fake-scope");
  assert.equal(
    two.store.getState().cleanupCustomApiKey,
    "",
    "scope overrides do not replace the shared key"
  );
  one.store.getState().setOpenaiApiKey("");
  saves.at(-1).resolve({ success: true });
  await assert.rejects(one.service.getApiKey("openai"), { code: "API_KEY_MISSING" });
  await assert.rejects(two.service.getApiKey("openai"), { code: "API_KEY_MISSING" });
  assert.equal(await two.service.getApiKey("anthropic"), "fake-independent");
  assert.equal(localStorage.getItem("openaiApiKey"), null);
  assert.equal(JSON.stringify(logs).includes("fake-rotate"), false);
  assert.equal(JSON.stringify(logs).includes("fake-overlap-new"), false);
});
