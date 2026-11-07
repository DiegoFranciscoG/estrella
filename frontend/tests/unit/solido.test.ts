import { describe, expect, it } from "vitest";
import {
  cleanOutline, create, createPrism, duplicate, footprint, newModel, normaliseAngle, parseModel, remove, signedArea, snap, update, volume,
  type Point2, type Solid,
} from "../../apps/solido/model";

const square: Point2[] = [[0, 0], [4, 0], [4, 3], [0, 3]];

describe("Sólido: placing and editing solids", () => {
  it("creates numbered solids on the ground with their default sizes", () => {
    let m = newModel();
    const a = create(m, "box", { x: 1.234567, z: -2 });
    m = a.model;
    const b = create(m, "box", { x: 0, z: 0 });
    expect(a.solid).toMatchObject({ id: "o1", name: "Caja 1", kind: "box", x: 1.2346, y: 0, z: -2, width: 1, depth: 1, height: 1 });
    expect(b.solid).toMatchObject({ id: "o2", name: "Caja 2" });
    expect(create(b.model, "roof", { x: 0, z: 0 }).solid).toMatchObject({ name: "Cubierta 1", width: 4, depth: 3, height: 1.5 });
  });

  it("clamps edits to sensible values and ignores invalid ones", () => {
    const { model, solid } = create(newModel(), "cylinder", { x: 0, z: 0 });
    const next = update(model, solid.id, { width: 0, height: 25.5, rotation: -90, color: "#ABCDEF", name: "  Tanque  ", x: Number.NaN });
    expect(next.solids[0]).toMatchObject({ width: 0.001, height: 25.5, rotation: 270, color: "#abcdef", name: "Tanque", x: 0 });
    expect(update(next, solid.id, { color: "red", name: "   " }).solids[0]).toMatchObject({ color: "#abcdef", name: "Tanque" });
    expect(normaliseAngle(725)).toBe(5);
    expect(snap(1.26, 0.1)).toBe(1.3);
    expect(snap(-0.74, 0.5)).toBe(-0.5);
  });

  it("duplicates beside the original and removes by id", () => {
    const { model, solid } = create(newModel(), "box", { x: 0, z: 0 });
    const copy = duplicate(update(model, solid.id, { width: 2 }), solid.id)!;
    expect(copy.solid).toMatchObject({ id: "o2", name: "Caja 2", x: 2.1, width: 2 });
    expect(remove(copy.model, "o1").solids.map((s) => s.id)).toEqual(["o2"]);
    expect(duplicate(model, "o9")).toBeNull();
  });
});

describe("Sólido: footprints drawn on the ground", () => {
  it("measures and cleans outlines", () => {
    expect(signedArea(square)).toBe(12);
    expect(cleanOutline([[0, 0], [2, 0], [4, 0], [4, 3], [4, 3], [0, 3], [0, 0]])).toEqual(square);
    expect(cleanOutline([[0, 0], [1, 0], [2, 0]])).toBeNull();
    // A bow tie crosses itself: it cannot be the base of a solid.
    expect(cleanOutline([[0, 0], [4, 3], [4, 0], [0, 3]])).toBeNull();
  });

  it("turns a drawn footprint into an editable prism", () => {
    const L: Point2[] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]];
    const { solid } = createPrism(newModel(), [...L].reverse(), 3)!;
    expect(solid).toMatchObject({ name: "Prisma 1", kind: "prism", x: 3, z: 2.5, width: 6, depth: 5, height: 3 });
    expect(signedArea(solid.outline!)).toBeGreaterThan(0);
    expect(footprint(solid)).toBeCloseTo(6 * 2 + 2 * 3, 9);
    expect(volume(solid)).toBeCloseTo(18 * 3, 9);
    expect(createPrism(newModel(), [[0, 0], [1, 1]])).toBeNull();
  });
});

describe("Sólido: volumes", () => {
  const base = (kind: Solid["kind"], extra: Partial<Solid> = {}): Solid =>
    ({ id: "o1", name: "x", kind, x: 0, y: 0, z: 0, width: 2, depth: 2, height: 3, rotation: 0, color: "#ffffff", hidden: false, ...extra });

  it("computes exact volumes for each kind of solid", () => {
    expect(volume(base("box"))).toBe(12);
    expect(volume(base("cylinder"))).toBeCloseTo(Math.PI * 3, 9);
    expect(volume(base("cone"))).toBeCloseTo(Math.PI, 9);
    expect(volume(base("sphere", { height: 2 }))).toBeCloseTo((4 / 3) * Math.PI, 9);
    expect(volume(base("roof", { width: 4, depth: 3, height: 1.5 }))).toBe(9);
    expect(footprint(base("cylinder"))).toBeCloseTo(Math.PI, 9);
  });
});

describe("Sólido: saved file", () => {
  it("keeps valid solids and drops broken ones", () => {
    const { model } = createPrism(create(newModel(), "box", { x: 1, z: 1 }).model, square)!;
    const saved = JSON.parse(JSON.stringify({ ...model, step: 0.5 }));
    expect(parseModel(saved)).toEqual({ ...model, step: 0.5 });
    const broken = {
      step: 7,
      solids: [
        ...saved.solids,
        { ...saved.solids[0], id: "o1" },
        { ...saved.solids[0], id: "o9", kind: "torus" },
        { ...saved.solids[0], id: "o10", width: "2" },
        { ...saved.solids[1], id: "o11", outline: [[0, 0], [0.5, 0.5]] },
        { ...saved.solids[0], id: "x<script>" },
        { ...saved.solids[0], id: "o12", color: "javascript:alert(1)", name: "" },
      ],
    };
    const parsed = parseModel(broken);
    expect(parsed.step).toBe(0.1);
    expect(parsed.solids.map((s) => s.id)).toEqual(["o1", "o2", "o12"]);
    expect(parsed.solids[2]).toMatchObject({ color: "#d9d9d9", name: "Caja" });
    expect(parseModel(null)).toEqual(newModel());
  });
});
