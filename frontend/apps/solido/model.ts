/**
 * Sólido's document: solids placed on the ground, measured in metres. Plain data and pure
 * functions (no three.js), so geometry rules, volumes and the saved file are unit tested.
 *
 * Each solid sits on its base: (x, z) is the centre of its footprint and y the height of its
 * base, the way a massing model is built. Width runs along X, depth along Z and height along Y.
 */

export type Kind = "box" | "cylinder" | "sphere" | "cone" | "roof" | "prism";
export type Point2 = [number, number];

export interface Solid {
  id: string;
  name: string;
  kind: Kind;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Turn around the vertical axis, degrees. */
  rotation: number;
  color: string;
  hidden: boolean;
  /** Prism only: footprint corners (x, z) around the centre, at width = depth = 1 scale. */
  outline?: Point2[];
}

export interface Model {
  v: 1;
  solids: Solid[];
  /** Grid step for placing and moving, metres. */
  step: number;
}

export const KIND_NAMES: Record<Kind, string> = {
  box: "Caja", cylinder: "Cilindro", sphere: "Esfera", cone: "Cono", roof: "Cubierta", prism: "Prisma",
};
export const STEPS = [0.01, 0.05, 0.1, 0.5, 1];
export const MAX_SOLIDS = 2000;
export const MAX_POINTS = 500;
const MIN_SIZE = 0.001;
const MAX_SIZE = 10_000;
const MAX_COORD = 100_000;
const ID = /^o\d{1,6}$/;
const COLOR = /^#[0-9a-f]{6}$/;
const KINDS = Object.keys(KIND_NAMES) as Kind[];

const DEFAULTS: Record<Kind, { width: number; depth: number; height: number; color: string }> = {
  box: { width: 1, depth: 1, height: 1, color: "#d9d9d9" },
  cylinder: { width: 1, depth: 1, height: 1, color: "#c9c9c9" },
  sphere: { width: 1, depth: 1, height: 1, color: "#e0e0e0" },
  cone: { width: 1, depth: 1, height: 1, color: "#c4c4c4" },
  roof: { width: 4, depth: 3, height: 1.5, color: "#b5b5b5" },
  prism: { width: 1, depth: 1, height: 3, color: "#d0d0d0" },
};

export function newModel(): Model {
  return { v: 1, solids: [], step: 0.1 };
}

export const round = (value: number, decimals = 4): number => Math.round(value * 10 ** decimals) / 10 ** decimals;

export function snap(value: number, step: number): number {
  return step > 0 ? round(Math.round(value / step) * step) : round(value);
}

const clampSize = (v: number) => round(Math.min(Math.max(v, MIN_SIZE), MAX_SIZE));
const clampCoord = (v: number) => round(Math.min(Math.max(v, -MAX_COORD), MAX_COORD));
/** Degrees in [0, 360). */
export const normaliseAngle = (deg: number) => round(((deg % 360) + 360) % 360, 3);

function nextId(model: Model): string {
  const used = model.solids.map((s) => Number(s.id.slice(1)));
  return `o${(used.length ? Math.max(...used) : 0) + 1}`;
}

/** "Caja 3": the first free number for that kind of solid. */
function nextName(model: Model, kind: Kind): string {
  const base = KIND_NAMES[kind];
  const taken = new Set(model.solids.map((s) => s.name));
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function create(model: Model, kind: Exclude<Kind, "prism">, at: { x: number; z: number; y?: number }): { model: Model; solid: Solid } {
  if (model.solids.length >= MAX_SOLIDS) throw new Error("limit");
  const d = DEFAULTS[kind];
  const solid: Solid = {
    id: nextId(model), name: nextName(model, kind), kind,
    x: clampCoord(at.x), y: clampCoord(at.y ?? 0), z: clampCoord(at.z),
    width: d.width, depth: d.depth, height: d.height, rotation: 0, color: d.color, hidden: false,
  };
  return { model: { ...model, solids: [...model.solids, solid] }, solid };
}

// ---------------------------------------------------------------------------- footprints

/** Signed area (shoelace); positive when the points turn counter-clockwise in (x, z). */
export function signedArea(points: Point2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const cross = (p: Point2, q: Point2, r: Point2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Removes repeated and collinear corners; null when the outline cannot be a solid's footprint. */
export function cleanOutline(points: Point2[]): Point2[] | null {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  for (let i = 0; out.length > 3 && i < out.length;) {
    const a = out[(i + out.length - 1) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-9) out.splice(i, 1);
    else i++;
  }
  if (out.length < 3 || out.length > MAX_POINTS || Math.abs(signedArea(out)) < 1e-6) return null;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === out.length - 1)) continue;
      if (segmentsCross(out[i], out[(i + 1) % out.length], out[j], out[(j + 1) % out.length])) return null;
    }
  }
  return out;
}

/**
 * A prism from a footprint drawn on the ground (absolute x, z). The outline is stored around its
 * centre and normalised to a 1 × 1 box, so width and depth stay editable like any other solid.
 */
