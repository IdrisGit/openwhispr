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

  useEffect(() => {
    const hostId = crypto.randomUUID();
    let disposed = false;
    let documentId: number | null = null;
    const dispose = window.electronAPI?.onShowSettings?.((request) => {
      if (disposed || request?.hostId !== hostId || !Number.isSafeInteger(request.requestId))
        return;
      openSettings();
      window.electronAPI?.acknowledgeSettingsOpen?.(hostId, request.requestId);
    });
    // This host exists only after AppRouter's auth/policy/onboarding gates and
    // the normal panel's Suspense commit. Subscribe before announcing readiness.
    void window.electronAPI
      ?.getSettingsDocumentId?.()
      .then((id) => {
        if (disposed || id === null || !Number.isSafeInteger(id)) return;
        documentId = id;
        window.electronAPI?.setSettingsHostReady?.(hostId, true, id);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (documentId !== null)
        window.electronAPI?.setSettingsHostReady?.(hostId, false, documentId);
      dispose?.();
    };
  }, [openSettings]);

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
