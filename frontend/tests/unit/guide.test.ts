import { describe, expect, it } from "vitest";
import { programs } from "../../src/core/catalog";
import { guide, normalize, paidPrograms, resolveTool, search, validateGuide, type Guide } from "../../src/core/guide";

/** Every test file of the project, as text, keyed by its path from the repository root. */
const testFiles: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob(["../e2e/*.spec.ts", "./*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>)
    .map(([path, code]) => [path.replace(/^\.\.\/e2e\//, "frontend/tests/e2e/").replace(/^\.\//, "frontend/tests/unit/"), code]),
);

const isProgram = (id: string) => ["plano", "visor"].includes(id);

function sample(): Guide {
  return {
    consulted: "2026-11-06",
    tools: { gimp: { name: "GIMP", where: "escritorio", site: "https://www.gimp.org/" } },
    cards: [{
      id: "a", area: "diseno", task: "Recortar", keywords: [], from: [{ program: "X", term: "y" }], tool: "gimp",
      steps: ["Paso"], source: { kind: "official", title: "Manual", url: "https://docs.gimp.org/3.0/es/x.html" },
    }],
  };
}

describe("Guide data", () => {
  it("has enough cards in both areas, each with steps and a source", () => {
    expect(guide.cards.length).toBeGreaterThanOrEqual(30);
    expect(guide.cards.filter((c) => c.area === "arquitectura").length).toBeGreaterThanOrEqual(10);
    expect(guide.cards.filter((c) => c.area === "diseno").length).toBeGreaterThanOrEqual(10);
  });

  it("cites only tests that really exist in the repository", () => {
    for (const card of guide.cards) {
      if (card.source.kind !== "test") continue;
      const code = testFiles[card.source.file];
      expect(code, `${card.id} cites a missing file`).toBeTypeOf("string");
      expect(code, `${card.id} cites a missing test`).toContain(`("${card.source.test}"`);
    }
  });

  it("covers every paid program the catalog says ESTRELLA replaces", () => {
    // Names come from the data, not from here: brand names live only in the equivalence data (T-01).
    const covered = new Set(paidPrograms(guide.cards));
    const free = new Set(Object.values(guide.tools).map((t) => t.name));
    const paid = [...new Set(programs.flatMap((p) => p.replaces))].filter((name) => !free.has(name) && name !== "varios formatos");
    expect(paid.length).toBeGreaterThanOrEqual(18);
    for (const p of paid) expect(covered.has(p), p).toBe(true);
  });

  it("resolves ESTRELLA programs and desktop tools", () => {
    expect(resolveTool("plano")).toMatchObject({ kind: "estrella", name: "Plano", available: true });
    expect(resolveTool("gimp")).toMatchObject({ kind: "external", name: "GIMP" });
  });
});

describe("Guide validation", () => {
  const broken = (change: (g: Guide) => void) => () => {
    const g = sample();
    change(g);
    validateGuide(g, isProgram);
  };

  it("accepts a well-formed guide", () => {
    expect(validateGuide(sample(), isProgram).cards).toHaveLength(1);
  });

  it("rejects cards without a trustworthy source", () => {
    expect(broken((g) => { g.cards[0].source = { kind: "official", title: "Blog", url: "https://miblog.example.com/gimp" }; })).toThrow(/official/);
    expect(broken((g) => { g.cards[0].source = { kind: "official", title: "Manual", url: "http://docs.gimp.org/x" }; })).toThrow(/official/);
    expect(broken((g) => { (g.cards[0] as { source?: unknown }).source = undefined; })).toThrow(/source/);
    expect(broken((g) => { g.cards[0].source = { kind: "test", file: "../secreto.ts", test: "x" }; })).toThrow(/test source/);
  });

  it("rejects unknown tools, repeated ids, empty steps and bad dates", () => {
    expect(broken((g) => { g.cards[0].tool = "fantasma"; })).toThrow(/unknown tool/);
    expect(broken((g) => { g.cards.push({ ...g.cards[0] }); })).toThrow(/repeated/);
    expect(broken((g) => { g.cards[0].steps = [" "]; })).toThrow(/steps/);
    expect(broken((g) => { g.cards[0].from = []; })).toThrow(/from/);
    expect(broken((g) => { g.consulted = "ayer"; })).toThrow(/date/);
    expect(broken((g) => { g.tools.gimp.site = "http://gimp.org"; })).toThrow(/tool gimp/);
  });
});

describe("Guide search", () => {
  it("ignores accents, case and extra spaces", () => {
    expect(normalize("  CÁMARA   Rápida ")).toBe("camara rapida");
  });

  it("returns every card in its order for an empty query", () => {
    expect(search(guide.cards, {}).map((c) => c.id)).toEqual(guide.cards.map((c) => c.id));
  });

  it("ranks title matches first and needs every word", () => {
    const ids = search(guide.cards, { text: "recortar" }).map((c) => c.id);
    expect(ids.slice(0, 2).sort()).toEqual(["recortar-imagen", "recortar-lineas"]);
    expect(search(guide.cards, { text: "recortar imagen" }).map((c) => c.id)[0]).toBe("recortar-imagen");
    expect(search(guide.cards, { text: "recortar zzzz" })).toEqual([]);
  });

  it("finds a task by the paid program's command name", () => {
    expect(search(guide.cards, { text: "trim" })[0].id).toBe("recortar-lineas");
    expect(search(guide.cards, { text: "PUSH pull" })[0].id).toBe("extruir-cara");
  });

  it("filters by area and by the program the student comes from", () => {
    expect(search(guide.cards, { area: "diseno" }).every((c) => c.area === "diseno")).toBe(true);
    // The PDF program students come from, read from the data (brand names stay out of the code).
    const pdfProgram = guide.cards.find((c) => c.id === "unir-pdf")!.from[0].program;
    const fromPdf = search(guide.cards, { from: pdfProgram });
    expect(fromPdf.length).toBeGreaterThanOrEqual(3);
    expect(fromPdf.every((c) => c.tool === "folio")).toBe(true);
    expect(search(guide.cards, { text: "pdf", area: "arquitectura" }).map((c) => c.id)).toContain("imprimir-a-escala");
  });

  it("lists paid programs once, sorted for Spanish", () => {
    const list = paidPrograms(guide.cards);
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort((a, b) => a.localeCompare(b, "es"))).toEqual(list);
  });
});
