import type { StateStorage } from 'zustand/middleware';

export interface PersistStorageAdapter {
  name: string;
  getStateStorage: () => StateStorage;
}

const memoryStorage = new Map<string, string>();

const getSafeLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const createDebouncedLocalStorage = (delayMs = 250): StateStorage => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    getItem: (name) => {
      const ls = getSafeLocalStorage();
      if (ls) return ls.getItem(name);
      return memoryStorage.get(name) ?? null;
    },

    setItem: (name, value) => {
      const pending = timers.get(name);
      if (pending) clearTimeout(pending);

      const timer = setTimeout(() => {
        const ls = getSafeLocalStorage();
        if (ls) ls.setItem(name, value);
        else memoryStorage.set(name, value);
        timers.delete(name);
      }, delayMs);

      timers.set(name, timer);
    },

    removeItem: (name) => {
      const pending = timers.get(name);
      if (pending) clearTimeout(pending);

      const ls = getSafeLocalStorage();
      if (ls) ls.removeItem(name);
      else memoryStorage.delete(name);
    },
  };
};

export const localStorageAdapter: PersistStorageAdapter = {
  name: 'localStorage',
  getStateStorage: () => createDebouncedLocalStorage(250),
};

/**
 * Phase 2 placeholder:
 * Hier später echtes IndexedDB-Storage einstecken.
 * Aktuell bewusst auf localStorage als Start.
 */
export const indexedDbAdapterPlaceholder: PersistStorageAdapter = {
  name: 'indexeddb-placeholder',
  getStateStorage: () => createDebouncedLocalStorage(250),
};
