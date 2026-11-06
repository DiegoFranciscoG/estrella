import { arcPoint, Drawing, drawingBounds, normAngle, primitives, Prim, Pt, TAU } from "./model";

/** SVG export in millimetres, black on white, visible layers only, one group per layer. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n = (v: number) => String(Math.round(v * 1000) / 1000);

function shape(q: Prim, flip: (p: Pt) => Pt): string {
  switch (q.t) {
    case "seg": {
      const a = flip(q.a), b = flip(q.b);
      return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"/>`;
    }
    case "arc": {
      const span = normAngle(q.end - q.start) || TAU;
      if (span >= TAU - 1e-9) {
        const c = flip(q.c);
        return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(q.r)}"/>`;
      }
      const a = flip(arcPoint(q, q.start)), b = flip(arcPoint(q, q.end));
      // The y flip turns counter-clockwise into clockwise: sweep flag 0.
      return `<path d="M${n(a.x)},${n(a.y)} A${n(q.r)},${n(q.r)} 0 ${span > Math.PI ? 1 : 0} 0 ${n(b.x)},${n(b.y)}"/>`;
    }
    case "text": {
      const p = flip(q.p);
      const deg = (-q.rot * 180) / Math.PI;
      const rotate = Math.abs(deg) > 1e-9 ? ` transform="rotate(${n(deg)} ${n(p.x)} ${n(p.y)})"` : "";
      return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(q.h)}"${q.center ? ' text-anchor="middle"' : ""}${rotate} stroke="none" fill="#000">${esc(q.value)}</text>`;
    }
    case "fill":
      return `<polygon points="${q.pts.map(flip).map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" fill="#000" stroke="none"/>`;
  }
}

export function toSvg(d: Drawing): string {
  const blocks = d.blocks ?? {};
  const visible = new Set(d.layers.filter((l) => l.visible).map((l) => l.name));
  const entities = d.entities.filter((e) => visible.has(e.layer));
  const b = drawingBounds(entities, blocks) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const margin = Math.max((b.maxX - b.minX) * 0.05, (b.maxY - b.minY) * 0.05, 5);
  const width = b.maxX - b.minX + margin * 2;
  const height = b.maxY - b.minY + margin * 2;
  // SVG has y down; flip so the drawing keeps its orientation without mirroring the text.
  const flip = (p: Pt): Pt => ({ x: p.x - b.minX + margin, y: b.maxY - p.y + margin });
  const groups = d.layers.filter((l) => l.visible).map((l) => {
    const body = entities.filter((e) => e.layer === l.name).flatMap((e) => primitives(e, blocks)).map((q) => shape(q, flip)).join("");
    return body ? `<g id="${esc(l.name)}">${body}</g>` : "";
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}" fill="none" stroke="#000" stroke-width="${n(Math.max(width, height) / 1000)}" font-family="sans-serif">${groups}</svg>
`;
}
