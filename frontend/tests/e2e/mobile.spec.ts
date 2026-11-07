import { expect, Page, test } from "@playwright/test";
import { openNew, useAccount } from "./helpers";

/**
 * Phase 8 on a phone-sized screen (Playwright's Pixel 7 emulation, Chromium): the pages fit the
 * screen, a program and its help work with touch-sized controls, and the install page starts with
 * Android. Safari on iPhone is not covered here (no such device on this machine).
 */

useAccount();
test.describe.configure({ mode: "serial" });

async function fitsTheScreen(page: Page): Promise<void> {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, "no sideways scrolling").toBeLessThanOrEqual(width);
}

test("the public pages fit a phone and the install page starts with Android", async ({ page }) => {
  for (const route of ["/#/ingresar", "/#/guia", "/#/privacidad"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await fitsTheScreen(page);
  }
  await page.goto("/#/instalar");
  const first = page.locator("details.install-option").first();
  await expect(first).toHaveAttribute("data-platform", "android");
  await expect(first).toHaveAttribute("open", "");
  await expect(first).toContainText("Instalar app");
  await fitsTheScreen(page);
});

test("a student writes notes and opens the help on a phone", async ({ page }) => {
  const { app } = await openNew(page, "apuntes");
  await fitsTheScreen(page);
  await app.locator("#body").tap();
  await app.locator("#body").fill("Apuntes desde el teléfono");
  await expect(page.getByTestId("save-status")).toContainText("Guardado", { timeout: 15_000 });

  await page.getByTestId("help-toggle").tap();
  const help = page.getByTestId("help-panel");
  await expect(help).toBeVisible();
  // On a phone the help covers the program instead of squeezing it.
  const box = await help.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.round(box!.width)).toBe(viewport.width);
  await help.getByLabel("Buscar en la guía").fill("exportar");
  await expect(help.locator(".guide-card").first()).toBeVisible();
  await help.getByRole("button", { name: "Cerrar la ayuda" }).tap();
  await expect(help).toBeHidden();
  await expect(app.locator("#body")).toHaveValue("Apuntes desde el teléfono");
});
