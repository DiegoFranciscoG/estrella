import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, storedData, useAccount, waitSaved } from "./helpers";

/** Trazo used the way a design student draws a logo: shapes, colors, text, export and import. */

useAccount();

test("Trazo: draws, colors and writes, exports SVG, imports safely and survives a lost tab", async ({ page }) => {
  const { app, projectId } = await openNew(page, "trazo");
  const canvas = app.locator("#canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // A rectangle dragged on the board is selected and listed in Capas.
  await app.getByRole("button", { name: "Rectángulo", exact: true }).click();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(app.getByRole("button", { name: "Rectángulo 1", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Its fill changes from Propiedades.
  await app.getByLabel("Relleno", { exact: true }).fill("#ff0000");
  await waitSaved(page, projectId, /"fill":"#ff0000"/);

  // Text goes where the student clicks.
  await app.getByRole("button", { name: "Texto", exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await app.getByRole("textbox", { name: "Texto" }).fill("Logo ESTRELLA");
  await app.getByRole("textbox", { name: "Texto" }).press("Enter");
  await waitSaved(page, projectId, /Logo ESTRELLA/);

  // Undo removes the text, redo brings it back.
  await app.getByRole("button", { name: "Deshacer" }).click();
  await expect(app.getByRole("button", { name: "Texto 1", exact: true })).toHaveCount(0);
  await app.getByRole("button", { name: "Rehacer" }).click();
  await expect(app.getByRole("button", { name: "Texto 1", exact: true })).toBeVisible();

  // The exported SVG has the red rectangle and the text.
  const download = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar SVG" }).click();
  const svg = readFileSync((await (await download).path())!, "utf8");
  expect(svg).toMatch(/<rect [^>]*fill="#ff0000"/);
  expect(svg).toContain(">Logo ESTRELLA</text>");

  // An imported SVG brings its shapes and leaves out its script.
  await app.locator("#import").setInputFiles({
    name: "icono.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="blue"/><script>alert(1)</script></svg>'),
  });
  await expect(app.locator("#status")).toContainText("Se importó 1 forma");
  await expect(app.getByRole("button", { name: "Elipse 1", exact: true })).toBeVisible();
  const saved = await waitSaved(page, projectId, /"fill":"#0000ff"/);
  expect(saved).not.toContain("alert");

  await loseTabAndReopen(page, projectId);
  await expect(app.getByRole("button", { name: "Rectángulo 1", exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await storedData(page, projectId)).toContain("Logo ESTRELLA");
});
