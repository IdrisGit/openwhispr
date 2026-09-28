const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("Prompt Studio tests are request-local and cannot revert concurrent saves", async (t) => {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const originalDocument = globalThis.document;
  const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    globalThis.document = originalDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct;
    delete globalThis.__promptStudio;
    await dom.happyDOM.close();
  });
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const observed = (globalThis.__promptStudio = { calls: [], writes: [] });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-prompt-studio-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = key => key; export const useTranslation = () => ({t});`,
      "/i18n": `export const normalizeUiLanguage = value => value; export default { getFixedT: () => (key, options) => options.defaultValue };`,
      "/hooks/usePolicy": `const policy = {}; export const usePolicySnapshot = () => policy;`,
      "/utils/agentName": `export const useAgentName = () => ({agentName: "Whisper"});`,
      "/models/ModelRegistry": `export const getModelProvider = () => "openai";`,
      "/utils/logger": `export default {debug() {}, error() {}};`,
      "/utils/snippets": `export const getDictionaryHintWords = () => ["OpenWhispr"];`,
      "/helpers/dictationAgentInference": `export const resolveDictationAgentInference = () => ({reachable: true, model: "auto", displayProvider: "openwhispr", config: {provider: "openwhispr"}});`,
      "/helpers/dictationTranslationInference": `export const resolveDictationTranslationInference = () => ({reachable: true, model: "auto", displayProvider: "openwhispr", config: {provider: "openwhispr", inferenceScope: "dictationTranslation"}});`,
      "/stores/settingsStore": `
        import { create } from "zustand";
        export const useSettingsStore = create(set => ({
          uiLanguage: "en", preferredLanguage: "fr",
          useCleanupModel: true, cleanupModel: "auto", cleanupDisableThinking: true,
          useDictationAgent: true, dictationAgentMode: "openwhispr", dictationAgentModel: "auto",
          useDictationTranslation: true, translationMode: "openwhispr", translationModel: "auto",
          translationTargetLanguage: "es", translationRemoteUrl: "",
          customPrompts: {cleanup: "Saved {{agentName}}", dictationAgent: "Saved {{agentName}}", translate: "Saved {{agentName}}"},
          setCustomPrompt: (kind, value) => {
            globalThis.__promptStudio.writes.push({kind, value});
            set(s => ({customPrompts: {...s.customPrompts, [kind]: value}}));
          },
        }));
        globalThis.__promptStudio.store = useSettingsStore;
        export const selectPolicyEffectiveSettings = s => s;
        export const selectIsCloudCleanupMode = () => true;
        export const selectIsCloudDictationAgentMode = () => true;
        export const selectIsCloudTranslationMode = () => true;
      `,
      "/services/ReasoningService": `export default { processText(...args) {
        globalThis.__promptStudio.calls.push(args);
        return new Promise((resolve, reject) => { globalThis.__promptStudio.pending = {resolve, reject}; });
      }};`,
      "/hooks/useDialogs": `export const useDialogs = () => ({alertDialog: {}, showAlertDialog() {}, hideAlertDialog() {}});`,
      "./dialog": `export const AlertDialog = () => null;`,
      "./button": `import React from "react"; export const Button = ({children, onClick, disabled}) => React.createElement("button", {onClick, disabled}, children);`,
      "./textarea": `export function Textarea(props) { if (props.rows === 16) globalThis.__promptStudio.edit = props; return null; }`,
    },
  });
  const { default: PromptStudio } = await vite.ssrLoadModule("/components/ui/PromptStudio.tsx");
  const { resolvePrompt } = await vite.ssrLoadModule("/config/prompts/index.ts");
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = createRoot(container);
  const click = async (label) => {
    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent.includes(label)
    );
    assert.ok(button, `${label}: ${container.textContent}`);
    await React.act(async () => button.click());
  };
  const draft = "Test {{agentName}} to {{targetLanguage}}";
  for (const kind of ["cleanup", "dictationAgent", "translate"]) {
    for (const action of ["same", "different", "reset", "failure", "no-save"]) {
      await t.test(`${kind}: ${action}`, async (subtest) => {
        subtest.after(async () => {
          await React.act(async () => observed.pending?.resolve("settled"));
        });
        await React.act(async () => {
          observed.store.setState({ customPrompts: { [kind]: "Saved {{agentName}}" } });
          root.render(React.createElement(PromptStudio, { kind, key: `${kind}-${action}` }));
        });
        await click("promptStudio.tabs.customize");
        await React.act(async () => observed.edit.onChange({ target: { value: draft } }));
        await click("promptStudio.tabs.test");
        const writes = observed.writes.length;
        await click("promptStudio.test.run");
        assert.equal(observed.writes.length, writes, "testing never writes shared settings");
        assert.equal(
          resolvePrompt(kind, { agentName: "Whisper" }),
          "Saved Whisper",
          "a simultaneous ordinary request still resolves the saved prompt"
        );
        const config = observed.calls.at(-1)[3];
        if (kind === "cleanup") {
          assert.equal(config.cleanupPrompt, draft);
          assert.equal(
            config.systemPrompt,
            undefined,
            "cleanup must not become an agent-style request"
          );
          assert.equal(config.inferenceScope, "dictationCleanup");
          assert.equal(config.disableThinking, true);
        } else {
          assert.match(config.systemPrompt, /Test Whisper/);
          assert.match(config.systemPrompt, /OpenWhispr/);
          if (kind === "dictationAgent") {
            assert.equal(config.requiresAgent, true, "agent policy enforcement stays enabled");
            assert.equal(config.inferenceScope, "dictationAgent");
            assert.match(config.systemPrompt, /French|français/i);
          } else {
            assert.match(config.systemPrompt, /Spanish/);
            assert.equal(config.inferenceScope, "dictationTranslation");
          }
        }
        let saved = "Saved {{agentName}}";
        if (action !== "no-save") {
          await click("promptStudio.tabs.customize");
          if (action === "reset") {
            await click("promptStudio.common.reset");
            saved = "";
          } else {
            saved = action === "different" ? "Different saved text" : draft;
            await React.act(async () => observed.edit.onChange({ target: { value: saved } }));
            await click("promptStudio.common.save");
          }
        }
        const afterSave = observed.writes.length;
        await React.act(async () => {
          if (action === "failure") observed.pending.reject(new Error("test failure"));
          else observed.pending.resolve("result");
        });
        assert.equal(observed.store.getState().customPrompts[kind], saved);
        assert.equal(observed.writes.length, afterSave, "settling never restores an old prompt");
        await click("promptStudio.tabs.test");
        assert.match(
          container.textContent,
          action === "failure" ? /promptStudio.test.failed/ : /result/
        );
      });
    }
  }
});
