/** Plano's drawing model: plain data in millimetres, y axis up, angles in radians (CCW). */

export interface Pt { x: number; y: number }

interface Base { id: string; layer: string }
export type Entity =
  | (Base & { kind: "line"; a: Pt; b: Pt })
  | (Base & { kind: "polyline"; pts: Pt[]; closed: boolean })
  | (Base & { kind: "circle"; c: Pt; r: number })
  | (Base & { kind: "arc"; c: Pt; r: number; start: number; end: number })
  | (Base & { kind: "text"; p: Pt; text: string; h: number })
  | (Base & { kind: "dim"; a: Pt; b: Pt; offset: number });

export interface Layer { name: string; visible: boolean; locked: boolean }

export interface Drawing {
  v: 1;
  units: "mm";
  layers: Layer[];
  current: string;
  entities: Entity[];
}

export function emptyDrawing(): Drawing {
  return { v: 1, units: "mm", layers: [{ name: "0", visible: true, locked: false }], current: "0", entities: [] };
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Validates untrusted saved or imported data; unknown parts are dropped, never executed. */
export function parseDrawing(json: string): Drawing {
  const raw = JSON.parse(json) as Partial<Drawing>;
  const d = emptyDrawing();
  const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const pt = (p: unknown): p is Pt => !!p && num((p as Pt).x) && num((p as Pt).y);
  if (Array.isArray(raw.layers)) {
    const layers = raw.layers.filter((l) => l && typeof l.name === "string" && l.name.length <= 64)
      .map((l) => ({ name: l.name, visible: l.visible !== false, locked: l.locked === true }));
    if (layers.length) d.layers = layers;
  }
  const names = new Set(d.layers.map((l) => l.name));
  d.current = typeof raw.current === "string" && names.has(raw.current) ? raw.current : d.layers[0].name;
  for (const e of Array.isArray(raw.entities) ? raw.entities : []) {
    if (!e || !names.has(e.layer) || typeof e.id !== "string") continue;
    const ok =
      (e.kind === "line" && pt(e.a) && pt(e.b)) ||
      (e.kind === "polyline" && Array.isArray(e.pts) && e.pts.length >= 2 && e.pts.every(pt)) ||
      (e.kind === "circle" && pt(e.c) && num(e.r) && e.r > 0) ||
      (e.kind === "arc" && pt(e.c) && num(e.r) && e.r > 0 && num(e.start) && num(e.end)) ||
      (e.kind === "text" && pt(e.p) && typeof e.text === "string" && num(e.h) && e.h > 0) ||
      (e.kind === "dim" && pt(e.a) && pt(e.b) && num(e.offset));
    if (ok) d.entities.push(e);
  }
  return d;
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export function bounds(e: Entity): Box {
  const ofPts = (pts: Pt[]): Box => ({
    minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)),
  });
  switch (e.kind) {
    case "line": return ofPts([e.a, e.b]);
    case "polyline": return ofPts(e.pts);
    case "circle":
    case "arc": return { minX: e.c.x - e.r, minY: e.c.y - e.r, maxX: e.c.x + e.r, maxY: e.c.y + e.r };
    case "text": return { minX: e.p.x, minY: e.p.y, maxX: e.p.x + e.text.length * e.h * 0.6, maxY: e.p.y + e.h };
    case "dim": return ofPts(dimensionGeometry(e).points);
  }
}

