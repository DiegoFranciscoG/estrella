import { defineConfig, devices } from "@playwright/test";

/** End-to-end tests run against the full stack started with `docker compose up --build`. */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8088",
    locale: "es-EC",
    trace: "retain-on-failure",
    // Intercepted test doubles must reach the page; the offline cache would serve the real files instead.
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", testIgnore: [/pwa\.spec\.ts/, /perf\.spec\.ts/, /mobile\.spec\.ts/], use: { ...devices["Desktop Chrome"] } },
    // The installed app: service workers on, as students have them (also for the T-06 timings).
    { name: "pwa", testMatch: /(pwa|perf)\.spec\.ts/, use: { ...devices["Desktop Chrome"], serviceWorkers: "allow" } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
});
