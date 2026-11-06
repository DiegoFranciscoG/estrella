import { expect, FrameLocator, Page, test } from "@playwright/test";
import { writePsdBuffer } from "ag-psd";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { toDxf } from "../../apps/plano/dxf";
import { emptyDrawing } from "../../apps/plano/model";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/**
 * T-07: every file is one made here by the test itself (or, for DWG, a sample the tester points
 * to), so no third-party file is redistributed. Each one is opened through the real panel, and no
 * request may leave the student's computer with its content.
 */

useAccount();

const IFC = readFileSync(new URL("../fixtures/muro-y-losa.ifc", import.meta.url));
const DWG_SAMPLE = process.env.E2E_DWG_SAMPLE;

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB.
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set([x * 4, y * 4, 128], y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function psd(): Buffer {
  const fill = (w: number, h: number, rgba: number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
    return { width: w, height: h, data };
  };
  return writePsdBuffer({
    width: 64, height: 48,
    imageData: fill(64, 48, [200, 60, 60, 255]),
    children: [
      { name: "Fondo", imageData: fill(64, 48, [255, 255, 255, 255]) },
      { name: "Logotipo", top: 8, left: 8, imageData: fill(20, 20, [200, 60, 60, 255]) },
      { name: "Boceto oculto", hidden: true, imageData: fill(10, 10, [0, 0, 0, 255]) },
    ],
  });
}

async function pdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["Lámina 1", "Lámina 2"]) doc.addPage([420, 297]).drawText(text, { x: 40, y: 250, size: 24, font });
  return Buffer.from(await doc.save());
}

function dxf(): Buffer {
  const d = emptyDrawing();
  d.layers.push({ name: "Muros", visible: true, locked: false });
  d.entities = [
    { id: "a", layer: "Muros", kind: "polyline", closed: true, pts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }] },
    { id: "b", layer: "0", kind: "circle", c: { x: 2500, y: 1500 }, r: 400 },
    { id: "c", layer: "0", kind: "text", p: { x: 200, y: 3200 }, text: "Dormitorio", h: 200 },
  ];
  return Buffer.from(toDxf(d));
}

const STL = Buffer.from(`solid cuña
 facet normal 0 0 -1
  outer loop
   vertex 0 0 0
   vertex 10 0 0
   vertex 0 10 0
  endloop
 endfacet
 facet normal 0 -1 0
  outer loop
   vertex 0 0 0
   vertex 0 0 5
   vertex 10 0 0
  endloop
 endfacet
endsolid cuña
`);

const OBJ = Buffer.from("# cubo hecho a mano\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\nf 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n");

const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#222"/><circle cx="100" cy="50" r="30" fill="#fff"/><image href="https://example.com/rastreo.png" width="1" height="1"/></svg>');

/** A RAW-like file: TIFF signature, sensor-like noise, the camera's JPG preview, more noise. */
async function raw(page: Page): Promise<{ file: Buffer; preview: Buffer }> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3a6";
    ctx.fillRect(0, 0, 320, 200);
    return c.toDataURL("image/jpeg", 0.9);
  });
  const preview = Buffer.from(dataUrl.split(",")[1], "base64");
  const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251));
  return { file: Buffer.concat([Buffer.from("MM\0*", "latin1"), noise, Buffer.from([0xff, 0xd8, 0xff, 0x00]), preview, noise]), preview };
}

function watchUploads(page: Page): string[] {
  const leaks: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    const local = ["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "blob:" || url.protocol === "data:";
    if (!local || (r.method() !== "GET" && !url.pathname.startsWith("/api/"))) leaks.push(`${r.method()} ${r.url()}`);
  });
  return leaks;
}

async function open(app: FrameLocator, name: string, buffer: Buffer, label: string): Promise<void> {
  await app.locator("#open").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  await expect(app.locator("#format")).toHaveText(label, { timeout: 30_000 });
  await expect(app.locator("#status")).toContainText("abierto", { timeout: 60_000 });
}

