/**
 * When and how often this device syncs, and what the student sees about it.
 *
 * Runs right after signing in, every minute while the page is visible, when the connection comes
 * back, and a few seconds after each save. Never two passes at once: a request during a pass
 * schedules one more pass right after it.
 */
import { ProjectStore } from "./store";
import { SyncError, SyncReport, syncOnce, SyncServer } from "./sync";
import { httpSyncServer } from "./syncApi";
import type { SyncKeys } from "./vault";

export type SyncState = "off" | "locked" | "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  report: SyncReport | null;
  message: string;
}

const KEYS = "syncKeys";
const INTERVAL_MS = 60_000;
const AFTER_SAVE_MS = 4_000;

let status: SyncStatus = { state: "off", lastSync: null, report: null, message: "" };
const listeners = new Set<(s: SyncStatus) => void>();
let session: { userId: string; keys: SyncKeys | null } | null = null;
let server: SyncServer = httpSyncServer;
let interval: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let running: Promise<SyncStatus> | null = null;
let again = false;
const openIds = new Set<string>();

function set(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}

export function syncStatus(): SyncStatus {
  return status;
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

/** For tests: replace the HTTP server. */
export function useSyncServer(next: SyncServer): void {
  server = next;
}

async function withStore<T>(userId: string, work: (s: ProjectStore) => Promise<T>): Promise<T> {
  const store = await ProjectStore.open(userId);
  try {
    return await work(store);
  } finally {
    store.close();
  }
}

/** Keeps the device's sync keys (non-extractable CryptoKeys) so a reload does not ask for the password. */
export function rememberKeys(userId: string, keys: SyncKeys): Promise<void> {
  return withStore(userId, (s) => s.setMeta(KEYS, keys));
}

export async function loadKeys(userId: string): Promise<SyncKeys | null> {
  try {
    const keys = await withStore(userId, (s) => s.getMeta<SyncKeys>(KEYS));
    return keys?.content && keys?.names ? keys : null;
  } catch {
    return null;
  }
}

export function forgetKeys(userId: string): Promise<void> {
  return withStore(userId, (s) => s.deleteMeta(KEYS)).catch(() => undefined);
}

const onOnline = () => { void syncNow(); };

function stopTimers(): void {
  if (interval) clearInterval(interval);
  if (pending) clearTimeout(pending);
  interval = null;
  pending = null;
  window.removeEventListener("online", onOnline);
}

export async function startSync(userId: string, keys: SyncKeys | null): Promise<void> {
  stopTimers();
  session = { userId, keys };
  if (!keys) {
    set({ state: "locked", message: "Para sincronizar en este equipo, escribe tu contraseña." });
    return;
  }
  set({ state: "idle", message: "" });
  interval = setInterval(() => {
    if (document.visibilityState === "visible" && status.state !== "off") void syncNow();
  }, INTERVAL_MS);
  window.addEventListener("online", onOnline);
  await syncNow();
}

export function stopSync(): void {
  stopTimers();
  session = null;
  openIds.clear();
  set({ state: "off", lastSync: null, report: null, message: "" });
}

/** Schedules a pass soon (debounced): after a save, a rename or a deletion. */
export function requestSync(delayMs = AFTER_SAVE_MS): void {
  if (!session?.keys) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void syncNow();
  }, delayMs);
}

export async function syncNow(): Promise<SyncStatus> {
  const current = session;
  if (!current?.keys) return status;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    set({ state: "syncing" });
    try {
      const report = await withStore(current.userId, (store) =>
        syncOnce({ userId: current.userId, store, keys: current.keys!, server, openIds }));
      set({ state: "idle", lastSync: report.at, report, message: "" });
    } catch (e) {
      if (e instanceof SyncError && e.code === "SYNC_DISABLED") {
        set({ state: "off", message: "La nube está desactivada. Tus proyectos quedan solo en este equipo." });
      } else if (e instanceof SyncError && (e.code === "NETWORK" || e.code === "WAKING")) {
        set({ state: "offline", message: "Sin conexión con el servidor: se sincroniza al volver." });
      } else if (e instanceof SyncError && e.code === "TOO_MANY_UPLOADS") {
        set({ state: "idle", message: e.message });
      } else {
        set({ state: "error", message: e instanceof Error ? e.message : "No se pudo sincronizar." });
      }
    }
    return status;
  })();
  try {
    return await running;
  } finally {
    running = null;
    if (again) {
      again = false;
      requestSync(500);
    }
  }
}

/** Projects open in this tab are uploaded but never replaced while the student works on them. */
export function markProjectOpen(id: string): void {
  openIds.add(id);
}

export function markProjectClosed(id: string): void {
  openIds.delete(id);
  requestSync(1000);
}
