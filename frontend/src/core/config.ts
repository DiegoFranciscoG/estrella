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

/**
 * The local stack's test mailbox (Mailpit), where its emails land instead of real inboxes. Set only by
 * docker-compose.yml; production builds leave it out, so the hint never shows there.
 */
export function devMailbox(configured: string | undefined): string | null {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export const DEV_MAILBOX = devMailbox(import.meta.env.VITE_DEV_MAILBOX);

/**
 * A build for a site without the API (`VITE_ACCOUNTS=off`): there is nothing to sign in to, so the
 * panel opens straight in guest mode, with everything kept in the browser.
 */
export function accountsEnabled(setting: string | undefined): boolean {
  return setting !== "off";
}

export const ACCOUNTS_ENABLED = accountsEnabled(import.meta.env.VITE_ACCOUNTS);

/** Programs keep an offline copy only in production builds, where the programs site has its service worker. */
export const OFFLINE_PROGRAMS = import.meta.env.PROD && APPS_ISOLATED;
