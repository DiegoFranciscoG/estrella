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
      include: ["src/core/**", "apps/shared/bridge.ts", "apps/folio/ops.ts", "apps/plano/model.ts", "apps/plano/dxf.ts", "apps/plano/svg.ts", "apps/shared/base64.ts", "apps/visor/detect.ts", "apps/visor/raw.ts", "apps/visor/cad-bounds.ts", "apps/visor/convert.ts"],
      thresholds: { lines: 70 },
    },
  },
});
