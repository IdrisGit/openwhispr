const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("SettingsPage leaves retained Speech owners alone on unrelated updates", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__settingsSpeech;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const observed = (globalThis.__settingsSpeech = {
    renders: { dictation: 0, meeting: 0, upload: 0 },
    pickers: {},
    mounted: 0,
    disposed: 0,
    pageRenders: 0,
    vadRenders: 0,
    inputs: [],
    modes: [],
  });
  const emptyComponent = "export default function Stub() { return null; }";
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-speech-ownership-",
    noExternal: ["react-i18next"],
    mockModules: {
      ...Object.fromEntries(
        [
          "/ui/MicPermissionWarning",
          "/ui/MicrophoneSettings",
          "/ui/PermissionCard",
          "/ui/PasteToolsInfo",
          "/ui/NixOsPasteInfo",
          "/ui/LinuxPttSetupInfo",
          "/ui/LanguageSelector",
          "/DeveloperSection",
          "/settings/GpuDeviceSelector",
          "/settings/LlmsSection",
          "/settings/SystemUpdates",
          "/settings/ProfileSection",
          "/settings/WorkspaceBillingOverview",
          "/settings/EnterpriseCheckoutDialog",
          "/CreateWorkspaceDialog",
          "/SelfHostedPanel",
        ].map((suffix) => [suffix, emptyComponent])
      ),
      "react-i18next": `
        import { create } from "zustand";
        const useLocale = create(() => ({ t: key => key }));
        globalThis.__settingsSpeech.locale = useLocale;
        export function useTranslation() { return { t: useLocale(s => s.t), i18n: { language: "en" } }; }
      `,
      "/stores/settingsStore": `
        import { create } from "zustand";
        export const useSettingsStore = create(set => ({
          isSignedIn: true, customDictionary: [], activationMode: "tap",
          transcriptionMode: "local", localTranscriptionProvider: "whisper", whisperModel: "base",
          useLocalWhisper: true, showTranscriptionPreview: false,
          meetingTranscriptionMode: "local", meetingLocalTranscriptionProvider: "whisper", meetingWhisperModel: "base",
          uploadTranscriptionMode: "local", uploadLocalTranscriptionProvider: "whisper", uploadWhisperModel: "base",
          whisperVadThreshold: 0.5, whisperVadMinSpeechDurationMs: 250,
          whisperVadMinSilenceDurationMs: 100, whisperVadMaxSpeechDurationS: 30,
          whisperVadSpeechPadMs: 30, whisperVadSamplesOverlap: 0.1,
          setWhisperModel: value => set({ whisperModel: value }),
          setWhisperVadThreshold: value => set({ whisperVadThreshold: value }),
        }));
        globalThis.__settingsSpeech.store = useSettingsStore;
        export const TRANSCRIPTION_ENTERPRISE_POLICY_PROVIDER_IDS = [];
        export const TRANSCRIPTION_POLICY_PROVIDER_IDS = [];
        export const clearMissingLocalModelSelections = () => {};
        export const reconcileLocalModelSelections = async () => {};
      `,
      "/hooks/useAuth": `
        import { create } from "zustand";
        const useAuthState = create(() => ({ isSignedIn: true, isLoaded: true }));
        globalThis.__settingsSpeech.auth = useAuthState;
        export const useAuth = () => useAuthState();
      `,
      "/hooks/usePolicy": `
        import { create } from "zustand";
        const usePolicy = create(() => ({ status: "unmanaged", policy: null, appVersion: null }));
        globalThis.__settingsSpeech.policy = usePolicy;
        export const usePolicySnapshot = () => usePolicy();
        export function usePolicyModeOptions(modes, scope, current) {
          const policy = usePolicy();
          return { modes, effectiveMode: policy.forcedMode ?? current, isModeAllowed: () => true };
        }
      `,
      "/stores/enterpriseIdentityStore": `export const useManagedScopeResolution = () => ({kind: "unmanaged"});`,
      "/stores/policyStore": `export const usePolicyStore = { getState: () => ({}) };`,
      "/stores/workspaceStore": `const state = { workspaces: [], loaded: false }; export const useWorkspaceStore = select => select(state);`,
      "/stores/noteStore.js": `export const useMigration = () => ({}); export const startMigration = () => {}; export const loadFolders = () => {}; export const initializeNotesTree = () => {};`,
      "/stores/meetingRecordingStore": `export const stopRecording = async () => {};`,
      "/services/SyncService.js": `export const syncService = {};`,
      "/lib/auth": `export const AUTH_URL = ""; export const signOut = async () => {};`,
      "/lib/accountDeletionRequest": `export const deleteAccount = async () => {};`,
      "/lib/authRequestContext": `export const getValidatedAuthGeneration = () => null;`,
      "/lib/usageStore": `export const highestPlan = () => "free";`,
      "/hooks/useSettings": `export const useAutoLearnCorrections = () => ({});`,
      "/hooks/useDialogs": `const noop = () => {}; export const useDialogs = () => ({ confirmDialog: {}, alertDialog: {}, showConfirmDialog: noop, showAlertDialog: noop, hideConfirmDialog: noop, hideAlertDialog: noop });`,
      "/hooks/usePermissions": `export const usePermissions = () => ({});`,
      "/hooks/useSystemAudioPermission": `export const useSystemAudioPermission = () => ({});`,
      "/hooks/useInsightsSyncOptIn": `export const useInsightsSyncOptIn = () => ({});`,
      "/hooks/useLeaderboardParticipation": `export const useLeaderboardParticipation = () => ({});`,
      "/hooks/useHotkeyRegistration": `export const useHotkeyRegistration = () => ({});`,
      "/hooks/useHotkeyModeInfo": `export const useHotkeyModeInfo = () => ({});`,
      "/hooks/useBillingPortal": `export const useBillingPortal = () => ({});`,
      "/hooks/useUsage": `export const useUsage = () => ({});`,
      "/hooks/useTheme": `export const useTheme = () => ({});`,
      "/ui/useToast": `const toast = () => {}; export const useToast = () => ({toast});`,
      "/ui/useSettingsLayout": `export const useSettingsLayout = () => ({isCompact: false});`,
      "/models/ModelRegistry": `export const getTranscriptionProvider = () => null; export const enterpriseProviderName = id => id; export const getMeetingStreamingTranscriptionProviders = () => [];`,
      "/ui/dialog": `export const ConfirmDialog = () => null; export const AlertDialog = ConfirmDialog; export const Dialog = ConfirmDialog; export const DialogContent = ConfirmDialog; export const DialogHeader = ConfirmDialog; export const DialogTitle = ConfirmDialog; export const DialogDescription = ConfirmDialog; export const DialogFooter = ConfirmDialog;`,
      "/ui/popover": `export const Popover = ({children}) => children; export const PopoverTrigger = Popover; export const PopoverContent = () => null;`,
      "/ui/SettingsSection": `
        import React from "react";
        export const SettingsPanel = ({children}) => children;
        export const SettingsPanelRow = SettingsPanel;
        export const SettingsRow = SettingsPanel;
        export function SectionHeader({title}) {
          if (title.includes("transcription.vad.title")) globalThis.__settingsSpeech.vadRenders++;
          return React.createElement("h3", null, title);
        }
        export function InferenceModeSelector(props) {
          globalThis.__settingsSpeech.modes.push(props);
          return null;
        }
      `,
      "/ui/input": `export function Input(props) { globalThis.__settingsSpeech.inputs.push(props); return null; }`,
      "/ui/toggle": `export const Toggle = () => null;`,
      "/ui/ProviderTabs": `export function ProviderTabs(props) { globalThis.__settingsSpeech.tabs = props; return null; }`,
      "/settings/WorkspaceSection": `export default function WorkspaceSection() { globalThis.__settingsSpeech.pageRenders++; return null; }`,
      "/TranscriptionModelPicker": `
        import React from "react";
        export default function Picker(props) {
          const context = props.transcriptionContext ?? "dictation";
          const [draft, setDraft] = React.useState("");
          const [progress, setProgress] = React.useState(0);
          const observed = globalThis.__settingsSpeech;
          observed.renders[context]++;
          observed.pickers[context] = {props, draft, setDraft, progress, setProgress};
          React.useEffect(() => { observed.mounted++; return () => observed.disposed++; }, []);
          return null;
        }
      `,
    },
  });
  const { default: SettingsPage } = await vite.ssrLoadModule("/components/SettingsPage.tsx");
  root = createRoot(container);
  const render = (activeSection, initialSubTab, subTabRequest) =>
    React.act(async () =>
      root.render(
        React.createElement(SettingsPage, { activeSection, initialSubTab, subTabRequest })
      )
    );
  const update = (values) => React.act(async () => observed.store.setState(values));

  await render("workspace");
  assert.equal(observed.mounted, 0, "Speech does not mount before first visit");
  await render("speechToText");
  assert.equal(observed.mounted, 3);
  assert.equal(observed.vadRenders, 2, "both local Whisper contexts show VAD");
  await React.act(async () => observed.pickers.dictation.setDraft("unsaved"));
  await render("workspace");
  const before = { ...observed.renders };
  const pageBefore = observed.pageRenders;
  await update({ customDictionary: ["OpenWhispr"] });
  assert.equal(observed.pageRenders, pageBefore + 1, "a real SettingsPage subscription updates");
  assert.deepEqual(
    observed.renders,
    before,
    "the parent update does not rebuild hidden Speech panels"
  );
  const pageAfter = observed.pageRenders;
  await update({ whisperModel: "small" });
  assert.equal(observed.pageRenders, pageAfter, "Dictation no longer updates SettingsPage");
  assert.equal(observed.pickers.dictation.props.selectedLocalModel, "small");
  assert.equal(observed.renders.meeting, before.meeting);
  assert.equal(observed.renders.upload, before.upload);
  await update({ meetingWhisperModel: "medium" });
  assert.equal(observed.pickers.meeting.props.selectedLocalModel, "medium");
  await update({ uploadWhisperModel: "tiny" });
  assert.equal(observed.pickers.upload.props.selectedLocalModel, "tiny");
  await React.act(async () => observed.pickers.dictation.setProgress(42));
  assert.equal(observed.pickers.dictation.draft, "unsaved");
  assert.equal(observed.pickers.dictation.progress, 42, "hidden child work stays live");

  const vadCount = () =>
    container.textContent.split("settingsPage.transcription.vad.title").length - 1;
  await update({ localTranscriptionProvider: "nvidia" });
  assert.equal(vadCount(), 1, "Meeting VAD is independent of Dictation provider");
  await update({ meetingLocalTranscriptionProvider: "nvidia" });
  assert.equal(vadCount(), 0);
  await update({
    localTranscriptionProvider: "whisper",
    meetingLocalTranscriptionProvider: "whisper",
  });
  assert.equal(vadCount(), 2);
  const pageBeforeVad = observed.pageRenders;
  const vadBefore = observed.vadRenders;
  const threshold = observed.inputs.findLast((input) => input.min === "0.1");
  await React.act(async () => threshold.onChange({ target: { value: "0.7" } }));
  assert.equal(observed.store.getState().whisperVadThreshold, 0.7);
  assert.equal(
    observed.vadRenders,
    vadBefore + 2,
    "both VAD views receive their shared preference"
  );
  assert.equal(observed.pageRenders, pageBeforeVad);

  await React.act(async () => observed.auth.setState({ isSignedIn: false }));
  assert.equal(observed.modes.at(-1).modes.find((mode) => mode.id === "openwhispr").disabled, true);
  await React.act(async () => observed.locale.setState({ t: (key) => "translated:" + key }));
  assert.match(container.textContent, /translated:settingsPage.transcription.vad.title/);
  await render("speechToText", "upload", {});
  assert.equal(observed.tabs.selectedId, "upload");
  await render("speechToText", "dictation", {});
  assert.equal(observed.tabs.selectedId, "dictation");
  assert.equal(observed.pickers.dictation.draft, "unsaved");
  assert.equal(observed.disposed, 0, "section and subtab changes retain picker lifetimes");
  await React.act(async () => observed.policy.setState({ forcedMode: "openwhispr" }));
  assert.equal(observed.disposed, 3, "a policy mode change still reaches retained children");
  await React.act(async () => observed.policy.setState({ forcedMode: undefined }));
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(observed.disposed, observed.mounted, "Settings close releases every mounted picker");
});
