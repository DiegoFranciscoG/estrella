import { Browser, chromium, expect, Page, test } from "@playwright/test";
import { ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { accountEmail, accountPassword, useAccount, waitSaved } from "../e2e/helpers";

/**
 * Phase 8, "install, uninstall and update without losing data", with the real ESTRELLA.exe on
 * this computer (per user, no administrator). Two builds (0.8.0 and 0.8.1) are made here; the test
 * refuses to run over an existing installation, and leaves the computer as it found it.
 */

test.skip(process.platform !== "win32", "ESTRELLA for Windows");
useAccount();

const APP = process.env.E2E_BASE_URL ?? "http://localhost:8088";
const LOCAL = process.env.LOCALAPPDATA ?? "";
const INSTALL_DIR = join(LOCAL, "Programs", "ESTRELLA");
const INSTALLED_EXE = join(INSTALL_DIR, "ESTRELLA.exe");
const DATA_DIR = join(LOCAL, "ESTRELLA");
const SHORTCUT = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "ESTRELLA.lnk");
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ESTRELLA";
// Short folder: Windows refuses to start programs from paths longer than 260 characters.
const BUILDS = join(tmpdir(), "estrella-desktop-e2e");
const PROJECT = resolve(process.cwd(), "..", "desktop", "windows", "Estrella.Desktop");
const CDP_PORT = 9335;

function build(version: string): string {
  const out = join(BUILDS, version);
  execFileSync("dotnet", ["build", PROJECT, "-c", "Debug", `-p:Version=${version}`, `-p:EstrellaUrl=${APP}`, "-o", out], { stdio: "pipe" });
  return join(out, "ESTRELLA.exe");
}

function run(exe: string, args: string[]): number | null {
  return spawnSync(exe, args, { windowsHide: true, timeout: 60_000 }).status;
}

function registryValue(name: string): string | null {
  const out = spawnSync("reg", ["query", UNINSTALL_KEY, "/v", name], { encoding: "utf8" });
  if (out.status !== 0) return null;
  return /REG_\w+\s+(.*)$/m.exec(out.stdout)?.[1].trim() ?? null;
}

async function gone(path: string): Promise<void> {
  await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(false);
}

interface Running {
  page: Page;
  close(): Promise<void>;
}

