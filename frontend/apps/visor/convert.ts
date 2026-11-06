import type { Kind } from "./detect";

export type Target = "png" | "jpg" | "webp" | "svg" | "dxf" | "stl" | "obj" | "glb";

export interface Option { value: Target; label: string }

const PNG: Option = { value: "png", label: "PNG (imagen)" };
const JPG: Option = { value: "jpg", label: "JPG (foto, más liviano)" };
const WEBP: Option = { value: "webp", label: "WebP (web)" };
const MESH: Option[] = [
  { value: "glb", label: "GLB (3D en un solo archivo)" },
  { value: "obj", label: "OBJ (3D, muy compatible)" },
  { value: "stl", label: "STL (impresión 3D)" },
  { value: "png", label: "PNG (captura de la vista)" },
];

/** What each kind of file can be turned into, always in the student's own computer. */
export function targetsFor(kind: Kind): Option[] {
  switch (kind) {
    case "image": return [PNG, JPG, WEBP];
    case "svg": return [PNG];
    case "pdf": return [{ value: "png", label: "PNG (página actual)" }];
    case "psd": return [PNG, JPG, WEBP];
    case "raw": return [{ value: "jpg", label: "JPG (vista previa, sin pérdida extra)" }, PNG];
    case "dxf": return [{ value: "svg", label: "SVG (vectorial)" }, PNG];
    case "dwg": return [{ value: "dxf", label: "DXF (para editar en Plano)" }, { value: "svg", label: "SVG (vectorial)" }, PNG];
    case "mesh": return MESH;
    case "ifc": return MESH;
    default: return [];
  }
}

export function renameTo(name: string, target: Target, suffix = ""): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name || "archivo").replace(/[\\/:*?"<>|]+/g, "_");
  return `${base}${suffix}.${target}`;
}

export function mimeOf(target: Target): string {
  return ({ png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", dxf: "application/dxf" } as Record<string, string>)[target] ?? "application/octet-stream";
}
