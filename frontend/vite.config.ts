import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:8080" },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**"],
      thresholds: { lines: 70 },
    },
  },
});
