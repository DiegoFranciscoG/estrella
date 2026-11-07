/**
 * Opens an IFC building model with web-ifc (MPL-2.0, unmodified) and keeps it open, so properties
 * are read when the student selects an element instead of all at once. Single-threaded: threads
 * would need cross-origin isolation headers that the embedded programs do not have.
 */
import * as WebIFC from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { transformVertices } from "../visor/ifc";
import {
  amounts, categoryOf, materialNames, NO_LEVEL, quantities, readGroups, sceneY, siScale, text, unitScales,
  type BimElement, type BimLevel, type PropertyGroup, type PropertyRow, type Quantity, type RawUnit, type Scales,
} from "./model";

export interface BimPart {
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
}

export interface Details {
  attributes: PropertyRow[];
  typeName: string;
  materials: string[];
  groups: PropertyGroup[];
}

export interface OpenedModel {
  schema: string;
  scales: Scales;
  parts: BimPart[];
  elements: BimElement[];
  levels: BimLevel[];
  /** Scene height of the building's ±0,00. */
  baseY: number;
  details(id: number): Promise<Details>;
  /** One row per element: level, category, class, name, GlobalId, length, area, volume. */
  schedule(ids: number[]): (string | number | null)[][];
  close(): void;
}

interface SpatialNode { expressID: number; type: string; children?: SpatialNode[] }
type Line = Record<string, unknown> & { ObjectPlacement?: { value?: number } | null };

let api: WebIFC.IfcAPI | null = null;

async function ready(): Promise<WebIFC.IfcAPI> {
  if (!api) {
    const fresh = new WebIFC.IfcAPI();
    await fresh.Init(() => wasmUrl, true);
    api = fresh;
  }
  return api;
}

const refs = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).map((r) => (r && typeof r === "object" ? (r as { value?: unknown }).value : undefined))
    .filter((n): n is number => Number.isInteger(n));

export async function openIfc(bytes: Uint8Array): Promise<OpenedModel> {
  const ifc = await ready();
  const model = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (model < 0) throw new Error("ifc");
  try {
    return await read(ifc, model);
  } catch (error) {
    ifc.CloseModel(model);
    throw error;
  }
}

