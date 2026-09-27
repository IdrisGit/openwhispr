import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileAudio, Mic, Upload } from "../icons";
import { useVisitedTabs } from "../../hooks/useVisitedTabs";
import { ProviderTabs } from "../ui/ProviderTabs";
import { SectionHeader } from "../ui/SettingsSection";

export type SpeechTab = "dictation" | "noteRecording" | "upload";

const SPEECH_TABS: SpeechTab[] = ["dictation", "noteRecording", "upload"];

export function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? undefined : "hidden"}>{children}</div>;
}

export default function SpeechToTextTabs({
  initialTab,
  request,
  dictation,
  noteRecording,
  upload,
}: {
  initialTab?: SpeechTab;
  request?: object;
  dictation: ReactNode;
  noteRecording: ReactNode;
  upload: ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useVisitedTabs<SpeechTab>(
    "settings.speechToTextTab",
    SPEECH_TABS,
    initialTab,
    request
  );

  // ProviderTabs observes the indicator; keep its list stable until labels change.
  const subTabs = useMemo(
    () => [
      { id: "dictation", name: t("settingsPage.speechToText.tabs.dictation") },
      { id: "noteRecording", name: t("settingsPage.speechToText.tabs.noteRecording") },
      { id: "upload", name: t("settingsPage.speechToText.tabs.upload") },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.speechToText.title")}
        description={t("settingsPage.speechToText.description")}
      />
      <ProviderTabs
        providers={subTabs}
        selectedId={tab}
        onSelect={(id) => setTab(id as SpeechTab)}
        renderIcon={(id) =>
          id === "dictation" ? (
            <Mic className="w-3.5 h-3.5" />
          ) : id === "upload" ? (
            <Upload className="w-3.5 h-3.5" />
          ) : (
            <FileAudio className="w-3.5 h-3.5" />
          )
        }
      />
      <TabPanel active={tab === "dictation"}>{dictation}</TabPanel>
      <TabPanel active={tab === "noteRecording"}>{noteRecording}</TabPanel>
      <TabPanel active={tab === "upload"}>{upload}</TabPanel>
    </div>
  );
}
