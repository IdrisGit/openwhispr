const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("SettingsPage leaves retained Speech owners alone on unrelated updates", async (t) => {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  const originalDocument = globalThis.document;
  const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__settingsSpeech;
    globalThis.document = originalDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct;
    await dom.happyDOM.close();
  });
  installBrowserGlobals(t);
  globalThis.window = dom;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.electronAPI = {};
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const observed = (globalThis.__settingsSpeech = {
    renders: { dictation: 0, meeting: 0, upload: 0 },
    pickers: {},
    mounted: 0,
    disposed: 0,
    pageRenders: 0,
    vadRenders: 0,
    inputs: [],
    modes: [],
    buttons: [],
    rows: [],
    toasts: [],
    registered: [],
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
          updateTranscriptionSettings: values => set(values),
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
      "/hooks/useHotkeyRegistration": `export const useHotkeyRegistration = () => ({ registerHotkey: key => globalThis.__settingsSpeech.registered.push(key) });`,
      "/hooks/useHotkeyModeInfo": `export const useHotkeyModeInfo = () => ({});`,
      "/hooks/useBillingPortal": `export const useBillingPortal = () => ({});`,
      "/hooks/useUsage": `export const useUsage = () => ({});`,
      "/hooks/useTheme": `export const useTheme = () => ({});`,
      "/ui/useToast": `const toast = value => globalThis.__settingsSpeech.toasts.push(value); export const useToast = () => ({toast});`,
      "/ui/button": `import React from "react"; export function Button(props) { globalThis.__settingsSpeech.buttons.push(props); return React.createElement("button", {onClick: props.onClick, disabled: props.disabled}, props.children); }`,
      "/ui/useSettingsLayout": `export const useSettingsLayout = () => ({isCompact: false});`,
      "/models/ModelRegistry": `export const getTranscriptionProvider = () => null; export const enterpriseProviderName = id => id; export const getMeetingStreamingTranscriptionProviders = () => [];`,
      "/ui/dialog": `export const ConfirmDialog = () => null; export const AlertDialog = ConfirmDialog; export const Dialog = ConfirmDialog; export const DialogContent = ConfirmDialog; export const DialogHeader = ConfirmDialog; export const DialogTitle = ConfirmDialog; export const DialogDescription = ConfirmDialog; export const DialogFooter = ConfirmDialog;`,
      "/ui/popover": `export const Popover = ({children}) => children; export const PopoverTrigger = Popover; export const PopoverContent = () => null;`,
      "/ui/select": `import React from "react"; export const Select = ({children}) => children; export const SelectTrigger = ({children, ...props}) => React.createElement("button", props, children); export const SelectValue = () => null; export const SelectContent = () => null; export const SelectItem = ({children}) => children;`,
      "/ui/SettingsSection": `
        import React from "react";
        export const SettingsPanel = ({children}) => children;
        export const SettingsPanelRow = SettingsPanel;
        export function SettingsRow(props) { globalThis.__settingsSpeech.rows.push(props); return props.children; }
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
      "/utils/platform": `export const getPlatform = () => "linux"; export const getCachedPlatform = getPlatform;`,
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

  await t.test(
    "General's Chinese script control preserves native options and store updates",
    async () => {
      await update({ preferredLanguage: "auto", chineseScriptPreference: "simplified" });
      observed.locale.setState({ t: (key) => key });
      root = createRoot(container);
      await render("general");
      const select = container.querySelector(
        'select[aria-label="settings.language.chineseScriptLabel"]'
      );
      assert.ok(select);
      assert.equal(select.value, "simplified");
      assert.deepEqual(
        [...select.options].map((option) => option.value),
        ["as-transcribed", "simplified", "traditional"]
      );
      await React.act(async () => {
        select.value = "traditional";
        select.dispatchEvent(new dom.Event("change", { bubbles: true }));
      });
      assert.equal(observed.store.getState().chineseScriptPreference, "traditional");
      await update({ preferredLanguage: "en" });
      assert.equal(
        container.querySelector('select[aria-label="settings.language.chineseScriptLabel"]'),
        null
      );
      await update({ preferredLanguage: "auto" });
      assert.equal(
        container.querySelector('select[aria-label="settings.language.chineseScriptLabel"]').value,
        "traditional"
      );
      await React.act(async () => root.unmount());
      root = null;
    }
  );

  await t.test(
    "Settings reads ignore older entries and preserve completed startup read-back",
    async (scope) => {
      scope.after(async () => {
        if (root) await React.act(async () => root.unmount());
        root = null;
      });
      observed.locale.setState({ t: (key) => key });
      await update({ dictationKey: "F8", noteFilesEnabled: true, noteFilesPath: "" });
      const api = globalThis.window.electronAPI;
      const startup = [];
      const paths = [];
      const diagnostics = [];
      const defaults = [];
      const pending = (queue) => new Promise((resolve, reject) => queue.push({ resolve, reject }));
      api.getAutoStartEnabled = () => pending(startup);
      api.setAutoStartEnabled = async () => ({ success: true });
      api.noteFilesGetDefaultPath = () => pending(paths);
      api.getYdotoolStatus = () => pending(diagnostics);
      api.getEffectiveDefaultHotkey = () => pending(defaults);
      const toggle = () =>
        container.querySelector('[aria-label="settingsPage.general.startup.launchAtLogin"]');
      root = createRoot(container);
      await render("workspace");
      assert.deepEqual(
        [startup.length, paths.length, diagnostics.length, defaults.length],
        [0, 0, 0, 0]
      );
      await render("general");
      assert.equal(defaults.length, 0, "General does not read the Hotkeys default");
      await React.act(async () => startup[0].resolve({ enabled: false, requiresApproval: false }));
      assert.equal(toggle().disabled, false);
      await render("workspace");
      await render("general");
      assert.equal(
        toggle().disabled,
        true,
        "a fresh entry is pending, not a usable stale OS value"
      );
      await render("workspace");
      await render("general");
      await React.act(async () => {
        startup[2].resolve({ enabled: false, requiresApproval: false });
        paths[2].resolve("/fresh-notes");
        diagnostics[2].resolve({
          isLinux: true,
          isWayland: true,
          hasYdotool: true,
          hasYdotoold: true,
          hasWtype: true,
          daemonRunning: true,
          hasUinput: true,
          hasUdevRule: true,
          hasGroup: true,
          isWlroots: true,
        });
      });
      await React.act(async () => toggle().click());
      assert.equal(startup.length, 4, "successful startup write reads the OS back");
      await React.act(async () => startup[3].resolve({ enabled: true, requiresApproval: true }));
      await React.act(async () => {
        startup[1].resolve({ enabled: false, requiresApproval: false });
        paths[1].resolve("/obsolete-notes");
        diagnostics[1].resolve({ isLinux: false, isWayland: false });
      });
      assert.equal(toggle().getAttribute("aria-checked"), "true");
      assert.equal(toggle().disabled, false);
      const pathHint = () =>
        observed.rows.findLast((row) => row.label === "settings.noteFiles.path").description.props
          .children;
      assert.equal(pathHint(), "/fresh-notes");
      assert.ok(container.textContent.includes("settingsPage.general.waylandPaste.title"));
      assert.ok(
        container.querySelector('[aria-label="settingsPage.general.waylandPaste.recheck"]')
      );
      await render("hotkeys");
      await render("workspace");
      await render("hotkeys");
      await React.act(async () => defaults[1].resolve("F10"));
      await React.act(async () => defaults[0].resolve("F9"));
      const reset = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("resetToDefault")
      );
      await React.act(async () => reset.click());
      assert.equal(observed.registered.at(-1), "F10");
      await render("general");
      await React.act(async () => {
        startup.at(-1).reject(new Error("unavailable"));
        paths.at(-1).reject(new Error("unavailable"));
        diagnostics.at(-1).reject(new Error("unavailable"));
      });
      assert.equal(
        toggle().getAttribute("aria-checked"),
        "true",
        "failed reads retain valid state"
      );
      assert.equal(toggle().disabled, false);
      assert.equal(pathHint(), "/fresh-notes");
      let finishWrite;
      api.setAutoStartEnabled = () =>
        new Promise((resolve) => {
          finishWrite = resolve;
        });
      await React.act(async () => toggle().click());
      await render("workspace");
      const readsBeforeHiddenWrite = startup.length;
      await React.act(async () => finishWrite({ success: true }));
      assert.equal(
        startup.length,
        readsBeforeHiddenWrite + 1,
        "completed hidden write still reconciles OS state"
      );
      await React.act(async () =>
        startup.at(-1).resolve({ enabled: false, requiresApproval: false })
      );
      await render("general");
      await React.act(async () =>
        startup.at(-1).resolve({ enabled: true, requiresApproval: false })
      );
      await React.act(async () => toggle().click());
      await React.act(async () => root.unmount());
      root = null;
      const readsAtClose = startup.length;
      await React.act(async () => finishWrite({ success: true }));
      assert.equal(startup.length, readsAtClose, "closed owner cannot start a late read-back");
      await React.act(async () => {
        paths[0].resolve("/closed-notes");
        diagnostics[0].resolve({ isLinux: false, isWayland: false });
      });
      api.getAutoStartEnabled = async () => ({ enabled: false, requiresApproval: false });
      api.noteFilesGetDefaultPath = async () => "/reopened-notes";
      api.getYdotoolStatus = async () => ({ isLinux: false, isWayland: false });
      root = createRoot(container);
      await render("general");
      assert.equal(toggle().getAttribute("aria-checked"), "false");
      assert.equal(pathHint(), "/reopened-notes");
      await React.act(async () => root.unmount());
      root = null;
    }
  );

  await t.test(
    "Privacy refreshes audio usage and reports partial deletion instead of success",
    async () => {
      observed.locale.setState({
        t: (key, options) => (options?.count ? `${key}:${options.count}` : key),
      });
      const api = globalThis.window.electronAPI;
      api.getAudioStorageUsage = async () => ({ fileCount: 5, totalBytes: 500 });
      root = createRoot(container);
      await render("privacyData");
      await render("workspace");
      let resolveOldUsage;
      api.getAudioStorageUsage = () =>
        new Promise((resolve) => {
          resolveOldUsage = resolve;
        });
      await render("privacyData");
      let usageReads = 0;
      api.getAudioStorageUsage = async () => {
        usageReads++;
        return { fileCount: 2, totalBytes: 100 };
      };
      api.deleteAllAudio = async () => ({ deleted: 3, deletedIds: ["1", "2", "3"], failed: true });
      const clearButton = () =>
        observed.buttons.findLast(
          (button) => button.children === "settingsPage.privacy.clearAllAudio"
        );
      assert.equal(clearButton().disabled, false);
      await React.act(async () => clearButton().onClick());
      assert.equal(usageReads, 1);
      assert.deepEqual(observed.toasts.at(-1), { title: "common.error", variant: "destructive" });
      const usageRow = () =>
        observed.rows.findLast((row) => row.label === "settingsPage.privacy.audioStorageUsage");
      assert.equal(usageRow().description, "settingsPage.privacy.audioStorageFiles:2");
      await React.act(async () => resolveOldUsage({ fileCount: 20, totalBytes: 2000 }));
      assert.equal(
        usageRow().description,
        "settingsPage.privacy.audioStorageFiles:2",
        "old mount usage cannot overwrite post-delete evidence"
      );
      assert.equal(clearButton().disabled, false);
      api.deleteAllAudio = async () => ({ deleted: 2, deletedIds: ["4", "5"], failed: false });
      api.getAudioStorageUsage = async () => ({ fileCount: 0, totalBytes: 0 });
      await React.act(async () => clearButton().onClick());
      assert.deepEqual(observed.toasts.at(-1), {
        title: "settingsPage.privacy.clearAllAudio",
        variant: "default",
      });
      assert.equal(usageRow().description, "settingsPage.privacy.audioStorageEmpty");
      assert.equal(clearButton().disabled, true);
    }
  );
});
