import { expect, FrameLocator, Page, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { openNew, storedData, useAccount } from "./helpers";

/**
 * Plano used the way a drafting student works: commands typed in the command line, then edits
 * on what was drawn. Every step is checked in what the panel stored, not only on screen.
 */

useAccount();

type Saved = { entities: { kind: string; pts?: { x: number; y: number }[]; a?: { x: number; y: number }; b?: { x: number; y: number }; mode?: string; name?: string; pattern?: string }[]; blocks?: Record<string, unknown> };

async function saved(page: Page, projectId: string): Promise<Saved> {
  const raw = await storedData(page, projectId);
  return raw ? JSON.parse(raw) : { entities: [] };
}

async function count(page: Page, projectId: string, kind: string): Promise<number> {
  return (await saved(page, projectId)).entities.filter((e) => e.kind === kind).length;
}

async function type(app: FrameLocator, text: string): Promise<void> {
  await app.locator("#cmd").fill(text);
  await app.locator("#cmd").press("Enter");
}

test("Plano: offset, trim, hatch, arc, dimensions, copy, rotate, blocks and a PDF to scale", async ({ page }) => {
  test.setTimeout(120_000);
  const { app, projectId } = await openNew(page, "plano");
  const canvas = app.locator("#canvas");
  await expect(canvas).toBeVisible();

  // A 4000 × 3000 room typed from the command line, then "fit" frames it.
  await type(app, "rec");
  await expect(app.getByRole("button", { name: "Rectángulo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await type(app, "0,0");
  await type(app, "4000,3000");
  await canvas.press("f");
  const box = (await canvas.boundingBox())!;
  const s = Math.min((box.width * 0.85) / 4000, (box.height * 0.85) / 3000);
  const at = (x: number, y: number) => ({ x: box.x + box.width / 2 + (x - 2000) * s, y: box.y + box.height / 2 - (y - 1500) * s });
  const click = async (x: number, y: number) => { const p = at(x, y); await page.mouse.click(p.x, p.y); };
  await expect.poll(() => count(page, projectId, "polyline"), { timeout: 20_000 }).toBe(1);

  // Offset 150 mm outward: the wall's outer face.
  await type(app, "o");
  await type(app, "150");
  await click(2000, 0);
  await click(2000, -100);
  await expect.poll(async () => {
    const outer = (await saved(page, projectId)).entities.filter((e) => e.kind === "polyline").map((e) => Math.min(...e.pts!.map((p) => p.y)));
    return outer.sort((m, n) => m - n)[0];
  }, { timeout: 20_000 }).toBeCloseTo(-150, 3);

  // A line across both walls, then trim the part inside the room.
  await type(app, "l");
  await type(app, "-300,1500");
  await type(app, "@4600,0");
  await canvas.press("Escape");
  await type(app, "tr");
  await click(2000, 1500);
  await expect.poll(async () => (await saved(page, projectId)).entities.filter((e) => e.kind === "line").map((e) => [Math.round(e.a!.x), Math.round(e.b!.x)]), { timeout: 20_000 })
    .toEqual([[-300, 0], [4000, 4300]]);

  // Brick hatch inside the room: the inner outline is the smallest one around the click.
  await type(app, "h");
  await app.getByLabel("Patrón", { exact: true }).selectOption("ladrillo");
  await click(1000, 800);
  await expect.poll(async () => (await saved(page, projectId)).entities.find((e) => e.kind === "hatch")?.pattern, { timeout: 20_000 }).toBe("ladrillo");

  // An arc through three typed points and a horizontal dimension 400 mm below the room.
  await type(app, "a");
  await type(app, "500,500");
  await type(app, "@500,500");
  await type(app, "@500,-500");
  await type(app, "dli");
  await type(app, "0,0");
  await type(app, "@4000,0");
  await type(app, "@0,-400");
  await expect.poll(() => count(page, projectId, "arc"), { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await saved(page, projectId)).entities.find((e) => e.kind === "dim")?.mode, { timeout: 20_000 }).toBe("h");

  // Select everything, copy it 6000 mm to the right, then rotate the whole sheet 90°.
  await canvas.press("Escape");
  await canvas.press("Control+a");
  const total = (await saved(page, projectId)).entities.length;
  await type(app, "co");
  await type(app, "0,0");
  await type(app, "@6000,0");
  await canvas.press("Escape");
  await expect.poll(async () => (await saved(page, projectId)).entities.length, { timeout: 20_000 }).toBe(total * 2);
  await canvas.press("Control+a");
  await type(app, "ro");
  await type(app, "0,0");
  await type(app, "90");
  await expect.poll(async () => {
    const lines = (await saved(page, projectId)).entities.filter((e) => e.kind === "line");
    return lines.every((e) => Math.abs(e.a!.x - e.b!.x) < 1e-6);
  }, { timeout: 20_000 }).toBe(true);

  // Everything becomes one block "Planta", then a second copy is inserted.
  page.once("dialog", (d) => d.accept("Planta"));
  await canvas.press("Control+a");
  await app.getByRole("button", { name: "Crear bloque" }).click();
  await click(0, 0);
  await expect.poll(async () => Object.keys((await saved(page, projectId)).blocks ?? {}), { timeout: 20_000 }).toEqual(["Planta"]);
  await app.getByRole("button", { name: "Insertar el bloque Planta" }).click();
  await click(2000, 2000);
  await canvas.press("Escape");
  await expect.poll(() => count(page, projectId, "insert"), { timeout: 20_000 }).toBe(2);

  // A PDF fitted to an A3 sheet, and a DXF that carries the block.
  await app.getByRole("button", { name: "Imprimir / PDF" }).click();
  await app.getByLabel("Escala", { exact: true }).selectOption("0");
  const pdfDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "Descargar PDF" }).click();
  const pdf = readFileSync(await (await pdfDownload).path());
  expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  const dxfDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar DXF", exact: true }).click();
  const dxf = readFileSync(await (await dxfDownload).path(), "latin1");
  expect(dxf).toContain("BLOCKS");
  expect(dxf).toContain("Planta");
  expect(dxf).toContain("INSERT");
});

test("Plano: unknown commands and edits without a selection explain what to do", async ({ page }) => {
  const { app } = await openNew(page, "plano");
  await type(app, "xyz");
  await expect(app.locator("#status")).toContainText("No conozco el comando");
  await type(app, "m");
  await expect(app.locator("#status")).toContainText("Primero selecciona");
  await expect(app.getByRole("button", { name: "Seleccionar", exact: true })).toHaveAttribute("aria-pressed", "true");
  await type(app, "o");
  await app.locator("#canvas").click({ position: { x: 50, y: 50 } });
  await expect(app.locator("#status")).toContainText("Primero escribe la distancia");
});

test("Plano: opens a DWG directly, with its blocks", async ({ page }) => {
  const sample = process.env.E2E_DWG_SAMPLE;
  test.skip(!sample || !existsSync(sample), "Set E2E_DWG_SAMPLE to a DWG file you are allowed to use.");
  test.setTimeout(120_000);
  const { app, projectId } = await openNew(page, "plano");
  await app.locator("#import").setInputFiles({ name: "muestra.dwg", mimeType: "application/octet-stream", buffer: readFileSync(sample!) });
  await expect(app.locator("#status")).toContainText("Importados", { timeout: 90_000 });
  await expect.poll(async () => (await saved(page, projectId)).entities.length, { timeout: 20_000 }).toBeGreaterThan(10);
  await expect(app.locator("#blocks li").first()).not.toHaveText(/Sin bloques/);
});
