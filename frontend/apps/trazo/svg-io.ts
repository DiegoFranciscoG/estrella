/**
 * SVG in and out. Export writes clean SVG from the drawing's data. Import reads only a list of
 * plain drawing elements and attributes, checking every color, number and path: scripts, links,
 * images, embedded HTML and event attributes never get through.
 */
import { color, MAX_SHAPES, PATH_DATA, type Drawing, type Placement, type Shape, type Style } from "./model";

export interface Described {
  tag: "rect" | "ellipse" | "line" | "polyline" | "polygon" | "text" | "path";
  attrs: Record<string, string>;
  text?: string;
}

/** Up to three decimals, without trailing zeros. */
export function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function styleAttrs(s: Style, scaled: boolean): Record<string, string> {
  const a: Record<string, string> = {
    fill: s.fill ?? "none",
    stroke: s.stroke ?? "none",
    "stroke-width": num(s.strokeWidth),
  };
  if (s.opacity < 1) a.opacity = num(s.opacity);
  if (scaled) a["vector-effect"] = "non-scaling-stroke";
  return a;
}

export function placementAttr(p: Placement): string | null {
  const parts: string[] = [];
  if (p.tx !== 0 || p.ty !== 0) parts.push(`translate(${num(p.tx)} ${num(p.ty)})`);
  if (p.sx !== 1 || p.sy !== 1) parts.push(`scale(${num(p.sx)} ${num(p.sy)})`);
  return parts.length ? parts.join(" ") : null;
}

/** Tag, attributes and text of one shape, shared by the screen and the export. */
export function describe(s: Shape): Described {
  const scaled = s.sx !== 1 || s.sy !== 1;
  const style = styleAttrs(s, scaled);
  switch (s.kind) {
    case "rect":
      return { tag: "rect", attrs: { x: num(s.x), y: num(s.y), width: num(s.w), height: num(s.h), ...(s.r ? { rx: num(s.r) } : {}), ...style } };
    case "ellipse":
      return { tag: "ellipse", attrs: { cx: num(s.cx), cy: num(s.cy), rx: num(s.rx), ry: num(s.ry), ...style } };
    case "line":
      return { tag: "line", attrs: { x1: num(s.x1), y1: num(s.y1), x2: num(s.x2), y2: num(s.y2), ...style } };
    case "poly":
      return {
        tag: s.closed ? "polygon" : "polyline",
        attrs: { points: s.points.map(([x, y]) => `${num(x)},${num(y)}`).join(" "), "stroke-linejoin": "round", "stroke-linecap": "round", ...style },
      };
    case "text":
      return {
        tag: "text",
        attrs: { x: num(s.x), y: num(s.y), "font-size": num(s.size), "font-family": "system-ui, Arial, sans-serif", ...(s.bold ? { "font-weight": "700" } : {}), ...style },
        text: s.text,
      };
    case "path":
      return { tag: "path", attrs: { d: s.d, ...style } };
  }
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** The visible drawing as a standalone SVG file. */
export function toSvg(d: Drawing): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(d.width)}" height="${num(d.height)}" viewBox="0 0 ${num(d.width)} ${num(d.height)}">`,
  ];
  if (d.background) lines.push(`  <rect width="${num(d.width)}" height="${num(d.height)}" fill="${d.background}"/>`);
  for (const s of d.shapes) {
    if (s.hidden) continue;
    const { tag, attrs, text } = describe(s);
    const attr = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join("");
    const element = text === undefined ? `<${tag}${attr}/>` : `<${tag}${attr}>${escapeXml(text)}</${tag}>`;
    const transform = placementAttr(s);
    lines.push(transform ? `  <g transform="${transform}">${element}</g>` : `  ${element}`);
  }
  lines.push("</svg>");
  return lines.join("\n") + "\n";
}

// ----------------------------------------------------------------------------------- import

export interface ImportedShape {
  geometry: Record<string, unknown> & { kind: Shape["kind"] };
  style: Style;
  placement: Placement;
}

export interface Imported {
  shapes: ImportedShape[];
  width: number | null;
  height: number | null;
  /** Elements that were left out (images, embedded content, rotations not supported…). */
  skipped: number;
  /** Colors that could not be read (gradients, patterns) and became gray. */
  approximated: number;
}

