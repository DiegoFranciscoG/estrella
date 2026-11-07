import { devices, expect, FrameLocator, test } from "@playwright/test";
import { signIn, useAccount } from "./helpers";

/**
 * The README's screenshots (docs/img), taken from the local stack with a fresh test account. Only on
 * demand: E2E_SCREENSHOTS=1 npx playwright test --project=docs
 */
test.skip(!process.env.E2E_SCREENSHOTS, "Solo para regenerar las capturas del README");
useAccount();
test.describe.configure({ mode: "serial" });

const IMG = "../docs/img";

async function type(app: FrameLocator, text: string): Promise<void> {
  await app.locator("#cmd").fill(text);
  await app.locator("#cmd").press("Enter");
  // At a person's pace: each command finishes before the next one.
  await app.locator("#cmd").page().waitForTimeout(250);
}

test("README: sign-in, panel, Plano and the guide on a computer (dark theme)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/#/ingresar");
  await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${IMG}/ingresar.png` });

  await signIn(page);
  await page.screenshot({ path: `${IMG}/panel.png` });

  // Already signed in: open Plano from the panel, as a student would.
  await page.getByTestId("new-plano").click();
  await page.getByTestId("thanks-close").click({ timeout: 10_000 }).catch(() => undefined);
  const app = page.frameLocator('[data-testid="program-frame"]');
  const canvas = app.locator("#canvas");
  await expect(canvas).toBeVisible();
  // A 4 × 3 m room with the outer face of its walls, a partition and a round table.
  await type(app, "rec");
  await expect(app.getByRole("button", { name: "Rectángulo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await type(app, "0,0");
  await type(app, "4000,3000");
  await type(app, "rec");
  await type(app, "-150,-150");
  // After the first corner, Plano reads "width,height".
  await type(app, "4300,3300");
  await type(app, "l");
  await type(app, "2500,0");
  await type(app, "@0,1800");
  await canvas.press("Escape");
  await type(app, "c");
  await type(app, "1200,1500");
  await type(app, "500");
  await canvas.press("Escape");
  await canvas.press("f");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${IMG}/plano.png` });

  await page.getByTestId("help-toggle").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${IMG}/guia.png` });
});

test("README: the panel on a phone (light theme)", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: test.info().project.use.baseURL,
    locale: "es-EC",
    colorScheme: "light",
  });
  const page = await context.newPage();
  await signIn(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${IMG}/movil.png` });
  await context.close();
});
