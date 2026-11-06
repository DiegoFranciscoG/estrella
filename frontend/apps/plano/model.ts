/** Plano's drawing model: plain data in millimetres, y axis up, angles in radians (CCW). */

export interface Pt { x: number; y: number }

export type HatchPattern = "solido" | "diagonal" | "cruzado" | "ladrillo";
export const HATCH_PATTERNS: HatchPattern[] = ["solido", "diagonal", "cruzado", "ladrillo"];

interface Base { id: string; layer: string }
export type Entity =
  | (Base & { kind: "line"; a: Pt; b: Pt })
  | (Base & { kind: "polyline"; pts: Pt[]; closed: boolean })
  | (Base & { kind: "circle"; c: Pt; r: number })
  | (Base & { kind: "arc"; c: Pt; r: number; start: number; end: number })
  | (Base & { kind: "text"; p: Pt; text: string; h: number; rot?: number })
  /** aligned (default) measures the true distance; h and v measure along x or y only. */
  | (Base & { kind: "dim"; a: Pt; b: Pt; offset: number; mode?: "aligned" | "h" | "v" })
  | (Base & { kind: "hatch"; pts: Pt[]; pattern: HatchPattern; scale: number; angle: number })
  | (Base & { kind: "insert"; name: string; p: Pt; rot: number; s: number; flip?: boolean });

/** An entity before it gets an id and a layer (distributes over the union, unlike Omit). */
export type Shape = Entity extends infer E ? (E extends Entity ? Omit<E, "id" | "layer"> : never) : never;

export interface Layer { name: string; visible: boolean; locked: boolean }
export interface Block { base: Pt; entities: Entity[] }

export interface Drawing {
  v: 1;
  units: "mm";
  layers: Layer[];
  current: string;
  entities: Entity[];
  blocks?: Record<string, Block>;
}

