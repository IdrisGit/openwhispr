import React, {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { usePolicySnapshot } from "../hooks/usePolicy";
import { useGpuBannerAvailability } from "../hooks/useGpuBannerAvailability";
import { usePolicyStore } from "../stores/policyStore";
import { isAgentAllowed } from "../stores/policyRules";
import { selectPolicyEffectiveSettings, useSettingsStore } from "../stores/settingsStore";
import { getCachedPlatform } from "../utils/platform";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { cn } from "./lib/utils";
import { Zap } from "./icons";
import { OpenSettingsContext, useOpenSettings, useSettingsModalState } from "./SettingsHostContext";

const SettingsModal = React.lazy(() => import("./SettingsModal"));
const platform = getCachedPlatform();

const GpuBannerContext = React.createContext<{
  transcription: boolean;
  intelligence: string | null;
  dismissed: boolean;
  dismiss: () => void;
} | null>(null);

export function SettingsHost({
  children,
  initialSection,
}: {
  children: ReactNode;
  initialSection?: string;
}) {
  const { showSettings, settingsSection, openSettings, setSettingsOpen } =
    useSettingsModalState(initialSection);
  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(
    () => localStorage.getItem("gpuBannerDismissedUnified") === "true"
  );
  const policySnapshot = usePolicySnapshot();
  const agentAllowedByPolicy = usePolicyStore(isAgentAllowed);
  const gpuBannerSettings = useSettingsStore(
    useShallow((settings) => {
      const effective = selectPolicyEffectiveSettings(settings, policySnapshot);
      return {
        useLocalWhisper: effective.useLocalWhisper,
        localTranscriptionProvider: effective.localTranscriptionProvider,
        useCleanupModel: effective.useCleanupModel,
        cleanupMode: effective.cleanupMode,
        useDictationAgent: effective.useDictationAgent,
        dictationAgentMode: effective.dictationAgentMode,
      };
    })
  );
  const gpuAccelAvailable = useGpuBannerAvailability({
    settings: gpuBannerSettings,
    agentAllowedByPolicy,
    dismissed: gpuBannerDismissed,
    settingsOpen: showSettings,
    platform,
  });

  const dismissGpuBanner = useCallback(() => {
    setGpuBannerDismissed(true);
    localStorage.setItem("gpuBannerDismissedUnified", "true");
  }, []);
  const gpuBanner = useMemo(
    () => ({ ...gpuAccelAvailable, dismissed: gpuBannerDismissed, dismiss: dismissGpuBanner }),
    [dismissGpuBanner, gpuAccelAvailable, gpuBannerDismissed]
  );

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
      <OpenSettingsContext.Provider value={openSettings}>
        <GpuBannerContext.Provider value={gpuBanner}>{children}</GpuBannerContext.Provider>
      </OpenSettingsContext.Provider>
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            open={showSettings}
            onOpenChange={setSettingsOpen}
            initialSection={settingsSection}
          />
        </Suspense>
      )}
    </>
  );
}

export function GpuAccelerationBanner() {
  const { t } = useTranslation();
  const openSettings = useOpenSettings();
  const banner = useContext(GpuBannerContext);
  if (!banner || banner.dismissed || (!banner.transcription && !banner.intelligence)) return null;

  return (
    <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "px-6 mb-3")}>
      <div className="rounded-lg border border-primary/20 dark:border-primary/15 bg-primary/5 p-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/15 flex items-center justify-center">
            <Zap size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground mb-0.5">
              {t("controlPanel.gpu.bannerTitle")}
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              {t("controlPanel.gpu.bannerDescription")}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  openSettings(
                    banner.transcription
                      ? "transcription"
                      : banner.intelligence === "dictationAgent"
                        ? "dictationAgent"
                        : "intelligence"
                  )
                }
              >
                {t("controlPanel.gpu.enableButton")}
              </Button>
              <button
                onClick={banner.dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("controlPanel.gpu.dismissButton")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
