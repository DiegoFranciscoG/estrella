import data from "../data/guia.json";
import { findProgram } from "./catalog";

/**
 * Equivalence guide: "this is how you did it in the paid program; this is how you do it here".
 * Every card names its evidence: the official manual of the free program, or the automated test
 * that proves an ESTRELLA program does it. Data that breaks these rules fails at load, so an
 * unsourced card never reaches a student.
 */

export type Area = "arquitectura" | "diseno";

export interface ExternalTool { name: string; where: "escritorio"; site: string }

export type Source =
  | { kind: "official"; title: string; url: string }
  | { kind: "test"; file: string; test: string };

export interface Card {
  id: string;
  area: Area;
  task: string;
  keywords: string[];
  from: { program: string; term: string }[];
  /** An ESTRELLA program id, or a key of `tools`. */
  tool: string;
  steps: string[];
  limits?: string;
  source: Source;
}

export interface Guide {
  consulted: string;
  tools: Record<string, ExternalTool>;
  cards: Card[];
}

export type ResolvedTool =
  | { kind: "estrella"; id: string; name: string; available: boolean }
  | { kind: "external"; id: string; name: string; site: string };

const ID = /^[a-z0-9-]{1,60}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Official documentation of each project. A blog or forum is never the only source (project rule). */
const OFFICIAL = [
  "https://docs.librecad.org/", "https://wiki.freecad.org/", "https://docs.blender.org/", "https://extensions.blender.org/",
  "https://docs.gimp.org/", "https://inkscape-manuals.readthedocs.io/", "https://wiki.scribus.net/", "https://docs.darktable.org/",
  "https://docs.digikam.org/", "https://docs.kdenlive.org/", "https://github.com/viliusle/miniPaint",
];
const TEST_FILE = /^frontend\/tests\/(e2e|unit)\/[a-z0-9-]+\.(spec|test)\.ts$/;

export function validateGuide(raw: unknown, isProgram: (id: string) => boolean): Guide {
  const g = raw as Guide;
  if (!g || !DATE.test(g.consulted)) throw new Error("guide: consulted date");
  for (const [key, t] of Object.entries(g.tools ?? {})) {
    if (!ID.test(key) || !t.name || t.where !== "escritorio" || !/^https:\/\//.test(t.site)) throw new Error(`guide tool ${key}`);
  }
  if (!Array.isArray(g.cards) || !g.cards.length) throw new Error("guide: no cards");
  const seen = new Set<string>();
  for (const c of g.cards) {
    const where = `guide card ${c.id}`;
    if (!ID.test(c.id) || seen.has(c.id)) throw new Error(`${where}: invalid or repeated id`);
    seen.add(c.id);
    if (c.area !== "arquitectura" && c.area !== "diseno") throw new Error(`${where}: area`);
    if (!c.task || !c.steps?.length || c.steps.some((s) => !s.trim())) throw new Error(`${where}: task or steps`);
    if (!c.from?.length || c.from.some((f) => !f.program || !f.term)) throw new Error(`${where}: from`);
    if (!Array.isArray(c.keywords)) throw new Error(`${where}: keywords`);
    if (!isProgram(c.tool) && !(c.tool in g.tools)) throw new Error(`${where}: unknown tool ${c.tool}`);
    const s = c.source;
    if (s?.kind === "official") {
      if (!OFFICIAL.some((prefix) => s.url.startsWith(prefix)) || !s.title) throw new Error(`${where}: source must be an official manual`);
    } else if (s?.kind === "test") {
      if (!TEST_FILE.test(s.file) || !s.test) throw new Error(`${where}: test source`);
    } else {
      throw new Error(`${where}: missing source`);
    }
  }
  return g;
}

export const guide: Guide = validateGuide(data, (id) => !!findProgram(id));

export function resolveTool(id: string, g: Guide = guide): ResolvedTool {
  const program = findProgram(id);
  if (program) return { kind: "estrella", id, name: program.name, available: program.status === "disponible" };
  const t = g.tools[id];
  return { kind: "external", id, name: t.name, site: t.site };
}

/** Lowercase without accents, so "camara", "Cámara" and "CÁMARA" match. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface Query { text?: string; area?: Area | ""; from?: string }

/**
 * Every word of the query must appear somewhere in the card. Matches in the task title rank first,
 * then the paid program and its term, then keywords and the rest.
 */
export function search(cards: Card[], q: Query, g: Guide = guide): Card[] {
  const words = normalize(q.text ?? "").split(" ").filter(Boolean);
  const scored: { card: Card; score: number; index: number }[] = [];
  cards.forEach((card, index) => {
    if (q.area && card.area !== q.area) return;
    if (q.from && !card.from.some((f) => f.program === q.from)) return;
    const task = normalize(card.task);
    const from = normalize(card.from.map((f) => `${f.program} ${f.term}`).join(" "));
    const keys = normalize(card.keywords.join(" "));
    const rest = normalize(`${resolveTool(card.tool, g).name} ${card.steps.join(" ")} ${card.limits ?? ""}`);
    let score = 0;
    for (const w of words) {
      if (task.includes(w)) score += 4;
      else if (from.includes(w)) score += 3;
      else if (keys.includes(w)) score += 2;
      else if (rest.includes(w)) score += 1;
      else return;
    }
    scored.push({ card, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.card);
}

/** Paid programs that appear in the guide, for the "I come from…" filter. */
export function paidPrograms(cards: Card[]): string[] {
  return [...new Set(cards.flatMap((c) => c.from.map((f) => f.program)))].sort((a, b) => a.localeCompare(b, "es"));
}
