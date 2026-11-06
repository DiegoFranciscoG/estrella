import DxfParser from "dxf-parser";
import { dimensionGeometry, Drawing, emptyDrawing, Entity, Layer, newId } from "./model";

/**
 * DXF is documented by its publisher and is the exchange format every CAD program reads.
 * Export uses the oldest widely supported variant (R12, AC1009) so any program can open it.
 * Dimensions are exported as lines and text, which every reader understands.
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
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LAYER"); g(70, d.layers.length);
  for (const l of d.layers) {
    g(0, "LAYER"); g(2, layerName(l.name)); g(70, l.locked ? 4 : 0); g(62, l.visible ? 7 : -7); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const line = (layer: string, a: { x: number; y: number }, b: { x: number; y: number }) => {
    g(0, "LINE"); g(8, layer); g(10, n(a.x)); g(20, n(a.y)); g(30, 0); g(11, n(b.x)); g(21, n(b.y)); g(31, 0);
  };
  const text = (layer: string, p: { x: number; y: number }, h: number, value: string, rotation = 0) => {
    g(0, "TEXT"); g(8, layer); g(10, n(p.x)); g(20, n(p.y)); g(30, 0); g(40, n(h)); g(1, dxfText(value));
    if (rotation) g(50, deg(rotation));
  };
  for (const e of d.entities) {
    const layer = layerName(e.layer);
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
      case "text": text(layer, e.p, e.h, e.text); break;
      case "dim": {
        const geo = dimensionGeometry(e);
        geo.segments.forEach(([a, b]) => line(layer, a, b));
        text(layer, geo.textAt, geo.textHeight, geo.value, geo.angle);
        break;
      }
    }
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

export interface ImportResult {
  drawing: Drawing;
  imported: number;
  skipped: Record<string, number>;
}

interface RawEntity {
  type: string;
  layer?: string;
  vertices?: { x: number; y: number }[];
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
}

/** Reads the common 2D entities; anything else is counted and reported, never silently lost. */
export function fromDxf(content: string): ImportResult {
  const parsed = new DxfParser().parseSync(content) as unknown as {
    entities?: RawEntity[];
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
  const add = (e: Entity) => d.entities.push(e);
  const clean = (t?: string) => (t ?? "").replace(/\\P/g, "\n").replace(/\{\\[^;]*;|[{}]/g, "").replace(/\\[A-Za-z][^;]*;/g, "").slice(0, 500);
  for (const e of parsed.entities ?? []) {
    const layer = ensure(e.layer);
    const id = newId();
    const v = e.vertices ?? [];
    switch (e.type) {
      case "LINE":
        if (v.length >= 2) add({ id, layer, kind: "line", a: { x: v[0].x, y: v[0].y }, b: { x: v[1].x, y: v[1].y } });
        break;
      case "LWPOLYLINE":
      case "POLYLINE":
        if (v.length >= 2) add({ id, layer, kind: "polyline", pts: v.map((p) => ({ x: p.x, y: p.y })), closed: e.shape === true });
        break;
      case "CIRCLE":
        if (e.center && e.radius) add({ id, layer, kind: "circle", c: { x: e.center.x, y: e.center.y }, r: e.radius });
        break;
      case "ARC":
        if (e.center && e.radius && e.startAngle !== undefined && e.endAngle !== undefined) {
          add({ id, layer, kind: "arc", c: { x: e.center.x, y: e.center.y }, r: e.radius, start: e.startAngle, end: e.endAngle });
        }
        break;
      case "TEXT":
        if (e.startPoint && e.text) add({ id, layer, kind: "text", p: { x: e.startPoint.x, y: e.startPoint.y }, text: clean(e.text), h: e.textHeight || 2.5 });
        break;
      case "MTEXT":
        if (e.position && e.text) add({ id, layer, kind: "text", p: { x: e.position.x, y: e.position.y }, text: clean(e.text), h: e.height || 2.5 });
        break;
      default:
        skipped[e.type] = (skipped[e.type] ?? 0) + 1;
    }
  }
  d.layers = [...layers.values()];
  return { drawing: d, imported: d.entities.length, skipped };
}
