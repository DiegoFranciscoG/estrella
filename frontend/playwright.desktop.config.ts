import { defineConfig } from "@playwright/test";

/**
 * ESTRELLA for Windows, installed for real on this computer and driven through WebView2's
 * DevTools port (Windows only, with `docker compose up` running). Run: npm run e2e:desktop
 */
export default defineConfig({
  testDir: "tests/desktop",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8088",
    locale: "es-EC",
    serviceWorkers: "block",
  },
});
