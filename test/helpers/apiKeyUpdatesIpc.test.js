const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { BYOK_API_KEYS } = require("../../src/config/secretKeys");

const bindings = [
  ...BYOK_API_KEYS.map((key) => ({ ...key, channel: `save-${key.base}-key` })),
  ...[
    ["corti-client-id", "cortiClientId", "saveCortiClientId"],
    ["corti-client-secret", "cortiClientSecret", "saveCortiClientSecret"],
    ["custom-transcription-key", "customTranscriptionApiKey", "saveCustomTranscriptionKey"],
    ["cleanup-custom-key", "cleanupCustomApiKey", "saveCleanupCustomKey"],
    ["bedrock-access-key-id", "bedrockAccessKeyId", "saveBedrockAccessKeyId"],
    ["bedrock-secret-access-key", "bedrockSecretAccessKey", "saveBedrockSecretAccessKey"],
    ["bedrock-session-token", "bedrockSessionToken", "saveBedrockSessionToken"],
    ["azure-api-key", "azureApiKey", "saveAzureApiKey"],
    ["vertex-api-key", "vertexApiKey", "saveVertexApiKey"],
  ].map(([channel, storeKey, save]) => ({
    channel: `save-${channel}`,
    storeKey,
    save,
    get: save.replace(/^save/, "get"),
  })),
];
const handlers = new Map();
const keys = new Map();
const notifications = [];
const editor = { id: 1 };
const windows = [1, 2, 3].map((id) => ({
  isDestroyed: () => id === 3,
  webContents: { id, send: (...args) => notifications.push([id, ...args]) },
}));
let fetchToken = async (key) => `token-${key}`;
const environmentManager = Object.fromEntries(
  bindings.flatMap(({ get, save, storeKey }) => [
    [get, () => keys.get(storeKey) || ""],
    [
      save,
      (key) => {
        keys.set(storeKey, key);
        return { success: true };
      },
    ],
  ])
);

class FakeStreaming {
  warmToken = null;
  cachedToken = null;
  isConnected = false;
  adoptMode() {}
  beginConnecting() {}
  setTokenRefreshFn() {}
  getCachedToken() {
    return this.cachedToken;
  }
  cacheToken(token) {
    this.cachedToken = token;
  }
  hasWarmConnection() {
    return this.warmToken !== null;
  }
  cleanupWarmConnection() {
    this.warmToken = null;
  }
  async warmup({ token }) {
    this.warmToken = token;
  }
  async connect({ token, apiKey }) {
    this.token = this.warmToken || token || apiKey;
    this.warmToken = null;
    this.isConnected = true;
  }
  async disconnect() {
    this.isConnected = false;
    this.warmToken = null;
    return { text: "" };
  }
}
class FakeOrukeet extends FakeStreaming {}

const modulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const electron = {
  app: {
    getPath: () => "/tmp",
    getName: () => "test",
    getVersion: () => "0.0.0",
    on() {},
    isPackaged: false,
  },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeHandler() {} },
  BrowserWindow: {
    getAllWindows: () => windows,
    fromWebContents: () => windows[1],
  },
  net: {
    fetch: async (_url, init) => ({
      ok: true,
      json: async () => ({ token: await fetchToken(init.headers.Authorization) }),
    }),
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
};
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electron;
  if (parent?.filename === modulePath) {
    if (
      [
        "./assemblyAiStreaming",
        "./deepgramStreaming",
        "./cortiStreaming",
        "./openaiRealtimeStreaming",
      ].includes(request)
    )
      return FakeStreaming;
    if (request === "./orukeetStreaming")
      return { OrukeetStreaming: FakeOrukeet, MANAGED_STREAM_OPTIONS: {} };
    if (request === "./geminiLiveStreaming")
      return { GeminiLiveStreaming: FakeStreaming, GEMINI_LIVE_MODEL: "gemini-live" };
    if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
  }
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});