export function drawingBounds(entities: Entity[]): Box | null {
  if (!entities.length) return null;
  return entities.map(bounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function angleIn(angle: number, start: number, end: number): boolean {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a = norm(angle - start);
  const span = norm(end - start) || 2 * Math.PI;
  return a <= span;
}

/** Distance from a point to the entity's outline, in mm. */
export function distanceTo(e: Entity, p: Pt): number {
  switch (e.kind) {
    case "line": return distToSegment(p, e.a, e.b);
    case "polyline": {
      let best = Infinity;
      const n = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < n; i++) best = Math.min(best, distToSegment(p, e.pts[i], e.pts[(i + 1) % e.pts.length]));
      return best;
    }
    case "circle": return Math.abs(dist(p, e.c) - e.r);
    case "arc": {
      const ang = Math.atan2(p.y - e.c.y, p.x - e.c.x);
      if (angleIn(ang, e.start, e.end)) return Math.abs(dist(p, e.c) - e.r);
      const ends = arcEnds(e);
      return Math.min(dist(p, ends[0]), dist(p, ends[1]));
    }
    case "text": {
      const b = bounds(e);
      const inside = p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
      return inside ? 0 : Math.min(...[[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]
        .map(([x, y], i, all) => distToSegment(p, { x, y }, { x: all[(i + 1) % 4][0], y: all[(i + 1) % 4][1] })));
    }
    case "dim": {
      const g = dimensionGeometry(e);
      return Math.min(...g.segments.map(([a, b]) => distToSegment(p, a, b)));
    }
  }
}

export function arcEnds(e: Extract<Entity, { kind: "arc" }>): [Pt, Pt] {
  return [
    { x: e.c.x + e.r * Math.cos(e.start), y: e.c.y + e.r * Math.sin(e.start) },
    { x: e.c.x + e.r * Math.cos(e.end), y: e.c.y + e.r * Math.sin(e.end) },
  ];
}

/** Aligned dimension: extension lines, dimension line with ticks, and the measured value. */
export function dimensionGeometry(e: Extract<Entity, { kind: "dim" }>) {
  const len = dist(e.a, e.b) || 1;
  const nx = -(e.b.y - e.a.y) / len;
  const ny = (e.b.x - e.a.x) / len;
  const a2 = { x: e.a.x + nx * e.offset, y: e.a.y + ny * e.offset };
  const b2 = { x: e.b.x + nx * e.offset, y: e.b.y + ny * e.offset };
  const tick = Math.max(len * 0.02, 1);
  const ux = (e.b.x - e.a.x) / len;
  const uy = (e.b.y - e.a.y) / len;
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
    value: formatLength(dist(e.a, e.b)),
    textHeight: Math.max(tick * 2.5, 2.5),
  };
}

export function formatLength(mm: number): string {
  const rounded = Math.round(mm * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

export type SnapKind = "end" | "mid" | "center" | "grid";
export interface Snap { p: Pt; kind: SnapKind }

/** Characteristic points: ends, midpoints and centers. */
export function snapPoints(e: Entity): Snap[] {
  switch (e.kind) {
    case "line": return [{ p: e.a, kind: "end" }, { p: e.b, kind: "end" }, { p: mid(e.a, e.b), kind: "mid" }];
    case "polyline": {
      const out: Snap[] = e.pts.map((p) => ({ p, kind: "end" as const }));
      const n = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < n; i++) out.push({ p: mid(e.pts[i], e.pts[(i + 1) % e.pts.length]), kind: "mid" });
      return out;
    }
    case "circle": return [{ p: e.c, kind: "center" }, ...[0, 1, 2, 3].map((q) => ({
      p: { x: e.c.x + e.r * Math.cos((q * Math.PI) / 2), y: e.c.y + e.r * Math.sin((q * Math.PI) / 2) }, kind: "end" as const }))];
    case "arc": return [{ p: e.c, kind: "center" }, ...arcEnds(e).map((p) => ({ p, kind: "end" as const }))];
    case "text": return [{ p: e.p, kind: "end" }];
    case "dim": return [{ p: e.a, kind: "end" }, { p: e.b, kind: "end" }];
  }
}

export function nearestSnap(entities: Entity[], p: Pt, tolerance: number): Snap | null {
  let best: Snap | null = null;
  let bestDist = tolerance;
  for (const e of entities) {
    for (const s of snapPoints(e)) {
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

export function translate(e: Entity, dx: number, dy: number): Entity {
  const t = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  switch (e.kind) {
    case "line": return { ...e, a: t(e.a), b: t(e.b) };
    case "polyline": return { ...e, pts: e.pts.map(t) };
    case "circle":
    case "arc": return { ...e, c: t(e.c) };
    case "text": return { ...e, p: t(e.p) };
    case "dim": return { ...e, a: t(e.a), b: t(e.b) };
  }
}

export function inside(e: Entity, box: Box): boolean {
  const b = bounds(e);
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
