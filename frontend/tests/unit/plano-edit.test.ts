import { describe, expect, it } from "vitest";
import { fromDxf, toDxf } from "../../apps/plano/dxf";
import { arcThrough, boundaryAt, entityIntersections, intersectionSnap, offset, perpendicularSnap, tangentSnap, trim } from "../../apps/plano/geom";
import {
  bounds, dimensionGeometry, distanceTo, Drawing, emptyDrawing, Entity, mirroring, parseDrawing, polarPoint, polygonArea,
  primitives, rotation, scaling, transformEntity, translation,
} from "../../apps/plano/model";
import { toPdf } from "../../apps/plano/pdf";
import { toSvg } from "../../apps/plano/svg";

const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, layer: "0", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe("Plano transforms", () => {
  it("rotates, scales and mirrors lines, circles and arcs", () => {
    const line = transformEntity(L("a", 10, 0, 20, 0), rotation({ x: 0, y: 0 }, Math.PI / 2)) as Extract<Entity, { kind: "line" }>;
    close(line.a, 0, 10);
    close(line.b, 0, 20);
    const circle = transformEntity({ id: "c", layer: "0", kind: "circle", c: { x: 10, y: 10 }, r: 5 }, scaling({ x: 0, y: 0 }, 2)) as Extract<Entity, { kind: "circle" }>;
    close(circle.c, 20, 20);
    expect(circle.r).toBeCloseTo(10);
    // An arc from 0° to 90° mirrored across the y axis runs from 90° to 180°.
    const arc = transformEntity({ id: "r", layer: "0", kind: "arc", c: { x: 0, y: 0 }, r: 1, start: 0, end: Math.PI / 2 }, mirroring({ x: 0, y: 0 }, { x: 0, y: 1 })) as Extract<Entity, { kind: "arc" }>;
    expect(arc.start).toBeCloseTo(Math.PI / 2);
    expect(arc.end).toBeCloseTo(Math.PI);
  });

  it("keeps mirrored text readable and rotates it with the drawing", () => {
    const t: Entity = { id: "t", layer: "0", kind: "text", p: { x: 5, y: 0 }, text: "Sala", h: 2 };
    const mirrored = transformEntity(t, mirroring({ x: 0, y: 0 }, { x: 0, y: 1 })) as Extract<Entity, { kind: "text" }>;
    close(mirrored.p, -5, 0);
    expect(mirrored.rot ?? 0).toBe(0);
    const turned = transformEntity(t, rotation({ x: 0, y: 0 }, Math.PI / 2)) as Extract<Entity, { kind: "text" }>;
    expect(turned.rot).toBeCloseTo(Math.PI / 2);
  });

  it("moves by a typed vector and places points by length and angle", () => {
    const moved = transformEntity(L("a", 0, 0, 1, 0), translation(300, -50)) as Extract<Entity, { kind: "line" }>;
    close(moved.a, 300, -50);
    close(polarPoint({ x: 0, y: 0 }, 100, 90), 0, 100);
    close(polarPoint({ x: 10, y: 10 }, 2, 180), 8, 10);
  });
});

describe("Plano dimensions", () => {
  it("measures horizontal and vertical distances only, whatever the slope", () => {
    const base = { id: "d", layer: "0", kind: "dim" as const, a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, offset: -20 };
    expect(dimensionGeometry({ ...base, mode: "h" }).value).toBe("300");
    expect(dimensionGeometry({ ...base, mode: "v" }).value).toBe("400");
    expect(dimensionGeometry(base).value).toBe("500");
    close(dimensionGeometry({ ...base, mode: "h" }).points[2], 0, -20);
  });

  it("swaps a horizontal dimension to vertical when turned 90°", () => {
    const dim: Entity = { id: "d", layer: "0", kind: "dim", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, offset: 10, mode: "h" };
    const turned = transformEntity(dim, rotation({ x: 0, y: 0 }, Math.PI / 2)) as Extract<Entity, { kind: "dim" }>;
    expect(turned.mode).toBe("v");
    expect(dimensionGeometry(turned).value).toBe("100");
  });
});

