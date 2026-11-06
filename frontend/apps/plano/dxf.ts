import DxfParser from "dxf-parser";
import { Block, dimensionGeometry, Drawing, emptyDrawing, Entity, Layer, newId, primitives, Pt } from "./model";

/**
 * DXF is documented by its publisher and is the exchange format every CAD program reads.
 * Export uses the oldest widely supported variant (R12, AC1009) so any program can open it.
 * Blocks travel as real blocks; dimensions and hatches as lines and text, which every reader
 * understands (R12 has no hatch entity).
 */

const n = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
const deg = (rad: number) => n((((rad * 180) / Math.PI) % 360 + 360) % 360);

/** DXF text is ASCII-safe only with escapes; non-ASCII becomes \U+XXXX as CAD programs expect. */
function dxfText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7E]/g, (ch) => `\\U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
}

function layerName(name: string): string {
  return name.replace(/[<>/\\":;?*|=`]/g, "_").slice(0, 64) || "0";
}

export function toDxf(d: Drawing): string {
  const out: string[] = [];
  const blocks = d.blocks ?? {};
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const line = (layer: string, a: Pt, b: Pt) => {
    g(0, "LINE"); g(8, layer); g(10, n(a.x)); g(20, n(a.y)); g(30, 0); g(11, n(b.x)); g(21, n(b.y)); g(31, 0);
  };
  const text = (layer: string, p: Pt, h: number, value: string, rotation = 0, center = false) => {
    g(0, "TEXT"); g(8, layer); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(h)); g(1, dxfText(value));
    if (rotation) g(50, deg(rotation));
    if (center) { g(72, 1); g(11, n(p.x)); g(21, n(p.y)); g(31, 0); }
  };
  const entity = (e: Entity, layer: string) => {
    switch (e.kind) {
      case "line": line(layer, e.a, e.b); break;
      case "polyline":
        g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
        for (const p of e.pts) { g(0, "VERTEX"); g(8, layer); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); }
        g(0, "SEQEND"); g(8, layer);
        break;
      case "circle": g(0, "CIRCLE"); g(8, layer); g(10, n(e.c.x)); g(20, n(e.c.y)); g(30, 0); g(40, n(e.r)); break;
      case "arc":
        g(0, "ARC"); g(8, layer); g(10, n(e.c.x)); g(20, n(e.c.y)); g(30, 0); g(40, n(e.r)); g(50, deg(e.start)); g(51, deg(e.end));
        break;
      case "text": text(layer, e.p, e.h, e.text, e.rot ?? 0); break;
      case "dim": {
        const geo = dimensionGeometry(e);
        geo.segments.forEach(([a, b]) => line(layer, a, b));
        text(layer, geo.textAt, geo.textHeight, geo.value, geo.angle, true);
        break;
      }
      case "hatch":
        if (e.pattern === "solido") {
          // A solid fill keeps its outline so the area is not lost; R12 cannot store the fill.
          entity({ ...e, kind: "polyline", pts: e.pts, closed: true } as Entity, layer);
        } else {
          for (const q of primitives(e)) if (q.t === "seg") line(layer, q.a, q.b);
        }
        break;
      case "insert":
        if (!blocks[e.name]) break;
        g(0, "INSERT"); g(8, layer); g(2, blockName(e.name)); g(10, n(e.p.x)); g(20, n(e.p.y)); g(30, 0);
        g(41, n(e.flip ? -e.s : e.s)); g(42, n(e.s)); g(43, 1); g(50, deg(e.rot));
        break;
    }
  };

  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LAYER"); g(70, d.layers.length);
  for (const l of d.layers) {
    g(0, "LAYER"); g(2, layerName(l.name)); g(70, l.locked ? 4 : 0); g(62, l.visible ? 7 : -7); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "BLOCKS");
  for (const [name, b] of Object.entries(blocks)) {
    g(0, "BLOCK"); g(8, "0"); g(2, blockName(name)); g(70, 0); g(10, n(b.base.x)); g(20, n(b.base.y)); g(30, 0); g(3, blockName(name));
    for (const e of b.entities) entity(e, layerName(e.layer));
    g(0, "ENDBLK"); g(8, "0");
  }
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  for (const e of d.entities) entity(e, layerName(e.layer));
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

/** Block names in DXF are ASCII; others are escaped the same way as text. */
function blockName(name: string): string {
  return dxfText(layerName(name));
}

export interface ImportResult {
  drawing: Drawing;
  imported: number;
  skipped: Record<string, number>;
}

