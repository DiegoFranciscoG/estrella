import { Browser, BrowserContext, expect, FrameLocator, Page, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { accountEmail, accountPassword, signIn, sql, storedData, useAccount } from "./helpers";

/**
 * Phase 6 through the real panel, API and database:
 * T-09 nothing readable reaches the server, T-08 two devices share projects without mixing them,
 * T-10 deleting leaves no row and no stored bytes.
 */

useAccount();
test.describe.configure({ mode: "serial" });

const MARKER = `marca-${randomBytes(6).toString("hex")}`;
const contexts: BrowserContext[] = [];

/** Each device is a separate browser profile: its own storage, its own keys. */
async function device(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  await signIn(page);
  return page;
}

test.afterAll(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function enableCloud(page: Page): Promise<void> {
  await page.goto("/#/cuenta");
  const toggle = page.getByTestId("cloud-toggle");
  await expect(toggle).toHaveText(/Activar la nube|Desactivar/, { timeout: 15_000 });
  if ((await toggle.textContent())?.startsWith("Activar")) await toggle.click();
  await expect(toggle).toHaveText(/Desactivar/);
}

async function write(page: Page, title: string, body: string): Promise<FrameLocator> {
  const app = page.frameLocator('[data-testid="program-frame"]');
  await page.getByTestId("thanks-close").click({ timeout: 3000 }).catch(() => undefined);
  await app.locator("#title").fill(title);
  await app.locator("#body").fill(body);
  await expect(page.getByTestId("save-status")).toContainText("Guardado", { timeout: 15_000 });
  return app;
}

async function backToPanelSynced(page: Page): Promise<void> {
  await page.getByTestId("back").click();
  await expect(page.getByTestId("place").first()).toHaveText("En la nube", { timeout: 30_000 });
}

test("a project travels encrypted to a second device and its changes come back (T-08, T-09)", async ({ browser }) => {
  const a = await device(browser);
  const sent: Buffer[] = [];
  a.on("request", (r) => {
    if (r.url().includes("/api/")) {
      const body = r.postDataBuffer();
      if (body) sent.push(body);
    }
  });
  await enableCloud(a);
  await a.goto("/#/");
  await a.getByTestId("new-apuntes").click();
  await write(a, `Apuntes ${MARKER}`, `Contenido privado ${MARKER}`);
  await backToPanelSynced(a);
  await expect(a.getByTestId("sync-bar")).toHaveAttribute("data-state", "idle");

  // T-09 on the wire: no request carried the title or the content in readable form.
  expect(sent.some((b) => b.length > 28)).toBe(true);
  for (const body of sent) expect(body.includes(MARKER)).toBe(false);

  // T-09 in the database: the project is there, its bytes and its name are not readable.
  const email = accountEmail();
  expect(sql(`SELECT count(*) FROM project p JOIN user_account u ON u.id = p.user_id WHERE u.email = '${email}';`)).toBe("1");
  expect(sql(`SELECT count(*) FROM project_blob WHERE position(convert_to('${MARKER}', 'UTF8') in data) > 0;`)).toBe("0");
  expect(sql(`SELECT count(*) FROM project WHERE position(convert_to('${MARKER}', 'UTF8') in encrypted_name) > 0;`)).toBe("0");

  // T-08: a second device receives it, decrypted with the same password-derived key.
  const b = await device(browser);
  await expect(b.getByTestId("projects")).toContainText(`Apuntes ${MARKER}`, { timeout: 30_000 });
  await b.getByRole("link", { name: new RegExp(MARKER) }).click();
  const appB = b.frameLocator('[data-testid="program-frame"]');
  await expect(appB.locator("#body")).toHaveValue(`Contenido privado ${MARKER}`);
  await write(b, `Apuntes ${MARKER}`, `Editado en el segundo equipo ${MARKER}`);
  await backToPanelSynced(b);

  // Back on the first device, the change arrives (checked in its storage before opening it:
  // a project open in a tab is never replaced under the student's hands).
  const projectId = (await a.getByRole("link", { name: new RegExp(MARKER) }).getAttribute("href"))!.split("/p/")[1];
  await a.getByRole("button", { name: "Sincronizar ahora" }).click();
  await expect.poll(() => storedData(a, projectId), { timeout: 30_000 }).toContain("Editado en el segundo equipo");
  await a.getByRole("link", { name: new RegExp(MARKER) }).click();
  await expect(a.frameLocator('[data-testid="program-frame"]').locator("#body")).toHaveValue(`Editado en el segundo equipo ${MARKER}`, { timeout: 15_000 });

  // A reload keeps syncing without asking for the password again (non-extractable keys kept here).
  await a.goto("/#/");
  await a.reload();
  await expect(a.getByTestId("sync-bar")).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
  await expect(a.locator("#unlock-password")).toHaveCount(0);
});

test("exports everything, turns the cloud off and deletes the account leaving nothing behind (T-10)", async ({ browser }) => {
  const page = await device(browser);
  const email = accountEmail();
  const userId = sql(`SELECT id FROM user_account WHERE email = '${email}';`);
  expect(userId).toMatch(/^[0-9a-f-]{36}$/);

  // Portability: one ZIP with the account data and the project, decrypted on this device.
  await page.goto("/#/cuenta");
  await expect(page.getByTestId("cloud-toggle")).toHaveText(/Desactivar/, { timeout: 15_000 });
  const download = page.waitForEvent("download");
  await page.getByTestId("export-all").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^estrella-mis-datos-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = readFileSync(await file.path());
  expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
  for (const name of ["LEEME.txt", "datos-personales.json", "proyectos/"]) expect(zip.includes(name)).toBe(true);
  expect(zip.includes(`Editado en el segundo equipo ${MARKER}`)).toBe(true);
  expect(zip.includes(email)).toBe(true);

  // Revoking the cloud deletes the server copy (LOPDP art. 15.6); this device keeps its projects.
  await page.getByTestId("cloud-toggle").click();
  await expect(page.getByText(/Se borraron 1 proyecto\(s\) del servidor/)).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT count(*) FROM project WHERE user_id = '${userId}';`)).toBe("0");
  await page.goto("/#/");
  await expect(page.getByTestId("projects")).toContainText(MARKER);
  await expect(page.getByTestId("place").first()).toHaveText("Solo en este equipo", { timeout: 15_000 });

  // Turning it on again uploads what this device has: nothing was lost.
  await enableCloud(page);
  await expect.poll(() => sql(`SELECT count(*) FROM project WHERE user_id = '${userId}';`), { timeout: 30_000 }).toBe("1");
  expect(Number(sql(`SELECT count(*) FROM project_blob b JOIN project_version v ON v.storage_key = b.storage_key JOIN project p ON p.id = v.project_id WHERE p.user_id = '${userId}';`))).toBeGreaterThan(0);

  // T-10: deleting the account removes every row about it and every stored byte.
  const keys = sql(`SELECT string_agg(storage_key, ',') FROM project_version v JOIN project p ON p.id = v.project_id WHERE p.user_id = '${userId}';`);
  await page.locator("#delete-password").fill(accountPassword());
  await page.getByTestId("delete-account").click();
  await expect(page).toHaveURL(/#\/ingresar$/, { timeout: 15_000 });
  expect(sql(`SELECT count(*) FROM user_account WHERE id = '${userId}' OR email = '${email}';`)).toBe("0");
  for (const table of ["user_session", "email_token", "consent_record", "project", "program_state"]) {
    expect(sql(`SELECT count(*) FROM ${table} WHERE user_id = '${userId}';`), table).toBe("0");
  }
  const keyList = keys.split(",").filter(Boolean).map((k) => `'${k.replace(/'/g, "")}'`).join(",");
  expect(sql(`SELECT count(*) FROM project_blob WHERE storage_key IN (${keyList});`)).toBe("0");
});
