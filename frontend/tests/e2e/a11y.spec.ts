import AxeBuilder from "@axe-core/playwright";
import { expect, Page, test } from "@playwright/test";
import { signIn, useAccount } from "./helpers";

/**
 * Phase 9: WCAG 2.2 A and AA rules that can be checked automatically (axe-core), on every screen a
 * student uses, in both themes. Lienzo and Pizarra are third-party editors (miniPaint, Excalidraw)
 * and are not audited here; ESTRELLA's own programs are. Automatic checks find part of the
 * problems; the keyboard tests in the other files cover more.
 */

useAccount();
test.describe.configure({ mode: "default" });

const APPS = process.env.E2E_APPS_URL ?? "http://127.0.0.1:8089";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function audit(page: Page, label: string, exclude: string[] = []): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const found = violations.map((v) => `${label} · ${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(found, found.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`public pages pass WCAG 2.2 AA checks (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const route of ["/#/ingresar", "/#/registro", "/#/olvide", "/#/guia", "/#/instalar", "/#/privacidad", "/#/licencias"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await audit(page, `${route} (${scheme})`);
    }
  });

  test(`a student's own screens pass WCAG 2.2 AA checks (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await audit(page, `panel (${scheme})`);
    await page.getByTestId("meter").locator("summary").click();
    await expect(page.getByTestId("storage-state")).toBeVisible();
    await audit(page, `panel + medidor (${scheme})`);

    await page.goto("/#/cuenta");
    await expect(page.getByTestId("ai-connect")).toBeVisible();
    await audit(page, `cuenta (${scheme})`);

    // A program's own frame is a separate page, audited below; here, the panel around it.
    await page.goto("/#/");
    await page.getByTestId("new-apuntes").click();
    await page.getByTestId("thanks-close").click({ timeout: 5000 }).catch(() => undefined);
    await expect(page.frameLocator('[data-testid="program-frame"]').locator("#body")).toBeVisible();
    await page.getByTestId("help-toggle").click();
    await audit(page, `programa + ayuda: guía (${scheme})`, ['[data-testid="program-frame"]']);
    await page.getByTestId("help-tab-ai").click();
    await expect(page.getByTestId("ai-go-connect")).toBeVisible();
    await audit(page, `programa + ayuda: asistente (${scheme})`, ['[data-testid="program-frame"]']);
  });
}

test("ESTRELLA's own programs pass WCAG 2.2 AA checks", async ({ page }) => {
  for (const program of ["apuntes", "plano", "folio", "visor", "trazo"]) {
    await page.goto(`${APPS}/apps/${program}/index.html`);
    await page.waitForLoadState("load");
    await audit(page, program);
  }
});
