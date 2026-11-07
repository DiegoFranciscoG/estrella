import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/** Análisis de sitio used the way an architecture student studies the sun on a lot in Quito. */

useAccount();

/** A lot and a 15 m neighbour north of it, as an OpenStreetMap export would give them. */
function neighbourhood(): Buffer {
  const box = (lon: number, lat: number, dLon: number, dLat: number) => [[[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]]];
  return Buffer.from(JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { lote: true }, geometry: { type: "Polygon", coordinates: box(-78.5, -0.2, 0.00018, 0.00027) } },
      { type: "Feature", properties: { name: "Torre vecina", height: 15 }, geometry: { type: "Polygon", coordinates: box(-78.49999, -0.19970, 0.00009, 0.00009) } },
      { type: "Feature", properties: { name: "Poste" }, geometry: { type: "Point", coordinates: [-78.5, -0.2] } },
    ],
  }));
}

test("Análisis de sitio: sun, shadows and hours of sun on a lot, COS ratios, a GeoJSON neighbourhood and a saved site", async ({ page }) => {
  const { app, projectId } = await openNew(page, "sitio");

  // Quito on the June solstice: sunrise, sunset and the noon sun high in the north.
  await expect(app.getByLabel("Ciudad")).toHaveValue("Quito");
  await app.getByLabel("Fecha clave").selectOption("06-21");
  await expect(app.getByLabel("Fecha", { exact: true })).toHaveValue(/-06-21$/);
  await expect(app.locator("#sun-amanecer")).toHaveText(/^06:1[234]$/);
  await expect(app.locator("#sun-atardecer")).toHaveText(/^18:(1[89]|20)$/);
  await app.getByLabel("Hora", { exact: true }).fill("735");
  await expect(app.locator("#time-value")).toHaveText("12:15");
  await expect(app.locator("#sun-altura-del-sol")).toHaveText(/^66,\d°$/);
  await expect(app.locator("#sun-dirección")).toContainText("Norte");

  // A 20 × 30 m lot and a 10 × 12 m building, 9 m high (3 floors).
  await app.getByLabel("Ancho del lote (m)").fill("20");
  await app.getByLabel("Fondo del lote (m)").fill("30");
  await app.getByRole("button", { name: "Crear lote" }).click();
  const ratios = app.locator("#ratios");
  await expect(ratios).toContainText("600,00 m²");
  await app.getByLabel("Ancho del edificio (m)").fill("10");
  await app.getByLabel("Fondo del edificio (m)").fill("12");
  await app.getByLabel("Altura del edificio (m)").fill("9");
  await app.getByRole("button", { name: "Añadir edificio" }).click();
  await expect(app.locator("#status")).toContainText("Edificio 1: 10,0 × 12,0 m y 9,0 m de alto (3 pisos)");
  await expect(ratios).toContainText("COS PB20,0 %");
  await expect(ratios).toContainText("COS total60,0 %");

  // A second building drawn corner by corner on the plan.
  await app.getByRole("button", { name: "Edificio", exact: true }).click();
  const plan = app.locator("#plan");
  const box = (await plan.boundingBox())!;
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await at(0.6, 0.2);
  await at(0.66, 0.2);
  await at(0.66, 0.3);
  await at(0.6, 0.3);
  await expect(app.locator("#status")).toContainText("Esquina 4");
  await page.keyboard.press("Enter");
  await expect(app.locator("#status")).toContainText(/Edificio 2 con \d+,\d{2} m² en planta/);
  await app.getByLabel("Altura (m)", { exact: true }).fill("12");
  await app.getByLabel("Altura (m)", { exact: true }).press("Tab");
  await expect(app.getByRole("button", { name: "Edificio 2 · 12,0 m" })).toBeVisible();

  // Hours of direct sun on the free ground of the lot: about 12 h at most on the equator.
  await app.getByLabel("Horas de sol").check();
  await expect(app.locator("#hours-summary")).toContainText(/promedio \d+,\d h, mínimo \d+,\d h, máximo 1[12],\d h/, { timeout: 30_000 });
  await expect(app.locator("#legend")).toBeVisible();

  // The sun table for a spreadsheet: every half hour with the sun up.
  const csvDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "Tabla solar CSV" }).click();
  const lines = readFileSync((await (await csvDownload).path())!, "utf8").split("\r\n").filter(Boolean);
  expect(lines[0]).toBe("﻿\"Hora\";\"Altura del sol (°)\";\"Azimut (°)\";\"Dirección\"");
  expect(lines.length - 1).toBeGreaterThanOrEqual(23);
  expect(lines.find((l) => l.startsWith("\"12:00\""))).toMatch(/^"12:00";6\d,\d;\d+,\d;"Norte"$/);

  // The site is kept with the project.
  await waitSaved(page, projectId, /"name":"Edificio 2","points":.*"height":12/);
  await loseTabAndReopen(page, projectId);
  await expect(ratios).toContainText("COS PB", { timeout: 20_000 });
  await expect(ratios).toContainText("600,00 m²");
  await expect(app.getByRole("button", { name: "Edificio 2 · 12,0 m" })).toBeVisible();

  // A neighbourhood from GeoJSON replaces the drawing and moves the site to its coordinates.
  await app.locator("#import").setInputFiles({ name: "barrio.geojson", mimeType: "application/geo+json", buffer: neighbourhood() });
  await expect(app.locator("#status")).toContainText("Importados 1 edificio y el lote");
  await expect(app.locator("#status")).toContainText("Se omitió 1 elemento");
  await expect(app.getByRole("button", { name: "Torre vecina · 15,0 m" })).toBeVisible();
  await expect(app.getByLabel("Latitud (°)")).toHaveValue(/^-0\.199/);
  await expect(ratios).toContainText(/Área del lote\d{3},\d{2} m²/);
});
