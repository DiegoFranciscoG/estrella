import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Trying ESTRELLA without an account: the work stays in the browser and the server is never called. */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test("a visitor tries a program without an account and nothing reaches the server", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/")) calls.push(`${r.method()} ${path}`);
  });

  await page.goto("/#/ingresar");
  await page.getByTestId("try-guest").click();
  await expect(page.getByTestId("guest-notice")).toContainText("sin cuenta");
  await expect(page.getByTestId("new-apuntes")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mi cuenta" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salir" })).toHaveCount(0);
  await expect(page.getByTestId("sync-bar")).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

  // A program works as for anyone else, and keeps the work.
  await page.getByTestId("new-apuntes").click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const app = page.frameLocator('[data-testid="program-frame"]');
  await app.locator("#title").fill("Prueba sin cuenta");
  await app.locator("#body").fill("Esto se queda en mi navegador.");
  await expect(page.getByTestId("save-status")).toContainText("Guardado", { timeout: 10_000 });
  await page.getByTestId("thanks-close").click();

  // The guide is there; the assistant says it needs an account instead of failing.
  await page.getByTestId("help-toggle").click();
  await page.getByTestId("help-tab-ai").click();
  await expect(page.getByTestId("ai-guest")).toContainText("necesita una cuenta");

  // Still a guest after losing the tab, with the work in place.
  await page.reload();
  await page.goto(projectUrl);
  await expect(page.getByTestId("recovered")).toContainText("Recuperamos tu trabajo", { timeout: 20_000 });
  await expect(app.locator("#body")).toHaveValue(/mi navegador/);
  await page.getByTestId("back").click();
  await expect(page.getByTestId("projects")).toContainText("Prueba sin cuenta");
  await expect(page.getByTestId("place")).toHaveText("Solo en este equipo");

  // There is no account page for a guest, and signing in stays one click away.
  await page.goto("/#/cuenta");
  await expect(page.getByTestId("guest-notice")).toBeVisible();
  await page.getByRole("link", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();

  expect(calls).toEqual([]);
});
