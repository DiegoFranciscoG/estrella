/**
 * Programs are served from a different site than the panel. Browsers only give a frame its own
 * process when it belongs to another site; on the same site a frozen program freezes the panel too
 * (verified with a busy-looping frame: the panel stopped answering). Being cross-site also lets each
 * program keep its own storage without any access to the panel's session.
 */
export function appsOrigin(configured: string | undefined, current: string): string {
  if (!configured) return current;
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("VITE_APPS_ORIGIN must be http(s)");
  return url.origin;
}

export const APPS_ORIGIN = appsOrigin(import.meta.env.VITE_APPS_ORIGIN, location.origin);

/** True when programs run on their own site (the safe, isolated setup used in production). */
export const APPS_ISOLATED = APPS_ORIGIN !== location.origin;

/** Programs keep an offline copy only in production builds, where the programs site has its service worker. */
export const OFFLINE_PROGRAMS = import.meta.env.PROD && APPS_ISOLATED;
