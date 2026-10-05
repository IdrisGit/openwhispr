const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("useTheme ignores unrelated settings writes and synchronizes theme changes", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });

  installBrowserGlobals(t, {
    window: {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
  });
  const container = installHookDom(t);
  const classes = new Set();
  globalThis.document.documentElement.classList = {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
  };
  globalThis.document.body = { classList: globalThis.document.documentElement.classList };

  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-subscriptions-test-",
    mockModules: {
      "/stores/settingsStore": `
        import { create } from "zustand";
        export const useSettingsStore = create((set) => ({
          theme: "light",
          unrelated: 0,
          setTheme: (theme) => set({ theme }),
        }));
        globalThis.__settingsSubscriptionStore = useSettingsStore;
      `,
    },
  });
  const { useTheme } = await vite.ssrLoadModule("/hooks/useTheme.ts");
  const useSettingsStore = globalThis.__settingsSubscriptionStore;
  t.after(() => delete globalThis.__settingsSubscriptionStore);

  let themeRenders = 0;

  function ThemeProbe() {
    useTheme();
    themeRenders += 1;
    return null;
  }

  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(ThemeProbe)));
  assert.equal(classes.has("dark"), false);

  const initial = themeRenders;
  await React.act(async () => useSettingsStore.setState({ unrelated: 1 }));
  assert.equal(themeRenders, initial, "unrelated settings leave the actual theme hook alone");

  await React.act(async () => useSettingsStore.getState().setTheme("dark"));
  assert.equal(classes.has("dark"), true, "theme changes still synchronize the DOM");
  assert.equal(themeRenders, initial + 1);
});

