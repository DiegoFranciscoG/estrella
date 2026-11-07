/**
 * Asks the programs site's service worker (apps/sw/programs-sw.js) to keep this program, so it
 * also opens without internet. The panel decides whether to ask (production builds on their own
 * site); a frame without its own origin cannot have a service worker anyway.
 */

export interface OfflineEnv {
  serviceWorker?: ServiceWorkerContainer;
  secure: boolean;
  origin: string;
  pageUrl: string;
  /** URLs this page has loaded so far (Resource Timing). */
  loaded(): string[];
}

const SCOPE = "/apps/";

const browserEnv = (): OfflineEnv => ({
  serviceWorker: navigator.serviceWorker,
  secure: window.isSecureContext,
  origin: location.origin,
  pageUrl: location.href,
  loaded: () => performance.getEntriesByType("resource").map((e) => e.name),
});

/** The page and everything it loaded from the programs site, without fragments or repeats. */
export function filesToKeep(env: Pick<OfflineEnv, "origin" | "pageUrl" | "loaded">): string[] {
  const prefix = env.origin + SCOPE;
  const urls = [env.pageUrl, ...env.loaded()].map((u) => u.split("#")[0]).filter((u) => u.startsWith(prefix));
  return [...new Set(urls)];
}

export async function keepForOffline(env: OfflineEnv = browserEnv()): Promise<boolean> {
  if (!env.serviceWorker || !env.secure || env.origin === "null") return false;
  try {
    await env.serviceWorker.register(`${SCOPE}sw.js`, { scope: SCOPE });
    const ready = await env.serviceWorker.ready;
    ready.active?.postMessage({ type: "estrella:keep", urls: filesToKeep(env) });
    return true;
  } catch {
    return false; // Storage blocked or private mode: the program still works online.
  }
}