export function createPrism(model: Model, points: Point2[], height = DEFAULTS.prism.height, y = 0): { model: Model; solid: Solid } | null {
  if (model.solids.length >= MAX_SOLIDS) throw new Error("limit");
  const clean = cleanOutline(points);
  if (!clean) return null;
  const xs = clean.map((p) => p[0]);
  const zs = clean.map((p) => p[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (width < MIN_SIZE || depth < MIN_SIZE) return null;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let outline = clean.map(([x, z]): Point2 => [(x - cx) / width, (z - cz) / depth]);
  if (signedArea(outline) < 0) outline = outline.reverse();
  const solid: Solid = {
    id: nextId(model), name: nextName(model, "prism"), kind: "prism",
    x: clampCoord(cx), y: clampCoord(y), z: clampCoord(cz), width: clampSize(width), depth: clampSize(depth), height: clampSize(height),
    rotation: 0, color: DEFAULTS.prism.color, hidden: false, outline,
  };
  return { model: { ...model, solids: [...model.solids, solid] }, solid };
}

// ---------------------------------------------------------------------------- editing

export type Patch = Partial<Pick<Solid, "name" | "x" | "y" | "z" | "width" | "depth" | "height" | "rotation" | "color" | "hidden">>;

export function update(model: Model, id: string, patch: Patch): Model {
  return {
    ...model,
    solids: model.solids.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s };
      if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
      for (const key of ["x", "y", "z"] as const) if (Number.isFinite(patch[key])) next[key] = clampCoord(patch[key]!);
      for (const key of ["width", "depth", "height"] as const) if (Number.isFinite(patch[key])) next[key] = clampSize(patch[key]!);
      if (Number.isFinite(patch.rotation)) next.rotation = normaliseAngle(patch.rotation!);
      if (typeof patch.color === "string" && COLOR.test(patch.color.toLowerCase())) next.color = patch.color.toLowerCase();
      if (typeof patch.hidden === "boolean") next.hidden = patch.hidden;
      return next;
    }),
  };
}

export function remove(model: Model, id: string): Model {
  return { ...model, solids: model.solids.filter((s) => s.id !== id) };
}

/** A copy beside the original (one width to the right), so it is visible at once. */
export function duplicate(model: Model, id: string): { model: Model; solid: Solid } | null {
  const source = model.solids.find((s) => s.id === id);
  if (!source || model.solids.length >= MAX_SOLIDS) return null;
  const copy: Solid = {
    ...source,
    outline: source.outline?.map((p): Point2 => [p[0], p[1]]),
    id: nextId(model),
    name: nextName(model, source.kind),
    x: clampCoord(source.x + source.width + Math.max(model.step, 0.1)),
    hidden: false,
  };
  return { model: { ...model, solids: [...model.solids, copy] }, solid: copy };
}

// ---------------------------------------------------------------------------- measures

/** Footprint area in m² (what the solid covers on the ground, before turning it). */
export function footprint(s: Solid): number {
  switch (s.kind) {
    case "box":
    case "roof":
      return s.width * s.depth;
    case "cylinder":
    case "cone":
    case "sphere":
      return (Math.PI * s.width * s.depth) / 4;
    case "prism":
      return Math.abs(signedArea(s.outline ?? [])) * s.width * s.depth;
  }
}

/** Volume in m³: exact for every kind of solid Sólido draws. */
export function volume(s: Solid): number {
  switch (s.kind) {
    case "box":
    case "cylinder":
    case "prism":
      return footprint(s) * s.height;
    case "cone":
      return (footprint(s) * s.height) / 3;
    case "roof":
      return (s.width * s.depth * s.height) / 2;
    case "sphere":
      return (Math.PI * s.width * s.depth * s.height) / 6;
  }
}

// ---------------------------------------------------------------------------- saved file

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads a saved document field by field. Broken solids are skipped, never trusted. */
export function parseModel(raw: unknown): Model {
  const model = newModel();
  if (typeof raw !== "object" || raw === null) return model;
  const r = raw as Record<string, unknown>;
  if (num(r.step) && STEPS.includes(r.step)) model.step = r.step;
  if (!Array.isArray(r.solids)) return model;
  const seen = new Set<string>();
  for (const item of r.solids.slice(0, MAX_SOLIDS)) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID.test(s.id) || seen.has(s.id)) continue;
    if (typeof s.kind !== "string" || !KINDS.includes(s.kind as Kind)) continue;
    if (![s.x, s.y, s.z, s.width, s.depth, s.height, s.rotation].every(num)) continue;
    let outline: Point2[] | undefined;
    if (s.kind === "prism") {
      if (!Array.isArray(s.outline)) continue;
      const pts = s.outline.filter((p): p is Point2 => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]) && Math.abs(p[0]) <= 1 && Math.abs(p[1]) <= 1);
      const clean = pts.length === s.outline.length ? cleanOutline(pts) : null;
      if (!clean) continue;
      outline = clean;
    }
    seen.add(s.id);
    model.solids.push({
      id: s.id,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : KIND_NAMES[s.kind as Kind],
      kind: s.kind as Kind,
      x: clampCoord(s.x as number), y: clampCoord(s.y as number), z: clampCoord(s.z as number),
      width: clampSize(s.width as number), depth: clampSize(s.depth as number), height: clampSize(s.height as number),
      rotation: normaliseAngle(s.rotation as number),
      color: typeof s.color === "string" && COLOR.test(s.color) ? s.color : DEFAULTS[s.kind as Kind].color,
      hidden: s.hidden === true,
      ...(outline ? { outline } : {}),
    });
  }
  return model;
}
