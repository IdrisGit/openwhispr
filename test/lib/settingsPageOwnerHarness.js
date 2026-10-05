const { mountAuditDom } = require("./settingsAuditHarness");
const { createRendererServer } = require("./rendererTestHarness");

// Keep SettingsPage, its dialogs, ProfileSection and settings-store actions real.
// Unvisited feature surfaces and external account/policy services are boundaries.
async function mountSettingsPageOwner(t, { section = "system" } = {}) {
  const mounted = await mountAuditDom(t);
  const observed = (globalThis.__settingsPageOwner = { toasts: [] });
  t.after(() => delete globalThis.__settingsPageOwner);
  const empty = "export default function Stub() { return null; }";
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-page-owner-",
    noExternal: ["react-i18next"],
    mockModules: {
      ...Object.fromEntries(
        [
          "/ui/MicPermissionWarning",
          "/ui/MicrophoneSettings",
          "/ui/PermissionCard",
          "/ui/PasteToolsInfo",
          "/ui/NixOsPasteInfo",
          "/ui/LanguageSelector",
          "/DeveloperSection",
          "/settings/GpuDeviceSelector",
          "/settings/LlmsSection",
          "/settings/SystemUpdates",
          "/settings/HotkeysSection",
          "/settings/WorkspaceSection",
          "/settings/WorkspaceBillingOverview",
          "/settings/EnterpriseCheckoutDialog",
          "/CreateWorkspaceDialog",
          "/SelfHostedPanel",
          "/TranscriptionModelPicker",
        ].map((suffix) => [suffix, empty])
      ),
      "react-i18next": `const t = (key, options) => options?.returnObjects ? [] : key; export const useTranslation = () => ({t, i18n: {language: "en"}});`,
      "/i18n": `export const normalizeUiLanguage = value => value || "en"; export default {language: "en", changeLanguage: async () => {}};`,
      "/hooks/useAuth": `
        import { create } from "zustand";
        const useAuthState = create(() => ({isSignedIn: true, isLoaded: true, user: {id: "account-a", name: "Same name"}, refetch: () => globalThis.__settingsPageOwner.refetch?.()}));
        globalThis.__settingsPageOwner.auth = useAuthState;
        export const useAuth = () => useAuthState();
      `,
      "/hooks/usePolicy": `export const usePolicySnapshot = () => ({status: "unmanaged", policy: null}); export const usePolicyModeOptions = modes => ({modes});`,
      "/stores/policyStore": `const state = {status: "unmanaged", policy: null}; export const usePolicyStore = select => select(state); usePolicyStore.getState = () => state;`,
      "/stores/enterpriseIdentityStore": `export const useManagedScopeResolution = () => ({kind: "unmanaged"}); export const getManagedScopeResolution = () => ({kind: "unmanaged"});`,
      "/stores/workspaceStore": `const state = {workspaces: [], loaded: false}; export const useWorkspaceStore = select => select(state);`,
      "/stores/noteStore.js": `export const useMigration = () => null; export const startMigration = async () => {}; export const loadFolders = () => {}; export const initializeNotesTree = () => {};`,
      "/stores/meetingRecordingStore": `export const stopRecording = async () => {};`,
      "/services/SyncService.js": `export const syncService = {purgeTeamSpacesForSignOut: async () => {}, scheduleSettingsPush() {}};`,
      "/lib/auth": `
        export const AUTH_URL = "https://auth.example.test";
        export const signOut = async () => {};
        export const hasCredentialAccount = () => globalThis.__settingsPageOwner.hasCredentialAccount?.() ?? Promise.resolve(false);
        export const updateDisplayName = name => globalThis.__settingsPageOwner.updateDisplayName(name);
        export const changePassword = values => globalThis.__settingsPageOwner.changePassword(values);
      `,
      "/lib/authRequestContext": `export const getValidatedAuthGeneration = () => globalThis.__settingsPageOwner.authGeneration ?? null; export const getBoundSessionGeneration = id => id === globalThis.__settingsPageOwner.auth.getState().user?.id ? getValidatedAuthGeneration() : null;`,
      "/hooks/useSettings": `export const useAutoLearnCorrections = () => ({});`,
      "/hooks/usePermissions": `export const usePermissions = () => ({});`,
      "/hooks/useSystemAudioPermission": `export const useSystemAudioPermission = () => ({});`,
      "/hooks/useInsightsSyncOptIn": `export const useInsightsSyncOptIn = () => ({});`,
      "/hooks/useLeaderboardParticipation": `export const useLeaderboardParticipation = () => ({});`,
      "/hooks/useBillingPortal": `export const useBillingPortal = () => ({});`,
      "/hooks/useUsage": `export const useUsage = () => globalThis.__settingsPageOwner.usage ?? {};`,
      "/hooks/useTheme": `export const useTheme = () => ({});`,
      "/ui/useToast": `const toast = value => globalThis.__settingsPageOwner.toasts.push(value); export const useToast = () => ({toast});`,
      "/ui/useSettingsLayout": `export const useSettingsLayout = () => ({isCompact: false});`,
      "/models/ModelRegistry": `export const getTranscriptionProvider = () => null; export const enterpriseProviderName = id => id; export const getMeetingStreamingTranscriptionProviders = () => [];`,
      "/utils/logger": `export default {info() {}, warn() {}, error() {}, debug() {}};`,
    },
  });
  const { default: SettingsPage } = await vite.ssrLoadModule("/components/SettingsPage.tsx");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { createSettingsNavigationStore } = await vite.ssrLoadModule(
    "/stores/settingsNavigationStore.ts"
  );
  const navigation = createSettingsNavigationStore();
  navigation.getState().openSettings(section);
  return { ...mounted, observed, store: useSettingsStore, navigation, SettingsPage };
}

module.exports = { mountSettingsPageOwner };
