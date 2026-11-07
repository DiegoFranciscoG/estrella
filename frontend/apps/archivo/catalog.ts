/**
 * Archivo's catalog: what the student knows about each file (rating, colour label, keywords)
 * next to what the file says about itself (name, size, date, type). Only this index is saved
 * with the project; the files stay on the student's computer. Pure functions, unit tested.
 */

export type FileKind =
  | "imagen" | "raw" | "vector" | "pdf" | "cad" | "bim" | "modelo3d" | "documento" | "hoja" | "presentacion" | "video" | "audio" | "comprimido" | "otro";

export const KIND_LABELS: Record<FileKind, string> = {
  imagen: "Imagen", raw: "Foto RAW", vector: "Vectorial", pdf: "PDF", cad: "Plano CAD", bim: "Modelo BIM", modelo3d: "Modelo 3D",
  documento: "Documento", hoja: "Hoja de cálculo", presentacion: "Presentación", video: "Video", audio: "Audio", comprimido: "Comprimido", otro: "Otro",
};

const EXTENSIONS: Record<FileKind, string[]> = {
  imagen: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "tif", "tiff", "heic", "psd"],
  raw: ["cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "rw2", "pef", "srw", "raf", "erf", "kdc", "3fr", "mrw", "x3f"],
  vector: ["svg", "ai", "eps"],
  pdf: ["pdf"],
  cad: ["dwg", "dxf"],
  bim: ["ifc", "ifczip", "rvt"],
  modelo3d: ["stl", "obj", "glb", "gltf", "ply", "3mf", "skp", "3dm", "fbx", "blend"],
  documento: ["doc", "docx", "odt", "rtf", "txt", "md"],
  hoja: ["xls", "xlsx", "ods", "csv"],
  presentacion: ["ppt", "pptx", "odp", "key"],
  video: ["mp4", "mov", "webm", "avi", "mkv"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac"],
  comprimido: ["zip", "rar", "7z", "tar", "gz"],
  otro: [],
};
const BY_EXTENSION = new Map(Object.entries(EXTENSIONS).flatMap(([kind, list]) => list.map((ext) => [ext, kind as FileKind])));

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function kindOf(name: string): FileKind {
  return BY_EXTENSION.get(extensionOf(name)) ?? "otro";
}

/** Which ESTRELLA program opens the file, in the student's words. */
export function opensWith(name: string): string {
  const ext = extensionOf(name);
  if (ext === "dxf") return "Plano para editarlo, Visor para verlo";
  if (ext === "dwg") return "Visor, que también lo convierte a DXF para Plano";
  if (ext === "svg") return "Trazo";
  if (ext === "psd") return "Visor";
  if (ext === "ifc") return "BIM o Visor";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "Lienzo para editarla, Revelado para ajustar la foto, Visor para verla";
  if (["gif", "bmp", "avif"].includes(ext)) return "Lienzo o Visor";
  switch (kindOf(name)) {
    case "raw": return "Revelado";
    case "pdf": return "Folio";
    case "modelo3d": return ["stl", "obj", "glb", "gltf", "ply", "3mf"].includes(ext) ? "Visor" : "";
    default: return "";
  }
}

export const LABELS = { rojo: "Elegido", amarillo: "Segunda opción", verde: "Aprobado", azul: "Revisar", morado: "Pendiente" } as const;
export type Label = keyof typeof LABELS;
const LABEL_KEYS = Object.keys(LABELS) as Label[];
export const labelText = (label: Label) => `${label[0].toUpperCase()}${label.slice(1)} · ${LABELS[label]}`;

export interface Entry {
  /** Path inside the chosen folder, e.g. "fotos/fachada.jpg": the key that keeps ratings. */
  path: string;
  name: string;
  size: number;
  modified: number;
  kind: FileKind;
  width: number | null;
  height: number | null;
  rating: number;
  label: Label | null;
  tags: string[];
}

export type Sort = "name" | "date" | "size" | "rating";
export interface View { query: string; kind: FileKind | ""; minRating: number; label: Label | ""; sort: Sort }
export interface Catalog { v: 1; folder: string | null; entries: Entry[]; view: View }

export const MAX_ENTRIES = 10_000;
const MAX_TAGS = 20;

export function newCatalog(): Catalog {
  return { v: 1, folder: null, entries: [], view: { query: "", kind: "", minRating: 0, label: "", sort: "name" } };
}

/** System and temporary files nobody wants to rate: hidden files, Office locks, thumbnails caches. */
export function isNoise(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return name.startsWith(".") || name.startsWith("~$") || /^(thumbs\.db|desktop\.ini)$/i.test(name) || path.split("/").some((p) => p.startsWith("."));
}

export interface Found { path: string; size: number; modified: number }

/**
 * A folder read again: files keep their rating, label and keywords by path; new files arrive
 * blank; files no longer there leave the catalog. With `add`, files join the current ones.
 */
export function scan(catalog: Catalog, found: Found[], folder: string | null, add = false): { catalog: Catalog; skipped: number } {
  const before = new Map(catalog.entries.map((e) => [e.path, e]));
  const out = new Map<string, Entry>(add ? catalog.entries.map((e) => [e.path, e]) : []);
  let skipped = 0;
  for (const f of found) {
    const path = f.path.replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 500);
    if (!path || isNoise(path)) continue;
    if (out.size >= MAX_ENTRIES && !out.has(path)) {
      skipped++;
      continue;
    }
    const name = path.split("/").pop()!;
    const old = before.get(path);
    const same = old && old.size === f.size && old.modified === f.modified;
    out.set(path, {
      path, name, size: Math.max(0, Math.floor(f.size)), modified: Math.floor(f.modified), kind: kindOf(name),
      width: same ? old.width : null, height: same ? old.height : null,
      rating: old?.rating ?? 0, label: old?.label ?? null, tags: old?.tags ?? [],
    });
  }
  return { catalog: { ...catalog, folder: add ? catalog.folder ?? folder : folder, entries: [...out.values()] }, skipped };
}

