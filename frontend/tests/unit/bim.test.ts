import { describe, expect, it } from "vitest";
import {
  addMeasure, amounts, categoryOf, csv, defaultView, distance, formatLevel, formatMeasure, looksLikeIfc, materialNames,
  parseView, propertyLabel, quantities, readGroups, sceneY, search, siScale, sortCategories, unitScales, valueText,
  type BimElement, type Measure, type Scales,
} from "../../apps/bim/model";

const METRES: Scales = { length: 1, area: 1, volume: 1, mass: 1 };
const MM: Scales = { length: 0.001, area: 1, volume: 1, mass: 1 };

describe("BIM categories", () => {
  it("groups IFC classes the way a student looks for them", () => {
    expect(categoryOf("IfcWallStandardCase")).toBe("Muros");
    expect(categoryOf("IFCWALL")).toBe("Muros");
    expect(categoryOf("IfcCurtainWall")).toBe("Muros cortina");
    expect(categoryOf("IfcSlab")).toBe("Losas");
    expect(categoryOf("IfcStairFlight")).toBe("Escaleras");
    expect(categoryOf("IfcPipeSegment")).toBe("Instalaciones");
    expect(categoryOf("IfcFlowTerminal")).toBe("Instalaciones");
    expect(categoryOf("IfcSpace")).toBe("Espacios");
    expect(categoryOf("IfcBuildingElementProxy")).toBe("Otros");
    expect(sortCategories(["Otros", "Losas", "Muros", "Losas"])).toEqual(["Muros", "Losas", "Otros"]);
  });
});

describe("BIM units", () => {
  it("applies SI prefixes before the power", () => {
    expect(siScale("LENGTHUNIT", "MILLI", "METRE")).toBe(0.001);
    expect(siScale("AREAUNIT", "MILLI", "SQUARE_METRE")).toBeCloseTo(1e-6, 12);
    expect(siScale("VOLUMEUNIT", "CENTI", "CUBIC_METRE")).toBeCloseTo(1e-6, 12);
    expect(siScale("MASSUNIT", "KILO", "GRAM")).toBe(1);
    expect(siScale("LENGTHUNIT", "BOGUS", "METRE")).toBeNull();
    expect(siScale("LENGTHUNIT", null, "SQUARE_METRE")).toBeNull();
  });

  it("reads the project's units, including conversion-based ones", () => {
    expect(unitScales([
      { type: "LENGTHUNIT", prefix: "MILLI", name: "METRE" },
      { type: "AREAUNIT", factor: 0.09290304 },
      { type: "PLANEANGLEUNIT", name: "RADIAN" },
    ])).toEqual({ length: 0.001, area: 0.09290304, volume: 1, mass: 1 });
    expect(unitScales([])).toEqual(METRES);
  });

  it("places a storey in the scene: file units, Z up, moved near the origin", () => {
    const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 500000000, 9000000, 5500, 1];
    const coordination = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -500000, -2.5, 9000, 1];
    expect(sceneY(world, coordination, 0.001)).toBeCloseTo(3, 9);
  });

  it("writes levels and measures the way drawings do", () => {
    expect(formatLevel(0)).toBe("±0,00 m");
    expect(formatLevel(0.004)).toBe("±0,00 m");
    expect(formatLevel(3)).toBe("+3,00 m");
    expect(formatLevel(-0.15)).toBe("-0,15 m");
    expect(formatMeasure(12, "area")).toBe("12,00 m²");
    expect(formatMeasure(3, "count")).toBe("3");
  });
});

