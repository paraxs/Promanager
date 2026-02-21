import type { StateStorage } from 'zustand/middleware';
import { APP_CONFIG } from '../config/appConfig';

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

const flushToStorage = (name: string, value: string) => {
  const ls = getSafeLocalStorage();
  if (ls) {
    ls.setItem(name, value);
    return;
  }
  memoryStorage.set(name, value);
};

export const createDebouncedLocalStorage = (delayMs = APP_CONFIG.persistence.writeDebounceMs): StateStorage => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingValues = new Map<string, string>();

  return {
    getItem: (name) => {
      if (pendingValues.has(name)) return pendingValues.get(name) ?? null;

      const ls = getSafeLocalStorage();
      if (ls) return ls.getItem(name);
      return memoryStorage.get(name) ?? null;
    },

    setItem: (name, value) => {
      pendingValues.set(name, value);

      const pending = timers.get(name);
      if (pending) clearTimeout(pending);

      const timer = setTimeout(() => {
        const queuedValue = pendingValues.get(name);
        if (typeof queuedValue === 'string') {
          flushToStorage(name, queuedValue);
        }

        pendingValues.delete(name);
        timers.delete(name);
      }, delayMs);

      timers.set(name, timer);
    },

    removeItem: (name) => {
      const pending = timers.get(name);
      if (pending) clearTimeout(pending);

      timers.delete(name);
      pendingValues.delete(name);

      const ls = getSafeLocalStorage();
      if (ls) ls.removeItem(name);
      else memoryStorage.delete(name);
    },
  };
};

const debouncedLocalStorage = createDebouncedLocalStorage(APP_CONFIG.persistence.writeDebounceMs);

export const clearPersistedState = (key: string): void => {
  debouncedLocalStorage.removeItem(key);
};

export const localStorageAdapter: PersistStorageAdapter = {
  name: 'localStorage',
  getStateStorage: () => debouncedLocalStorage,
};

/**
 * Phase 2 placeholder:
 * Hier später echtes IndexedDB-Storage einstecken.
 * Aktuell bewusst auf localStorage als Start.
 */
export const indexedDbAdapterPlaceholder: PersistStorageAdapter = {
  name: 'indexeddb-placeholder',
  getStateStorage: () => debouncedLocalStorage,
};
