import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { loseTabAndReopen, openNew, storedData, useAccount, waitSaved } from "./helpers";

/**
 * Each program used the way a student would, through the real panel, then the tab is lost and the
 * work must come back. Saved content is checked in the panel's own storage, not just on screen.
 */

useAccount();

test("Plano: draws with clicks and typed measures, exports DXF, survives a lost tab", async ({ page }) => {
  const { app, projectId } = await openNew(page, "plano");
  const canvas = app.locator("#canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // A line by two clicks, then a rectangle typed as 300,200 mm.
  await app.getByRole("button", { name: "Línea", exact: true }).click();
  await page.mouse.click(box.x + 100, box.y + 300);
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press("Escape");
  await app.getByRole("button", { name: "Rectángulo", exact: true }).click();
  await page.mouse.click(box.x + 120, box.y + 120);
  await page.mouse.move(box.x + 200, box.y + 80);
  await app.locator("#cmd").fill("300,200");
  await app.locator("#cmd").press("Enter");
  // A circle with radius typed, and a text.
  await app.getByRole("button", { name: "Círculo", exact: true }).click();
  await page.mouse.click(box.x + 400, box.y + 200);
  await app.locator("#cmd").fill("25");
  await app.locator("#cmd").press("Enter");
  await app.getByRole("button", { name: "Texto", exact: true }).click();
  await page.mouse.click(box.x + 150, box.y + 350);
  await app.locator("#cmd").fill("Planta baja");
  await app.locator("#cmd").press("Enter");

  const saved = await waitSaved(page, projectId, /Planta baja/);
  const drawing = JSON.parse(saved);
  expect(drawing.entities.map((e: { kind: string }) => e.kind).sort()).toEqual(["circle", "line", "polyline", "text"]);
  const rect = drawing.entities.find((e: { kind: string }) => e.kind === "polyline");
  const xs = rect.pts.map((p: { x: number }) => p.x);
  const ys = rect.pts.map((p: { y: number }) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(300);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200);
  expect(drawing.entities.find((e: { kind: string }) => e.kind === "circle").r).toBeCloseTo(25);

  const download = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar DXF", exact: true }).click();
  const dxf = readFileSync(await (await download).path(), "utf8");
  expect(dxf).toContain("AC1009");
  expect(dxf).toContain("CIRCLE");
  expect(dxf).toContain("Planta baja");

  // Undo removes the last object; the change is saved too.
  await app.locator("#canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => JSON.parse(await storedData(page, projectId)).entities.length, { timeout: 20_000 }).toBe(3);

  await loseTabAndReopen(page, projectId);
  await expect.poll(async () => JSON.parse(await storedData(page, projectId)).entities.length).toBe(3);
});

test("Folio: opens, rotates, deletes and downloads a PDF without uploading it", async ({ page }) => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save());
  const uploads: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET") uploads.push(r.url()); });

  const { app, projectId } = await openNew(page, "folio");
  await app.locator("#open").setInputFiles({ name: "apuntes-clase.pdf", mimeType: "application/pdf", buffer: bytes });
  await expect(app.locator("#thumbs li")).toHaveCount(3);
  await app.getByRole("button", { name: "Girar", exact: true }).click();
  await expect(app.locator("#status")).toContainText("Páginas giradas");
  page.on("dialog", (d) => void d.accept());
  await app.locator("#thumbs li").nth(2).getByRole("button").click();
  await app.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(app.locator("#thumbs li")).toHaveCount(2);

  const download = page.waitForEvent("download");
  await app.getByRole("button", { name: "Descargar PDF", exact: true }).click();
  const out = await PDFDocument.load(readFileSync(await (await download).path()));
  expect(out.getPageCount()).toBe(2);
  expect(out.getPage(0).getRotation().angle).toBe(90);

  await waitSaved(page, projectId, /"pdf":"JVBER/);
  // The PDF never left the device: only account calls were made.
  expect(uploads.filter((u) => !u.includes("/api/v1/auth/") && !u.includes("/api/v1/me/thanks"))).toEqual([]);

  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#thumbs li")).toHaveCount(2);
});

test("Pizarra: shapes drawn on the whiteboard are kept", async ({ page }) => {
  const { app, projectId } = await openNew(page, "pizarra");
  const canvas = app.locator("canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await waitSaved(page, projectId, /"type":\s*"rectangle"/);

  await loseTabAndReopen(page, projectId);
  await expect(app.locator("canvas.interactive")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => await storedData(page, projectId)).toMatch(/"type":\s*"rectangle"/);
});

test("Lienzo: painting is saved as layers and restored", async ({ page }) => {
  const { app, projectId } = await openNew(page, "lienzo");
  const canvas = app.locator("#canvas_minipaint");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await app.locator("#tools_container #brush").click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 180, { steps: 6 });
  await page.mouse.up();
  // miniPaint keeps each brush stroke as a vector layer with its points.
  const saved = await waitSaved(page, projectId, /"layers"/);
  const project = JSON.parse(saved);
  const stroke = project.layers.find((l: { type: string }) => l.type === "brush");
  expect(stroke, "the brush stroke is saved as a layer").toBeDefined();
  expect(JSON.stringify(stroke.data).length, "the stroke keeps its points").toBeGreaterThan(20);

  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#layers_base")).toBeVisible({ timeout: 30_000 });
  expect(await storedData(page, projectId)).toBe(saved);
});