interface RawEntity {
  type: string;
  layer?: string;
  vertices?: { x: number; y: number; bulge?: number }[];
  shape?: boolean;
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  startPoint?: { x: number; y: number };
  position?: { x: number; y: number };
  text?: string;
  textHeight?: number;
  height?: number;
  rotation?: number;
  name?: string;
  xScale?: number;
  yScale?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads the common 2D entities and blocks; anything else is counted and reported, never silently lost. */
export function fromDxf(content: string): ImportResult {
  const parsed = new DxfParser().parseSync(content) as unknown as {
    entities?: RawEntity[];
    blocks?: Record<string, { name: string; position?: { x: number; y: number }; entities?: RawEntity[] }>;
    tables?: { layer?: { layers?: Record<string, { name: string; visible?: boolean; frozen?: boolean }> } };
  } | null;
  if (!parsed) throw new Error("El archivo no es un DXF válido.");
  const d = emptyDrawing();
  const layers = new Map<string, Layer>([["0", d.layers[0]]]);
  for (const l of Object.values(parsed.tables?.layer?.layers ?? {})) {
    if (l?.name) layers.set(l.name, { name: l.name.slice(0, 64), visible: l.visible !== false && !l.frozen, locked: false });
  }
  const skipped: Record<string, number> = {};
  const ensure = (name?: string) => {
    const key = (name ?? "0").slice(0, 64) || "0";
    if (!layers.has(key)) layers.set(key, { name: key, visible: true, locked: false });
    return key;
  };
  const clean = (t?: string) => (t ?? "").replace(/\\P/g, "\n").replace(/\{\\[^;]*;|[{}]/g, "").replace(/\\[A-Za-z][^;]*;/g, "").slice(0, 500);
  // Model and paper space, and anonymous blocks (dimensions, hatches), are not reusable blocks.
  const usable = new Set(Object.keys(parsed.blocks ?? {}).filter((name) => name && !name.startsWith("*") && name.length <= 64));

  const convert = (e: RawEntity): Entity | null => {
    const layer = ensure(e.layer);
    const id = newId();
    const v = e.vertices ?? [];
    switch (e.type) {
      case "LINE":
        return v.length >= 2 ? { id, layer, kind: "line", a: { x: v[0].x, y: v[0].y }, b: { x: v[1].x, y: v[1].y } } : null;
      case "LWPOLYLINE":
      case "POLYLINE":
        if (v.some((p) => p.bulge)) skipped["curvas dentro de polilíneas (se dibujan rectas)"] = (skipped["curvas dentro de polilíneas (se dibujan rectas)"] ?? 0) + 1;
        return v.length >= 2 ? { id, layer, kind: "polyline", pts: v.map((p) => ({ x: p.x, y: p.y })), closed: e.shape === true } : null;
      case "CIRCLE":
        return e.center && e.radius ? { id, layer, kind: "circle", c: { x: e.center.x, y: e.center.y }, r: e.radius } : null;
      case "ARC":
        return e.center && e.radius && finite(e.startAngle) && finite(e.endAngle)
          ? { id, layer, kind: "arc", c: { x: e.center.x, y: e.center.y }, r: e.radius, start: e.startAngle, end: e.endAngle } : null;
      case "TEXT":
        return e.startPoint && e.text ? {
          id, layer, kind: "text", p: { x: e.startPoint.x, y: e.startPoint.y }, text: clean(e.text), h: e.textHeight || 2.5,
          rot: finite(e.rotation) ? (e.rotation * Math.PI) / 180 : 0,
        } : null;
      case "MTEXT":
        return e.position && e.text ? { id, layer, kind: "text", p: { x: e.position.x, y: e.position.y }, text: clean(e.text), h: e.height || 2.5 } : null;
      case "INSERT": {
        if (!e.name || !usable.has(e.name) || !e.position) return null;
        const sx = finite(e.xScale) && e.xScale !== 0 ? e.xScale : 1;
        return {
          id, layer, kind: "insert", name: e.name, p: { x: e.position.x, y: e.position.y },
          rot: finite(e.rotation) ? (e.rotation * Math.PI) / 180 : 0, s: Math.abs(sx), flip: sx < 0,
        };
      }
      default:
        return null;
    }
  };

  const take = (list: RawEntity[] | undefined, into: Entity[]) => {
    for (const raw of list ?? []) {
      const e = convert(raw);
      if (e) into.push(e);
      else skipped[raw.type] = (skipped[raw.type] ?? 0) + 1;
    }
  };

  for (const name of usable) {
    const b = parsed.blocks![name];
    const block: Block = { base: { x: b.position?.x ?? 0, y: b.position?.y ?? 0 }, entities: [] };
    take(b.entities, block.entities);
    d.blocks![name] = block;
  }
  take(parsed.entities, d.entities);
  d.layers = [...layers.values()];
  return { drawing: d, imported: d.entities.length, skipped };
}
