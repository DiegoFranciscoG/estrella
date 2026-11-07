import { expect, Page, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { openNew, signIn, useAccount, waitSaved } from "./helpers";

/**
 * Phase 8, the installed web app, against the production build served by nginx (docker compose),
 * with service workers on: installable by Chromium's own rules, the panel and a program open
 * without internet, and a new version never loses the last words typed.
 */

useAccount();
test.describe.configure({ mode: "serial" });

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** Runs a command inside the web container as root (only to simulate a new deploy). */
function inWeb(command: string): string {
  return execFileSync("docker", ["compose", "exec", "-T", "-u", "root", "web", "sh", "-c", command], {
    cwd: resolve(process.cwd(), ".."),
    encoding: "utf8",
  });
}

async function panelWorkerReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  }), { timeout: 30_000 }).toBe(true);
}

/** URLs the programs' service worker has kept, read from inside the program's own site. */
async function keptPrograms(page: Page): Promise<string[]> {
  const frame = page.frames().find((f) => f.url().includes("/apps/"));
  if (!frame) return [];
  return frame.evaluate(async () => (await (await caches.open("estrella-programs")).keys()).map((r) => r.url)).catch(() => []);
}

test("Chromium considers ESTRELLA installable, with real icons for every launcher", async ({ page, request }) => {
  await page.goto("/#/guia");
  await panelWorkerReady(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "ESTRELLA", short_name: "ESTRELLA", start_url: "/", display: "standalone", lang: "es" });
  expect(manifest.prefer_related_applications).toBeUndefined();
  const pngs = manifest.icons.filter((i: { type: string }) => i.type === "image/png");
  expect(pngs.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of pngs) {
    const res = await request.get(icon.src);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(pngSize(await res.body()).join("x")).toBe(icon.sizes);
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(pngSize(await (await request.get(touch!)).body())).toEqual([180, 180]);

  await page.goto("/#/instalar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instala ESTRELLA");
  await expect(page.locator('details[data-platform="windows"]')).toHaveAttribute("open", "");
  await expect(page.locator('details[data-platform="windows"] .badge')).toHaveText("Tu equipo");
  await expect(page.getByTestId("windows-installer")).toContainText("No está firmado");
});

test("the panel and a program open without internet after the first visit", async ({ page, context }) => {
  const { app, projectId } = await openNew(page, "apuntes");
  await app.locator("#title").fill("Sin conexión");
  await app.locator("#body").fill("Escrito con internet, leído sin internet.");
  await waitSaved(page, projectId, /leído sin internet/);
  await panelWorkerReady(page);
  // The program keeps itself the first time it opens: its page and its own files.
  await expect.poll(async () => {
    const kept = await keptPrograms(page);
    return ["/apps/apuntes/index.html", "/apps/apuntes/apuntes.js", "/apps/apuntes/apuntes.css"].every((f) => kept.some((u) => u.endsWith(f)));
  }, { timeout: 30_000 }).toBe(true);
  await page.getByTestId("back").click();
  await expect(page.getByTestId("projects")).toContainText("Sin conexión");

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByTestId("projects")).toContainText("Sin conexión", { timeout: 30_000 });
    await page.getByRole("link", { name: /Sin conexión/ }).click();
    await expect(page.frameLocator('[data-testid="program-frame"]').locator("#body")).toHaveValue("Escrito con internet, leído sin internet.", { timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});

test("a new version waits for the student and keeps the last words typed", async ({ page }) => {
  await signIn(page);
  await panelWorkerReady(page);
  await page.getByTestId("new-apuntes").click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await page.getByTestId("thanks-close").click({ timeout: 3000 }).catch(() => undefined);
  const app = page.frameLocator('[data-testid="program-frame"]');
  await app.locator("#title").fill("Antes de actualizar");

  // A deploy: same files, new worker version.
  inWeb("cp /usr/share/nginx/html/sw.js /tmp/sw.js.bak && sed -i 's/const VERSION = \"\\([0-9a-f]*\\)\"/const VERSION = \"\\1-next\"/' /usr/share/nginx/html/sw.js");
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const banner = page.getByTestId("update-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    // Typed right before accepting, still inside the program's save delay.
    await app.locator("#body").fill("Última frase antes de actualizar");
    const reloaded = page.waitForEvent("load", { timeout: 30_000 });
    await page.getByTestId("update-now").click();
    await reloaded;
    await expect(page).toHaveURL(projectUrl);
    await expect(app.locator("#body")).toHaveValue("Última frase antes de actualizar", { timeout: 30_000 });
    await expect(page.getByTestId("recovered")).toBeHidden();
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  } finally {
    inWeb("cp /tmp/sw.js.bak /usr/share/nginx/html/sw.js");
  }
});
