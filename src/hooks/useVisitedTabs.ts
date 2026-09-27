import { useCallback, useEffect, useState } from "react";

function persistTab<T extends string>(storageKey: string, tab: T): boolean {
  try {
    const value = JSON.stringify(tab);
    if (localStorage.getItem(storageKey) !== value) localStorage.setItem(storageKey, value);
    return true;
  } catch (error) {
    console.error(`Error setting localStorage key "${storageKey}":`, error);
    return false;
  }
}

export function useVisitedTabs<T extends string>(
  storageKey: string,
  options: readonly T[],
  initial?: T
) {
  const [storedTab, setStoredTab] = useState<T>(() => {
    let persisted: T | undefined;
    try {
      persisted = JSON.parse(localStorage.getItem(storageKey) ?? "null") as T;
    } catch {}
    const selected = initial ?? persisted;
    return selected && options.includes(selected) ? selected : options[0];
  });
  const [previousInitial, setPreviousInitial] = useState(initial);
  const requested = initial !== previousInitial && initial ? initial : storedTab;
  const tab = options.includes(requested) ? requested : options[0];
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([tab]));

  if (initial !== previousInitial) setPreviousInitial(initial);
  if (storedTab !== tab) {
    setStoredTab(tab);
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)));
  }

  const selectTab = useCallback(
    (requested: T) => {
      const next = options.includes(requested) ? requested : options[0];
      if (!persistTab(storageKey, next)) return;
      setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
      setStoredTab(next);
    },
    [options, storageKey]
  );

  useEffect(() => {
    persistTab(storageKey, tab);
  }, [storageKey, tab]);

  return [tab, selectTab, visited] as const;
}
