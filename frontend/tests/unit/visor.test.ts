import { describe, expect, it } from "vitest";
import { entityBounds, frameSvg } from "../../apps/visor/cad-bounds";
import { renameTo, targetsFor } from "../../apps/visor/convert";
import { detect, extension } from "../../apps/visor/detect";
import { transformVertices } from "../../apps/visor/ifc";
import { listLayers } from "../../apps/visor/psd";
import { largestPreview, readJpeg } from "../../apps/visor/raw";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const chunks = parts.map((p) => (typeof p === "string" ? enc(p) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return out;
};

/** Smallest structurally valid JPG: SOI, APP0, SOF0 with the given size, SOS, data, EOI. */
function jpeg(width: number, height: number, data: number[] = [0x12, 0x34, 0xff, 0x00, 0x56]): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46],
    [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00],
    [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
    data,
    [0xff, 0xd9],
  );
}

describe("Visor format detection", () => {
  it("trusts content over the extension", () => {
    expect(detect("foto.pdf", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toMatchObject({ kind: "image", label: "PNG" });
    expect(detect("plano.png", enc("AC1032\0\0\0"))).toMatchObject({ kind: "dwg", label: "DWG 2018" });
    expect(detect("x", bytes([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ kind: "image", subtype: "image/jpeg" });
    expect(detect("a.webp", enc("RIFF\0\0\0\0WEBPVP8 "))).toMatchObject({ kind: "image", label: "WebP" });
    expect(detect("a.avif", bytes([0, 0, 0, 0x1c], "ftypavif"))).toMatchObject({ kind: "image", label: "AVIF" });
    expect(detect("a.gif", enc("GIF89a"))).toMatchObject({ kind: "image", label: "GIF" });
  });

  it("names every DWG version the reader supports and refuses the others honestly", () => {
    for (const [code, name] of [["AC1015", "2000"], ["AC1018", "2004"], ["AC1024", "2010"], ["AC1027", "2013"]]) {
      expect(detect("p.dwg", enc(code)).label).toBe(`DWG ${name}`);
    }
    const old = detect("p.dwg", enc("AC1009"));
    expect(old.kind).toBe("unsupported");
    expect(old.note).toMatch(/DXF/);
  });

  it("tells PDF-compatible AI files from old ones", () => {
    expect(detect("logo.ai", enc("%PDF-1.6"))).toMatchObject({ kind: "pdf", label: "AI (copia PDF)" });
    expect(detect("logo.ai", enc("%!PS-3.0 EPSF-3.0"))).toMatchObject({ kind: "unsupported" });
    expect(detect("doc.pdf", enc("%PDF-1.7"))).toMatchObject({ kind: "pdf", label: "PDF" });
  });

  it("recognises CAD text, building models and STEP files", () => {
    expect(detect("p.dxf", enc("  0\r\nSECTION\r\n  2\r\nHEADER"))).toMatchObject({ kind: "dxf" });
    expect(detect("p.txt", enc("999\nLibreDWG\n  0\nSECTION"))).toMatchObject({ kind: "dxf" });
    expect(detect("p.dxf", enc("VENDOR__Binary DXF\r\n\x1a\0"))).toMatchObject({ kind: "unsupported" });
    expect(detect("m.ifc", enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));"))).toMatchObject({ kind: "ifc" });
    expect(detect("m.step", enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));"))).toMatchObject({ kind: "unsupported", label: "STEP" });
  });

  it("recognises 3D formats, including binary STL by its exact length", () => {
    const stl = new Uint8Array(84 + 2 * 50);
    new DataView(stl.buffer).setUint32(80, 2, true);
    expect(detect("pieza.bin", stl, stl.length)).toMatchObject({ kind: "mesh", subtype: "stl" });
    expect(detect("pieza.bin", stl, stl.length + 1).kind).toBe("unsupported");
    expect(detect("p.stl", enc("solid cubo\n facet normal 0 0 1"))).toMatchObject({ subtype: "stl" });
    expect(detect("p.obj", enc("# hecho a mano\nv 0 0 0\nv 1 0 0\nf 1 2 3"))).toMatchObject({ subtype: "obj" });
    expect(detect("p.glb", enc("glTF\x02\0\0\0"))).toMatchObject({ subtype: "glb" });
    expect(detect("p.gltf", enc('{"asset":{"version":"2.0"}}'))).toMatchObject({ subtype: "gltf" });
    expect(detect("p.ply", enc("ply\nformat ascii 1.0"))).toMatchObject({ subtype: "ply" });
    expect(detect("p.3mf", bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ subtype: "3mf" });
    expect(detect("p.zip", bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ kind: "unsupported", label: "ZIP" });
  });

  it("finds SVG after declarations and comments, and PSD/PSB", () => {
    expect(detect("a.svg", enc('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg">'))).toMatchObject({ kind: "svg" });
    expect(detect("a.txt", enc("<svg>"))).toMatchObject({ kind: "svg" });
    expect(detect("a.psd", bytes("8BPS", [0, 1]))).toMatchObject({ kind: "psd", label: "PSD" });
    expect(detect("a.psb", bytes("8BPS", [0, 2]))).toMatchObject({ kind: "psd", label: "PSB" });
  });

  it("opens camera RAW by extension and TIFF signature only", () => {
    expect(detect("IMG_1.CR2", enc("II*\0"))).toMatchObject({ kind: "raw", label: "RAW (CR2)" });
    expect(detect("foto.nef", enc("MM\0*"))).toMatchObject({ kind: "raw" });
    expect(detect("foto.raf", enc("FUJIFILMCCD-RAW"))).toMatchObject({ kind: "raw" });
    expect(detect("foto.cr3", bytes([0, 0, 0, 0x18], "ftypcrx "))).toMatchObject({ kind: "raw" });
    expect(detect("foto.nef", enc("hola")).kind).toBe("unsupported");
  });

  it("explains closed formats with what to ask for instead, without brand names", () => {
    for (const ext of ["skp", "indd", "rvt"]) {
      const d = detect(`archivo.${ext}`, enc("\0\0\0\0"));
      expect(d.kind).toBe("unsupported");
      expect(d.note).toMatch(/Pide/);
    }
    expect(detect("nada", enc("hola")).note).toMatch(/DWG, DXF, PDF/);
    expect(extension("A.B.DWG")).toBe("dwg");
    expect(extension("sin")).toBe("");
  });
});

describe("RAW preview", () => {
  it("reads a JPG's size and end", () => {
    const j = jpeg(640, 480);
    expect(readJpeg(j, 0)).toEqual({ start: 0, end: j.length, width: 640, height: 480 });
  });

  it("rejects stray FF D8 bytes and truncated images", () => {
    expect(readJpeg(bytes([0xff, 0xd8, 0x00, 0x11]), 0)).toBeNull();
    const j = jpeg(10, 10);
    expect(readJpeg(j.subarray(0, j.length - 2), 0)).toBeNull();
    expect(readJpeg(bytes([0xff, 0xd8, 0xff, 0xd9]), 0)).toBeNull();
  });

  it("picks the largest preview among several, skipping sensor noise", () => {
    const small = jpeg(160, 120);
    const big = jpeg(6000, 4000, [1, 2, 3, 0xff, 0xd0, 4, 5]);
    const file = bytes("II*\0", [0xff, 0xd8, 0xff, 0x00, 0x01], small, [9, 9, 9], big, [0xff, 0xd8, 0xff]);
    const p = largestPreview(file)!;
    expect([p.width, p.height]).toEqual([6000, 4000]);
    expect(file.subarray(p.start, p.end)).toEqual(big);
    expect(largestPreview(enc("II*\0 sin vista previa"))).toBeNull();
  });
});

describe("DWG framing", () => {
  it("ignores infinite construction lines and includes radii", () => {
    const b = entityBounds([
      { type: "LINE", startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 50 } },
      { type: "XLINE", basePoint: { x: -1e9, y: 0 }, startPoint: { x: -1e9, y: -1e9 } },
      { type: "RAY", startPoint: { x: 1e9, y: 1e9 } },
      { type: "CIRCLE", center: { x: 200, y: 0 }, radius: 10 },
      { type: "ELLIPSE", center: { x: 0, y: 100 }, majorAxisEndPoint: { x: 3, y: 4 } },
      { type: "LWPOLYLINE", vertices: [{ x: -5, y: -5 }, { x: Number.NaN, y: 0 }] },
    ]);
    expect(b).toEqual({ minX: -5, minY: -10, maxX: 210, maxY: 105 });
    expect(entityBounds([{ type: "XLINE" }])).toBeNull();
  });

  it("rewrites only the root viewBox and gives the image a pixel size", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1e9 -1e9 2e9 2e9" width="100%" height="100%"><svg viewBox="0 0 1 1" width="5"/></svg>';
    const out = frameSvg(svg, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, 0);
    expect(out).toContain('viewBox="0 -50 100 50" width="2000" height="1000"');
    expect(out).toContain('<svg viewBox="0 0 1 1" width="5"/>');
    expect(frameSvg(svg, null)).toBe(svg);
  });
});

describe("Visor conversions", () => {
  it("offers only conversions that each format supports", () => {
    expect(targetsFor("dwg").map((t) => t.value)).toEqual(["dxf", "svg", "png"]);
    expect(targetsFor("raw")[0].value).toBe("jpg");
    expect(targetsFor("ifc").map((t) => t.value)).toContain("glb");
    expect(targetsFor("unsupported")).toEqual([]);
    for (const kind of ["image", "svg", "pdf", "psd", "dxf", "mesh"] as const) expect(targetsFor(kind).length).toBeGreaterThan(0);
  });

  it("names downloads after the original, without characters a disk rejects", () => {
    expect(renameTo("Planta baja.dwg", "dxf")).toBe("Planta baja.dxf");
    expect(renameTo("informe.final.pdf", "png", "-p2")).toBe("informe.final-p2.png");
    expect(renameTo('a<b>:"c".psd', "png")).toBe("a_b_c_.png");
    expect(renameTo("", "png")).toBe("archivo.png");
  });
});

describe("IFC geometry", () => {
  it("applies the placement matrix to positions and normals", () => {
    // Column-major: translate (10, 20, 30) and rotate 90° about Z.
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    const { positions, normals } = transformVertices(Float32Array.from([1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1]), m);
    expect(Array.from(positions)).toEqual([10, 21, 30, 8, 20, 30]);
    expect(Array.from(normals)).toEqual([0, 1, 0, 0, 0, 1]);
  });
});

describe("PSD layers", () => {
  it("lists layers top to bottom with nesting and visibility", () => {
    const layers = listLayers([
      { name: "Fondo" },
      { name: "Grupo", children: [{ name: "Sombra", hidden: true }, { name: "Texto" }] },
    ]);
    expect(layers).toEqual([
      { name: "Grupo", visible: true, depth: 0 },
      { name: "Texto", visible: true, depth: 1 },
      { name: "Sombra", visible: false, depth: 1 },
      { name: "Fondo", visible: true, depth: 0 },
    ]);
  });
});
