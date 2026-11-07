/**
 * Pure helpers that turn a finished build into its service workers. Reading and writing files is
 * done by the Vite configs; everything that decides what goes in the worker lives here, tested.
 */

export interface BuiltFile {
  /** Path inside the output folder, with forward slashes ("assets/index-abc.js"). */
  path: string;
  bytes: Uint8Array;
}

/** Files the panel needs offline: everything it built, except the programs site, the worker and the notices. */
export function panelPrecache(paths: string[]): string[] {
  return paths
    .filter((p) => !p.startsWith("apps/") && p !== "sw.js" && p !== "THIRD-PARTY-NOTICES.txt" && !p.startsWith("."))
    .map((p) => `/${p}`)
    .sort();
}

/** Hashed files of the programs build, as URLs under the programs scope. */
export function programsAssets(paths: string[], scope = "/apps/"): string[] {
  return paths.filter((p) => p.startsWith("assets/")).map((p) => `${scope}${p}`).sort();
}

/** Short SHA-256 of names and contents: any change to the build gives a new worker version. */
export async function buildVersion(files: BuiltFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of sorted) parts.push(enc.encode(`${f.path}\0${f.bytes.length}\0`), f.bytes);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Replaces "__KEY__" placeholders; a placeholder left behind fails the build instead of shipping. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    if (!out.includes(`__${key}__`)) throw new Error(`Placeholder __${key}__ not found`);
    out = out.split(`"__${key}__"`).join(value).split(`__${key}__`).join(value);
  }
  const left = /__[A-Z]+__/.exec(out);
  if (left) throw new Error(`Placeholder ${left[0]} left in the service worker`);
  return out;
}
