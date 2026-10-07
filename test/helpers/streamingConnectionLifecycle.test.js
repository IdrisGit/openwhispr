const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");

const AssemblyAiStreaming = require("../../src/helpers/assemblyAiStreaming");
const CortiStreaming = require("../../src/helpers/cortiStreaming");
const DeepgramStreaming = require("../../src/helpers/deepgramStreaming");
const OpenAIRealtimeStreaming = require("../../src/helpers/openaiRealtimeStreaming");

const clients = [
  ["OpenAI", OpenAIRealtimeStreaming, "_notifyConnectionLost"],
  ["AssemblyAI", AssemblyAiStreaming, "notifyConnectionLost"],
  ["Deepgram", DeepgramStreaming, "notifyConnectionLost"],
  ["Corti", CortiStreaming, "notifyConnectionLost"],
];

for (const [name, StreamingClient, notifyMethod] of clients) {
  test(`${name} reports one recoverable connection loss to meetings`, () => {
    const streaming = new StreamingClient();
    const recoveries = [];
    const errors = [];
    streaming.onConnectionLost = (error) => recoveries.push(error.message);
    streaming.onError = (error) => errors.push(error.message);

    streaming[notifyMethod](new Error("socket failed"));
    streaming[notifyMethod](new Error("duplicate close"));

    assert.deepEqual(recoveries, ["socket failed"]);
    assert.deepEqual(errors, []);
  });

  test(`${name} preserves the existing error path outside meetings`, () => {
    const streaming = new StreamingClient();
    const errors = [];
    streaming.onError = (error) => errors.push(error.message);

    streaming[notifyMethod](new Error("socket failed"));

    assert.deepEqual(errors, ["socket failed"]);
  });
}

// Completes each client's warm handshake: AssemblyAI waits for Begin, Corti for
// CONFIG_ACCEPTED after its config message, Deepgram only for the open.
async function withWarmServer(run) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "Begin", id: "warm-session" }));
    socket.on("message", (data, isBinary) => {
      if (!isBinary && JSON.parse(data).type === "config") {
        socket.send(JSON.stringify({ type: "CONFIG_ACCEPTED", sessionId: "warm-session" }));
      }
    });
  });
  try {
    await run(`ws://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ipcHandlers.js reads warmConnectionOptions to tell a warm socket opened before
// the latest key save from one opened after it.
for (const [name, StreamingClient] of [
  ["AssemblyAI", AssemblyAiStreaming],
  ["Deepgram", DeepgramStreaming],
  ["Corti", CortiStreaming],
]) {
  test(`${name} keeps the options its warm socket opened with until it is dropped`, async () => {
    await withWarmServer(async (url) => {
      const streaming = new StreamingClient();
      streaming.buildWebSocketUrl = () => url;
      const opened = { token: "t", environment: "us", tenant: "base", credentialGeneration: 1 };
      try {
        await streaming.warmup(opened);
        await streaming.warmup({ ...opened, credentialGeneration: 2 });
        assert.equal(streaming.hasWarmConnection(), true);
        assert.equal(streaming.warmConnectionOptions.credentialGeneration, 1);
        streaming.cleanupWarmConnection();
        assert.equal(streaming.warmConnectionOptions, null);
      } finally {
        streaming.cleanupWarmConnection();
      }
    });
  });
}
