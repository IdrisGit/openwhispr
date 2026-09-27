import React, { memo, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Languages, MessageSquare, Sparkles, Wand2 } from "../icons";
import { useVisitedTabs } from "../../hooks/useVisitedTabs";
import { usePolicyStore } from "../../stores/policyStore";
import { isAgentAllowed } from "../../stores/policyRules";
import { useSettingsStore } from "../../stores/settingsStore";
import { ProviderTabs } from "../ui/ProviderTabs";
import { SettingsPanel, SettingsPanelRow, SettingsRow, SectionHeader } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { useToast } from "../ui/useToast";
import PromptStudio from "../ui/PromptStudio";
import ChatAgentSettings from "./ChatAgentSettings";
import DictationAgentSettings from "./DictationAgentSettings";
import DictationTranslationSettings from "./DictationTranslationSettings";
import GpuDeviceSelector from "./GpuDeviceSelector";
import InferenceConfigEditor from "./InferenceConfigEditor";
import type { InferenceMode } from "../../types/electron";

export type LlmTab =
  | "dictationCleanup"
  | "dictationAgent"
  | "dictationTranslation"
  | "noteFormatting"
  | "chatIntelligence";

const LLM_TABS: LlmTab[] = [
  "dictationCleanup",
  "dictationAgent",
  "dictationTranslation",
  "noteFormatting",
  "chatIntelligence",
];
const AGENT_LLM_TABS = new Set<LlmTab>(["dictationAgent", "chatIntelligence"]);
const NON_AGENT_LLM_TABS = LLM_TABS.filter((tabId) => !AGENT_LLM_TABS.has(tabId));

const CLEANUP_MODE_TOAST_KEY: Record<InferenceMode, string> = {
  openwhispr: "switchedCloud",
  providers: "switchedProviders",
  local: "switchedLocal",
  "self-hosted": "switchedSelfHosted",
  enterprise: "switchedEnterprise",
};

function CleanupSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const useCleanupModel = useSettingsStore((settings) => settings.useCleanupModel);
  const setUseCleanupModel = useSettingsStore((settings) => settings.setUseCleanupModel);

  const handleCleanupModeChange = (mode: InferenceMode) => {
    const toastKey = CLEANUP_MODE_TOAST_KEY[mode];
    toast({
      title: t(`settingsPage.aiModels.toasts.${toastKey}.title`),
      description: t(`settingsPage.aiModels.toasts.${toastKey}.description`),
      variant: "success",
      duration: 3000,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label={t("settingsPage.aiModels.enableTextCleanup")}
              description={t("settingsPage.aiModels.enableTextCleanupDescription")}
            >
              <Toggle checked={useCleanupModel} onChange={setUseCleanupModel} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>

        {useCleanupModel && (
          <>
            <InferenceConfigEditor
              scope="dictationCleanup"
              onModeChange={handleCleanupModeChange}
            />
            <GpuDeviceSelector purpose="intelligence" />
          </>
        )}
      </div>
      <div className="border-t border-border/70 pt-6">
        <SectionHeader
          title={t("settingsPage.prompts.title")}
          description={t("settingsPage.prompts.description")}
        />
        <PromptStudio />
      </div>
    </div>
  );
}

function NoteFormattingSettings() {
  const { t } = useTranslation();
  const autoGenerateNoteTitle = useSettingsStore((settings) => settings.autoGenerateNoteTitle);
  const setAutoGenerateNoteTitle = useSettingsStore(
    (settings) => settings.setAutoGenerateNoteTitle
  );

  return (
    <div className="space-y-4">
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.noteFormatting.autoGenerateTitle")}
            description={t("settingsPage.noteFormatting.autoGenerateTitleDescription")}
          >
            <Toggle checked={autoGenerateNoteTitle} onChange={setAutoGenerateNoteTitle} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
      <InferenceConfigEditor scope="noteFormatting" />
    </div>
  );
}

const LLM_CONTENT = {
  dictationCleanup: <CleanupSettings />,
  dictationAgent: <DictationAgentSettings />,
  dictationTranslation: <DictationTranslationSettings />,
  noteFormatting: <NoteFormattingSettings />,
  chatIntelligence: <ChatAgentSettings />,
};

function TabPanel({
  active,
  children,
  policyAgent = false,
}: {
  active: boolean;
  children: React.ReactNode;
  policyAgent?: boolean;
}) {
  return (
    <div hidden={!active} data-policy-agent-panel={policyAgent || undefined}>
      {children}
    </div>
  );
}

const LlmsTabs = memo(function LlmsTabs({ initialTab }: { initialTab?: LlmTab }) {
  const { t } = useTranslation();
  const agentAllowed = usePolicyStore(isAgentAllowed);
  const visibleTabIds = agentAllowed ? LLM_TABS : NON_AGENT_LLM_TABS;
  const [tab, selectTab, visitedTabs] = useVisitedTabs<LlmTab>(
    "settings.llmsTab",
    visibleTabIds,
    initialTab
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const previousAgentAllowed = useRef(agentAllowed);
  const focusedPanelWasRemoved =
    previousAgentAllowed.current &&
    !agentAllowed &&
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-policy-agent-panel]") ?? []
    ).some((panel) => panel.contains(document.activeElement));

  useLayoutEffect(() => {
    previousAgentAllowed.current = agentAllowed;
    if (!focusedPanelWasRemoved) return;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${tab}"]`)?.focus();
  }, [agentAllowed, focusedPanelWasRemoved, tab]);

  const subTabs = [
    { id: "dictationCleanup", name: t("settingsPage.llms.tabs.dictationCleanup") },
    { id: "dictationAgent", name: t("settingsPage.llms.tabs.dictationAgent") },
    { id: "dictationTranslation", name: t("settingsPage.llms.tabs.dictationTranslation") },
    { id: "noteFormatting", name: t("settingsPage.llms.tabs.noteFormatting") },
    { id: "chatIntelligence", name: t("settingsPage.llms.tabs.chatIntelligence") },
  ].filter((item) => visibleTabIds.includes(item.id as LlmTab));

  return (
    <div ref={rootRef} className="space-y-4">
      <SectionHeader
        title={t("settingsPage.llms.title")}
        description={t("settingsPage.llms.description")}
      />
      <ProviderTabs
        providers={subTabs}
        selectedId={tab}
        onSelect={(id) => selectTab(id as LlmTab)}
        renderIcon={(id) => {
          if (id === "dictationCleanup") return <Wand2 className="w-3.5 h-3.5" />;
          if (id === "dictationAgent") return <Sparkles className="w-3.5 h-3.5" />;
          if (id === "dictationTranslation") return <Languages className="w-3.5 h-3.5" />;
          if (id === "noteFormatting") return <BookOpen className="w-3.5 h-3.5" />;
          return <MessageSquare className="w-3.5 h-3.5" />;
        }}
      />
      {(tab === "dictationCleanup" || visitedTabs.has("dictationCleanup")) && (
        <TabPanel active={tab === "dictationCleanup"}>{LLM_CONTENT.dictationCleanup}</TabPanel>
      )}
      {agentAllowed && (tab === "dictationAgent" || visitedTabs.has("dictationAgent")) && (
        <TabPanel active={tab === "dictationAgent"} policyAgent>
          {LLM_CONTENT.dictationAgent}
        </TabPanel>
      )}
      {(tab === "dictationTranslation" || visitedTabs.has("dictationTranslation")) && (
        <TabPanel active={tab === "dictationTranslation"}>
          {LLM_CONTENT.dictationTranslation}
        </TabPanel>
      )}
      {(tab === "noteFormatting" || visitedTabs.has("noteFormatting")) && (
        <TabPanel active={tab === "noteFormatting"}>{LLM_CONTENT.noteFormatting}</TabPanel>
      )}
      {agentAllowed && (tab === "chatIntelligence" || visitedTabs.has("chatIntelligence")) && (
        <TabPanel active={tab === "chatIntelligence"} policyAgent>
          {LLM_CONTENT.chatIntelligence}
        </TabPanel>
      )}
    </div>
  );
});

export default function LlmsKeepAlive({
  active,
  initialTab,
}: {
  active: boolean;
  initialTab?: LlmTab;
}) {
  const [mounted, setMounted] = useState(active);
  const [requestedTab, setRequestedTab] = useState(initialTab);
  if (active && initialTab && requestedTab !== initialTab) setRequestedTab(initialTab);
  if (active && !mounted) setMounted(true);

  if (!mounted) return null;
  return (
    <div hidden={!active}>
      <LlmsTabs initialTab={requestedTab} />
    </div>
  );
}