describe("Plano trim, offset and arcs", () => {
  it("finds intersections between lines, circles and arcs", () => {
    expect(entityIntersections(L("a", 0, 0, 10, 10), L("b", 0, 10, 10, 0))).toHaveLength(1);
    const circle: Entity = { id: "c", layer: "0", kind: "circle", c: { x: 0, y: 0 }, r: 5 };
    expect(entityIntersections(L("a", -10, 0, 10, 0), circle)).toHaveLength(2);
    const arc: Entity = { id: "r", layer: "0", kind: "arc", c: { x: 0, y: 0 }, r: 5, start: 0, end: Math.PI / 2 };
    expect(entityIntersections(L("a", -10, 0.0001, 10, 0.0001), arc)).toHaveLength(1);
  });

  it("trims the clicked part of a line between two cutting edges", () => {
    const wall = L("w", 0, 0, 100, 0);
    const cutters = [L("c1", 30, -10, 30, 10), L("c2", 70, -10, 70, 10)];
    const pieces = trim(wall, { x: 50, y: 1 }, [wall, ...cutters])!;
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.kind === "line" && [p.a.x, p.b.x])).toEqual([[0, 30], [70, 100]]);
    // Clicking the end beyond the last cut removes only that end.
    expect(trim(wall, { x: 90, y: 0 }, cutters)!.map((p) => p.kind === "line" && p.b.x)).toEqual([70]);
    expect(trim(wall, { x: 50, y: 0 }, [])).toBeNull();
  });

  it("turns a trimmed circle into the arc that remains", () => {
    const circle: Entity = { id: "c", layer: "0", kind: "circle", c: { x: 0, y: 0 }, r: 10 };
    const [arc] = trim(circle, { x: 10, y: 0 }, [L("v", 0, -20, 0, 20)])!;
    expect(arc.kind).toBe("arc");
    // The right half (around 0°) was removed: the arc runs from 90° to 270°.
    const a = arc as Extract<Entity, { kind: "arc" }>;
    expect(a.start).toBeCloseTo(Math.PI / 2);
    expect(a.end).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("cuts a polyline segment and keeps both ends as polylines", () => {
    const path: Entity = { id: "p", layer: "0", kind: "polyline", closed: false, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    const pieces = trim(path, { x: 50, y: 0 }, [L("a", 20, -5, 20, 5), L("b", 80, -5, 80, 5)])!;
    expect(pieces).toHaveLength(2);
    expect(pieces[1].kind === "polyline" && pieces[1].pts.map((p) => [p.x, p.y])).toEqual([[80, 0], [100, 0], [100, 100]]);
  });

  it("offsets lines, circles and closed outlines to the clicked side", () => {
    const up = offset(L("a", 0, 0, 100, 0), 15, { x: 50, y: 40 })!;
    expect(up.kind === "line" && [up.a.y, up.b.y]).toEqual([15, 15]);
    const ring = offset({ id: "c", layer: "0", kind: "circle", c: { x: 0, y: 0 }, r: 10 }, 3, { x: 1, y: 0 })!;
    expect(ring.kind === "circle" && ring.r).toBe(7);
    // A 400 × 300 room offset 15 outward (a wall's thickness) becomes 430 × 330.
    const room: Entity = { id: "r", layer: "0", kind: "polyline", closed: true, pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] };
    const outer = offset(room, 15, { x: 200, y: -50 })!;
    expect(outer.kind === "polyline" && polygonArea(outer.pts)).toBeCloseTo(430 * 330);
    expect(offset(room, 0, { x: 0, y: 0 })).toBeNull();
  });

  it("draws an arc through three points, counter-clockwise", () => {
    const arc = arcThrough({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 })!;
    close(arc.c, 0, 0);
    expect(arc.r).toBeCloseTo(10);
    expect(arc.start).toBeCloseTo(0);
    expect(arc.end).toBeCloseTo(Math.PI);
    const below = arcThrough({ x: 10, y: 0 }, { x: 0, y: -10 }, { x: -10, y: 0 })!;
    expect(below.start).toBeCloseTo(Math.PI);
    expect(arcThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe("Plano snaps", () => {
  const cross = [L("a", -10, 0, 10, 0), L("b", 0, -10, 0, 10)];
  it("snaps to intersections, perpendiculars and tangents", () => {
    close(intersectionSnap(cross, { x: 0.4, y: -0.3 }, 1)!.p, 0, 0);
    expect(intersectionSnap(cross, { x: 5, y: 5 }, 1)).toBeNull();
    const foot = perpendicularSnap([L("w", 0, 0, 100, 0)], { x: 30, y: 50 }, { x: 31, y: 0.5 }, 2)!;
    close(foot.p, 30, 0);
    const circle: Entity = { id: "c", layer: "0", kind: "circle", c: { x: 0, y: 0 }, r: 10 };
    const tan = tangentSnap([circle], { x: 20, y: 0 }, { x: 5, y: 8.66 }, 2)!;
    expect(tan.kind).toBe("tangent");
    // A tangent point is at a right angle with the radius.
    expect(tan.p.x * (20 - tan.p.x) + tan.p.y * (0 - tan.p.y)).toBeCloseTo(0, 6);
  });
});

describe("Plano hatching and blocks", () => {
  const room: Entity = { id: "r", layer: "0", kind: "polyline", closed: true, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };

  it("finds the smallest closed outline around a point", () => {
    const inner: Entity = { ...room, id: "i", pts: room.kind === "polyline" ? room.pts.map((p) => ({ x: p.x / 2 + 10, y: p.y / 2 + 10 })) : [] };
    expect(polygonArea(boundaryAt([room, inner], { x: 20, y: 20 })!)).toBeCloseTo(50 * 25);
    expect(polygonArea(boundaryAt([room, inner], { x: 90, y: 45 })!)).toBeCloseTo(100 * 50);
    expect(boundaryAt([room], { x: 200, y: 0 })).toBeNull();
  });

  it("fills hatches with lines that stay inside the outline", () => {
    for (const pattern of ["diagonal", "cruzado", "ladrillo"] as const) {
      const hatch: Entity = { id: "h", layer: "0", kind: "hatch", pts: room.kind === "polyline" ? room.pts : [], pattern, scale: 2, angle: 0 };
      const segs = primitives(hatch);
      expect(segs.length, pattern).toBeGreaterThan(5);
      for (const s of segs) if (s.t === "seg") for (const p of [s.a, s.b]) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(100 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(50 + 1e-6);
      }
    }
    const solid: Entity = { id: "s", layer: "0", kind: "hatch", pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], pattern: "solido", scale: 1, angle: 0 };
    expect(primitives(solid)[0].t).toBe("fill");
    expect(distanceTo(solid, { x: 0.2, y: 0.2 })).toBe(0);
  });

  it("draws block inserts moved, turned and scaled, and saves them safely", () => {
    const d: Drawing = emptyDrawing();
    d.blocks = { Puerta: { base: { x: 0, y: 0 }, entities: [L("p", 0, 0, 90, 0)] } };
    d.entities = [{ id: "i", layer: "0", kind: "insert", name: "Puerta", p: { x: 100, y: 100 }, rot: Math.PI / 2, s: 2 }];
    const [seg] = primitives(d.entities[0], d.blocks);
    expect(seg.t === "seg" && [Math.round(seg.b.x), Math.round(seg.b.y)]).toEqual([100, 280]);
    expect(bounds(d.entities[0], d.blocks).maxY).toBeCloseTo(280);
    const back = parseDrawing(JSON.stringify(d));
    expect(back.entities).toHaveLength(1);
    // An insert that names a block that does not exist is dropped, not drawn as nothing.
    expect(parseDrawing(JSON.stringify({ ...d, blocks: {} })).entities).toHaveLength(0);
  });
});

describe("Plano exchange with blocks, hatches and PDF", () => {
  function sample(): Drawing {
    const d = emptyDrawing();
    d.blocks = { Mesa: { base: { x: 0, y: 0 }, entities: [{ id: "m", layer: "0", kind: "circle", c: { x: 0, y: 0 }, r: 40 }] } };
    d.entities = [
      { id: "w", layer: "0", kind: "polyline", closed: true, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "h", layer: "0", kind: "hatch", pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], pattern: "diagonal", scale: 10, angle: 0 },
      { id: "i", layer: "0", kind: "insert", name: "Mesa", p: { x: 2000, y: 1500 }, rot: 0, s: 1 },
      { id: "t", layer: "0", kind: "text", p: { x: 100, y: 3100 }, text: "Planta baja — año 2026", h: 150 },
    ];
    return d;
  }

  it("writes blocks as real DXF blocks and reads them back as inserts", () => {
    const dxf = toDxf(sample());
    expect(dxf).toContain("BLOCKS");
    expect(dxf).toMatch(/INSERT\r\n {0,2}8\r\n0\r\n {0,2}2\r\nMesa/);
    const back = fromDxf(dxf).drawing;
    expect(Object.keys(back.blocks ?? {})).toEqual(["Mesa"]);
    expect(back.entities.filter((e) => e.kind === "insert")).toHaveLength(1);
    expect(back.entities.filter((e) => e.kind === "line").length).toBeGreaterThan(5);
  });

  it("exports SVG with the block and the hatch", () => {
    const svg = toSvg(sample());
    expect(svg).toContain("<circle");
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThan(5);
  });

  it("prints to scale on a sheet, and says which scale fits when it does not", () => {
    const ok = toPdf(sample(), { sheet: "A3", landscape: true, scale: 50, title: "Casa", author: "Ana", date: "2026-11-06" });
    expect(ok.ok).toBe(true);
    const text = ok.ok ? new TextDecoder("latin1").decode(ok.pdf) : "";
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 1190.551 841.89]");
    expect(text).toContain("(Escala 1:50) Tj");
    expect(text).toMatch(/startxref\n\d+\n%%EOF/);
    // The xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const tooBig = toPdf(sample(), { sheet: "A4", landscape: true, scale: 10, title: "", author: "", date: "" });
    expect(tooBig.ok).toBe(false);
    // 3250 mm tall in 152 mm of usable height needs 1:21.4: the next standard scale is 1:25.
    expect(!tooBig.ok && tooBig.suggest).toBe(25);
    const fit = toPdf(sample(), { sheet: "A4", landscape: false, scale: 0, title: "", author: "", date: "" });
    expect(fit.ok && fit.scale).toBeGreaterThan(10);
    expect(toPdf(emptyDrawing(), { sheet: "A4", landscape: true, scale: 0, title: "", author: "", date: "" }).ok).toBe(false);
  });
});
