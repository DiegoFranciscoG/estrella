/**
 * Trazo's drawing: plain data, no DOM. Every shape keeps its own geometry plus a placement
 * (translate and scale), so moving or resizing never rewrites points and the SVG export stays exact.
 */

export type Kind = "rect" | "ellipse" | "line" | "poly" | "text" | "path";

export interface Style {
  /** null: no fill. */
  fill: string | null;
  /** null: no outline. */
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

export interface Placement {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

interface Base extends Style, Placement {
  id: string;
  kind: Kind;
  name: string;
  hidden: boolean;
}

export interface Rect extends Base { kind: "rect"; x: number; y: number; w: number; h: number; r: number }
export interface Ellipse extends Base { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
export interface Line extends Base { kind: "line"; x1: number; y1: number; x2: number; y2: number }
export interface Poly extends Base { kind: "poly"; points: [number, number][]; closed: boolean }
export interface Text extends Base { kind: "text"; x: number; y: number; text: string; size: number; bold: boolean }
/** An imported SVG path, kept as its validated "d". */
export interface Path extends Base { kind: "path"; d: string }

export type Shape = Rect | Ellipse | Line | Poly | Text | Path;

export interface Drawing {
  v: 1;
  width: number;
  height: number;
  /** null: transparent. */
  background: string | null;
  shapes: Shape[];
}

export interface Box { x: number; y: number; w: number; h: number }

export const MAX_SHAPES = 5000;
export const MAX_SIDE = 20000;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Path commands, numbers and separators only: nothing else can reach an exported "d". */
export const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/;
const NAMES: Record<Kind, string> = {
  rect: "Rectángulo", ellipse: "Elipse", line: "Línea", poly: "Trazo", text: "Texto", path: "Forma",
};

export function newDrawing(width = 1024, height = 768): Drawing {
  return { v: 1, width, height, background: "#ffffff", shapes: [] };
}

export function defaultStyle(): Style {
  return { fill: "#d9d9d9", stroke: "#111111", strokeWidth: 2, opacity: 1 };
}

/** #rgb or #rrggbb, lower-case; anything else is not a color here. */
export function color(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !HEX.test(value)) return undefined;
  const v = value.toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

const finite = (n: unknown, min = -MAX_SIDE * 10, max = MAX_SIDE * 10): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

export function nextId(d: Drawing): string {
  let n = d.shapes.length + 1;
  const used = new Set(d.shapes.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

function nextName(d: Drawing, kind: Kind): string {
  const base = NAMES[kind];
  let n = d.shapes.filter((s) => s.kind === kind).length + 1;
  const used = new Set(d.shapes.map((s) => s.name));
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

type Geometry =
  | Omit<Rect, keyof Base> & { kind: "rect" }
  | Omit<Ellipse, keyof Base> & { kind: "ellipse" }
  | Omit<Line, keyof Base> & { kind: "line" }
  | Omit<Poly, keyof Base> & { kind: "poly" }
  | Omit<Text, keyof Base> & { kind: "text" }
  | Omit<Path, keyof Base> & { kind: "path" };

/** Adds a shape on top of the others and returns it. */
export function add(d: Drawing, geometry: Geometry, style: Style): Shape {
  if (d.shapes.length >= MAX_SHAPES) throw new Error(`Un dibujo admite hasta ${MAX_SHAPES} formas`);
  const shape = {
    ...geometry, ...style, id: nextId(d), name: nextName(d, geometry.kind), hidden: false, tx: 0, ty: 0, sx: 1, sy: 1,
  } as Shape;
  d.shapes.push(shape);
  return shape;
}

export function find(d: Drawing, ids: Iterable<string>): Shape[] {
  const set = new Set(ids);
  return d.shapes.filter((s) => set.has(s.id));
}

export function remove(d: Drawing, ids: Iterable<string>): void {
  const set = new Set(ids);
  d.shapes = d.shapes.filter((s) => !set.has(s.id));
}

export function move(d: Drawing, ids: Iterable<string>, dx: number, dy: number): void {
  for (const s of find(d, ids)) {
    s.tx += dx;
    s.ty += dy;
  }
}

export function restyle(d: Drawing, ids: Iterable<string>, style: Partial<Style>): void {
  for (const s of find(d, ids)) Object.assign(s, style);
}

/** Copies placed 16 px down and right, on top; returns the new ids. */
export function duplicate(d: Drawing, ids: Iterable<string>): string[] {
  const copies: string[] = [];
  for (const s of find(d, ids)) {
    const copy = JSON.parse(JSON.stringify(s)) as Shape;
    copy.id = nextId(d);
    copy.name = nextName(d, copy.kind);
    copy.tx += 16;
    copy.ty += 16;
    d.shapes.push(copy);
    copies.push(copy.id);
  }
  return copies;
}

export type Order = "front" | "back" | "up" | "down";

/** Stacking order: later shapes are drawn on top. */
export function reorder(d: Drawing, ids: Iterable<string>, order: Order): void {
  const set = new Set(ids);
  const picked = d.shapes.filter((s) => set.has(s.id));
  const rest = d.shapes.filter((s) => !set.has(s.id));
  if (order === "front") d.shapes = [...rest, ...picked];
  else if (order === "back") d.shapes = [...picked, ...rest];
  else {
    const list = d.shapes.slice();
    const indexes = list.map((s, i) => (set.has(s.id) ? i : -1)).filter((i) => i >= 0);
    const step = order === "up" ? 1 : -1;
    for (const i of order === "up" ? indexes.reverse() : indexes) {
      const j = i + step;
      if (j < 0 || j >= list.length || set.has(list[j].id)) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
    d.shapes = list;
  }
}

/** The shape's own box before placement; null for imported paths (the DOM measures those). */
export function localBox(s: Shape): Box | null {
  switch (s.kind) {
    case "rect": return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "ellipse": return { x: s.cx - s.rx, y: s.cy - s.ry, w: 2 * s.rx, h: 2 * s.ry };
    case "line": return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    case "poly": {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case "text": return { x: s.x, y: s.y - s.size, w: s.text.length * s.size * 0.56, h: s.size * 1.25 };
    case "path": return null;
  }
}

/** A box in drawing coordinates after the shape's placement. */
export function placed(s: Placement, b: Box): Box {
  const x1 = s.tx + b.x * s.sx;
  const x2 = s.tx + (b.x + b.w) * s.sx;
  const y1 = s.ty + b.y * s.sy;
  const y2 = s.ty + (b.y + b.h) * s.sy;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/**
 * Resizes a shape so its placed box becomes `to`, keeping the corner opposite to the one dragged.
 * Uses the placement, so strokes keep their width (non-scaling-stroke) and geometry is untouched.
 */
export function fitTo(s: Placement, local: Box, to: Box): void {
  if (local.w > 0) {
    s.sx = Math.max(1e-3, to.w / local.w) * Math.sign(s.sx || 1);
    s.tx = to.x - local.x * s.sx;
  }
  if (local.h > 0) {
    s.sy = Math.max(1e-3, to.h / local.h) * Math.sign(s.sy || 1);
    s.ty = to.y - local.y * s.sy;
  }
}

/** Ramer–Douglas–Peucker: keeps a freehand stroke's shape with far fewer points. */
export function simplify(points: [number, number][], tolerance = 1): [number, number][] {
  if (points.length < 3) return points.slice();
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (dist > worst) {
      worst = dist;
      at = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, at + 1), tolerance);
  const right = simplify(points.slice(at), tolerance);
  return [...left.slice(0, -1), ...right];
}

function checkStyle(s: Record<string, unknown>, where: string): void {
  if (color(s.fill) === undefined || color(s.stroke) === undefined) throw new Error(`${where}: color`);
  if (!finite(s.strokeWidth, 0, 500) || !finite(s.opacity, 0, 1)) throw new Error(`${where}: estilo`);
  for (const k of ["tx", "ty", "sx", "sy"]) if (!finite(s[k])) throw new Error(`${where}: posición`);
  if (typeof s.id !== "string" || !/^s\d{1,6}$/.test(s.id)) throw new Error(`${where}: id`);
  if (typeof s.name !== "string" || s.name.length > 80 || typeof s.hidden !== "boolean") throw new Error(`${where}: nombre`);
}

/** Reads a saved drawing, refusing anything malformed instead of drawing it half. */
export function parseDrawing(json: string): Drawing {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (raw?.v !== 1 || !finite(raw.width, 1, MAX_SIDE) || !finite(raw.height, 1, MAX_SIDE)) throw new Error("dibujo");
  if (color(raw.background) === undefined || !Array.isArray(raw.shapes) || raw.shapes.length > MAX_SHAPES) throw new Error("dibujo");
  const ids = new Set<string>();
  for (const [i, value] of (raw.shapes as Record<string, unknown>[]).entries()) {
    const s = value as Record<string, unknown>;
    const where = `forma ${i + 1}`;
    checkStyle(s, where);
    if (ids.has(s.id as string)) throw new Error(`${where}: id repetido`);
    ids.add(s.id as string);
    switch (s.kind) {
      case "rect":
        if (![s.x, s.y].every((n) => finite(n)) || ![s.w, s.h, s.r].every((n) => finite(n, 0))) throw new Error(where);
        break;
      case "ellipse":
        if (![s.cx, s.cy].every((n) => finite(n)) || ![s.rx, s.ry].every((n) => finite(n, 0))) throw new Error(where);
        break;
      case "line":
        if (![s.x1, s.y1, s.x2, s.y2].every((n) => finite(n))) throw new Error(where);
        break;
      case "poly":
        if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > 20000 || typeof s.closed !== "boolean"
          || !(s.points as unknown[]).every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) throw new Error(where);
        break;
      case "text":
        if (![s.x, s.y].every((n) => finite(n)) || !finite(s.size, 1, 2000) || typeof s.bold !== "boolean"
          || typeof s.text !== "string" || s.text.length > 2000) throw new Error(where);
        break;
      case "path":
        if (typeof s.d !== "string" || s.d.length > 200000 || !PATH_DATA.test(s.d)) throw new Error(where);
        break;
      default:
        throw new Error(`${where}: tipo`);
    }
  }
  return raw as unknown as Drawing;
}
