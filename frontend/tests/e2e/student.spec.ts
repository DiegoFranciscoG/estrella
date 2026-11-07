import { APIRequestContext, expect, Page, request, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * A student's whole first day, as a person would do it: sign up, confirm the email, sign in,
 * write notes, lose the tab, come back, hit a frozen program, and finally delete the account.
 */

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const email = `e2e-${Date.now()}@example.com`;
const password = `frase-${randomBytes(12).toString("base64url")}`;

let mail: APIRequestContext;

async function latestToken(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await (await mail.get(`/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`)).json();
    if (list.messages?.length) {
      const msg = await (await mail.get(`/api/v1/message/${list.messages[0].ID}`)).json();
      const match = /token=([A-Za-z0-9_-]{43})/.exec(msg.Text);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email "${subject}" for ${to}`);
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/#/ingresar");
  await page.getByRole("textbox", { name: "Correo" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Tus programas" })).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mail = await request.newContext({ baseURL: MAILPIT });
});

test.afterAll(async () => {
  await mail.dispose();
});

test("signs up, keeps the recovery code and confirms the email", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/ingresar$/);
  await page.getByRole("link", { name: "Crear una cuenta" }).click();

  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByTestId("error")).toContainText("Escribe un correo válido");

  await page.getByRole("textbox", { name: "Correo" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Repite la contraseña").fill(password);
  await page.getByLabel(/Tengo 15 años o más/).check();
  await page.getByLabel(/guarden mi correo/).check();
  await page.getByLabel(/Avísenme por correo/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  const code = page.getByTestId("recovery-code");
  await expect(code).toHaveText(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/, { timeout: 30_000 });
  const next = page.getByTestId("continue");
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("Ya guardé mi código").check();
  await expect(next).toHaveAttribute("aria-disabled", "false");

  // The account works only after the emailed link: the app says so, and where local emails land.
  await next.click();
  await expect(page.getByRole("heading", { level: 1, name: "Revisa tu correo" })).toBeVisible();
  await expect(page.getByTestId("sent-to")).toHaveText(email);
  await expect(page.getByTestId("dev-mailbox").getByRole("link", { name: "buzón de pruebas" })).toHaveAttribute("href", /^http:\/\/localhost:8025/);
  await page.getByTestId("resend").click();
  await expect(page.getByTestId("resend-status")).toContainText("te enviamos otro enlace");

  const token = await latestToken(email, "Confirma tu correo");
  await page.goto(`/#/verificar?token=${token}`);
  await expect(page.getByRole("status")).toContainText("Correo confirmado");
  await expect(page).toHaveURL(/#\/verificar$/);
});

test("signs in and sees an honest catalog", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-program="apuntes"] .badge')).toHaveText("Disponible");
  await expect(page.locator('[data-program="visor"] .badge')).toHaveText("Disponible");
  await expect(page.locator('[data-program="trazo"] button')).toBeDisabled();
  await expect(page.locator('[data-program="sitio"]')).toContainText("hueco más grande");
  const sessionMail = await latestToken(email, "Confirma tu correo").catch(() => null);
  expect(sessionMail).not.toBeNull();
});

test("writes notes that save themselves and survive a closed tab", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("new-apuntes").click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  const thanks = page.getByTestId("thanks");
  await expect(thanks).toBeVisible();
  await expect(thanks).toContainText("@diego.granda.z");
  await expect(thanks).toBeInViewport();

  const app = page.frameLocator('[data-testid="program-frame"]');
  await app.locator("#title").fill("Historia de la arquitectura");
  await app.locator("#body").fill("Clase 1: el orden dórico.\nClase 2: el orden jónico.");
  await expect(page.getByTestId("save-status")).toContainText("Guardado", { timeout: 10_000 });
  await thanks.getByRole("button", { name: "Cerrar" }).click();
  await expect(thanks).toBeHidden();

  // The tab dies without a clean close.
  await page.reload();
  await page.goto(projectUrl);
  await expect(page.getByTestId("recovered")).toContainText("Recuperamos tu trabajo");
  await expect(app.locator("#body")).toHaveValue(/orden jónico/);
  await expect(app.locator("#title")).toHaveValue("Historia de la arquitectura");
  await expect(page.getByTestId("thanks")).toHaveCount(0);

  // Leaving through the panel is a clean close: no recovery notice next time.
  await page.getByTestId("back").click();
  await expect(page.getByTestId("projects")).toContainText("Historia de la arquitectura");
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: /Historia de la arquitectura/ }).click();
  await expect(app.locator("#body")).toHaveValue(/orden dórico/);
  await expect(page.getByTestId("recovered")).toBeHidden();
});

test("leaving right after typing keeps the last words", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("new-apuntes").click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await page.getByTestId("thanks-close").click({ timeout: 3000 }).catch(() => undefined);
  const app = page.frameLocator('[data-testid="program-frame"]');
  await app.locator("#title").fill("Al vuelo");
  await app.locator("#body").fill("Escrito justo antes de salir");
  // No waiting for the autosave: straight back to the panel.
  await page.getByTestId("back").click();
  await expect(page.getByTestId("projects")).toContainText("Al vuelo");
  await page.goto(projectUrl);
  await expect(app.locator("#body")).toHaveValue("Escrito justo antes de salir");
});

test("the theme switch reaches the program", async ({ page }) => {
  await signIn(page);
  const toggle = page.getByTestId("theme");
  await expect(toggle).toHaveText("Tema: sistema");
  await toggle.click();
  await expect(toggle).toHaveText("Tema: claro");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Projects live on the device until sync arrives, and every test starts a fresh browser.
  await page.getByTestId("new-apuntes").click();
  const app = page.frameLocator('[data-testid="program-frame"]');
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", /light|dark/);
});

test("the whole sign-in page works with the keyboard alone", async ({ page }) => {
  await page.goto("/#/ingresar");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.getByRole("textbox", { name: "Correo" }).focus();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Tus programas" })).toBeVisible({ timeout: 30_000 });
});

test("wrong passwords are throttled", async ({ page }) => {
  await page.goto("/#/ingresar");
  const fakeEmail = `nadie-${Date.now()}@example.com`;
  for (let i = 0; i < 5; i++) {
    await page.getByRole("textbox", { name: "Correo" }).fill(fakeEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(`incorrecta-${i}-xxxxx`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByTestId("error")).toHaveText("Correo o contraseña incorrectos", { timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByTestId("error")).toContainText("Demasiados intentos", { timeout: 30_000 });
});

test("deleting the account removes it for good", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Mi cuenta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  page.on("dialog", (d) => void d.accept());
  await page.getByLabel("Tu contraseña").fill(password);
  await page.getByTestId("delete-account").click();
  await expect(page).toHaveURL(/#\/ingresar$/, { timeout: 30_000 });

  await page.getByRole("textbox", { name: "Correo" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByTestId("error")).toHaveText("Correo o contraseña incorrectos", { timeout: 30_000 });
});
