import { getSettings, useSettingsStore } from "../stores/settingsStore";
import { agentNameDictionaryChanges } from "../helpers/agentNameDictionary";

const AGENT_NAME_KEY = "agentName";
const DEFAULT_AGENT_NAME = "OpenWhispr";

export const getAgentName = (): string => getSettings().agentName;

function syncAgentNameToDictionary(newName: string, oldName?: string): void {
  const { add, remove } = agentNameDictionaryChanges(
    getSettings().customDictionary,
    newName,
    oldName
  );
  if (add.length === 0 && remove.length === 0) return;
  useSettingsStore.getState().updateCustomDictionary({ add, remove });
}

export const setAgentName = (name: string): void => {
  const oldName = getAgentName();
  const trimmed = name.trim() || DEFAULT_AGENT_NAME;
  // A rejected storage write must not publish a name that wasn't saved.
  localStorage.setItem(AGENT_NAME_KEY, trimmed);
  useSettingsStore.setState({ agentName: trimmed });
  try {
    syncAgentNameToDictionary(trimmed, oldName);
  } finally {
    window.electronAPI?.notifyAgentNameChanged?.();
  }
};

export const ensureAgentNameInDictionary = (): void => {
  syncAgentNameToDictionary(getAgentName());
};

/** App-lifetime synchronization, not a saved-state mirror in every consumer. */
export function subscribeAgentNameChanges(): () => void {
  const refresh = () => {
    const name = localStorage.getItem(AGENT_NAME_KEY)?.trim() || DEFAULT_AGENT_NAME;
    const previous = getAgentName();
    if (name === previous) return;
    useSettingsStore.setState({ agentName: name });
    syncAgentNameToDictionary(name, previous);
  };
  // A null key is localStorage.clear() (Reset app data), which must not write the dictionary back.
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === AGENT_NAME_KEY) refresh();
  };
  window.addEventListener("storage", onStorage);
  const unsubscribe = window.electronAPI?.onAgentNameChanged?.(refresh);
  refresh();
  return () => {
    window.removeEventListener("storage", onStorage);
    unsubscribe?.();
  };
}

export const useAgentName = () => ({
  agentName: useSettingsStore((s) => s.agentName),
  setAgentName,
});
