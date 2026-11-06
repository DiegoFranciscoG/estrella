export interface SafeStore {
  get(key: string): string | null;
  /** Returns whether it was stored. */
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

/** Web storage can be missing or throw (private windows, blocked storage); the app must still work. */
function safe(area: () => Storage): SafeStore {
  return {
    get(key) {
      try {
        return area().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        area().setItem(key, value);
        return true;
      } catch {
        // Not remembered; nothing else breaks.
        return false;
      }
    },
    remove(key) {
      try {
        area().removeItem(key);
      } catch {
        // Same as above.
      }
    },
  };
}

export const safeStorage = safe(() => localStorage);
/** Per tab, gone when the tab closes: for short-lived values such as a PKCE verifier. */
export const safeSession = safe(() => sessionStorage);