/** Opens the installed app with its DevTools port and connects to its window. */
async function launch(): Promise<Running> {
  const child: ChildProcess = spawn(INSTALLED_EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
    detached: false,
  });
  let browser: Browser | null = null;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`).catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) throw new Error("ESTRELLA.exe did not open its window");
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState("load");
  return {
    page,
    async close() {
      await browser!.close();
      const exited = new Promise((r) => child.once("exit", r));
      // A normal close request, as the window's X button does.
      spawnSync("taskkill", ["/pid", String(child.pid)]);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
      // WebView2's own processes finish right after the window.
      await new Promise((r) => setTimeout(r, 2000));
    },
  };
}

test.beforeAll(() => {
  if (existsSync(INSTALL_DIR) || registryValue("DisplayVersion") || existsSync(DATA_DIR)) {
    throw new Error("ESTRELLA para Windows ya está en este equipo (programa o datos). Esta prueba no la toca: desinstálala antes.");
  }
});

test.afterAll(() => {
  // Leave the computer as it was, whatever happened above.
  spawnSync("taskkill", ["/im", "ESTRELLA.exe", "/f"]);
  if (existsSync(INSTALLED_EXE)) run(INSTALLED_EXE, ["--uninstall", "--silent", "--delete-data"]);
  rmSync(BUILDS, { recursive: true, force: true });
});

test("installs for the user, keeps projects through an update and an uninstall, and removes everything when asked", async () => {
  const v1 = build("0.8.0");
  const v2 = build("0.8.1");

  // Install: per user, a Start menu entry, Settings > Apps, and the WebView2 licence next to the program.
  expect(run(v1, ["--install", "--silent"])).toBe(0);
  expect(existsSync(INSTALLED_EXE)).toBe(true);
  expect(existsSync(SHORTCUT)).toBe(true);
  expect(registryValue("DisplayVersion")).toBe("0.8.0");
  expect(registryValue("UninstallString")).toBe(`"${INSTALLED_EXE}" --uninstall`);
  expect(readFileSync(join(INSTALL_DIR, "AVISOS-DE-TERCEROS.txt"), "utf8")).toMatch(/WebView2[\s\S]*Redistribution/);

  // First use: sign in and write a project, saved on this computer.
  let app = await launch();
  await app.page.goto(`${APP}/#/ingresar`);
  await app.page.getByRole("textbox", { name: "Correo" }).fill(accountEmail());
  await app.page.getByLabel("Contraseña", { exact: true }).fill(accountPassword());
  await app.page.getByRole("button", { name: "Entrar", exact: true }).click();
  await app.page.getByTestId("new-apuntes").click();
  await app.page.getByTestId("thanks-close").click({ timeout: 10_000 }).catch(() => undefined);
  const projectId = app.page.url().split("/p/")[1];
  const program = app.page.frameLocator('[data-testid="program-frame"]');
  await program.locator("#title").fill("Escrito en la app de Windows");
  await program.locator("#body").fill("Este texto debe sobrevivir a la actualización y a la desinstalación.");
  await waitSaved(app.page, projectId, /sobrevivir/);
  expect(await app.page.evaluate(() => navigator.userAgent)).toContain("EstrellaDesktop/0.8.0");
  // The app answers only its one request, and only for programs on its list.
  const reply = await app.page.evaluate(() => new Promise<string>((done) => {
    const webview = (window as unknown as { chrome: { webview: EventTarget & { postMessage(m: string): void } } }).chrome.webview;
    webview.addEventListener("message", (e) => done(String((e as MessageEvent).data)), { once: true });
    webview.postMessage("estrella:desktop:install:calc");
  }));
  expect(reply).toBe("estrella:desktop:rejected:calc");
  // The guide offers installing official desktop programs only here (not clicked: it would install FreeCAD).
  await app.page.goto(`${APP}/#/guia?q=curvas+libres`);
  await expect(app.page.locator(".guide-card").first().getByTestId("install-freecad")).toHaveText("Instalar en este equipo");
  await app.close();

  // Update to 0.8.1: the program changes, the student's data does not.
  expect(run(v2, ["--install", "--silent"])).toBe(0);
  expect(registryValue("DisplayVersion")).toBe("0.8.1");
  app = await launch();
  expect(await app.page.evaluate(() => navigator.userAgent)).toContain("EstrellaDesktop/0.8.1");
  await expect(app.page.getByTestId("projects")).toContainText("Escrito en la app de Windows");
  await app.close();

  // Uninstall keeping the data (the default): program, shortcut and entry go; projects stay.
  expect(run(INSTALLED_EXE, ["--uninstall", "--silent"])).toBe(0);
  await gone(INSTALL_DIR);
  expect(existsSync(SHORTCUT)).toBe(false);
  expect(registryValue("DisplayVersion")).toBeNull();
  expect(existsSync(join(DATA_DIR, "WebView2"))).toBe(true);

  // Reinstalled, the project is there again.
  expect(run(v2, ["--install", "--silent"])).toBe(0);
  app = await launch();
  await expect(app.page.getByTestId("projects")).toContainText("Escrito en la app de Windows");
  await app.page.getByRole("link", { name: /Escrito en la app de Windows/ }).click();
  await expect(app.page.frameLocator('[data-testid="program-frame"]').locator("#body"))
    .toHaveValue("Este texto debe sobrevivir a la actualización y a la desinstalación.");
  await app.close();

  // Uninstall deleting the data: nothing of ESTRELLA is left on the computer.
  expect(run(INSTALLED_EXE, ["--uninstall", "--silent", "--delete-data"])).toBe(0);
  await gone(INSTALL_DIR);
  await gone(DATA_DIR);
});
