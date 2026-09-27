import { createContext, useCallback, useContext, useState } from "react";

export type OpenSettings = (section?: string) => void;
export type SettingsSectionRequest = { section: string };

export const OpenSettingsContext = createContext<OpenSettings | null>(null);

export function useOpenSettings(): OpenSettings {
  const openSettings = useContext(OpenSettingsContext);
  if (!openSettings) throw new Error("useOpenSettings must be used within SettingsHost");
  return openSettings;
}

export function useSettingsModalState(initialSection?: string) {
  const [showSettings, setShowSettings] = useState(!!initialSection);
  const [sectionRequest, setSectionRequest] = useState<SettingsSectionRequest | undefined>(() =>
    initialSection ? { section: initialSection } : undefined
  );
  const openSettings = useCallback<OpenSettings>((section) => {
    if (section) setSectionRequest({ section });
    setShowSettings(true);
  }, []);
  const setSettingsOpen = useCallback((open: boolean) => {
    setShowSettings(open);
    if (!open) setSectionRequest(undefined);
  }, []);
  return { showSettings, sectionRequest, openSettings, setSettingsOpen };
}
