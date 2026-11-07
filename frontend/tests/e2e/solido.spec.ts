import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/** Sólido used the way an architecture student builds a massing model. */

useAccount();

test("Sólido: places and sizes solids, raises a drawn footprint, exports STL and glTF, and keeps the model", async ({ page }) => {
  const { app, projectId } = await openNew(page, "solido");
  const canvas = app.locator("#view3d canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  const item = (name: string) => app.getByRole("button", { name, exact: true });

  // A footprint drawn corner by corner on the ground is raised as a prism.
  await app.getByRole("button", { name: "Polígono" }).click();
  await at(0.4, 0.55);
  await at(0.6, 0.55);
  await at(0.6, 0.7);
  await at(0.4, 0.7);
  await expect(app.locator("#status")).toContainText("Esquina 4");
  await page.keyboard.press("Enter");
  await expect(app.locator("#status")).toContainText("Prisma 1 levantado 3,00 m");
  await expect(app.locator("#p-kind")).toHaveText("Prisma");
  await expect(app.locator("#p-volume")).toHaveText(/^\d+,\d{2} m³$/);

  // A box placed with a click, then sized with exact measures.
  await app.getByRole("button", { name: "Caja", exact: true }).click();
  await at(0.22, 0.5);
  await expect(app.locator("#status")).toContainText("Caja 1 en el suelo");
  for (const [label, value] of [["Ancho (m)", "4"], ["Profundidad (m)", "3"], ["Alto (m)", "2.5"]]) {
    await app.getByLabel(label).fill(value);
    await app.getByLabel(label).press("Tab");
  }
  await expect(app.locator("#p-area")).toHaveText("12,00 m²");
  await expect(app.locator("#p-volume")).toHaveText("30,00 m³");

  // A copy beside it; undo, redo and delete.
  await app.getByRole("button", { name: "Duplicar" }).click();
  await expect(item("Caja 2")).toBeVisible();
  await app.getByRole("button", { name: "Deshacer" }).click();
  await expect(item("Caja 2")).toHaveCount(0);
  await app.getByRole("button", { name: "Rehacer" }).click();
  await item("Caja 2").click();
  await app.getByRole("button", { name: "Eliminar" }).click();
  await expect(item("Caja 2")).toHaveCount(0);

  // A cylinder, hidden and shown again from the list.
  await app.getByRole("button", { name: "Cilindro", exact: true }).click();
  await at(0.8, 0.5);
  await expect(app.locator("#status")).toContainText("Cilindro 1 en el suelo");
  await app.getByRole("button", { name: "Ver Cilindro 1" }).click();
  await expect(app.getByRole("button", { name: "Ver Cilindro 1" })).toHaveAttribute("aria-pressed", "false");
  await app.getByRole("button", { name: "Ver Cilindro 1" }).click();
  await expect(app.locator("#totals")).toContainText("3 sólidos");

  // STL for 3D printing: binary, in millimetres. glTF for other 3D programs.
  const stlDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "STL" }).click();
  const stl = readFileSync((await (await stlDownload).path())!);
  const triangles = stl.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(24);
  expect(stl.length).toBe(84 + triangles * 50);
  let largest = 0;
  for (let t = 0; t < triangles; t++) for (let v = 0; v < 9; v++) largest = Math.max(largest, Math.abs(stl.readFloatLE(84 + t * 50 + 12 + v * 4)));
  expect(largest).toBeGreaterThan(1500);
  const glbDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "glTF" }).click();
  const glb = readFileSync((await (await glbDownload).path())!);
  expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");

  // The model is kept with the project and survives a lost tab.
  await waitSaved(page, projectId, /"name":"Caja 1","kind":"box",.*"width":4,"depth":3,"height":2\.5/);
  await loseTabAndReopen(page, projectId);
  await expect(item("Caja 1")).toBeVisible({ timeout: 20_000 });
  await expect(item("Prisma 1")).toBeVisible();
  await expect(item("Cilindro 1")).toBeVisible();
  await item("Caja 1").click();
  await expect(app.getByLabel("Ancho (m)")).toHaveValue("4");
});
