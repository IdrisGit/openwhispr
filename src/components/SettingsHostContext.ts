import { createContext, useCallback, useContext, useState } from "react";

export type OpenSettings = (section?: string) => void;

export const OpenSettingsContext = createContext<OpenSettings | null>(null);

export function useOpenSettings(): OpenSettings {
  const openSettings = useContext(OpenSettingsContext);
  if (!openSettings) throw new Error("useOpenSettings must be used within SettingsHost");
  return openSettings;
}

export function useSettingsModalState(initialSection?: string) {
  const [showSettings, setShowSettings] = useState(!!initialSection);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(initialSection);
  const openSettings = useCallback<OpenSettings>((section) => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);
  const setSettingsOpen = useCallback((open: boolean) => {
    setShowSettings(open);
    if (!open) setSettingsSection(undefined);
  }, []);
  return { showSettings, settingsSection, openSettings, setSettingsOpen };
}