describe("BIM properties", () => {
  // Shaped like web-ifc's resolved lines (values wrapped, numbers as _representationValue).
  const pset = {
    Name: { value: "Pset_WallCommon" },
    HasProperties: [
      { Name: { value: "IsExternal" }, NominalValue: { name: "IFCBOOLEAN", value: true } },
      { Name: { value: "LoadBearing" }, NominalValue: { name: "IFCBOOLEAN", value: ".F." } },
      { Name: { value: "FireRating" }, NominalValue: { name: "IFCLABEL", value: "EI 60" } },
      { Name: { value: "Width" }, NominalValue: { name: "IFCPOSITIVELENGTHMEASURE", _representationValue: 200 } },
      { Name: { value: "Finishes" }, EnumerationValues: [{ value: "Pintura" }, { value: "Estuco" }] },
      { Name: { value: "Grupo" }, HasProperties: [{ Name: { value: "Color" }, NominalValue: { value: "Blanco" } }] },
      { Name: { value: "Empty" }, NominalValue: null },
    ],
  };
  const qto = {
    Name: { value: "Qto_WallBaseQuantities" },
    Quantities: [
      { Name: { value: "Length" }, LengthValue: { _representationValue: 4000 } },
      { Name: { value: "GrossSideArea" }, AreaValue: { _representationValue: 12.6 } },
      { Name: { value: "NetSideArea" }, AreaValue: { _representationValue: 12 } },
      { Name: { value: "NetVolume" }, VolumeValue: { _representationValue: 2.4 } },
      { Name: { value: "Broken" }, VolumeValue: { _representationValue: "x" } },
    ],
  };

  it("labels IFC properties in Spanish and keeps the standard's name", () => {
    expect(propertyLabel("IsExternal")).toBe("Es exterior (IsExternal)");
    expect(propertyLabel("Pset_Custom")).toBe("Pset_Custom");
  });

  it("turns values into text a student reads, in metres", () => {
    expect(valueText({ name: "IFCBOOLEAN", value: false }, METRES)).toBe("No");
    expect(valueText({ name: "IFCLOGICAL", value: "U" }, METRES)).toBe("Desconocido");
    expect(valueText({ name: "IFCLENGTHMEASURE", _representationValue: 3000 }, MM)).toBe("3,00 m");
    expect(valueText({ name: "IFCREAL", value: 0.25 }, MM)).toBe("0,2500");
    expect(valueText(null, METRES)).toBe("");
  });

  it("reads property sets and quantity sets", () => {
    const groups = readGroups([pset, qto, { Name: { value: "Vacío" }, HasProperties: [] }], MM, "");
    expect(groups.map((g) => [g.name, g.quantities])).toEqual([["Pset_WallCommon", false], ["Qto_WallBaseQuantities", true]]);
    const rows = Object.fromEntries(groups[0].rows.map((r) => [r.name, r.value]));
    expect(rows).toEqual({ IsExternal: "Sí", LoadBearing: "No", FireRating: "EI 60", Width: "0,20 m", Finishes: "Pintura, Estuco", Color: "Blanco" });
    expect(groups[0].rows.find((r) => r.name === "Color")!.label).toBe("Grupo · Color");
    expect(groups[1].rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Longitud (Length): 4,00 m", "Área lateral bruta (GrossSideArea): 12,60 m²", "Área lateral neta (NetSideArea): 12,00 m²", "Volumen neto (NetVolume): 2,40 m³",
    ]);
    expect(readGroups([pset], METRES, " (tipo)")[0].name).toBe("Pset_WallCommon (tipo)");
  });

  it("picks the schedule's length, area and volume: net before gross", () => {
    expect(amounts(quantities(qto, MM))).toEqual({ length: 4, area: 12, volume: 2.4 });
    expect(amounts(quantities({ Quantities: [{ Name: { value: "Otra" }, AreaValue: { value: 5 } }] }, METRES))).toEqual({ length: null, area: 5, volume: null });
    expect(amounts([])).toEqual({ length: null, area: null, volume: null });
  });

  it("finds material names in layer sets, lists and single materials", () => {
    const layered = { ForLayerSet: { MaterialLayers: [{ Material: { Name: { value: "Hormigón" } } }, { Material: { Name: { value: "Ladrillo" } } }] } };
    const list = { Materials: [{ Name: { value: "Vidrio" } }, { Name: { value: "Hormigón" } }] };
    expect(materialNames([layered, list, { Name: { value: "Acero" } }])).toEqual(["Hormigón", "Ladrillo", "Vidrio", "Acero"]);
    expect(materialNames([])).toEqual([]);
  });
});

describe("BIM elements, files and schedule", () => {
  const elements: BimElement[] = [
    { id: 30, ifcClass: "IfcWall", category: "Muros", level: 24, name: "Muro de fachada", globalId: "2JMlyUIMzr276kTRvc3UAO" },
    { id: 70, ifcClass: "IfcSlab", category: "Losas", level: 60, name: "Losa de habitación", globalId: "3mhXOWNk1SItGgUBVCpXYh" },
  ];
  const levels = [{ id: 24, name: "Planta baja", elevation: 0, y: 0 }, { id: 60, name: "Planta alta", elevation: 3, y: 3 }];

  it("searches without caring about accents or case", () => {
    expect(search(elements, levels, "HABITACION").map((e) => e.id)).toEqual([70]);
    expect(search(elements, levels, "muro baja").map((e) => e.id)).toEqual([30]);
    expect(search(elements, levels, "losas alta").map((e) => e.id)).toEqual([70]);
    expect(search(elements, levels, "   ")).toEqual([]);
  });

  it("recognises STEP files and nothing else", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeIfc(enc("ISO-10303-21;\nHEADER;"))).toBe(true);
    expect(looksLikeIfc(enc("﻿  ISO-10303-21;"))).toBe(true);
    expect(looksLikeIfc(enc("PK\u0003\u0004zip"))).toBe(false);
    expect(looksLikeIfc(enc("<?xml version='1.0'?><ifcXML/>"))).toBe(false);
  });

  it("writes a CSV that spreadsheets read and that cannot run formulas", () => {
    const out = csv([["Nombre", "Volumen (m³)"], ["Muro \"A\"", 2.4], ["=HYPERLINK(\"x\")", null], ["-1+1", -0.15]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.split("\r\n")).toEqual([
      "﻿\"Nombre\";\"Volumen (m³)\"", "\"Muro \"\"A\"\"\";2,40", "\"'=HYPERLINK(\"\"x\"\")\";", "\"'-1+1\";-0,15", "",
    ]);
  });
});

describe("BIM saved view", () => {
  it("starts with spaces and openings hidden", () => {
    expect(defaultView()).toEqual({ hiddenLevels: [], hiddenCategories: ["Espacios", "Aberturas"], section: null, selected: null, measures: [] });
  });

  it("keeps only valid fields from a saved view", () => {
    const m: Measure = [0, 0, 0, 3, 4, 0];
    expect(parseView({
      hiddenLevels: [60, 60, -1, 1.5, "x"], hiddenCategories: ["Muros", "<img>", 3], section: 1.2, selected: 30,
      measures: [m, [1, 2, 3], [0, 0, 0, 0, 0, Infinity]],
    })).toEqual({ hiddenLevels: [60], hiddenCategories: ["Muros"], section: 1.2, selected: 30, measures: [m] });
    expect(parseView("nope")).toEqual(defaultView());
    expect(parseView({ section: "1", selected: 0 }).section).toBeNull();
  });

  it("measures straight distances and keeps the last hundred", () => {
    expect(distance([0, 0, 0, 3, 4, 0])).toBe(5);
    let list: Measure[] = [];
    for (let i = 0; i < 105; i++) list = addMeasure(list, [i, 0, 0, i + 1, 0, 0]);
    expect(list).toHaveLength(100);
    expect(list[0][0]).toBe(5);
  });
});