export const MAX_SVG_BYTES = 5 * 1024 * 1024;
const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080",
  teal: "#008080", maroon: "#800000", lime: "#00ff00", aqua: "#00ffff", fuchsia: "#ff00ff", olive: "#808000",
};
const IGNORED = new Set(["title", "desc", "metadata", "defs", "style", "lineargradient", "radialgradient", "clippath", "mask", "filter", "pattern", "marker", "symbol"]);
const IDENTITY: Placement = { tx: 0, ty: 0, sx: 1, sy: 1 };

/** a(b(point)). */
function compose(a: Placement, b: Placement): Placement {
  return { sx: a.sx * b.sx, sy: a.sy * b.sy, tx: a.sx * b.tx + a.tx, ty: a.sy * b.ty + a.ty };
}

/** translate, scale and rotation-free matrix; null for anything else (rotate, skew). */
export function parseTransform(value: string | null): Placement | null {
  if (!value || !value.trim()) return IDENTITY;
  let result = IDENTITY;
  const re = /\s*(translate|scale|matrix|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    consumed = re.lastIndex;
    const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.some((x) => !Number.isFinite(x))) return null;
    let t: Placement;
    if (m[1] === "translate" && n.length >= 1) t = { tx: n[0], ty: n[1] ?? 0, sx: 1, sy: 1 };
    else if (m[1] === "scale" && n.length >= 1) t = { tx: 0, ty: 0, sx: n[0], sy: n[1] ?? n[0] };
    else if (m[1] === "matrix" && n.length === 6 && n[1] === 0 && n[2] === 0) t = { sx: n[0], sy: n[3], tx: n[4], ty: n[5] };
    else if (m[1] === "rotate" && n[0] === 0) t = IDENTITY;
    else return null;
    result = compose(result, t);
  }
  return consumed === value.length || value.slice(consumed).trim() === "" ? result : null;
}

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["fill", "stroke", "stroke-width", "opacity", "font-size", "font-weight"]) {
    const v = el.getAttribute(k);
    if (v !== null) out[k] = v.trim();
  }
  for (const decl of (el.getAttribute("style") ?? "").split(";")) {
    const [k, ...rest] = decl.split(":");
    const key = k?.trim().toLowerCase();
    if (key && rest.length && ["fill", "stroke", "stroke-width", "opacity", "font-size", "font-weight"].includes(key)) out[key] = rest.join(":").trim();
  }
  return out;
}

const number = (v: string | null | undefined, fallback = 0): number => {
  if (v === null || v === undefined || v.trim() === "") return fallback;
  if (/%$/.test(v.trim())) return Number.NaN;
  return Number.parseFloat(v);
};

interface Inherited { fill: string | null; stroke: string | null; strokeWidth: number; opacity: number; fontSize: number; bold: boolean }

