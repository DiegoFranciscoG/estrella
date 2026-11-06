import { APIRequestContext, expect, FrameLocator, Page, request, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

/** Shared by the program tests: one verified account per test file, and the panel's own storage. */

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
// Each test file gets its own account: files share this module when they run in the same worker.
let email = "";
let password = "";
let mail: APIRequestContext;

/** Registers and verifies a fresh account before the file's tests run. */
export function useAccount(): void {
  test.beforeAll(async ({ browser }) => {
    email = `prog-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
    password = `frase-${randomBytes(12).toString("base64url")}`;
    mail = await request.newContext({ baseURL: MAILPIT });
    const page = await browser.newPage();
    await page.goto("/#/registro");
    await page.getByRole("textbox", { name: "Correo" }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repite la contraseña").fill(password);
    await page.getByLabel(/Tengo 15 años o más/).check();
    await page.getByLabel(/guarden mi correo/).check();
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page.getByTestId("recovery-code")).toBeVisible({ timeout: 30_000 });
    let token = "";
    for (let i = 0; i < 30 && !token; i++) {
      const list = await (await mail.get(`/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
      if (list.messages?.length) {
        const msg = await (await mail.get(`/api/v1/message/${list.messages[0].ID}`)).json();
        token = /token=([A-Za-z0-9_-]{43})/.exec(msg.Text)?.[1] ?? "";
      }
      if (!token) await page.waitForTimeout(500);
    }
    await page.goto(`/#/verificar?token=${token}`);
    await expect(page.getByRole("status")).toContainText("Correo confirmado");
    await page.close();
  });

  test.afterAll(async () => {
    await mail.dispose();
  });
}

export async function openNew(page: Page, programId: string): Promise<{ app: FrameLocator; projectId: string }> {
  await page.goto("/#/ingresar");
  await page.getByRole("textbox", { name: "Correo" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByTestId(`new-${programId}`).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}$/);
  const projectId = page.url().split("/p/")[1];
  await page.getByTestId("thanks-close").click({ timeout: 10_000 }).catch(() => undefined);
  return { app: page.frameLocator('[data-testid="program-frame"]'), projectId };
}

/** Reads the project exactly as stored in the panel's IndexedDB. */
export async function storedData(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const user = JSON.parse(localStorage.getItem("estrella:last-user")!).id;
    const db: IDBDatabase = await new Promise((ok, ko) => { const r = indexedDB.open(`estrella-${user}`); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const project = await new Promise<{ data: string } | undefined>((ok) => { const r = db.transaction("projects").objectStore("projects").get(id); r.onsuccess = () => ok(r.result); });
    db.close();
    return project?.data ?? "";
  }, projectId);
}

export async function waitSaved(page: Page, projectId: string, contains: string | RegExp): Promise<string> {
  let data = "";
  await expect.poll(async () => (data = await storedData(page, projectId)), { timeout: 30_000 }).toMatch(contains);
  return data;
}

export async function loseTabAndReopen(page: Page, projectId: string): Promise<void> {
  await page.reload();
  await page.goto(`/#/p/${projectId}`);
  await expect(page.getByTestId("recovered")).toContainText("Recuperamos tu trabajo", { timeout: 20_000 });
}

