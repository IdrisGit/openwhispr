const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const fs = require("node:fs");
const path = require("node:path");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("hidden note and upload panels select only their own preferences", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__speechOwnerStore;
    delete globalThis.__speechOwnerRenders;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  globalThis.__speechOwnerRenders = { meeting: 0, upload: 0, pickers: [] };
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-speech-panel-selectors-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = (key) => key; export function useTranslation() { return { t }; }`,
      "/stores/settingsStore": `
        import { create } from "zustand";
        export const useSettingsStore = create((set) => ({
          isSignedIn: true,
          meetingTranscriptionMode: "local",
          meetingLocalTranscriptionProvider: "whisper",
          meetingWhisperModel: "base",
          uploadTranscriptionMode: "providers",
          uploadCloudTranscriptionProvider: "openai",
          uploadCloudTranscriptionModel: "whisper-1",
          speakerDiarizationEnabled: false,
          unrelated: 0,
        }));
        globalThis.__speechOwnerStore = useSettingsStore;
        export const TRANSCRIPTION_ENTERPRISE_POLICY_PROVIDER_IDS = [];
        export const TRANSCRIPTION_POLICY_PROVIDER_IDS = [];
      `,
      "/hooks/usePolicy": `
        const policy = {};
        export function usePolicySnapshot() { return policy; }
        export function usePolicyModeOptions(modes, scope, current) {
          return { modes, effectiveMode: current, isModeAllowed: () => true };
        }
      `,
      "/stores/policyRules": `
        export const isModeAllowedByPolicy = () => false;
        export const isEnterpriseTranscriptionOfferable = () => false;
      `,
      "/models/ModelRegistry": `export const getMeetingStreamingTranscriptionProviders = () => [];`,
      "/components/icons": `
        export const Cloud = () => null; export const Key = () => null;
        export const Cpu = () => null; export const Network = () => null;
        export const ShieldCheck = () => null;
      `,
      "/ui/SettingsSection": `
        import React from "react";
        export function InferenceModeSelector({activeMode}) {
          globalThis.__speechOwnerRenders[activeMode === "local" ? "meeting" : "upload"]++;
          return React.createElement("span", null, activeMode);
        }
        export const SettingsRow = ({children}) => children;
      `,
      "/ui/toggle": `export const Toggle = () => null;`,
      "/TranscriptionModelPicker": `export default function TranscriptionModelPicker(props) {
        globalThis.__speechOwnerRenders.pickers.push({context: props.transcriptionContext, model: props.selectedLocalModel, mode: props.mode});
        return null;
      }`,
      "/SelfHostedPanel": `export default function SelfHostedPanel() { return null; }`,
    },
  });
  const { MeetingTranscriptionPanel } = await vite.ssrLoadModule(
    "/components/settings/MeetingSettings.tsx"
  );
  const { UploadTranscriptionPanel } = await vite.ssrLoadModule(
    "/components/settings/UploadSettings.tsx"
  );
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { hidden: true },
          React.createElement(MeetingTranscriptionPanel)
        ),
        React.createElement("div", { hidden: true }, React.createElement(UploadTranscriptionPanel))
      )
    )
  );
  assert.deepEqual(globalThis.__speechOwnerRenders, {
    meeting: 1,
    upload: 1,
    pickers: [
      { context: "meeting", model: "base", mode: "local" },
      { context: "upload", model: undefined, mode: "cloud" },
    ],
  });
  await React.act(async () => globalThis.__speechOwnerStore.setState({ unrelated: 1 }));
  assert.deepEqual(
    [globalThis.__speechOwnerRenders.meeting, globalThis.__speechOwnerRenders.upload],
    [1, 1],
    "unrelated settings do not rerender retained hidden panels"
  );
  await React.act(async () =>
    globalThis.__speechOwnerStore.setState({ meetingWhisperModel: "small" })
  );
  assert.deepEqual(
    [globalThis.__speechOwnerRenders.meeting, globalThis.__speechOwnerRenders.upload],
    [2, 1],
    "meeting model changes only reach meeting"
  );
  assert.deepEqual(globalThis.__speechOwnerRenders.pickers.at(-1), {
    context: "meeting",
    model: "small",
    mode: "local",
  });
  await React.act(async () =>
    globalThis.__speechOwnerStore.setState({ uploadCloudTranscriptionModel: "new-model" })
  );
  assert.deepEqual(
    [globalThis.__speechOwnerRenders.meeting, globalThis.__speechOwnerRenders.upload],
    [2, 2]
  );
  const settingsPage = fs.readFileSync(
    path.join(__dirname, "../../src/components/SettingsPage.tsx"),
    "utf8"
  );
  assert.match(
    settingsPage,
    /<MeetingTranscriptionPanel \/>\s*\{meetingTranscriptionMode === "local" &&\s*meetingLocalTranscriptionProvider === "whisper"/
  );
});