async function read(ifc: WebIFC.IfcAPI, model: number): Promise<OpenedModel> {
  const line = (id: number, recursive = false): Line => ifc.GetLine(model, id, recursive) as Line;
  const className = (id: number): string => ifc.GetNameFromTypeCode(ifc.GetLineType(model, id)) || "IfcProduct";

  const parts: BimPart[] = [];
  const ids = new Set<number>();
  ifc.StreamAllMeshes(model, (mesh) => {
    const placed = mesh.geometries;
    for (let i = 0; i < placed.size(); i++) {
      const pg = placed.get(i);
      const geometry = ifc.GetGeometry(model, pg.geometryExpressID);
      const vertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      const { positions, normals } = transformVertices(vertices, pg.flatTransformation);
      parts.push({ id: mesh.expressID, positions, normals, indices: new Uint32Array(indices), color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w] });
      geometry.delete();
    }
    ids.add(mesh.expressID);
  });

  const scales = readUnits(ifc, model);
  const coordination = ifc.GetCoordinationMatrix(model);
  const placementY = (id: number): number | null => {
    const placement = line(id).ObjectPlacement?.value;
    if (!Number.isInteger(placement)) return null;
    try {
      return sceneY(ifc.GetWorldTransformMatrix(model, placement!), coordination, scales.length);
    } catch {
      return null;
    }
  };

  // Spatial structure: which storey holds each element (directly or as part of an aggregate).
  const levelOf = new Map<number, number>();
  const storeys: { id: number; y: number | null; elevation: number | null; name: string }[] = [];
  let baseY: number | null = null;
  const walk = (node: SpatialNode, level: number, depth: number) => {
    if (depth > 64) return;
    const type = node.type.toUpperCase();
    if (type === "IFCBUILDING" && baseY === null) baseY = placementY(node.expressID);
    if (type === "IFCBUILDINGSTOREY") {
      level = node.expressID;
      const storey = line(node.expressID);
      const elevation = (storey.Elevation as { value?: unknown } | null)?.value;
      storeys.push({
        id: node.expressID,
        y: placementY(node.expressID),
        elevation: typeof elevation === "number" && Number.isFinite(elevation) ? elevation * scales.length : null,
        name: text(storey.Name) || text(storey.LongName) || `Nivel ${storeys.length + 1}`,
      });
    }
    if (!levelOf.has(node.expressID)) levelOf.set(node.expressID, level);
    for (const child of node.children ?? []) walk(child, level, depth + 1);
  };
  try {
    walk((await ifc.properties.getSpatialStructure(model)) as SpatialNode, NO_LEVEL, 0);
  } catch {
    // A model without a project tree still shows its geometry, under "Sin nivel".
  }
  const base = baseY ?? 0;
  const levels: BimLevel[] = storeys
    .map((s) => {
      const y = s.y ?? base + (s.elevation ?? 0);
      return { id: s.id, name: s.name, elevation: s.elevation ?? y - base, y };
    })
    .sort((a, b) => a.elevation - b.elevation);

  const elements: BimElement[] = [...ids].map((id) => {
    const l = line(id);
    const ifcClass = className(id);
    return { id, ifcClass, category: categoryOf(ifcClass), level: levelOf.get(id) ?? NO_LEVEL, name: text(l.Name) || `${ifcClass} #${id}`, globalId: text(l.GlobalId) };
  });
  const byId = new Map(elements.map((e) => [e.id, e]));
  const levelName = (id: number) => levels.find((l) => l.id === id)?.name ?? "Sin nivel";

  let quantityIndex: Map<number, Quantity[]> | null = null;
  const quantitiesOf = (): Map<number, Quantity[]> => {
    if (quantityIndex) return quantityIndex;
    quantityIndex = new Map();
    const rels = ifc.GetLineIDsWithType(model, WebIFC.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < rels.size(); i++) {
      const rel = line(rels.get(i));
      for (const def of refs(rel.RelatingPropertyDefinition)) {
        if (ifc.GetLineType(model, def) !== WebIFC.IFCELEMENTQUANTITY) continue;
        const found = quantities(line(def, true), scales);
        for (const target of refs(rel.RelatedObjects)) quantityIndex.set(target, [...(quantityIndex.get(target) ?? []), ...found]);
      }
    }
    return quantityIndex;
  };

  return {
    schema: ifc.GetModelSchema(model),
    scales,
    parts,
    elements,
    levels,
    baseY: base,
    async details(id) {
      const element = byId.get(id);
      const l = line(id);
      const attributes: PropertyRow[] = [
        ["Clase IFC", element?.ifcClass ?? className(id)],
        ["Categoría", element?.category ?? ""],
        ["Nivel", levelName(element?.level ?? NO_LEVEL)],
        ["GlobalId", text(l.GlobalId)],
        ["Tipo predefinido", text(l.PredefinedType).replace(/^NOTDEFINED$/, "")],
        ["Tipo de objeto", text(l.ObjectType)],
        ["Marca", text(l.Tag)],
        ["Descripción", text(l.Description)],
        ["Nombre largo", text(l.LongName)],
      ].filter(([, value]) => value).map(([name, value]) => ({ name, label: name, value }));
      const safe = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await work();
        } catch {
          return fallback;
        }
      };
      const [own, fromType, types, materials, typeMaterials] = await Promise.all([
        safe(() => ifc.properties.getPropertySets(model, id, true), []),
        safe(() => ifc.properties.getPropertySets(model, id, true, true), []),
        safe(() => ifc.properties.getTypeProperties(model, id, false), []),
        safe(() => ifc.properties.getMaterialsProperties(model, id, true), []),
        safe(() => ifc.properties.getMaterialsProperties(model, id, true, true), []),
      ]);
      return {
        attributes,
        typeName: types.map((t) => text((t as Line).Name)).find(Boolean) ?? "",
        materials: materialNames([...materials, ...typeMaterials]),
        groups: [...readGroups(own, scales), ...readGroups(fromType, scales, " (tipo)")],
      };
    },
    schedule(list) {
      const index = quantitiesOf();
      const header = ["Nivel", "Categoría", "Clase IFC", "Nombre", "GlobalId", "Longitud (m)", "Área (m²)", "Volumen (m³)"];
      const order = new Map(levels.map((l, i) => [l.id, i]));
      const rows = list
        .map((id) => byId.get(id))
        .filter((e): e is BimElement => !!e)
        .sort((a, b) => (order.get(a.level) ?? 1e9) - (order.get(b.level) ?? 1e9) || a.category.localeCompare(b.category, "es") || a.name.localeCompare(b.name, "es"))
        .map((e) => {
          const a = amounts(index.get(e.id) ?? []);
          return [levelName(e.level), e.category, e.ifcClass, e.name, e.globalId, a.length, a.area, a.volume];
        });
      return [header, ...rows];
    },
    close() {
      ifc.CloseModel(model);
    },
  };
}

/** Length, area, volume and mass units of the project (IfcProject.UnitsInContext). */
function readUnits(ifc: WebIFC.IfcAPI, model: number): Scales {
  try {
    const projects = ifc.GetLineIDsWithType(model, WebIFC.IFCPROJECT);
    if (!projects.size()) return unitScales([]);
    const project = ifc.GetLine(model, projects.get(0), true) as { UnitsInContext?: { Units?: unknown[] } };
    const units: RawUnit[] = [];
    for (const u of project.UnitsInContext?.Units ?? []) {
      const unit = u as Record<string, { value?: unknown } | null | undefined> & { ConversionFactor?: Record<string, unknown> };
      const type = String(unit.UnitType?.value ?? "");
      const factor = unit.ConversionFactor as { ValueComponent?: { value?: unknown }; UnitComponent?: Record<string, { value?: unknown } | null> } | undefined;
      if (factor) {
        const value = factor.ValueComponent?.value;
        const base = factor.UnitComponent ? siScale(String(factor.UnitComponent.UnitType?.value ?? type), factor.UnitComponent.Prefix?.value as string | undefined, factor.UnitComponent.Name?.value as string | undefined) : 1;
        if (typeof value === "number" && base !== null) units.push({ type, factor: value * base });
      } else {
        units.push({ type, prefix: (unit.Prefix?.value as string | undefined) ?? null, name: (unit.Name?.value as string | undefined) ?? null });
      }
    }
    return unitScales(units);
  } catch {
    return unitScales([]);
  }
}
