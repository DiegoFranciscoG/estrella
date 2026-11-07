/**
 * BIM, the part without web-ifc or three.js: the category of each IFC class, the project's units,
 * properties and quantities as a student reads them, the element schedule as CSV and the saved
 * view. Everything here is plain data in, plain data out, so it is unit tested.
 */

/** Express IDs start at 1; elements outside any storey are grouped under this pseudo level. */
export const NO_LEVEL = 0;
/** Plan views cut 1.20 m above the level, the usual cut height for architectural floor plans. */
export const PLAN_CUT = 1.2;
const MAX_MEASURES = 100;

// ---------------------------------------------------------------------------- categories

const RULES: [string, RegExp][] = [
  ["Muros", /^IFCWALL/],
  ["Muros cortina", /^IFCCURTAINWALL/],
  ["Losas", /^IFCSLAB/],
  ["Cubiertas", /^IFCROOF/],
  ["Columnas", /^IFCCOLUMN/],
  ["Vigas", /^IFCBEAM/],
  ["Puertas", /^IFCDOOR/],
  ["Ventanas", /^IFCWINDOW/],
  ["Escaleras", /^IFCSTAIR/],
  ["Rampas", /^IFCRAMP/],
  ["Barandas", /^IFCRAILING/],
  ["Revestimientos", /^IFCCOVERING/],
  ["Placas y perfiles", /^IFC(PLATE|MEMBER)/],
  ["Cimentación", /^IFC(FOOTING|PILE)/],
  ["Mobiliario", /^IFC(FURNISHINGELEMENT|FURNITURE|SYSTEMFURNITUREELEMENT)/],
  ["Instalaciones", /^IFC(FLOW|DISTRIBUTION|ENERGYCONVERSION|PIPE|DUCT|CABLE|SANITARY|LIGHTFIXTURE|LAMP|AIRTERMINAL|VALVE|PUMP|FAN|BOILER|CHILLER|TANK|FIRESUPPRESSION|ALARM|SENSOR|OUTLET|SWITCHINGDEVICE|ELECTRIC|TRANSFORMER|UNITARYEQUIPMENT|COIL|DAMPER|FILTER|SPACEHEATER|WASTETERMINAL|STACKTERMINAL|JUNCTIONBOX|PROTECTIVEDEVICE|COMMUNICATIONSAPPLIANCE|AUDIOVISUALAPPLIANCE|COMPRESSOR|CONDENSER|COOLING|EVAPORA|HEATEXCHANGER|HUMIDIFIER|BURNER|CONTROLLER|ACTUATOR)/],
  ["Terreno", /^IFC(SITE|GEOGRAPHICELEMENT)$/],
  ["Espacios", /^IFCSPACE$/],
  ["Aberturas", /^IFC(OPENINGELEMENT|OPENINGSTANDARDCASE|VOIDINGFEATURE)$/],
];

/** Volumes that would cover the building: BIM viewers start with them hidden. */
export const HIDDEN_BY_DEFAULT: readonly string[] = ["Espacios", "Aberturas"];

/** Spanish category of an IFC class name ("IfcWallStandardCase" or "IFCWALLSTANDARDCASE"). */
export function categoryOf(ifcClass: string): string {
  const name = ifcClass.toUpperCase();
  return RULES.find(([, rule]) => rule.test(name))?.[0] ?? "Otros";
}

