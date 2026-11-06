/**
 * Where a DWG drawing actually is. Construction lines (XLINE, RAY) are infinite and the file's own
 * extents often include them, so the drawing would open as a dot in a huge empty sheet. The view
 * is framed from the finite geometry instead.
 */

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

type Point = { x: number; y: number };
type AnyEntity = { type?: string; [key: string]: unknown };

const POINT_KEYS = ["startPoint", "endPoint", "insertionPoint", "position", "definitionPoint", "textPoint", "corner1", "corner2", "corner3", "corner4"];
const LIST_KEYS = ["vertices", "controlPoints", "fitPoints"];
const INFINITE = new Set(["XLINE", "RAY"]);

function isPoint(v: unknown): v is Point {
  return !!v && typeof (v as Point).x === "number" && typeof (v as Point).y === "number"
    && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);
}

export function entityBounds(entities: AnyEntity[]): Bounds | null {
  let b: Bounds | null = null;
  const add = (x: number, y: number) => {
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
    }
  };
  for (const e of entities) {
    if (INFINITE.has(String(e.type))) continue;
    for (const key of POINT_KEYS) if (isPoint(e[key])) add((e[key] as Point).x, (e[key] as Point).y);
    for (const key of LIST_KEYS) {
      const list = e[key];
      if (Array.isArray(list)) for (const p of list) if (isPoint(p)) add(p.x, p.y);
    }
    if (isPoint(e.center)) {
      const c = e.center;
      const r = typeof e.radius === "number" ? e.radius
        : isPoint(e.majorAxisEndPoint) ? Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y) : 0;
      add(c.x - r, c.y - r);
      add(c.x + r, c.y + r);
    }
  }
  return b;
}

/**
 * Replaces the root viewBox of the SVG that LibreDWG produces. Its content is drawn with a
 * vertical flip (CAD's Y grows upward), so the visible Y range is [-maxY, -minY].
 */
export function frameSvg(svg: string, b: Bounds | null, margin = 0.05): string {
  if (!b) return svg;
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const mx = w * margin;
  const my = h * margin;
  const box = `${b.minX - mx} ${-b.maxY - my} ${w + 2 * mx} ${h + 2 * my}`;
  // A pixel size gives the image an intrinsic size, so it can be zoomed by changing its width.
  const width = 2000;
  const height = Math.max(1, Math.round((width * (h + 2 * my)) / (w + 2 * mx)));
  return svg.replace(/<svg\b[^>]*>/, (root) => root
    .replace(/\bviewBox="[^"]*"/, `viewBox="${box}"`)
    .replace(/\bwidth="[^"]*"/, `width="${width}"`)
    .replace(/\bheight="[^"]*"/, `height="${height}"`));
}
