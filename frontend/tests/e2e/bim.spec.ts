import AxeBuilder from "@axe-core/playwright";
import { expect, FrameLocator, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/** BIM used the way an architecture student reviews a building exported to IFC. */

useAccount();

// Two storeys, lengths in millimetres, a property set, base quantities and an accented name.
const IFC = readFileSync(new URL("../fixtures/casa-dos-plantas.ifc", import.meta.url));
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** The value next to a property's label in the properties panel. */
const value = (app: FrameLocator, label: string) =>
  app.locator("#properties dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]");

test("BIM: opens an IFC, shows a plan, reads properties, measures, exports a schedule and keeps the view", async ({ page }) => {
  const { app, projectId } = await openNew(page, "bim");

  // Anything that is not an IFC STEP file is refused with a reason.
  await app.locator("#open").setInputFiles({ name: "modelo.ifc", mimeType: "application/octet-stream", buffer: Buffer.from("PK\u0003\u0004 comprimido") });
  await expect(app.locator("#status")).toContainText("no es un IFC en formato STEP");

  await app.locator("#open").setInputFiles({ name: "casa-dos-plantas.ifc", mimeType: "application/octet-stream", buffer: IFC });
  await expect(app.locator("#status")).toContainText("Modelo abierto: 4 elementos en 2 niveles", { timeout: 60_000 });
  await expect(app.locator("#summary")).toContainText("IFC4");

  // Levels in metres although the file is in millimetres; categories with their counts.
  await expect(app.getByRole("checkbox", { name: "Planta baja ±0,00 m" })).toBeChecked();
  await expect(app.getByRole("checkbox", { name: "Planta alta +3,00 m" })).toBeChecked();
  await expect(app.getByRole("checkbox", { name: "Muros 1" })).toBeChecked();
  await expect(app.getByRole("checkbox", { name: "Losas 2" })).toBeChecked();
  await expect(app.getByRole("checkbox", { name: "Columnas 1" })).toBeChecked();

  // Find an element by name and read what the IFC says about it.
  await app.getByLabel("Buscar elemento").fill("fachada");
  await app.getByRole("button", { name: /Muro de fachada/ }).click();
  await expect(app.locator("#properties h3")).toHaveText("Muro de fachada");
  await expect(value(app, "Clase IFC")).toHaveText("IfcWall");
  await expect(value(app, "Nivel")).toHaveText("Planta baja");
  await expect(value(app, "Es exterior (IsExternal)")).toHaveText("Sí");
  await expect(value(app, "Portante (LoadBearing)")).toHaveText("No");
  await expect(value(app, "Resistencia al fuego (FireRating)")).toHaveText("EI 60");
  await expect(value(app, "Longitud (Length)")).toHaveText("4,00 m");
  await expect(value(app, "Área lateral neta (NetSideArea)")).toHaveText("12,00 m²");

  // Accents do not matter when searching.
  await app.getByLabel("Buscar elemento").fill("habitacion");
  await app.getByRole("button", { name: /Losa de habitación/ }).click();
  await expect(app.locator("#properties h3")).toHaveText("Losa de habitación");
  await expect(value(app, "Nivel")).toHaveText("Planta alta");
  await expect(value(app, "Volumen neto (NetVolume)")).toHaveText("1,80 m³");

  // A floor plan: hide the upper floor, cut the ground floor at 1.20 m and look from above.
  await app.getByRole("checkbox", { name: /Planta alta/ }).uncheck();
  await app.getByRole("button", { name: "Ver planta de Planta baja" }).click();
  await expect(app.locator("#section-value")).toHaveText("+1,20 m");
  await expect(app.getByLabel("Corte horizontal")).toBeChecked();

  // Two clicks on the floor measure a distance in metres; Esc leaves the tool.
  await app.getByRole("button", { name: "Medir" }).click();
  const canvas = app.locator("#view3d canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(app.locator("#status")).toContainText("Primer punto marcado");
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.5);
  await expect(app.locator("#measures li")).toHaveText(/^Medida 1: \d+,\d{2} m$/);
  await page.keyboard.press("Escape");
  await expect(app.getByRole("button", { name: "Medir" })).toHaveAttribute("aria-pressed", "false");

  // The schedule lists what is visible, with quantities converted to metres.
  const pending = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar cuadro CSV" }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe("casa-dos-plantas-cuadro.csv");
  expect(readFileSync((await file.path())!, "utf8").split("\r\n")).toEqual([
    "\uFEFF\"Nivel\";\"Categoría\";\"Clase IFC\";\"Nombre\";\"GlobalId\";\"Longitud (m)\";\"Área (m²)\";\"Volumen (m³)\"",
    "\"Planta baja\";\"Losas\";\"IfcSlab\";\"Losa de piso\";\"2F8_qFXWRLlNyZNWsANnWr\";;12,00;1,80",
    "\"Planta baja\";\"Muros\";\"IfcWall\";\"Muro de fachada\";\"2JMlyUIMzr276kTRvc3UAO\";4,00;12,00;2,40",
    "",
  ]);

  // The loaded program passes the automatic WCAG 2.2 AA checks too.
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

  // The model and the view are kept with the project.
  await waitSaved(page, projectId, /"hiddenLevels":\[60\].*"section":1\.2,"selected":70,"measures":\[\[/);
  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#status")).toContainText("Modelo abierto", { timeout: 60_000 });
  await expect(app.getByRole("checkbox", { name: /Planta alta/ })).not.toBeChecked();
  await expect(app.locator("#section-value")).toHaveText("+1,20 m");
  await expect(app.locator("#measures li")).toHaveCount(1);
  await expect(app.locator("#properties h3")).toHaveText("Losa de habitación");
});