test("SettingsProvider owns initialization and external synchronization once", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__settingsLifecycleStore;
  });

  const calls = {
    dictionarySubscribed: 0,
    dictionaryCleaned: 0,
    agentSubscribed: 0,
    agentCleaned: 0,
    agentCallback: null,
    snippetsSubscribed: 0,
    snippetsCleaned: 0,
    autoLearn: [],
    retention: 0,
    startup: 0,
    notifications: [],
  };
  const { storage } = installBrowserGlobals(t, {
    initialStorage: { autoLearnCorrections: "false" },
    window: {
      electronAPI: {
        onAgentNameChanged(callback) {
          calls.agentSubscribed += 1;
          calls.agentCallback = callback;
          return () => {
            calls.agentCleaned += 1;
            calls.agentCallback = null;
          };
        },
        onDictionaryUpdated() {
          calls.dictionarySubscribed += 1;
          return () => (calls.dictionaryCleaned += 1);
        },
        onSnippetsUpdated() {
          calls.snippetsSubscribed += 1;
          return () => (calls.snippetsCleaned += 1);
        },
        setAutoLearnEnabled(enabled) {
          calls.autoLearn.push(enabled);
        },
        syncRetentionSettings() {
          calls.retention += 1;
        },
        syncNotificationPreferences(prefs) {
          calls.notifications.push(prefs);
        },
        async syncStartupPreferences() {
          calls.startup += 1;
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-settings-lifecycle-test-",
    mockModules: {
      "/stores/settingsStore": `
        import { create } from "zustand";
        export const useSettingsStore = create(() => ({
          agentName: "OpenWhispr",
          customDictionary: [],
          updateCustomDictionary() {},
          applyCustomDictionaryFromExternal() {},
          applySnippetsFromExternal() {},
          audioRetentionDays: 30,
          transcriptRetentionDays: 365,
          dataRetentionEnabled: true,
          useLocalWhisper: false,
          localTranscriptionProvider: "whisper",
          whisperModel: "base",
          parakeetModel: "parakeet",
          cohereModel: "cohere",
          preferredLanguage: "auto",
          notificationsEnabled: true,
          notifyMeetingDetection: true,
          notifyCalendarReminders: true,
          meetingProcessDetection: true,
          useCleanupModel: true,
          cleanupMode: "openwhispr",
          cleanupModel: "",
          useDictationAgent: false,
          dictationAgentMode: "openwhispr",
          dictationAgentModel: "",
          unrelated: 0,
        }));
        export function selectLocalServerPrefs(state) {
          return {
            useCleanupModel: state.useCleanupModel,
            cleanupMode: state.cleanupMode,
            cleanupModel: state.cleanupModel,
            useDictationAgent: state.useDictationAgent,
            dictationAgentMode: state.dictationAgentMode,
            dictationAgentModel: state.dictationAgentModel,
          };
        }
        globalThis.__settingsLifecycleStore = useSettingsStore;
        export const getSettings = () => useSettingsStore.getState();
        let hasInitialized = false;
        export async function initializeSettings() {
          if (hasInitialized) return;
          hasInitialized = true;
          const state = useSettingsStore.getState();
          window.electronAPI.syncNotificationPreferences({
            notificationsEnabled: state.notificationsEnabled,
            notifyMeetingDetection: state.notifyMeetingDetection,
            notifyCalendarReminders: state.notifyCalendarReminders,
            meetingProcessDetection: state.meetingProcessDetection,
          });
        }
      `,
      "/stores/policyStore": `
        const state = { status: "unmanaged" };
        export function usePolicyStore(selector) { return selector(state); }
      `,
      "/stores/policyRules": `
        export const effectiveAudioRetentionDays = (_state, days) => days;
        export const effectiveLocalHistoryEnabled = (_state, enabled) => enabled;
        export const isLocalHistoryPolicyResolved = () => true;
        export const isPolicySettled = () => true;
      `,
      "/utils/logger": `export default { warn() {} };`,
    },
  });
  const { SettingsProvider, useAutoLearnCorrections } =
    await vite.ssrLoadModule("/hooks/useSettings.ts");

  let childRenders = 0;
  let setAutoLearnCorrections;
  function Child() {
    childRenders += 1;
    return null;
  }
  function AutoLearnProbe() {
    setAutoLearnCorrections = useAutoLearnCorrections().setAutoLearnCorrections;
    return null;
  }
  const child = React.createElement(
    React.Fragment,
    null,
    React.createElement(Child),
    React.createElement(AutoLearnProbe)
  );
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(SettingsProvider, null, child)));

  assert.deepEqual(
    [calls.dictionarySubscribed, calls.snippetsSubscribed],
    [1, 1],
    "each external listener has one renderer owner"
  );
  assert.deepEqual(calls.autoLearn, [false], "the persisted value syncs on startup");
  assert.equal(calls.retention, 1);
  assert.equal(calls.agentSubscribed, 1);
  storage.setItem("agentName", "ExternalName");
  await React.act(async () => calls.agentCallback());
  assert.equal(globalThis.__settingsLifecycleStore.getState().agentName, "ExternalName");
  assert.equal(calls.startup, 1);
  assert.equal(calls.notifications.length, 1, "startup sync has no duplicate on Settings mount");

  await React.act(async () => globalThis.__settingsLifecycleStore.setState({ unrelated: 1 }));
  assert.equal(calls.notifications.length, 1, "unrelated settings do not resend notifications");
  await React.act(async () =>
    globalThis.__settingsLifecycleStore.setState({ notifyMeetingDetection: false })
  );
  assert.deepEqual(calls.notifications.at(-1), {
    notificationsEnabled: true,
    notifyMeetingDetection: false,
    notifyCalendarReminders: true,
    meetingProcessDetection: true,
  });
  assert.equal(calls.notifications.length, 2, "changes sync even without Settings open");
  await React.act(async () =>
    globalThis.__settingsLifecycleStore.setState({ notifyMeetingDetection: false })
  );
  assert.equal(calls.notifications.length, 2, "unchanged preferences are not resent");
  assert.equal(childRenders, 1, "an unrelated setting does not invalidate renderer children");
  assert.deepEqual(calls.autoLearn, [false], "unrelated settings do not resend auto-learn");

  await React.act(async () => setAutoLearnCorrections(true));
  assert.equal(storage.getItem("autoLearnCorrections"), "true");
  assert.deepEqual(calls.autoLearn, [false, true]);
  await React.act(async () => setAutoLearnCorrections(true));
  assert.deepEqual(calls.autoLearn, [false, true], "an unchanged preference is not resent");
  await React.act(async () => setAutoLearnCorrections(false));
  assert.deepEqual(calls.autoLearn, [false, true, false]);

  await React.act(async () => root.unmount());
  root = null;
  assert.deepEqual([calls.dictionaryCleaned, calls.snippetsCleaned, calls.agentCleaned], [1, 1, 1]);
  globalThis.__settingsLifecycleStore.setState({ meetingProcessDetection: false });
  assert.equal(calls.notifications.length, 2, "subscription stops on unmount");

  // Remount/replay does not reset the module latch or republish the startup snapshot.
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(React.StrictMode, null, React.createElement(SettingsProvider, null))
    )
  );
  assert.equal(calls.notifications.length, 2, "remount/replay does not republish startup");
  assert.deepEqual(
    [
      calls.dictionarySubscribed - calls.dictionaryCleaned,
      calls.snippetsSubscribed - calls.snippetsCleaned,
      calls.agentSubscribed - calls.agentCleaned,
    ],
    [1, 1, 1],
    "remount/replay leaves one active listener per external source"
  );
  await React.act(async () =>
    globalThis.__settingsLifecycleStore.setState({ notifyCalendarReminders: false })
  );
  assert.deepEqual(calls.notifications.at(-1), {
    notificationsEnabled: true,
    notifyMeetingDetection: false,
    notifyCalendarReminders: false,
    meetingProcessDetection: false,
  });
  assert.equal(calls.notifications.length, 3, "StrictMode leaves one active preference listener");
});
