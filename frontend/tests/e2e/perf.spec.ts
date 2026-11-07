import { CDPSession, expect, Page, test } from "@playwright/test";
import { signIn, useAccount } from "./helpers";

/**
 * T-06, rendimiento: "panel en menos de 1 s en perfil modesto" (docs/plan.md), measured once the app
 * is installed, as confirmed in F9; the first visit is measured and reported, within its 300 KB
 * budget. The modest profile is Lighthouse's mobile one (docs/investigacion.md): 4× slower CPU,
 * 150 ms of latency, 1.6 Mbps down and 750 Kbps up. Times run from the start of the navigation
 * until the page's main heading shows.
 */

useAccount();
test.describe.configure({ mode: "serial" });

async function modestProfile(page: Page): Promise<{ cdp: CDPSession; bytes: () => number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let total = 0;
  cdp.on("Network.loadingFinished", (e) => { total += e.encodedDataLength; });
  return { cdp, bytes: () => total };
}

async function shownAfter(page: Page, heading: string): Promise<number> {
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
  return page.evaluate(() => Math.round(performance.now()));
}

async function installed(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  }), { timeout: 30_000 }).toBe(true);
}

function report(label: string, ms: number, kb?: number): void {
  test.info().annotations.push({ type: label, description: kb === undefined ? `${ms} ms` : `${ms} ms, ${kb} KB` });
  console.log(`T-06 · ${label}: ${ms} ms${kb === undefined ? "" : ` (${kb} KB transferidos)`}`);
}

test("T-06: the first screen loads light on a modest phone, and in under a second once installed", async ({ page }) => {
  const { bytes } = await modestProfile(page);
  await page.goto("/#/ingresar");
  const first = await shownAfter(page, "Entrar");
  const firstKb = Math.round(bytes() / 1024);
  report("Entrar, primera visita", first, firstKb);
  // The panel's own weight budget (plan: 300 KB); measured compressed, as it travels.
  expect(firstKb).toBeLessThan(300);

  await installed(page);
  await page.reload();
  const again = await shownAfter(page, "Entrar");
  report("Entrar, app instalada", again);
  expect(again).toBeLessThan(1000);
});

test("T-06: a signed-in student's panel opens in under a second once installed", async ({ page }) => {
  await signIn(page);
  await installed(page);
  await modestProfile(page);
  await page.reload();
  const panel = await shownAfter(page, "Tus programas");
  report("Panel con sesión, app instalada", panel);
  expect(panel).toBeLessThan(1000);
});
