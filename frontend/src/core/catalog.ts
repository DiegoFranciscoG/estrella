import data from "../data/programas.json";

export type Availability = "web" | "desktop" | "planned";
export type Demand = "baja" | "media" | "alta";

export interface Program {
  id: string;
  name: string;
  summary: string;
  replaces: string[];
  availability: Availability;
  status: "disponible" | "experimental" | "en-construccion";
  sizeKb: number | null;
  demand: Demand;
  phase: string;
  appPath: string | null;
  basedOn: { name: string; license: string; source: string } | null;
  honestNote: string;
}

const ID = /^[a-z0-9-]{1,40}$/;

/** Fails loudly when the catalog data is inconsistent, so a bad entry never reaches students. */
export function validateCatalog(raw: unknown): Program[] {
  if (!Array.isArray(raw)) throw new Error("Catalog must be a list");
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const p = entry as Program;
    const where = `program #${i}`;
    if (!ID.test(p.id) || seen.has(p.id)) throw new Error(`${where}: invalid or repeated id`);
    seen.add(p.id);
    if (!p.name || !p.summary || !p.honestNote) throw new Error(`${where}: missing text`);
    if (!["web", "desktop", "planned"].includes(p.availability)) throw new Error(`${where}: availability`);
    if (p.status === "disponible" && !p.appPath) throw new Error(`${where}: available program needs appPath`);
    if (p.appPath !== null && !/^\/apps\/[a-z0-9-]+\/index\.html$/.test(p.appPath)) throw new Error(`${where}: appPath`);
    return p;
  });
}

export const programs: Program[] = validateCatalog(data);

export function findProgram(id: string): Program | undefined {
  return programs.find((p) => p.id === id);
}
