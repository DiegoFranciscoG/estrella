/**
 * IFC reader (web-ifc, MPL-2.0, unmodified). Turns the building model into triangles for the 3D
 * viewer and counts the main building elements, which is what a student checks first.
 * It runs single-threaded: threads would need cross-origin isolation headers that the embedded
 * editors do not support.
 */
import * as WebIFC from "web-ifc";
import wasmUrl from "web-ifc/web-ifc.wasm?url";

export interface IfcPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
}

export interface IfcResult {
  schema: string;
  parts: IfcPart[];
  counts: { label: string; count: number }[];
}

const ELEMENTS: [string, number[]][] = [
  ["Muros", [WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE]],
  ["Losas", [WebIFC.IFCSLAB]],
  ["Columnas", [WebIFC.IFCCOLUMN]],
  ["Vigas", [WebIFC.IFCBEAM]],
  ["Puertas", [WebIFC.IFCDOOR]],
  ["Ventanas", [WebIFC.IFCWINDOW]],
  ["Escaleras", [WebIFC.IFCSTAIR]],
  ["Cubiertas", [WebIFC.IFCROOF]],
  ["Espacios", [WebIFC.IFCSPACE]],
];

/** Applies a column-major 4x4 matrix to interleaved position+normal data. */
export function transformVertices(data: Float32Array, m: number[]): { positions: Float32Array; normals: Float32Array } {
  const count = data.length / 6;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z, nx, ny, nz] = data.subarray(i * 6, i * 6 + 6);
    positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    normals[i * 3] = m[0] * nx + m[4] * ny + m[8] * nz;
    normals[i * 3 + 1] = m[1] * nx + m[5] * ny + m[9] * nz;
    normals[i * 3 + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
  }
  return { positions, normals };
}

let api: WebIFC.IfcAPI | null = null;

export async function readIfc(bytes: Uint8Array): Promise<IfcResult> {
  if (!api) {
    const fresh = new WebIFC.IfcAPI();
    await fresh.Init(() => wasmUrl, true);
    api = fresh;
  }
  const ifc = api;
  const id = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (id < 0) throw new Error("ifc");
  try {
    const parts: IfcPart[] = [];
    ifc.StreamAllMeshes(id, (mesh) => {
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const geometry = ifc.GetGeometry(id, pg.geometryExpressID);
        const vertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const { positions, normals } = transformVertices(vertices, pg.flatTransformation);
        parts.push({ positions, normals, indices: new Uint32Array(indices), color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w] });
        geometry.delete();
      }
    });
    const counts = ELEMENTS
      .map(([label, types]) => ({ label, count: types.reduce((n, t) => n + ifc.GetLineIDsWithType(id, t).size(), 0) }))
      .filter((c) => c.count > 0);
    return { schema: ifc.GetModelSchema(id), parts, counts };
  } finally {
    ifc.CloseModel(id);
  }
}