/** Categories in a stable order (the order of the rules, then "Otros"). */
export function sortCategories(names: Iterable<string>): string[] {
  const order = [...RULES.map(([label]) => label), "Otros"];
  return [...new Set(names)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// ---------------------------------------------------------------------------- units

export interface Scales { length: number; area: number; volume: number; mass: number }
/** An IfcSIUnit (prefix + name) or an IfcConversionBasedUnit (factor already in SI). */
export interface RawUnit { type: string; prefix?: string | null; name?: string | null; factor?: number | null }

const PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
const KIND: Record<string, keyof Scales> = { LENGTHUNIT: "length", AREAUNIT: "area", VOLUMEUNIT: "volume", MASSUNIT: "mass" };

/**
 * Size of one SI unit in metres, m², m³ or kg. The prefix applies to the base unit before the
 * power: MILLI + SQUARE_METRE is a square millimetre (1e-6 m²).
 */
export function siScale(type: string, prefix: string | null | undefined, name: string | null | undefined): number | null {
  const p = prefix ? PREFIX[prefix] : 1;
  if (p === undefined) return null;
  const kind = KIND[type];
  if (kind === "length" && name === "METRE") return p;
  if (kind === "area" && name === "SQUARE_METRE") return p * p;
  if (kind === "volume" && name === "CUBIC_METRE") return p * p * p;
  if (kind === "mass" && name === "GRAM") return p / 1000;
  return null;
}

/** Project units → factors to metres, m², m³ and kg. Missing units are SI without prefix. */
export function unitScales(units: RawUnit[]): Scales {
  const out: Scales = { length: 1, area: 1, volume: 1, mass: 1 };
  for (const unit of units) {
    const kind = KIND[unit.type];
    if (!kind) continue;
    const scale = typeof unit.factor === "number" ? unit.factor : siScale(unit.type, unit.prefix, unit.name);
    if (scale !== null && Number.isFinite(scale) && scale > 0) out[kind] = scale;
  }
  return out;
}

/**
 * Height in the 3D scene of a placement. `world` is the placement's matrix in file units with Z
 * up; web-ifc turns the model to Y up and moves it near the origin with `coordination`. Both are
 * column-major 4x4 matrices.
 */
export function sceneY(world: number[], coordination: number[], lengthScale: number): number {
  const x = world[12] * lengthScale;
  const y = world[14] * lengthScale;
  const z = -world[13] * lengthScale;
  const c = coordination;
  return c[1] * x + c[5] * y + c[9] * z + c[13];
}

// ---------------------------------------------------------------------------- numbers

export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Level heights the way they are written on drawings: ±0,00 m, +3,00 m, -0,15 m. */
export function formatLevel(metres: number): string {
  if (Math.abs(metres) < 0.005) return "±0,00 m";
  return `${metres > 0 ? "+" : "-"}${formatNumber(Math.abs(metres))} m`;
}

export type Kind = "length" | "area" | "volume" | "mass" | "count" | "other";
const UNIT: Record<Kind, string> = { length: " m", area: " m²", volume: " m³", mass: " kg", count: "", other: "" };

export function formatMeasure(value: number, kind: Kind): string {
  if (kind === "count") return formatNumber(value, Number.isInteger(value) ? 0 : 2);
  if (kind === "other") return formatNumber(value, Number.isInteger(value) ? 0 : Math.abs(value) < 1 ? 4 : 2);
  return formatNumber(value) + UNIT[kind];
}

// ---------------------------------------------------------------------------- properties

export interface PropertyRow { name: string; label: string; value: string }
export interface PropertyGroup { name: string; quantities: boolean; rows: PropertyRow[] }
export interface Quantity { name: string; kind: Kind; value: number }

const LABELS: Record<string, string> = {
  IsExternal: "Es exterior", LoadBearing: "Portante", FireRating: "Resistencia al fuego", Reference: "Referencia",
  ThermalTransmittance: "Transmitancia térmica", AcousticRating: "Aislamiento acústico", Combustible: "Combustible",
  SurfaceSpreadOfFlame: "Propagación de llama", ExtendToStructure: "Llega a la estructura", Compartmentation: "Sectoriza incendios",
  Status: "Estado", Slope: "Pendiente", PitchAngle: "Inclinación", HandicapAccessible: "Accesible", FireExit: "Salida de emergencia",
  SelfClosing: "Cierre automático", SmokeStop: "Detiene el humo", GlazingAreaFraction: "Fracción acristalada", SecurityRating: "Seguridad",
  NumberOfRiser: "Contrahuellas", NumberOfTreads: "Huellas", RiserHeight: "Altura de contrahuella", TreadLength: "Longitud de huella",
  Span: "Luz", IsLandmarked: "Patrimonio", NetPlannedArea: "Área neta prevista", GrossPlannedArea: "Área bruta prevista",
  Length: "Longitud", Width: "Ancho", Height: "Altura", Depth: "Profundidad", Perimeter: "Perímetro", Thickness: "Espesor",
  GrossArea: "Área bruta", NetArea: "Área neta", GrossSideArea: "Área lateral bruta", NetSideArea: "Área lateral neta",
  GrossFootprintArea: "Área en planta bruta", NetFootprintArea: "Área en planta neta", GrossFloorArea: "Área de piso bruta",
  NetFloorArea: "Área de piso neta", GrossCeilingArea: "Área de techo bruta", NetCeilingArea: "Área de techo neta",
  GrossWallArea: "Área de muros bruta", NetWallArea: "Área de muros neta", CrossSectionArea: "Área de sección",
  OuterSurfaceArea: "Superficie exterior", GrossVolume: "Volumen bruto", NetVolume: "Volumen neto",
  GrossWeight: "Peso bruto", NetWeight: "Peso neto", GrossPerimeter: "Perímetro bruto", NetPerimeter: "Perímetro neto",
  FinishCeilingHeight: "Altura libre", FinishFloorHeight: "Altura del piso terminado",
};

/** Spanish name with the IFC name in parentheses, so the student learns the standard's terms. */
export function propertyLabel(name: string): string {
  return LABELS[name] ? `${LABELS[name]} (${name})` : name;
}

const MEASURE: Record<string, Kind> = {
  IFCLENGTHMEASURE: "length", IFCPOSITIVELENGTHMEASURE: "length", IFCNONNEGATIVELENGTHMEASURE: "length",
  IFCAREAMEASURE: "area", IFCVOLUMEMEASURE: "volume", IFCMASSMEASURE: "mass", IFCCOUNTMEASURE: "count",
};
const QUANTITY: [string, Kind][] = [
  ["LengthValue", "length"], ["AreaValue", "area"], ["VolumeValue", "volume"], ["WeightValue", "mass"], ["CountValue", "count"],
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** web-ifc wraps every value: strings in `value`, numbers in a `value` getter or `_representationValue`. */
function raw(v: unknown): unknown {
  if (!isObj(v)) return v;
  return v.value !== undefined ? v.value : v._representationValue;
}

/** Text of an IFC label, or "" when absent. Capped so a broken file cannot flood the panel. */
export function text(v: unknown): string {
  const r = raw(v);
  return typeof r === "string" ? r.trim().slice(0, 500) : typeof r === "number" ? String(r) : "";
}

function scaled(value: number, kind: Kind, scales: Scales): number {
  return kind === "length" ? value * scales.length : kind === "area" ? value * scales.area
    : kind === "volume" ? value * scales.volume : kind === "mass" ? value * scales.mass : value;
}

/** One IFC value as a student reads it: Sí/No, metres, plain text. */
export function valueText(v: unknown, scales: Scales): string {
  if (!isObj(v)) return "";
  const r = raw(v);
  const type = typeof v.name === "string" ? v.name.toUpperCase() : "";
  if (typeof r === "boolean") return r ? "Sí" : "No";
  if (type === "IFCBOOLEAN" || type === "IFCLOGICAL") {
    const s = String(r).replace(/\./g, "").toUpperCase();
    return s === "T" || s === "TRUE" ? "Sí" : s === "F" || s === "FALSE" ? "No" : "Desconocido";
  }
  if (typeof r === "number" && Number.isFinite(r)) {
    const kind = MEASURE[type] ?? "other";
    return formatMeasure(scaled(r, kind, scales), kind);
  }
  return typeof r === "string" ? r.trim().slice(0, 500) : "";
}

function propertyRows(props: unknown, scales: Scales, prefix = "", depth = 0): PropertyRow[] {
  if (!Array.isArray(props) || depth > 4) return [];
  const rows: PropertyRow[] = [];
  for (const p of props) {
    if (!isObj(p)) continue;
    const name = text(p.Name);
    if (!name) continue;
    const label = prefix + propertyLabel(name);
    let value = "";
    if (p.NominalValue !== undefined && p.NominalValue !== null) value = valueText(p.NominalValue, scales);
    else if (Array.isArray(p.EnumerationValues)) value = p.EnumerationValues.map((x) => valueText(x, scales)).filter(Boolean).join(", ");
    else if (Array.isArray(p.ListValues)) value = p.ListValues.map((x) => valueText(x, scales)).filter(Boolean).join(", ");
    else if (p.LowerBoundValue || p.UpperBoundValue) {
      value = [valueText(p.LowerBoundValue, scales), valueText(p.UpperBoundValue, scales)].filter(Boolean).join(" – ");
    } else if (Array.isArray(p.HasProperties)) {
      rows.push(...propertyRows(p.HasProperties, scales, `${prefix}${name} · `, depth + 1));
      continue;
    }
    if (value) rows.push({ name, label, value });
  }
  return rows;
}

/** Quantities of an IfcElementQuantity, converted to metres, m², m³ and kg. */
export function quantities(set: unknown, scales: Scales, depth = 0): Quantity[] {
  if (!isObj(set) || depth > 4) return [];
  const list = Array.isArray(set.Quantities) ? set.Quantities : Array.isArray(set.HasQuantities) ? set.HasQuantities : [];
  const out: Quantity[] = [];
  for (const q of list) {
    if (!isObj(q)) continue;
    if (Array.isArray(q.HasQuantities)) {
      out.push(...quantities(q, scales, depth + 1));
      continue;
    }
    const name = text(q.Name);
    const found = QUANTITY.find(([key]) => q[key] !== undefined && q[key] !== null);
    if (!name || !found) continue;
    const value = raw(q[found[0]]);
    if (typeof value === "number" && Number.isFinite(value)) out.push({ name, kind: found[1], value: scaled(value, found[1], scales) });
  }
  return out;
}

/** Property sets and quantity sets (as web-ifc returns them, resolved) → groups of rows. */
export function readGroups(sets: unknown[], scales: Scales, suffix = ""): PropertyGroup[] {
  const groups: PropertyGroup[] = [];
  for (const set of sets) {
    if (!isObj(set)) continue;
    const name = (text(set.Name) || "Propiedades") + suffix;
    if (Array.isArray(set.HasProperties)) {
      const rows = propertyRows(set.HasProperties, scales);
      if (rows.length) groups.push({ name, quantities: false, rows });
    } else if (Array.isArray(set.Quantities)) {
      const rows = quantities(set, scales).map((q) => ({ name: q.name, label: propertyLabel(q.name), value: formatMeasure(q.value, q.kind) }));
      if (rows.length) groups.push({ name, quantities: true, rows });
    }
  }
  return groups;
}

/** Material names from web-ifc's material associations: single, layer sets, lists, profiles. */
export function materialNames(found: unknown[]): string[] {
  const names = new Set<string>();
  const nested = ["Material", "Materials", "MaterialLayers", "MaterialConstituents", "MaterialProfiles", "ForLayerSet", "ForProfileSet"];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (!isObj(v)) return;
    const children = nested.filter((key) => v[key] !== undefined && v[key] !== null);
    if (children.length) return children.forEach((key) => visit(v[key], depth + 1));
    const name = text(v.Name);
    if (name) names.add(name);
  };
  visit(found, 0);
  return [...names];
}

export interface Amounts { length: number | null; area: number | null; volume: number | null }

const PREFERRED: Record<"length" | "area" | "volume", string[]> = {
  length: ["Length"],
  area: ["NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "NetFloorArea", "GrossFloorArea", "NetFootprintArea", "GrossFootprintArea", "CrossSectionArea", "OuterSurfaceArea"],
  volume: ["NetVolume", "GrossVolume"],
};

/** The length, area and volume a schedule shows for an element: net before gross. */
export function amounts(list: Quantity[]): Amounts {
  const pick = (kind: "length" | "area" | "volume"): number | null => {
    for (const name of PREFERRED[kind]) {
      const q = list.find((x) => x.kind === kind && x.name === name);
      if (q) return q.value;
    }
    return kind === "length" ? null : list.find((x) => x.kind === kind)?.value ?? null;
  };
  return { length: pick("length"), area: pick("area"), volume: pick("volume") };
}

// ---------------------------------------------------------------------------- elements

export interface BimElement { id: number; ifcClass: string; category: string; level: number; name: string; globalId: string }
export interface BimLevel { id: number; name: string; elevation: number; y: number }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Elements whose name, class, category, level or GlobalId contain every word of the query. */
export function search(elements: BimElement[], levels: BimLevel[], query: string, limit = 100): BimElement[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const levelName = new Map(levels.map((l) => [l.id, l.name]));
  const out: BimElement[] = [];
  for (const e of elements) {
    const haystack = fold(`${e.name} ${e.ifcClass} ${e.category} ${levelName.get(e.level) ?? ""} ${e.globalId}`);
    if (words.every((w) => haystack.includes(w))) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** A STEP physical file starts with ISO-10303-21 (after an optional byte order mark). */
export function looksLikeIfc(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 64)).replace(/^﻿|^ï»¿/, "").trimStart();
  return head.startsWith("ISO-10303-21");
}

// ---------------------------------------------------------------------------- schedule (CSV)

export { csv } from "../shared/csv";

// ---------------------------------------------------------------------------- saved view

export type Measure = [number, number, number, number, number, number];

export interface ViewState {
  hiddenLevels: number[];
  hiddenCategories: string[];
  /** Scene height (m) of the horizontal cut, or null without a cut. */
  section: number | null;
  selected: number | null;
  measures: Measure[];
}

export function defaultView(): ViewState {
  return { hiddenLevels: [], hiddenCategories: [...HIDDEN_BY_DEFAULT], section: null, selected: null, measures: [] };
}

const id = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 2 ** 31;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7;

/** A saved view, checked field by field: anything unexpected falls back to the default. */
export function parseView(value: unknown): ViewState {
  const view = defaultView();
  if (!isObj(value)) return view;
  if (Array.isArray(value.hiddenLevels)) view.hiddenLevels = [...new Set(value.hiddenLevels.filter(id))].slice(0, 10_000);
  if (Array.isArray(value.hiddenCategories)) {
    const known = new Set([...RULES.map(([label]) => label), "Otros"]);
    view.hiddenCategories = [...new Set(value.hiddenCategories.filter((c): c is string => typeof c === "string" && known.has(c)))];
  }
  if (finite(value.section)) view.section = value.section;
  if (id(value.selected) && value.selected > 0) view.selected = value.selected;
  if (Array.isArray(value.measures)) {
    view.measures = value.measures
      .filter((m): m is Measure => Array.isArray(m) && m.length === 6 && m.every(finite))
      .slice(0, MAX_MEASURES);
  }
  return view;
}

export function distance(m: Measure): number {
  return Math.hypot(m[3] - m[0], m[4] - m[1], m[5] - m[2]);
}

export function addMeasure(list: Measure[], m: Measure): Measure[] {
  return [...list, m].slice(-MAX_MEASURES);
}
