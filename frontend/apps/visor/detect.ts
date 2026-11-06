/**
 * Decides how Visor opens a file. The content decides first (magic bytes); the extension only
 * breaks ties or names formats that have no reliable signature. A renamed file therefore opens
 * with the right reader, and a file that only pretends to be something is refused.
 */

export type Kind = "image" | "svg" | "pdf" | "psd" | "dxf" | "dwg" | "raw" | "mesh" | "ifc" | "unsupported";

export interface Detected {
  kind: Kind;
  /** Short label shown to the student, e.g. "DWG 2018". */
  label: string;
  /** For meshes: which loader to use. For images: the MIME type. */
  subtype?: string;
  /** Honest explanation for unsupported or partially supported files. */
  note?: string;
}

/** Larger files are refused before reading: a 4 GB school computer would run out of memory. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

const DWG_VERSIONS: Record<string, string> = {
  AC1012: "R13", AC1014: "R14", AC1015: "2000", AC1018: "2004", AC1021: "2007",
  AC1024: "2010", AC1027: "2013", AC1032: "2018",
};

const RAW_EXT = new Set(["cr2", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "rw2", "pef", "srw", "raf", "erf", "kdc", "3fr", "mrw", "x3f", "cr3"]);

/** Formats students receive that no free web reader opens; each says what to ask for instead. */
const KNOWN_UNSUPPORTED: Record<string, string> = {
  skp: "Los archivos .skp usan un formato cerrado sin lector libre para la web. Pide a quien te lo mandó que lo exporte como OBJ, STL, glTF o IFC; Visor abre todos esos.",
  indd: "Los archivos .indd usan un formato cerrado sin lector libre. Pide un PDF (para ver o imprimir) o un IDML (para editar en Scribus, en escritorio).",
  idml: "IDML es un paquete de maquetación editable. Visor todavía no lo muestra; ábrelo en Scribus (escritorio) o pide un PDF.",
  rvt: "Los archivos .rvt usan un formato cerrado. Pide una exportación IFC: Visor la abre y muestra sus muros, losas, puertas y ventanas.",
  "3dm": "El formato .3dm todavía no se abre en Visor. Pide una exportación OBJ, STL o glTF.",
  max: "Los archivos .max usan un formato cerrado. Pide una exportación OBJ, FBX convertido a glTF, o STL.",
  blend: "Los archivos .blend se abren en Blender (escritorio, gratis). Para verlos aquí, exporta a glTF (.glb).",
  fbx: "FBX todavía no se abre en Visor. Exporta a glTF (.glb) u OBJ desde el programa de origen.",
  prproj: "Los proyectos de video guardan referencias a otros archivos, no el video. Pide el video final en MP4.",
  xd: "Los archivos .xd usan un formato cerrado. Pide un PDF o SVG.",
  tif: "Visor todavía no decodifica TIFF. Si es una foto, pide JPG o PNG; si es una foto RAW, cambia su extensión a la original de la cámara.",
  tiff: "Visor todavía no decodifica TIFF. Si es una foto, pide JPG o PNG; si es una foto RAW, cambia su extensión a la original de la cámara.",
  heic: "HEIC solo se abre en algunos navegadores. Pide JPG o, en el teléfono, comparte la foto como \"más compatible\".",
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = "";
  for (let i = start; i < Math.min(bytes.length, start + length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

export function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A binary STL has no signature, only an exact length: 80-byte header, count, 50 bytes per triangle. */
function isBinaryStl(head: Uint8Array, size: number): boolean {
  if (head.length < 84) return false;
  const triangles = new DataView(head.buffer, head.byteOffset + 80, 4).getUint32(0, true);
  return triangles > 0 && 84 + triangles * 50 === size;
}

/** `head` is the start of the file (a few KB is enough); `size` its full length. */
export function detect(name: string, head: Uint8Array, size = head.length): Detected {
  const ext = extension(name);
  const text = ascii(head, 0, 4096);
  const trimmed = text.replace(/^﻿/, "").trimStart();

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", label: "PNG", subtype: "image/png" };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "image", label: "JPG", subtype: "image/jpeg" };
  if (text.startsWith("GIF8")) return { kind: "image", label: "GIF", subtype: "image/gif" };
  if (text.startsWith("RIFF") && ascii(head, 8, 4) === "WEBP") return { kind: "image", label: "WebP", subtype: "image/webp" };
  if (text.startsWith("BM") && ["bmp", "dib"].includes(ext)) return { kind: "image", label: "BMP", subtype: "image/bmp" };
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (brand === "avif" || brand === "avis") return { kind: "image", label: "AVIF", subtype: "image/avif" };
    if (brand === "crx ") return { kind: "raw", label: "RAW (CR3)" };
  }

  if (text.startsWith("%PDF")) {
    return ext === "ai"
      ? { kind: "pdf", label: "AI (copia PDF)", note: "Se muestra la copia PDF que guarda el archivo. Las capas y los efectos editables no se ven." }
      : { kind: "pdf", label: "PDF" };
  }
  if (text.startsWith("%!PS")) {
    return ext === "ai"
      ? { kind: "unsupported", label: "AI antiguo", note: "Este archivo .ai se guardó sin copia PDF, así que ningún lector libre lo muestra bien. Pide que lo guarden \"con compatibilidad PDF\", o que lo exporten como PDF o SVG." }
      : { kind: "unsupported", label: "PostScript", note: "Visor no interpreta PostScript. Conviértelo a PDF (por ejemplo con Ghostscript, en escritorio) o pide un PDF." };
  }

  if (text.startsWith("8BPS")) {
    const version = head[5];
    return version === 2
      ? { kind: "psd", label: "PSB", note: "Los PSB son documentos muy grandes; en un equipo modesto pueden no caber en memoria." }
      : { kind: "psd", label: "PSD" };
  }

  if (/^AC1\d{3}/.test(text)) {
    const code = text.slice(0, 6);
    const version = DWG_VERSIONS[code];
    if (version) return { kind: "dwg", label: `DWG ${version}` };
    return { kind: "unsupported", label: `DWG (${code})`, note: "Es una versión de DWG muy antigua o muy nueva que el lector libre no reconoce. Pide que lo guarden como DXF o como DWG 2018." };
  }
  // Binary DXF starts with an 8-character vendor word followed by this fixed sentinel.
  if (text.startsWith("Binary DXF\r\n\x1a\0", 8)) {
    return { kind: "unsupported", label: "DXF binario", note: "Visor lee DXF de texto. Pide que lo guarden como DXF ASCII." };
  }
  if (/^0\s*\r?\n\s*SECTION/.test(trimmed) || /^999\s*\r?\n/.test(trimmed) || (ext === "dxf" && /\bSECTION\b/.test(text))) {
    return { kind: "dxf", label: "DXF" };
  }

  if (text.startsWith("ISO-10303-21")) {
    if (/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(text)) return { kind: "ifc", label: "IFC" };
    return { kind: "unsupported", label: "STEP", note: "Es un modelo STEP de CAD mecánico, no un IFC de edificio. Ábrelo en FreeCAD (escritorio, gratis) o pide un STL u OBJ." };
  }

  if (text.startsWith("glTF")) return { kind: "mesh", label: "GLB", subtype: "glb" };
  if (text.startsWith("ply")) return { kind: "mesh", label: "PLY", subtype: "ply" };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "3mf") return { kind: "mesh", label: "3MF", subtype: "3mf" };
    if (ext in KNOWN_UNSUPPORTED) return { kind: "unsupported", label: ext.toUpperCase(), note: KNOWN_UNSUPPORTED[ext] };
    return { kind: "unsupported", label: "ZIP", note: "Es un archivo comprimido. Descomprímelo y abre aquí el archivo que contiene." };
  }
  if (isBinaryStl(head, size) || (ext === "stl" && /^solid\b/.test(trimmed))) return { kind: "mesh", label: "STL", subtype: "stl" };
  if (ext === "gltf" && trimmed.startsWith("{")) {
    return { kind: "mesh", label: "glTF", subtype: "gltf", note: "Si el modelo usa archivos aparte (.bin o texturas), no se pueden leer: pide la versión .glb, que va en un solo archivo." };
  }
  if (ext === "obj" && /^(#|v |vn |vt |o |g |mtllib |f )/m.test(text)) {
    return { kind: "mesh", label: "OBJ", subtype: "obj", note: "Los materiales de un .mtl aparte no se cargan; el modelo se ve en gris." };
  }

  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(trimmed) || (ext === "svg" && /<svg[\s>]/i.test(text))) {
    return { kind: "svg", label: "SVG" };
  }

  if (RAW_EXT.has(ext) && (startsWith(head, [0x49, 0x49]) || startsWith(head, [0x4d, 0x4d]) || text.startsWith("FUJIFILM") || ext === "x3f")) {
    return { kind: "raw", label: `RAW (${ext.toUpperCase()})`, note: "Se muestra la vista previa JPG que la cámara guarda dentro del archivo, no un revelado del sensor." };
  }

  if (ext in KNOWN_UNSUPPORTED) return { kind: "unsupported", label: ext.toUpperCase(), note: KNOWN_UNSUPPORTED[ext] };
  return {
    kind: "unsupported",
    label: ext ? ext.toUpperCase() : "Desconocido",
    note: "Visor no reconoce este archivo. Abre DWG, DXF, PDF, PSD, SVG, PNG, JPG, WebP, GIF, AVIF, RAW de cámara, OBJ, STL, 3MF, PLY, glTF/GLB e IFC.",
  };
}
