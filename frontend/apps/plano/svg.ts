import { arcEnds, dimensionGeometry, Drawing, drawingBounds, Entity, Pt } from "./model";

/** SVG export in millimetres, black on white, visible layers only, one group per layer. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n = (v: number) => String(Math.round(v * 1000) / 1000);

function shape(e: Entity, flip: (p: Pt) => Pt): string {
  const P = (p: Pt) => { const f = flip(p); return `${n(f.x)},${n(f.y)}`; };
  switch (e.kind) {
    case "line": return `<line x1="${n(flip(e.a).x)}" y1="${n(flip(e.a).y)}" x2="${n(flip(e.b).x)}" y2="${n(flip(e.b).y)}"/>`;
    case "polyline": return `<${e.closed ? "polygon" : "polyline"} points="${e.pts.map(P).join(" ")}"/>`;
    case "circle": return `<circle cx="${n(flip(e.c).x)}" cy="${n(flip(e.c).y)}" r="${n(e.r)}"/>`;
    case "arc": {
      const [a, b] = arcEnds(e).map(flip);
      const span = (((e.end - e.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return `<path d="M${n(a.x)},${n(a.y)} A${n(e.r)},${n(e.r)} 0 ${span > Math.PI ? 1 : 0} 0 ${n(b.x)},${n(b.y)}"/>`;
    }
    case "text": {
      const p = flip(e.p);
      return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(e.h)}" stroke="none" fill="#000">${esc(e.text)}</text>`;
    }
    case "dim": {
      const g = dimensionGeometry(e);
      const lines = g.segments.map(([a, b]) => `<line x1="${n(flip(a).x)}" y1="${n(flip(a).y)}" x2="${n(flip(b).x)}" y2="${n(flip(b).y)}"/>`).join("");
      const t = flip(g.textAt);
      let deg = (-g.angle * 180) / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;
      return `${lines}<text x="${n(t.x)}" y="${n(t.y)}" font-size="${n(g.textHeight)}" text-anchor="middle" transform="rotate(${n(deg)} ${n(t.x)} ${n(t.y)})" stroke="none" fill="#000">${esc(g.value)}</text>`;
    }
  }
}

export function toSvg(d: Drawing): string {
  const visible = new Set(d.layers.filter((l) => l.visible).map((l) => l.name));
  const entities = d.entities.filter((e) => visible.has(e.layer));
  const b = drawingBounds(entities) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const margin = Math.max((b.maxX - b.minX) * 0.05, (b.maxY - b.minY) * 0.05, 5);
  const width = b.maxX - b.minX + margin * 2;
  const height = b.maxY - b.minY + margin * 2;
  // SVG has y down; flip so the drawing keeps its orientation without mirroring the text.
  const flip = (p: Pt): Pt => ({ x: p.x - b.minX + margin, y: b.maxY - p.y + margin });
  const groups = d.layers.filter((l) => l.visible).map((l) => {
    const body = entities.filter((e) => e.layer === l.name).map((e) => shape(e, flip)).join("");
    return body ? `<g id="${esc(l.name)}">${body}</g>` : "";
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}" fill="none" stroke="#000" stroke-width="${n(Math.max(width, height) / 1000)}" font-family="sans-serif">${groups}</svg>
`;
}