function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}
const target = {
  environmentManager,
  assemblyAiStreaming: null,
  deepgramStreaming: null,
  cortiStreaming: null,
  geminiStreaming: null,
  _dictationStreaming: null,
  _dictationConnectPromise: null,
  _dictationIdleTimer: null,
  _mintStoredCortiToken: async () => ({
    token: await fetchToken(environmentManager.getCortiClientSecret()),
    environment: "us",
    tenant: "base",
  }),
};
test.before(() => {
  const IPCHandlers = require(modulePath);
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
});
const invoke = (channel, ...args) => handlers.get(channel)({ sender: editor }, ...args);

test("every secret saver notifies peers by name only, including removal", () => {
  for (const { channel, storeKey, get } of bindings) {
    for (const value of ["secret-sentinel", ""]) {
      notifications.length = 0;
      assert.deepEqual(invoke(channel, value), { success: true });
      assert.equal(environmentManager[get](), value);
      assert.deepEqual(notifications, [[2, "api-key-updated", storeKey]]);
    }
  }
  assert.throws(
    () => invoke("save-custom-transcription-key", { key: "secret-sentinel" }),
    TypeError
  );
});

for (const [provider, property, saveChannel, usesToken] of [
  ["assemblyai", "assemblyAiStreaming", "save-assemblyai-key", true],
  ["deepgram", "deepgramStreaming", "save-deepgram-key", false],
  ["corti", "cortiStreaming", "save-corti-client-secret", true],
  ["gemini", "geminiStreaming", "save-gemini-key", false],
]) {
  test(`${provider}: BYOK skips warmup and uses the new key at start`, async () => {
    target[property] = null;
    fetchToken = async (key) => `token-${key}`;
    invoke(saveChannel, "A");
    assert.deepEqual(await invoke(`${provider}-streaming-warmup`, { mode: "byok" }), {
      success: true,
      skipped: true,
    });
    assert.equal(target[property], null);
    assert.equal((await invoke(`${provider}-streaming-start`, { mode: "byok" })).success, true);
    assert.equal(target[property].token, usesToken ? "token-A" : "A");
    target[property].warmToken = "stale-token";
    target[property].cachedToken = "stale-token";
    invoke(saveChannel, "B");
    assert.equal((await invoke(`${provider}-streaming-start`, { mode: "byok" })).success, true);
    assert.equal(target[property].token, usesToken ? "token-B" : "B");
  });
}

for (const [provider, saveChannel] of [
  ["openai-realtime", "save-openai-key"],
  ["tinfoil-realtime", "save-tinfoil-key"],
  ["orukeet", "save-custom-transcription-key"],
]) {
  test(`${provider}: BYOK opens a fresh connection for each start`, async () => {
    target._dictationStreaming = null;
    const options = { mode: "byok", provider, baseUrl: "https://example.com/v1" };
    invoke(saveChannel, "A");
    assert.deepEqual(await invoke("dictation-realtime-warmup", options), {
      success: true,
      skipped: true,
    });
    assert.equal(target._dictationStreaming, null);
    assert.equal((await invoke("dictation-realtime-start", options)).success, true);
    const previous = target._dictationStreaming;
    assert.equal(previous.token, "A");
    invoke(saveChannel, "B");
    assert.equal((await invoke("dictation-realtime-start", options)).success, true);
    assert.notEqual(target._dictationStreaming, previous);
    assert.equal(target._dictationStreaming.token, "B");
  });
}

test("Tinfoil does not prewarm even when the saved mode is managed", async () => {
  assert.deepEqual(
    await invoke("dictation-realtime-warmup", { mode: "openwhispr", provider: "tinfoil-realtime" }),
    { success: true, skipped: true }
  );
});

test("an unknown realtime provider still fails closed", async () => {
  const result = await invoke("dictation-realtime-warmup", { mode: "byok", provider: "unknown" });
  assert.equal(result.success, false);
  assert.match(result.error, /Unsupported realtime token provider/);
});