/** Reads an SVG file into Trazo shapes. Throws only when the file is not SVG at all. */
export function fromSvg(source: string): Imported {
  if (source.length > MAX_SVG_BYTES) throw new Error("El SVG pesa más de 5 MB.");
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || root.localName !== "svg") throw new Error("El archivo no es un SVG válido.");

  const result: Imported = { shapes: [], width: null, height: null, skipped: 0, approximated: 0 };
  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const hasViewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const width = number(root.getAttribute("width"), hasViewBox ? vb[2] : Number.NaN);
  const height = number(root.getAttribute("height"), hasViewBox ? vb[3] : Number.NaN);
  if (Number.isFinite(width) && width > 0) result.width = width;
  if (Number.isFinite(height) && height > 0) result.height = height;
  let rootPlacement = IDENTITY;
  if (hasViewBox) {
    const sx = result.width ? result.width / vb[2] : 1;
    const sy = result.height ? result.height / vb[3] : 1;
    rootPlacement = { sx, sy, tx: -vb[0] * sx, ty: -vb[1] * sy };
  }

  const paint = (value: string | undefined, inherited: string | null): string | null => {
    if (value === undefined || value === "inherit") return inherited;
    const v = value.toLowerCase();
    if (v === "none" || v === "transparent") return null;
    const hex = color(v);
    if (hex) return hex;
    if (NAMED[v]) return NAMED[v];
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v);
    if (rgb && rgb.slice(1).every((c) => Number(c) <= 255)) {
      return "#" + rgb.slice(1).map((c) => Number(c).toString(16).padStart(2, "0")).join("");
    }
    result.approximated++;
    return "#808080";
  };

  const walk = (el: Element, placement: Placement, inherited: Inherited): void => {
    for (const child of Array.from(el.children)) {
      if (result.shapes.length >= MAX_SHAPES) {
        result.skipped++;
        continue;
      }
      const tag = child.localName.toLowerCase();
      if (IGNORED.has(tag)) continue;
      const own = parseTransform(child.getAttribute("transform"));
      if (!own) {
        result.skipped++;
        continue;
      }
      const at = compose(placement, own);
      const st = styleOf(child);
      const style: Inherited = {
        fill: paint(st.fill, inherited.fill),
        stroke: paint(st.stroke, inherited.stroke),
        strokeWidth: Math.min(500, Math.max(0, number(st["stroke-width"], inherited.strokeWidth) || 0)),
        opacity: inherited.opacity * Math.min(1, Math.max(0, number(st.opacity, 1))),
        fontSize: number(st["font-size"], inherited.fontSize) || inherited.fontSize,
        bold: st["font-weight"] ? /bold|[6-9]00/.test(st["font-weight"]) : inherited.bold,
      };
      if (tag === "g" || tag === "svg" || tag === "a") {
        walk(child, at, style);
        continue;
      }
      const shape = readShape(child, tag, style);
      if (!shape) {
        result.skipped++;
        continue;
      }
      result.shapes.push({
        geometry: shape,
        style: { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: Math.round(style.opacity * 1000) / 1000 },
        placement: at,
      });
    }
  };

  walk(root, rootPlacement, {
    fill: "#000000", stroke: null, strokeWidth: 1, opacity: 1, fontSize: 16, bold: false,
  });
  return result;
}

function readShape(el: Element, tag: string, style: Inherited): ImportedShape["geometry"] | null {
  const n = (name: string, fallback = 0) => number(el.getAttribute(name), fallback);
  const ok = (...values: number[]) => values.every(Number.isFinite);
  switch (tag) {
    case "rect": {
      const g = { kind: "rect" as const, x: n("x"), y: n("y"), w: n("width"), h: n("height"), r: n("rx", n("ry")) };
      return ok(g.x, g.y, g.w, g.h, g.r) && g.w >= 0 && g.h >= 0 ? g : null;
    }
    case "circle": {
      const r = n("r");
      const g = { kind: "ellipse" as const, cx: n("cx"), cy: n("cy"), rx: r, ry: r };
      return ok(g.cx, g.cy, r) && r >= 0 ? g : null;
    }
    case "ellipse": {
      const g = { kind: "ellipse" as const, cx: n("cx"), cy: n("cy"), rx: n("rx"), ry: n("ry") };
      return ok(g.cx, g.cy, g.rx, g.ry) && g.rx >= 0 && g.ry >= 0 ? g : null;
    }
    case "line": {
      const g = { kind: "line" as const, x1: n("x1"), y1: n("y1"), x2: n("x2"), y2: n("y2") };
      return ok(g.x1, g.y1, g.x2, g.y2) ? g : null;
    }
    case "polyline":
    case "polygon": {
      const values = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite) || values.length > 40000) return null;
      const points: [number, number][] = [];
      for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
      return { kind: "poly", points, closed: tag === "polygon" };
    }
    case "path": {
      const d = (el.getAttribute("d") ?? "").trim();
      return d && d.length <= 200000 && PATH_DATA.test(d) ? { kind: "path", d } : null;
    }
    case "text": {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
      const x = Number.parseFloat((el.getAttribute("x") ?? "0").split(/[\s,]+/)[0]);
      const y = Number.parseFloat((el.getAttribute("y") ?? "0").split(/[\s,]+/)[0]);
      return text && ok(x, y) ? { kind: "text", x, y, text, size: Math.min(2000, Math.max(1, style.fontSize)), bold: style.bold } : null;
    }
    default:
      return null;
  }
}