async function download(page: Page, app: FrameLocator, target: string): Promise<{ name: string; bytes: Buffer }> {
  await app.locator("#convert").selectOption(target);
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Descargar", exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test("Visor: opens drawings, documents and images locally and converts them", async ({ page }) => {
  const leaks = watchUploads(page);
  const { app } = await openNew(page, "visor");
  const view2d = app.locator("#view2d img, #view2d canvas");

  await open(app, "fachada.png", png(40, 30), "PNG");
  await expect(view2d).toBeVisible();
  await expect(app.locator("#facts")).toContainText("40 × 30 px");
  const jpg = await download(page, app, "jpg");
  expect(jpg.name).toBe("fachada.jpg");
  expect([...jpg.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  // The SVG links an external image: shown as an image, it must not reach example.com (checked by watchUploads).
  await open(app, "logo.svg", SVG, "SVG");
  await expect(view2d).toBeVisible();
  const fromSvg = await download(page, app, "png");
  expect(fromSvg.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");

  await open(app, "laminas.pdf", await pdf(), "PDF");
  await expect(app.locator("#page")).toHaveText("1 / 2");
  await app.getByRole("button", { name: "Página siguiente" }).click();
  await expect(app.locator("#page")).toHaveText("2 / 2");
  expect((await download(page, app, "png")).name).toBe("laminas-p2.png");

  await open(app, "cartel.psd", psd(), "PSD");
  await expect(app.locator("#list li")).toHaveText(["Boceto oculto", "Logotipo", "Fondo"]);
  await expect(app.locator("#list li.off")).toHaveText("Boceto oculto");
  await expect(app.locator("#facts")).toContainText("64 × 48 px");

  await open(app, "planta.dxf", dxf(), "DXF");
  await expect(view2d).toBeVisible();
  await expect(app.getByRole("button", { name: "Fondo oscuro" })).toBeVisible();
  const svg = await download(page, app, "svg");
  expect(svg.bytes.toString("utf8")).toContain("Dormitorio");

  const photo = await raw(page);
  await open(app, "DSC_0042.NEF", photo.file, "RAW (NEF)");
  await expect(app.locator("#facts")).toContainText("320 × 200 px");
  const preview = await download(page, app, "jpg");
  expect(preview.bytes.equals(photo.preview)).toBe(true);

  // Closed formats are refused with an explanation, not an error code.
  await app.locator("#open").setInputFiles({ name: "maqueta.skp", mimeType: "application/octet-stream", buffer: Buffer.from([0xff, 0xfe, 0xff, 0x0e, 0x53, 0x00]) });
  await expect(app.locator("#status")).toContainText("Pide a quien te lo mandó");
  await expect(app.getByRole("button", { name: "Descargar", exact: true })).toBeDisabled();

  expect(leaks).toEqual([]);
});

test("Visor: shows 3D models and a building model, exports them, and keeps the file after a lost tab", async ({ page }) => {
  const leaks = watchUploads(page);
  const { app, projectId } = await openNew(page, "visor");
  const view3d = app.locator("#view3d canvas");

  await open(app, "cuna.stl", STL, "STL");
  await expect(view3d).toBeVisible();
  await expect(app.locator("#facts")).toContainText("Triángulos2");
  const glb = await download(page, app, "glb");
  expect(glb.bytes.subarray(0, 4).toString("latin1")).toBe("glTF");

  await open(app, "cubo.obj", OBJ, "OBJ");
  await expect(app.locator("#facts")).toContainText("1 × 1 × 1");
  const stl = await download(page, app, "stl");
  expect(stl.bytes.length).toBe(84 + 12 * 50);

  await open(app, "muro-y-losa.ifc", IFC, "IFC");
  await expect(app.locator("#list li")).toHaveText(["Muros: 1", "Losas: 1"]);
  await expect(app.locator("#facts")).toContainText("IFC4");
  const obj = await download(page, app, "obj");
  expect(obj.bytes.toString("utf8")).toMatch(/^v /m);

  await waitSaved(page, projectId, /muro-y-losa\.ifc/);
  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#format")).toHaveText("IFC", { timeout: 30_000 });
  await expect(app.locator("#list li")).toHaveText(["Muros: 1", "Losas: 1"]);

  expect(leaks).toEqual([]);
});

test("Visor: opens a real DWG and converts it to DXF", async ({ page }) => {
  test.skip(!DWG_SAMPLE || !existsSync(DWG_SAMPLE), "Set E2E_DWG_SAMPLE to a DWG file you are allowed to use.");
  test.setTimeout(120_000);
  const leaks = watchUploads(page);
  const { app } = await openNew(page, "visor");
  const name = basename(DWG_SAMPLE!);
  await app.locator("#open").setInputFiles({ name, mimeType: "application/octet-stream", buffer: readFileSync(DWG_SAMPLE!) });
  await expect(app.locator("#format")).toHaveText(/^DWG /);
  await expect(app.locator("#status")).toContainText("abierto", { timeout: 90_000 });
  await expect(app.locator("#view2d img")).toBeVisible();
  await expect(app.locator("#list li").first()).toBeVisible();
  const out = await download(page, app, "dxf");
  const text = out.bytes.toString("latin1");
  expect(text).toContain("SECTION");
  expect(text).toContain("ENTITIES");
  expect(leaks).toEqual([]);
});