export function emptyDrawing(): Drawing {
  return { v: 1, units: "mm", layers: [{ name: "0", visible: true, locked: false }], current: "0", entities: [], blocks: {} };
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const TAU = 2 * Math.PI;
export const normAngle = (x: number) => ((x % TAU) + TAU) % TAU;

const MAX_ENTITIES = 200_000;
const BLOCK_NAME = /^[^<>/\\":;?*|=`]{1,64}$/;

/** Validates untrusted saved or imported data; unknown parts are dropped, never executed. */
export function parseDrawing(json: string): Drawing {
  const raw = JSON.parse(json) as Partial<Drawing>;
  const d = emptyDrawing();
  if (Array.isArray(raw.layers)) {
    const layers = raw.layers.filter((l) => l && typeof l.name === "string" && l.name.length <= 64)
      .map((l) => ({ name: l.name, visible: l.visible !== false, locked: l.locked === true }));
    if (layers.length) d.layers = layers;
  }
  const names = new Set(d.layers.map((l) => l.name));
  d.current = typeof raw.current === "string" && names.has(raw.current) ? raw.current : d.layers[0].name;
  const blockNames = new Set(Object.keys(raw.blocks ?? {}).filter((n) => BLOCK_NAME.test(n)));
  for (const name of blockNames) {
    const b = (raw.blocks as Record<string, Block>)[name];
    if (!b || !isPt(b.base) || !Array.isArray(b.entities)) continue;
    // Block contents keep their own layer names; unknown layers fall back to "0" when drawn.
    d.blocks![name] = { base: { x: b.base.x, y: b.base.y }, entities: b.entities.filter((e) => validEntity(e, null, blockNames)).slice(0, MAX_ENTITIES) };
  }
  for (const e of Array.isArray(raw.entities) ? raw.entities.slice(0, MAX_ENTITIES) : []) {
    if (validEntity(e, names, new Set(Object.keys(d.blocks!)))) d.entities.push(e);
  }
  return d;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isPt = (p: unknown): p is Pt => !!p && isNum((p as Pt).x) && isNum((p as Pt).y);

function validEntity(e: Entity, layers: Set<string> | null, blocks: Set<string>): boolean {
  if (!e || typeof e.id !== "string" || typeof e.layer !== "string") return false;
  if (layers && !layers.has(e.layer)) return false;
  switch (e.kind) {
    case "line": return isPt(e.a) && isPt(e.b);
    case "polyline": return Array.isArray(e.pts) && e.pts.length >= 2 && e.pts.every(isPt);
    case "circle": return isPt(e.c) && isNum(e.r) && e.r > 0;
    case "arc": return isPt(e.c) && isNum(e.r) && e.r > 0 && isNum(e.start) && isNum(e.end);
    case "text": return isPt(e.p) && typeof e.text === "string" && e.text.length <= 500 && isNum(e.h) && e.h > 0 && (e.rot === undefined || isNum(e.rot));
    case "dim": return isPt(e.a) && isPt(e.b) && isNum(e.offset) && (e.mode === undefined || ["aligned", "h", "v"].includes(e.mode));
    case "hatch": return Array.isArray(e.pts) && e.pts.length >= 3 && e.pts.length <= 5000 && e.pts.every(isPt)
      && HATCH_PATTERNS.includes(e.pattern) && isNum(e.scale) && e.scale > 0 && isNum(e.angle);
    case "insert": return typeof e.name === "string" && blocks.has(e.name) && isPt(e.p) && isNum(e.rot) && isNum(e.s) && e.s !== 0;
    default: return false;
  }
}

/* ---------- primitives: what every entity looks like once drawn ---------- */

export type Prim =
  | { t: "seg"; a: Pt; b: Pt }
  | { t: "arc"; c: Pt; r: number; start: number; end: number }
  | { t: "text"; p: Pt; h: number; rot: number; value: string; center?: boolean }
  | { t: "fill"; pts: Pt[] };

/** Similarity transform: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function apply(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}
/** m1 after m2. */
export function compose(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}
export const translation = (dx: number, dy: number): Affine => ({ ...IDENTITY, e: dx, f: dy });
export function rotation(base: Pt, angle: number): Affine {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { a: cos, b: sin, c: -sin, d: cos, e: base.x - cos * base.x + sin * base.y, f: base.y - sin * base.x - cos * base.y };
}
export function scaling(base: Pt, k: number): Affine {
  return { a: k, b: 0, c: 0, d: k, e: base.x * (1 - k), f: base.y * (1 - k) };
}
/** Reflection across the line through p1 and p2. */
export function mirroring(p1: Pt, p2: Pt): Affine {
  const phi = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const cos = Math.cos(2 * phi), sin = Math.sin(2 * phi);
  const m = { a: cos, b: sin, c: sin, d: -cos, e: 0, f: 0 };
  const moved = apply(m, p1);
  return { ...m, e: p1.x - moved.x, f: p1.y - moved.y };
}
const det = (m: Affine) => m.a * m.d - m.b * m.c;
const factor = (m: Affine) => Math.sqrt(Math.abs(det(m)));
const turn = (m: Affine) => Math.atan2(m.b, m.a);

function insertMatrix(e: Extract<Entity, { kind: "insert" }>, base: Pt): Affine {
  let m = translation(-base.x, -base.y);
  if (e.flip) m = compose({ ...IDENTITY, a: -1 }, m);
  m = compose(scaling({ x: 0, y: 0 }, e.s), m);
  m = compose(rotation({ x: 0, y: 0 }, e.rot), m);
  return compose(translation(e.p.x, e.p.y), m);
}

function primsOfEntity(e: Entity, blocks: Record<string, Block>, depth: number): Prim[] {
  switch (e.kind) {
    case "line": return [{ t: "seg", a: e.a, b: e.b }];
    case "polyline": {
      const out: Prim[] = [];
      const n = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < n; i++) out.push({ t: "seg", a: e.pts[i], b: e.pts[(i + 1) % e.pts.length] });
      return out;
    }
    case "circle": return [{ t: "arc", c: e.c, r: e.r, start: 0, end: TAU }];
    case "arc": return [{ t: "arc", c: e.c, r: e.r, start: e.start, end: e.end }];
    case "text": return [{ t: "text", p: e.p, h: e.h, rot: e.rot ?? 0, value: e.text }];
    case "dim": {
      const g = dimensionGeometry(e);
      return [...g.segments.map(([a, b]) => ({ t: "seg" as const, a, b })), { t: "text", p: g.textAt, h: g.textHeight, rot: readable(g.angle), value: g.value, center: true }];
    }
    case "hatch": return hatchPrims(e);
    case "insert": {
      const block = blocks[e.name];
      if (!block || depth > 4) return [];
      const m = insertMatrix(e, block.base);
      return block.entities.flatMap((inner) => primsOfEntity(transformEntity(inner, m), blocks, depth + 1));
    }
  }
}

/** Text angles are kept between -90° and 90° so labels never read upside down. */
function readable(angle: number): number {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

export function primitives(e: Entity, blocks: Record<string, Block> = {}): Prim[] {
  return primsOfEntity(e, blocks, 0);
}

/* ---------- transforms ---------- */

/** Applies a similarity transform (move, rotate, scale, mirror) to any entity. */
export function transformEntity(e: Entity, m: Affine): Entity {
  const P = (p: Pt) => apply(m, p);
  const k = factor(m);
  const theta = turn(m);
  const reflect = det(m) < 0;
  switch (e.kind) {
    case "line": return { ...e, a: P(e.a), b: P(e.b) };
    case "polyline": return { ...e, pts: e.pts.map(P) };
    case "circle": return { ...e, c: P(e.c), r: e.r * k };
    case "arc": return reflect
      ? { ...e, c: P(e.c), r: e.r * k, start: normAngle(theta - e.end), end: normAngle(theta - e.start) }
      : { ...e, c: P(e.c), r: e.r * k, start: normAngle(e.start + theta), end: normAngle(e.end + theta) };
    // Mirrored text stays readable, as drafting convention expects.
    case "text": return { ...e, p: P(e.p), h: e.h * k, rot: reflect ? e.rot : normAngle((e.rot ?? 0) + theta) };
    case "dim": {
      const quarter = Math.abs(Math.sin(2 * theta)) < 1e-9;
      if ((e.mode === "h" || e.mode === "v") && !quarter) {
        // A horizontal dimension turned 30° is no longer horizontal: keep it as an aligned one.
        const g = dimensionGeometry(e);
        return { ...e, mode: "aligned", a: P(g.points[2]), b: P(g.points[3]), offset: 0 };
      }
      const swap = (e.mode === "h" || e.mode === "v") && Math.abs(Math.sin(theta)) > 0.5;
      const mode = swap ? (e.mode === "h" ? "v" : "h") : e.mode;
      if (mode === "h" || mode === "v") {
        // Keep the dimension line where it was drawn: recompute the offset from the moved line.
        const line = apply(m, dimensionGeometry(e).points[2]);
        const a = P(e.a);
        return { ...e, mode, a, b: P(e.b), offset: mode === "h" ? line.y - a.y : line.x - a.x };
      }
      return { ...e, a: P(e.a), b: P(e.b), offset: e.offset * k * (reflect ? -1 : 1) };
    }
    case "hatch": return { ...e, pts: e.pts.map(P), scale: e.scale * k, angle: normAngle(reflect ? theta - e.angle : e.angle + theta) };
    case "insert": return reflect
      ? { ...e, p: P(e.p), s: e.s * k, rot: normAngle(theta - e.rot + Math.PI), flip: !e.flip }
      : { ...e, p: P(e.p), s: e.s * k, rot: normAngle(e.rot + theta) };
  }
}

export function translate(e: Entity, dx: number, dy: number): Entity {
  return transformEntity(e, translation(dx, dy));
}

/* ---------- measuring ---------- */

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

function primBox(p: Prim): Box {
  switch (p.t) {
    case "seg": return { minX: Math.min(p.a.x, p.b.x), minY: Math.min(p.a.y, p.b.y), maxX: Math.max(p.a.x, p.b.x), maxY: Math.max(p.a.y, p.b.y) };
    case "arc": {
      const pts = [arcPoint(p, p.start), arcPoint(p, p.end)];
      for (let q = 0; q < 4; q++) if (angleIn((q * Math.PI) / 2, p.start, p.end)) pts.push(arcPoint(p, (q * Math.PI) / 2));
      return boxOf(pts);
    }
    case "text": {
      const w = p.value.length * p.h * 0.6;
      const x0 = p.center ? -w / 2 : 0;
      const corners = [{ x: x0, y: 0 }, { x: x0 + w, y: 0 }, { x: x0 + w, y: p.h }, { x: x0, y: p.h }]
        .map((c) => apply(compose(translation(p.p.x, p.p.y), rotation({ x: 0, y: 0 }, p.rot)), c));
      return boxOf(corners);
    }
    case "fill": return boxOf(p.pts);
  }
}

function boxOf(pts: Pt[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

const unite = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });

export function bounds(e: Entity, blocks: Record<string, Block> = {}): Box {
  if (e.kind === "hatch") return boxOf(e.pts);
  const prims = primitives(e, blocks);
  if (!prims.length) return e.kind === "insert" ? { minX: e.p.x, minY: e.p.y, maxX: e.p.x, maxY: e.p.y } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return prims.map(primBox).reduce(unite);
}

export function drawingBounds(entities: Entity[], blocks: Record<string, Block> = {}): Box | null {
  if (!entities.length) return null;
  return entities.map((e) => bounds(e, blocks)).reduce(unite);
}

export function arcPoint(a: { c: Pt; r: number }, angle: number): Pt {
  return { x: a.c.x + a.r * Math.cos(angle), y: a.c.y + a.r * Math.sin(angle) };
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  return dist(p, closestOnSegment(p, a, b));
}

export function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function angleIn(angle: number, start: number, end: number): boolean {
  const a = normAngle(angle - start);
  const span = normAngle(end - start) || TAU;
  return a <= span + 1e-12;
}

function distToPrim(p: Pt, q: Prim): number {
  switch (q.t) {
    case "seg": return distToSegment(p, q.a, q.b);
    case "arc": {
      const ang = Math.atan2(p.y - q.c.y, p.x - q.c.x);
      if (angleIn(ang, q.start, q.end)) return Math.abs(dist(p, q.c) - q.r);
      return Math.min(dist(p, arcPoint(q, q.start)), dist(p, arcPoint(q, q.end)));
    }
    case "text":
    case "fill": {
      const b = primBox(q);
      const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
      const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
      return Math.hypot(dx, dy);
    }
  }
}

/** Distance from a point to what the entity draws, in mm. A hatch counts from inside its area. */
export function distanceTo(e: Entity, p: Pt, blocks: Record<string, Block> = {}): number {
  if (e.kind === "hatch") return pointInPolygon(p, e.pts) ? 0 : Math.min(...edges(e.pts).map(([a, b]) => distToSegment(p, a, b)));
  const prims = primitives(e, blocks);
  return prims.length ? Math.min(...prims.map((q) => distToPrim(p, q))) : dist(p, (e as { p?: Pt }).p ?? p);
}

export function arcEnds(e: { c: Pt; r: number; start: number; end: number }): [Pt, Pt] {
  return [arcPoint(e, e.start), arcPoint(e, e.end)];
}

/** Dimension: extension lines, dimension line with ticks, and the measured value. */
export function dimensionGeometry(e: Extract<Entity, { kind: "dim" }>) {
  let a2: Pt, b2: Pt, measured: number;
  if (e.mode === "h") {
    const y = e.a.y + e.offset;
    a2 = { x: e.a.x, y }; b2 = { x: e.b.x, y }; measured = Math.abs(e.b.x - e.a.x);
  } else if (e.mode === "v") {
    const x = e.a.x + e.offset;
    a2 = { x, y: e.a.y }; b2 = { x, y: e.b.y }; measured = Math.abs(e.b.y - e.a.y);
  } else {
    const len = dist(e.a, e.b) || 1;
    const nx = -(e.b.y - e.a.y) / len;
    const ny = (e.b.x - e.a.x) / len;
    a2 = { x: e.a.x + nx * e.offset, y: e.a.y + ny * e.offset };
    b2 = { x: e.b.x + nx * e.offset, y: e.b.y + ny * e.offset };
    measured = dist(e.a, e.b);
  }
  const len = dist(a2, b2) || 1;
  const ux = (b2.x - a2.x) / len;
  const uy = (b2.y - a2.y) / len;
  const nx = -uy, ny = ux;
  const tick = Math.max(measured * 0.02, 1);
  const tickAt = (p: Pt): [Pt, Pt] => [
    { x: p.x - (ux + nx) * tick, y: p.y - (uy + ny) * tick },
    { x: p.x + (ux + nx) * tick, y: p.y + (uy + ny) * tick },
  ];
  const segments: [Pt, Pt][] = [[e.a, a2], [e.b, b2], [a2, b2], tickAt(a2), tickAt(b2)];
  return {
    segments,
    points: [e.a, e.b, a2, b2],
    textAt: { x: (a2.x + b2.x) / 2 + nx * tick * 1.5, y: (a2.y + b2.y) / 2 + ny * tick * 1.5 },
    angle: Math.atan2(uy, ux),
    value: formatLength(measured),
    textHeight: Math.max(tick * 2.5, 2.5),
  };
}

export function formatLength(mm: number): string {
  const rounded = Math.round(mm * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

/* ---------- areas and hatching ---------- */

export function edges(pts: Pt[]): [Pt, Pt][] {
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [Pt, Pt]);
}

export function polygonArea(pts: Pt[]): number {
  let s = 0;
  for (const [a, b] of edges(pts)) s += a.x * b.y - b.x * a.y;
  return Math.abs(s) / 2;
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (const [a, b] of edges(pts)) {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Parallel lines across a polygon, clipped by the even-odd rule, at `angle` and `spacing` apart. */
export function clippedLines(pts: Pt[], angle: number, spacing: number, offset = 0): [Pt, Pt][] {
  const toLocal = rotation({ x: 0, y: 0 }, -angle);
  const toWorld = rotation({ x: 0, y: 0 }, angle);
  const local = pts.map((p) => apply(toLocal, p));
  const b = boxOf(local);
  const out: [Pt, Pt][] = [];
  if (!(spacing > 0) || (b.maxY - b.minY) / spacing > 20_000) return out;
  for (let y = Math.ceil((b.minY - offset) / spacing) * spacing + offset; y <= b.maxY; y += spacing) {
    const xs: number[] = [];
    for (const [p, q] of edges(local)) {
      if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([apply(toWorld, { x: xs[i], y }), apply(toWorld, { x: xs[i + 1], y })]);
  }
  return out;
}

/** Spacing at scale 1, in mm (close to the common ANSI31 pattern). */
const HATCH_SPACING = 3.175;

function hatchPrims(e: Extract<Entity, { kind: "hatch" }>): Prim[] {
  const s = HATCH_SPACING * e.scale;
  const seg = ([a, b]: [Pt, Pt]): Prim => ({ t: "seg", a, b });
  switch (e.pattern) {
    case "solido": return [{ t: "fill", pts: e.pts }];
    case "diagonal": return clippedLines(e.pts, e.angle + Math.PI / 4, s).map(seg);
    case "cruzado": return [...clippedLines(e.pts, e.angle + Math.PI / 4, s), ...clippedLines(e.pts, e.angle - Math.PI / 4, s)].map(seg);
    case "ladrillo": {
      // Courses every 2s; joints every 4s, shifted half a brick on alternate courses.
      const toLocal = rotation({ x: 0, y: 0 }, -e.angle);
      const toWorld = rotation({ x: 0, y: 0 }, e.angle);
      const local = e.pts.map((p) => apply(toLocal, p));
      const box = boxOf(local);
      const joints: [Pt, Pt][] = [];
      if ((box.maxY - box.minY) / s < 10_000 && (box.maxX - box.minX) / s < 10_000) {
        for (let k = Math.floor(box.minY / (2 * s)); k * 2 * s < box.maxY; k++) {
          const y0 = k * 2 * s, y1 = y0 + 2 * s;
          const shift = Math.abs(k % 2) * 2 * s;
          for (let x = Math.ceil((box.minX - shift) / (4 * s)) * 4 * s + shift; x <= box.maxX; x += 4 * s) {
            for (const [lo, hi] of verticalSpans(local, x)) {
              const from = Math.max(lo, y0), to = Math.min(hi, y1);
              if (to > from) joints.push([apply(toWorld, { x, y: from }), apply(toWorld, { x, y: to })]);
            }
          }
        }
      }
      return [...clippedLines(e.pts, e.angle, 2 * s), ...joints].map(seg);
    }
  }
}

/** Where a vertical line at x is inside the polygon (even-odd), as [low, high] pairs. */
function verticalSpans(pts: Pt[], x: number): [number, number][] {
  const ys: number[] = [];
  for (const [p, q] of edges(pts)) if ((p.x > x) !== (q.x > x)) ys.push(p.y + ((x - p.x) * (q.y - p.y)) / (q.x - p.x));
  ys.sort((m, n) => m - n);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]]);
  return out;
}

/* ---------- snapping ---------- */

export type SnapKind = "end" | "mid" | "center" | "quadrant" | "intersection" | "perpendicular" | "tangent" | "insert" | "grid";
export interface Snap { p: Pt; kind: SnapKind }

/** Characteristic points: ends, midpoints, centers and quadrants. */
export function snapPoints(e: Entity, blocks: Record<string, Block> = {}): Snap[] {
  switch (e.kind) {
    case "line": return [{ p: e.a, kind: "end" }, { p: e.b, kind: "end" }, { p: mid(e.a, e.b), kind: "mid" }];
    case "polyline": {
      const out: Snap[] = e.pts.map((p) => ({ p, kind: "end" as const }));
      const n = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < n; i++) out.push({ p: mid(e.pts[i], e.pts[(i + 1) % e.pts.length]), kind: "mid" });
      return out;
    }
    case "circle": return [{ p: e.c, kind: "center" }, ...[0, 1, 2, 3].map((q) => ({ p: arcPoint(e, (q * Math.PI) / 2), kind: "quadrant" as const }))];
    case "arc": return [
      { p: e.c, kind: "center" },
      ...arcEnds(e).map((p) => ({ p, kind: "end" as const })),
      { p: arcPoint(e, e.start + normAngle(e.end - e.start) / 2), kind: "mid" },
      ...[0, 1, 2, 3].filter((q) => angleIn((q * Math.PI) / 2, e.start, e.end)).map((q) => ({ p: arcPoint(e, (q * Math.PI) / 2), kind: "quadrant" as const })),
    ];
    case "text": return [{ p: e.p, kind: "insert" }];
    case "dim": return [{ p: e.a, kind: "end" }, { p: e.b, kind: "end" }];
    case "hatch": return [];
    case "insert": return [{ p: e.p, kind: "insert" }, ...primitives(e, blocks).flatMap((q) => q.t === "seg" ? [{ p: q.a, kind: "end" as const }, { p: q.b, kind: "end" as const }] : [])];
  }
}

export function nearestSnap(entities: Entity[], p: Pt, tolerance: number, blocks: Record<string, Block> = {}): Snap | null {
  let best: Snap | null = null;
  let bestDist = tolerance;
  for (const e of entities) {
    for (const s of snapPoints(e, blocks)) {
      const d = dist(s.p, p);
      if (d <= bestDist) {
        bestDist = d;
        best = s;
      }
    }
  }
  return best;
}

export function snapToGrid(p: Pt, step: number): Pt {
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** Keeps the segment horizontal or vertical, whichever is closer. */
export function ortho(from: Pt, to: Pt): Pt {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** Point at an exact length from `from`, in the direction of `toward`. */
export function atLength(from: Pt, toward: Pt, length: number): Pt {
  const d = dist(from, toward);
  if (d === 0) return { x: from.x + length, y: from.y };
  return { x: from.x + ((toward.x - from.x) / d) * length, y: from.y + ((toward.y - from.y) / d) * length };
}

/** Point at a length and an angle in degrees (counter-clockwise from +x), as typed in "250<30". */
export function polarPoint(from: Pt, length: number, degrees: number): Pt {
  const a = (degrees * Math.PI) / 180;
  return { x: from.x + length * Math.cos(a), y: from.y + length * Math.sin(a) };
}

export function inside(e: Entity, box: Box, blocks: Record<string, Block> = {}): boolean {
  const b = bounds(e, blocks);
  return b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
}

/** Bounded undo history of whole drawings (they are small: plain numbers). */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private readonly limit = 100) {}
  push(state: Drawing): void {
    this.past.push(JSON.stringify(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: Drawing): Drawing | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev);
  }
  redo(current: Drawing): Drawing | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next);
  }
}
