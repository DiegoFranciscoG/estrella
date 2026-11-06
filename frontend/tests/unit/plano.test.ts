import { describe, expect, it } from "vitest";
import { fromDxf, toDxf } from "../../apps/plano/dxf";
import {
  atLength, bounds, dimensionGeometry, distanceTo, Drawing, drawingBounds, emptyDrawing, Entity, formatLength,
  History, inside, nearestSnap, ortho, parseDrawing, snapToGrid, translate,
} from "../../apps/plano/model";
import { toSvg } from "../../apps/plano/svg";

const line: Entity = { id: "l", layer: "0", kind: "line", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
const rect: Entity = { id: "r", layer: "Muros", kind: "polyline", closed: true, pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }] };
const circle: Entity = { id: "c", layer: "0", kind: "circle", c: { x: 10, y: 10 }, r: 5 };
const arc: Entity = { id: "a", layer: "0", kind: "arc", c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2 };
const text: Entity = { id: "t", layer: "0", kind: "text", p: { x: 0, y: 50 }, text: "Planta baja", h: 5 };
const dim: Entity = { id: "d", layer: "0", kind: "dim", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, offset: 10 };

function sample(): Drawing {
  const d = emptyDrawing();
  d.layers.push({ name: "Muros", visible: true, locked: false });
  d.entities = [line, rect, circle, arc, text, dim];
  return d;
}

describe("Plano geometry", () => {
  it("measures distance to every kind of entity", () => {
    expect(distanceTo(line, { x: 50, y: 3 })).toBeCloseTo(3);
    expect(distanceTo(line, { x: 110, y: 0 })).toBeCloseTo(10);
    expect(distanceTo(rect, { x: 25, y: 32 })).toBeCloseTo(2);
    expect(distanceTo(circle, { x: 10, y: 17 })).toBeCloseTo(2);
    expect(distanceTo(arc, { x: 0, y: 11 })).toBeCloseTo(1);
    expect(distanceTo(arc, { x: -10, y: 0 })).toBeGreaterThan(9);
    expect(distanceTo(text, { x: 5, y: 52 })).toBe(0);
    expect(distanceTo(dim, { x: 50, y: 10 })).toBeCloseTo(0);
  });

  it("snaps to ends, midpoints, centers and the grid", () => {
    expect(nearestSnap([line], { x: 49, y: 1 }, 3)).toEqual({ p: { x: 50, y: 0 }, kind: "mid" });
    expect(nearestSnap([circle], { x: 10.5, y: 9.5 }, 1)?.kind).toBe("center");
    expect(nearestSnap([line], { x: 30, y: 30 }, 3)).toBeNull();
    expect(snapToGrid({ x: 14, y: -6 }, 10)).toEqual({ x: 10, y: -10 });
  });

  it("keeps ortho segments straight and places exact lengths", () => {
    expect(ortho({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
    expect(ortho({ x: 0, y: 0 }, { x: 2, y: -9 })).toEqual({ x: 0, y: -9 });
    const p = atLength({ x: 0, y: 0 }, { x: 3, y: 4 }, 250);
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(200);
    expect(atLength({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toEqual({ x: 6, y: 1 });
  });

  it("measures dimensions and formats lengths without noise", () => {
    expect(dimensionGeometry(dim as Extract<Entity, { kind: "dim" }>).value).toBe("100");
    expect(formatLength(12.345)).toBe("12.35");
    expect(formatLength(12.5)).toBe("12.5");
    expect(formatLength(3)).toBe("3");
  });

  it("moves entities and computes bounds", () => {
    expect(bounds(translate(rect, 5, -5))).toEqual({ minX: 5, minY: -5, maxX: 55, maxY: 25 });
    expect(drawingBounds([line, circle])).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 15 });
    expect(drawingBounds([])).toBeNull();
    expect(inside(circle, { minX: 0, minY: 0, maxX: 20, maxY: 20 })).toBe(true);
    expect(inside(line, { minX: 0, minY: 0, maxX: 20, maxY: 20 })).toBe(false);
  });

  it("validates saved drawings and drops anything malformed", () => {
    const raw = JSON.stringify({
      layers: [{ name: "0" }, { name: "Muros", locked: true }],
      current: "Inexistente",
      entities: [line, { ...line, id: 5 }, { ...circle, r: -1 }, { ...rect, layer: "Otra" }, { kind: "script", id: "x", layer: "0" }, text],
    });
    const d = parseDrawing(raw);
    expect(d.entities.map((e) => e.id)).toEqual(["l", "t"]);
    expect(d.current).toBe("0");
    expect(d.layers[1].locked).toBe(true);
    expect(() => parseDrawing("{no")).toThrow();
  });

  it("undoes and redoes whole drawings", () => {
    const h = new History();
    const a = sample();
    h.push(a);
    const b = { ...a, entities: [] };
    expect(h.undo(b)?.entities).toHaveLength(6);
    expect(h.redo(a)?.entities).toHaveLength(0);
    expect(h.redo(a)).toBeNull();
  });
});

describe("DXF exchange", () => {
  it("writes R12 that its own reader reads back", () => {
    const dxf = toDxf(sample());
    expect(dxf).toContain("AC1009");
    expect(dxf.endsWith("EOF\r\n")).toBe(true);
    const back = fromDxf(dxf);
    const kinds = back.drawing.entities.map((e) => e.kind);
    // Dimensions travel as lines plus text, as every reader understands them.
    expect(kinds.filter((k) => k === "circle")).toHaveLength(1);
    expect(kinds.filter((k) => k === "arc")).toHaveLength(1);
    expect(kinds.filter((k) => k === "polyline")).toHaveLength(1);
    expect(kinds.filter((k) => k === "line")).toHaveLength(1 + 5);
    expect(kinds.filter((k) => k === "text")).toHaveLength(2);
    expect(back.drawing.layers.map((l) => l.name)).toContain("Muros");
    const poly = back.drawing.entities.find((e) => e.kind === "polyline") as Extract<Entity, { kind: "polyline" }>;
    expect(poly.closed).toBe(true);
    expect(poly.pts).toHaveLength(4);
    const a = back.drawing.entities.find((e) => e.kind === "arc") as Extract<Entity, { kind: "arc" }>;
    expect(a.end).toBeCloseTo(Math.PI / 2);
  });

  it("escapes non-ASCII text the way CAD programs expect", () => {
    const d = emptyDrawing();
    d.entities = [{ id: "t", layer: "0", kind: "text", p: { x: 0, y: 0 }, text: "Baño", h: 3 }];
    expect(toDxf(d)).toContain("Ba\\U+00F1o");
  });

  it("reports entities it cannot read instead of losing them silently", () => {
    const dxf = toDxf(sample()).replace("0\r\nENDSEC\r\n0\r\nEOF", "0\r\nPOINT\r\n8\r\n0\r\n10\r\n1\r\n20\r\n1\r\n30\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF");
    expect(fromDxf(dxf).skipped).toEqual({ POINT: 1 });
  });
});

describe("SVG export", () => {
  it("writes millimetre units, escapes text and skips hidden layers", () => {
    const d = sample();
    d.entities.push({ id: "x", layer: "0", kind: "text", p: { x: 0, y: 0 }, text: "<script>", h: 2 });
    d.layers[1].visible = false;
    const svg = toSvg(d);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain("&#60;script&#62;");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('id="Muros"');
    expect(svg).toContain("<circle");
  });
});
