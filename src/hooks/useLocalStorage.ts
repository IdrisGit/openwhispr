import { useState, useCallback, useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
  }
) {
  const serialize = options?.serialize || JSON.stringify;
  const deserialize = options?.deserialize || JSON.parse;

  const [owner] = useState(() => {
    let value = defaultValue;
    let needsDefault = false;
    try {
      const item = localStorage.getItem(key);
      needsDefault = item === null;
      if (item !== null) value = deserialize(item);
    } catch {
      // An unreadable preference keeps its fallback without overwriting storage.
    }
    const store = createStore(() => ({ value }));
    return {
      store,
      persistDefault() {
        if (!needsDefault) return;
        needsDefault = false;
        try {
          // Another committed owner/action may already have supplied the value.
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, serialize(store.getState().value));
          }
        } catch {
          // Default persistence is best effort, as before.
        }
      },
      cancelDefault() {
        needsDefault = false;
      },
    };
  });
  const state = useStore(owner.store, (snapshot) => snapshot.value);

  // Direct preference readers need missing defaults, but an abandoned render must not write them.
  useEffect(() => owner.persistDefault(), [owner]);

  const setValue = useCallback(
    (value: T | ((prevState: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(owner.store.getState().value) : value;
        localStorage.setItem(key, serialize(valueToStore));
        owner.cancelDefault();
        owner.store.setState({ value: valueToStore });
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, serialize, owner]
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      owner.cancelDefault();
      owner.store.setState({ value: defaultValue });
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue, owner]);

  return [state, setValue, remove] as const;
}
