import { expect, Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/** Revelado used the way a photography student develops a camera RAW. */

useAccount();

/** A RAW-like file: TIFF signature, sensor-like bytes, the camera's JPG preview, more bytes. */
async function rawFile(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 400, 0);
    g.addColorStop(0, "#202830");
    g.addColorStop(1, "#c0b090");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 300);
    return c.toDataURL("image/jpeg", 0.9);
  });
  const preview = Buffer.from(dataUrl.split(",")[1], "base64");
  const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251));
  return Buffer.concat([Buffer.from("II*\0", "latin1"), noise, preview, noise]);
}

test("Revelado: develops a RAW photo, crops it, exports a JPG and keeps the work", async ({ page }) => {
  const { app, projectId } = await openNew(page, "revelado");
  await app.locator("#open").setInputFiles({ name: "IMG_0042.NEF", mimeType: "application/octet-stream", buffer: await rawFile(page) });
  await expect(app.locator("#status")).toContainText("Foto abierta", { timeout: 30_000 });
  await expect(app.locator("#info")).toContainText("400 × 300");

  // Light and color.
  await app.getByLabel("Exposición").fill("1");
  await app.getByLabel("Temperatura").fill("40");
  await app.getByLabel("Blanco y negro").check();
  await app.getByLabel("Blanco y negro").uncheck();
  await waitSaved(page, projectId, /"exposure":1,.*"temperature":40/);

  // A square crop dragged over the photo.
  await app.getByRole("button", { name: "Recortar", exact: true }).click();
  await app.getByLabel("Proporción del recorte").selectOption("1:1");
  const photo = app.locator("#view");
  const box = (await photo.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.9, { steps: 5 });
  await page.mouse.up();
  await app.getByRole("button", { name: "Recortar", exact: true }).click();
  await expect(app.locator("#info")).toContainText(/Exporta (\d+) × \1 px/);

  // Undo and redo the crop.
  await app.getByRole("button", { name: "Deshacer" }).click();
  await expect(app.locator("#info")).toContainText("Exporta 400 × 300 px");
  await app.getByRole("button", { name: "Rehacer" }).click();
  await expect(app.locator("#info")).toContainText(/Exporta (\d+) × \1 px/);

  // The exported JPG is the developed, cropped photo.
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar JPG" }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/-revelada\.jpg$/);
  const bytes = readFileSync((await file.path())!);
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  await expect(app.locator("#status")).toContainText("sin datos de la cámara");

  // The crop is saved with the rest of the work.
  await waitSaved(page, projectId, /"crop":\{"x":/);
  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#info")).toContainText(/Exporta (\d+) × \1 px/, { timeout: 20_000 });
  await expect(app.getByLabel("Exposición")).toHaveValue("1");
});
