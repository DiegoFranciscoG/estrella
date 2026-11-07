import { safeSession } from "./storage";

/**
 * Installed app and offline use: the panel's service worker, its updates, storage protection and
 * the browser's install prompt. Each function takes its browser objects as parameters so it can be
 * tested without a browser.
 */

export interface UpdateOffer {
  /** Lets the waiting version take over; the page reloads when it does. */
  activate(): void;
}

interface WorkerEnv {
  serviceWorker: ServiceWorkerContainer;
  reload(): void;
  every(ms: number, run: () => void): void;
}

const browserEnv = (): WorkerEnv => ({
  serviceWorker: navigator.serviceWorker,
  reload: () => location.reload(),
  every: (ms, run) => void window.setInterval(run, ms),
});

/** How often an open app checks for a new version (it also checks on every load). */
export const UPDATE_CHECK_MS = 60 * 60_000;

/**
 * Registers the panel's service worker. When a new version is ready and an older one controls the
 * page, `onUpdate` receives the offer; nothing changes until the student accepts it.
 */
export async function registerPanelWorker(onUpdate: (offer: UpdateOffer) => void, env: WorkerEnv = browserEnv()): Promise<void> {
  const registration = await env.serviceWorker.register("/sw.js");
  // Reload only for an update the student accepted here. The first install also changes the
  // controller (clients.claim), and reloading then would wipe a form being filled in.
  let accepted = false;
  const offer = (worker: ServiceWorker) => onUpdate({
    activate: () => {
      accepted = true;
      worker.postMessage("estrella:activate-update");
    },
  });
  if (registration.waiting && env.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      // With no controller this is the first install: there is nothing to replace.
      if (worker.state === "installed" && env.serviceWorker.controller) offer(worker);
    });
  });
  let reloading = false;
  env.serviceWorker.addEventListener("controllerchange", () => {
    if (!accepted || reloading) return;
    reloading = true;
    env.reload();
  });
  env.every(UPDATE_CHECK_MS, () => void registration.update().catch(() => undefined));
}

export type StorageState = "persistent" | "best-effort" | "unsupported";

export async function storageState(storage: StorageManager | undefined = navigator.storage): Promise<StorageState> {
  try {
    if (!storage?.persisted) return "unsupported";
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/**
 * Asks the browser not to delete this site's data when space runs low (Storage API). Chrome, Edge
 * and Safari decide on their own; Firefox asks the student.
 */
export async function protectStorage(storage: StorageManager | undefined = navigator.storage): Promise<boolean> {
  try {
    return storage?.persist ? await storage.persist() : false;
  } catch {
    return false;
  }
}

const ASKED = "estrella:storage-asked";

/**
 * Once per session, after the student saved work: protect it. Not in Firefox, where it opens a
 * permission prompt that the student would see out of context; there it is a button in the meter.
 */
export async function protectAfterSaving(ua = navigator.userAgent, storage: StorageManager | undefined = navigator.storage,
                                         session = safeSession): Promise<StorageState | null> {
  if (/Firefox\//.test(ua) || session.get(ASKED)) return null;
  session.set(ASKED, "1");
  if ((await storageState(storage)) === "best-effort") await protectStorage(storage);
  return storageState(storage);
}

export type Platform = "android" | "ios" | "windows" | "mac" | "linux" | "other";

/** Which install instructions to show first. iPadOS presents itself as a Mac with touch. */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "other";
}

/** True when ESTRELLA runs as an installed app, not in a browser tab. */
export function isInstalledApp(match: (query: string) => boolean = (q) => window.matchMedia(q).matches,
                               standalone = (navigator as Navigator & { standalone?: boolean }).standalone): boolean {
  return match("(display-mode: standalone)") || match("(display-mode: window-controls-overlay)") || standalone === true;
}

/** Chromium's install event: not standard, so only what is used is typed. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Keeps the browser's install offer so the install page can show its own button. */
export function captureInstallPrompt(target: EventTarget = window): void {
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  target.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function onInstallAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  listeners.forEach((l) => l());
  return outcome;
}
