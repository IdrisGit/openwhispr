import React, { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useSettingsNavigation } from "../hooks/useSettingsNavigation";
import type { SettingsNavigationStore } from "../stores/settingsNavigationStore";
import { getCachedPlatform } from "../utils/platform";

const SettingsModal = React.lazy(() => import("./SettingsModal"));
const platform = getCachedPlatform();

export function SettingsHost({
  children,
  initialSection,
}: {
  children: (navigation: SettingsNavigationStore) => ReactNode;
  initialSection?: string;
}) {
  const { navigation, showSettings, openSettings, setSettingsOpen } =
    useSettingsNavigation(initialSection);
  // The store/action identity is stable. Host-only open/close updates must not
  // reconstruct ControlPanel/history, even though no Context distributes it.
  const content = useMemo(() => children(navigation), [children, navigation]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (mod && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSettings]);

  useEffect(() => window.electronAPI?.onShowSettings?.(() => openSettings()), [openSettings]);

  return (
    <>
      {content}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal navigation={navigation} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
    </>
  );
}
