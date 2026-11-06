import { expect, test } from "@playwright/test";

/** The guide is public: a student can check it before creating an account. */

test("the guide finds tasks by command name, filters, and keeps the search in a shareable link", async ({ page }) => {
  await page.goto("/#/guia");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guía: cómo se hace aquí");
  await expect(page.locator("#guide-count")).toHaveText(/^\d+ fichas$/);
  const total = await page.locator(".guide-card").count();
  expect(total).toBeGreaterThanOrEqual(30);

  // A student types the command they remember from the paid program.
  await page.getByLabel("Qué quieres hacer").fill("trim");
  const first = page.locator(".guide-card").first();
  await expect(first.getByRole("heading", { level: 2 })).toHaveText("Recortar líneas que se pasan de una intersección");
  await expect(first).toContainText("LibreCAD");
  await expect(first.getByRole("link", { name: "LibreCAD — Tools (Modify: Trim)" })).toHaveAttribute("href", "https://docs.librecad.org/en/latest/ref/tools.html");
  await expect(page).toHaveURL(/#\/guia\?q=trim$/);

  // Accents and case do not matter; every word must match.
  await page.getByLabel("Qué quieres hacer").fill("PAGINAS maestras");
  await expect(page.locator(".guide-card")).toHaveCount(1);
  await expect(page.locator(".guide-card")).toContainText("Scribus");

  await page.getByLabel("Qué quieres hacer").fill("");
  await page.getByLabel("Vengo de").selectOption("Acrobat");
  await expect(page.locator(".guide-card").first()).toContainText("En ESTRELLA");
  await expect(page.locator(".guide-card")).toHaveCount(3);
  for (const card of await page.locator(".guide-card").all()) await expect(card).toContainText("Folio");

  // The link reproduces the same search after a reload, which is how a teacher would share it.
  await page.reload();
  await expect(page.getByLabel("Vengo de")).toHaveValue("Acrobat");
  await expect(page.locator(".guide-card")).toHaveCount(3);

  await page.getByLabel("Vengo de").selectOption("");
  await page.getByLabel("Área", { exact: true }).selectOption("arquitectura");
  await page.getByLabel("Qué quieres hacer").fill("xyzzy");
  await expect(page.locator("#guide-count")).toHaveText("0 fichas");
  await expect(page.locator(".guide-list")).toContainText("No hay fichas para esa búsqueda");
});

test("the guide is reachable from the header and works with the keyboard", async ({ page }) => {
  await page.goto("/#/ingresar");
  await page.getByRole("link", { name: "Guía", exact: true }).click();
  await expect(page).toHaveURL(/#\/guia$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Qué quieres hacer")).toBeFocused();
  await page.keyboard.type("muros");
  await expect(page.locator(".guide-card", { hasText: "Dibujar muros con espesor" })).toContainText("FreeCAD");
});
