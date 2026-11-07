import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { buildVersion, fillTemplate, panelPrecache, type BuiltFile } from "./scripts/sw-build.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Every file under `dir`, with forward-slash paths relative to it. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

export default defineConfig({
  plugins: [
    {
      // dist/sw.js: the panel's service worker, with this build's exact files and version.
      name: "panel-service-worker",
      apply: "build",
      async closeBundle() {
        const dist = here("dist");
        const precache = panelPrecache(listFiles(dist));
        const files: BuiltFile[] = precache.map((url) => ({ path: url.slice(1), bytes: readFileSync(join(dist, url.slice(1))) }));
        const code = fillTemplate(readFileSync(here("src/sw/panel-sw.js"), "utf8"), {
          VERSION: JSON.stringify(await buildVersion(files)),
          PRECACHE: JSON.stringify(precache),
        });
        writeFileSync(join(dist, "sw.js"), code);
      },
    },
  ],
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
      include: ["src/core/**", "apps/shared/bridge.ts", "apps/shared/offline.ts", "apps/folio/ops.ts", "apps/plano/model.ts", "apps/plano/dxf.ts", "apps/plano/svg.ts", "apps/shared/base64.ts", "apps/visor/detect.ts", "apps/visor/raw.ts", "apps/visor/cad-bounds.ts", "apps/visor/convert.ts", "apps/trazo/model.ts", "apps/trazo/svg-io.ts", "apps/revelado/develop.ts", "apps/bim/model.ts", "apps/solido/model.ts", "apps/archivo/catalog.ts", "apps/shared/zip.ts", "apps/shared/csv.ts", "apps/sitio/sun.ts", "apps/sitio/site.ts"],
      thresholds: { lines: 70 },
    },
  },
});
