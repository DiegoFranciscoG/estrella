import { expect, Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loseTabAndReopen, openNew, useAccount, waitSaved } from "./helpers";

/** Archivo used the way a student sorts the files of a project before handing it in. */

useAccount();

const IFC = readFileSync(new URL("../fixtures/casa-dos-plantas.ifc", import.meta.url));
const DXF = Buffer.from(["0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF", ""].join("\n"));
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#888"/></svg>');

async function png(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c0b090";
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#303840";
    ctx.fillRect(60, 80, 280, 180);
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Names and sizes inside a ZIP, read from its local headers. */
function zipNames(zip: Buffer): [string, number][] {
  const out: [string, number][] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    out.push([zip.subarray(at + 30, at + 30 + nameLength).toString("utf8"), size]);
    at += 30 + nameLength + size;
  }
  return out;
}

test("Archivo: catalogs files, rates and tags them, finds them, renames a batch into a ZIP and keeps the marks", async ({ page }) => {
  const { app, projectId } = await openNew(page, "archivo");
  const photo = await png(page);
  await app.locator("#add").setInputFiles([
    { name: "foto-fachada.png", mimeType: "image/png", buffer: photo },
    { name: "planta.dxf", mimeType: "application/dxf", buffer: Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n") },
    { name: "memoria.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
    { name: "casa.ifc", mimeType: "application/octet-stream", buffer: IFC },
    { name: "boceto.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#888"/></svg>') },
  ]);
  await expect(app.locator("#status")).toContainText("5 archivos en el catálogo");
  await expect(app.locator("#count")).toHaveText("5 archivos");
  const tile = (name: string) => app.locator(`.tile[data-path="${name}"]`);
  await expect(tile("foto-fachada.png").locator("img")).toBeVisible();

  // What the file is and which program opens it.
  await tile("foto-fachada.png").click();
  const details = app.locator("#details");
  await expect(details).toContainText("Imagen (PNG)");
  await expect(details).toContainText("400 × 300 px");
  await expect(details).toContainText("Lienzo para editarla");

  // Stars, a colour label and keywords.
  await app.getByLabel("Calificación", { exact: true }).selectOption("4");
  await expect(app.locator("#status")).toContainText("Archivo calificado con 4 estrellas");
  await app.getByLabel("Etiqueta de color", { exact: true }).selectOption("verde");
  await app.getByLabel("Palabras clave").fill("fachada, entrega final");
  await app.getByLabel("Palabras clave").press("Tab");
  await expect(tile("foto-fachada.png")).toContainText("4 de 5 estrellas, Verde · Aprobado");

  // The keyboard rates the selection.
  await tile("planta.dxf").click();
  await page.keyboard.press("2");
  await expect(tile("planta.dxf")).toContainText("2 de 5 estrellas");

  // Search by keyword and filter by rating.
  await app.getByLabel("Buscar archivos").fill("entrega");
  await expect(app.locator("#count")).toHaveText(/^1 de 5 archivos/);
  await app.getByLabel("Buscar archivos").fill("");
  await app.getByLabel("Calificación mínima").selectOption("2");
  await expect(app.locator(".tile")).toHaveCount(2);
  await app.getByLabel("Calificación mínima").selectOption("0");
  await expect(app.locator(".tile")).toHaveCount(5);

  // Batch rename: a ZIP of renamed copies, in the order on screen.
  await app.getByRole("button", { name: "Seleccionar todo" }).click();
  await app.getByRole("button", { name: "Renombrar en lote" }).click();
  await app.getByLabel("Nombre nuevo").fill("entrega-{n}");
  await expect(app.locator("#rename-preview li").first()).toHaveText("boceto.svg → entrega-01.svg");
  const zipDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "Descargar ZIP" }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toBe("renombrados.zip");
  expect(zipNames(readFileSync((await zip.path())!))).toEqual([
    ["entrega-01.svg", SVG.length], ["entrega-02.ifc", IFC.length], ["entrega-03.png", photo.length], ["entrega-04.pdf", PDF.length], ["entrega-05.dxf", DXF.length],
  ]);

  // The list for a spreadsheet.
  const csvDownload = page.waitForEvent("download");
  await app.getByRole("button", { name: "Exportar lista CSV" }).click();
  const lines = readFileSync((await (await csvDownload).path())!, "utf8").split("\r\n");
  expect(lines[0]).toBe("﻿\"Ruta\";\"Nombre\";\"Tipo\";\"Tamaño (KB)\";\"Fecha\";\"Ancho (px)\";\"Alto (px)\";\"Calificación\";\"Etiqueta\";\"Palabras clave\"");
  expect(lines.find((l) => l.startsWith("\"foto-fachada.png\""))).toMatch(/^"foto-fachada\.png";"foto-fachada\.png";"Imagen";\d+;"\d{4}-\d{2}-\d{2}";400;300;4;"Verde · Aprobado";"fachada, entrega final"$/);

  // The marks are saved with the project; the files themselves are not.
  await waitSaved(page, projectId, /"rating":4,"label":"verde","tags":\["fachada","entrega final"\]/);
  await loseTabAndReopen(page, projectId);
  await expect(app.locator("#status")).toContainText("Vuelve a elegir tus archivos", { timeout: 20_000 });
  await expect(tile("foto-fachada.png")).toContainText("4 de 5 estrellas, Verde · Aprobado");
  await tile("foto-fachada.png").click();
  await expect(details).toContainText("Vuelve a elegir la carpeta");
});