function each(catalog: Catalog, paths: Iterable<string>, change: (e: Entry) => Entry): Catalog {
  const set = new Set(paths);
  return { ...catalog, entries: catalog.entries.map((e) => (set.has(e.path) ? change(e) : e)) };
}

export const setRating = (c: Catalog, paths: Iterable<string>, rating: number): Catalog =>
  each(c, paths, (e) => ({ ...e, rating: Math.min(5, Math.max(0, Math.round(rating))) }));

export const setLabel = (c: Catalog, paths: Iterable<string>, label: Label | null): Catalog =>
  each(c, paths, (e) => ({ ...e, label: label && LABEL_KEYS.includes(label) ? label : null }));

export const setSize = (c: Catalog, path: string, width: number, height: number): Catalog =>
  each(c, [path], (e) => ({ ...e, width: Math.round(width), height: Math.round(height) }));

/** "Fachada, entrega final; fachada" → ["Fachada", "entrega final"]: trimmed, no repeats. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export const setTags = (c: Catalog, paths: Iterable<string>, tags: string[]): Catalog =>
  each(c, paths, (e) => ({ ...e, tags: parseTags(tags.join(",")) }));

export const addTags = (c: Catalog, paths: Iterable<string>, tags: string[]): Catalog =>
  each(c, paths, (e) => ({ ...e, tags: parseTags([...e.tags, ...tags].join(",")) }));

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The files the view shows: search words in the name, path or keywords, then the filters, sorted. */
export function visible(c: Catalog): Entry[] {
  const words = fold(c.view.query).split(/\s+/).filter(Boolean);
  const list = c.entries.filter((e) => {
    if (c.view.kind && e.kind !== c.view.kind) return false;
    if (e.rating < c.view.minRating) return false;
    if (c.view.label && e.label !== c.view.label) return false;
    const text = fold(`${e.path} ${e.tags.join(" ")}`);
    return words.every((w) => text.includes(w));
  });
  const byName = (a: Entry, b: Entry) => a.path.localeCompare(b.path, "es", { numeric: true, sensitivity: "base" });
  const sorters: Record<Sort, (a: Entry, b: Entry) => number> = {
    name: byName,
    date: (a, b) => b.modified - a.modified || byName(a, b),
    size: (a, b) => b.size - a.size || byName(a, b),
    rating: (a, b) => b.rating - a.rating || byName(a, b),
  };
  return list.sort(sorters[c.view.sort]);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toLocaleString("es", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[i]}`;
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------- batch rename

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A name every operating system accepts: no reserved characters, no trailing dots or spaces. */
export function safeName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 150);
  if (!s) s = "archivo";
  return RESERVED.test(s) ? `_${s}` : s;
}

/**
 * New names for a list of files, in order: {nombre} is the old name, {n} a number with leading
 * zeros, {fecha} the file's date (YYYY-MM-DD). The extension is kept, and names never repeat.
 */
export function renamePlan(entries: Entry[], pattern: string, start = 1): { entry: Entry; name: string }[] {
  const last = start + entries.length - 1;
  const width = Math.max(2, String(Math.max(last, 0)).length);
  const taken = new Set<string>();
  return entries.map((entry, i) => {
    const ext = extensionOf(entry.name);
    const stem = ext ? entry.name.slice(0, -(ext.length + 1)) : entry.name;
    const filled = (pattern.trim() || "{nombre}")
      .replace(/\{nombre\}/gi, stem)
      .replace(/\{n\}/gi, String(start + i).padStart(width, "0"))
      .replace(/\{fecha\}/gi, isoDate(entry.modified));
    const base = safeName(filled);
    const original = entry.name.slice(entry.name.length - ext.length);
    let name = ext ? `${base}.${original}` : base;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = ext ? `${base} (${k}).${original}` : `${base} (${k})`;
    taken.add(name.toLowerCase());
    return { entry, name };
  });
}

// ---------------------------------------------------------------------------- saved catalog

const SORTS: Sort[] = ["name", "date", "size", "rating"];
const KINDS = Object.keys(KIND_LABELS) as FileKind[];
const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function parseCatalog(raw: unknown): Catalog {
  const c = newCatalog();
  if (typeof raw !== "object" || raw === null) return c;
  const r = raw as Record<string, unknown>;
  if (typeof r.folder === "string") c.folder = r.folder.slice(0, 200);
  const view = (typeof r.view === "object" && r.view !== null ? r.view : {}) as Record<string, unknown>;
  if (typeof view.query === "string") c.view.query = view.query.slice(0, 200);
  if (typeof view.kind === "string" && KINDS.includes(view.kind as FileKind)) c.view.kind = view.kind as FileKind;
  if (int(view.minRating, 0, 5)) c.view.minRating = view.minRating;
  if (typeof view.label === "string" && LABEL_KEYS.includes(view.label as Label)) c.view.label = view.label as Label;
  if (typeof view.sort === "string" && SORTS.includes(view.sort as Sort)) c.view.sort = view.sort as Sort;
  if (!Array.isArray(r.entries)) return c;
  const seen = new Set<string>();
  for (const item of r.entries.slice(0, MAX_ENTRIES)) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.path !== "string" || !e.path || e.path.length > 500 || seen.has(e.path)) continue;
    if (!int(e.size, 0, Number.MAX_SAFE_INTEGER) || !int(e.modified, 0, 8.64e15)) continue;
    seen.add(e.path);
    const name = e.path.split("/").pop()!;
    c.entries.push({
      path: e.path, name, size: e.size, modified: e.modified, kind: kindOf(name),
      width: int(e.width, 1, 1e6) ? e.width : null,
      height: int(e.height, 1, 1e6) ? e.height : null,
      rating: int(e.rating, 0, 5) ? e.rating : 0,
      label: typeof e.label === "string" && LABEL_KEYS.includes(e.label as Label) ? (e.label as Label) : null,
      tags: Array.isArray(e.tags) ? parseTags(e.tags.filter((t): t is string => typeof t === "string").join(",")) : [],
    });
  }
  return c;
}
