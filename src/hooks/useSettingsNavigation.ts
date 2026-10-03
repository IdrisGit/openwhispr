import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createSettingsNavigationStore } from "../stores/settingsNavigationStore";
import { usePolicyStore } from "../stores/policyStore";
import { isAgentAllowed } from "../stores/policyRules";

export function useSettingsNavigation(initialSection?: string) {
  // React retains the instance; all navigation values/actions live in Zustand.
  const [navigation] = useState(() =>
    createSettingsNavigationStore(initialSection, () => isAgentAllowed(usePolicyStore.getState()))
  );
  const showSettings = useStore(navigation, (state) => state.section !== null);
  const openSettings = useStore(navigation, (state) => state.openSettings);
  const setSettingsOpen = useStore(navigation, (state) => state.setSettingsOpen);

  useEffect(() => {
    const reconcile = navigation.getState().reconcilePolicy;
    const unsubscribe = usePolicyStore.subscribe(reconcile);
    reconcile();
    // Initial preferences were read during pure construction. Writes belong
    // after commit; subsequent navigation actions persist their own changes.
    navigation.getState().persistCurrentTab();
    return unsubscribe;
  }, [navigation]);

  return { navigation, showSettings, openSettings, setSettingsOpen };
}
