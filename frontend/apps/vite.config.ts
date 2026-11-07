import react from "@vitejs/plugin-react";
import { cpSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildVersion, fillTemplate, programsAssets, type BuiltFile } from "../scripts/sw-build.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Every file under `dir`, with forward-slash paths relative to it. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}
/** Google API keys (the pattern gitleaks also uses). */
const KEY = /AIza[0-9A-Za-z_-]{35}/;

/**
 * Programs site. Built separately from the panel because it is served from another site
 * (see src/core/config.ts). Each program is one HTML entry; shared code is split into chunks
 * that are downloaded only when a program that needs them is opened.
 */
export default defineConfig({
  root: here("."),
  base: "/apps/",
  publicDir: here("static"),
  plugins: [
    react(),
    {
      // Excalidraw's published build embeds its own Firebase web key for live collaboration, which
      // ESTRELLA does not use (and the CSP blocks). No third-party keys ship to students: strip them,
      // and fail the build if a key pattern survives anywhere.
      name: "strip-embedded-keys",
      renderChunk(code) {
        return KEY.test(code) ? { code: code.replace(new RegExp(KEY.source, "g"), ""), map: null } : null;
      },
      generateBundle(_, bundle) {
        for (const file of Object.values(bundle)) {
          const text = file.type === "chunk" ? file.code : typeof file.source === "string" ? file.source : "";
          if (KEY.test(text)) throw new Error(`API key left in ${file.fileName}`);
        }
      },
    },
    {
      // Drawing fonts are served from here, never from a CDN: programs have no external network.
      name: "copy-whiteboard-fonts",
      closeBundle() {
        cpSync(here("../node_modules/@excalidraw/excalidraw/dist/prod/fonts"), here("../dist/apps/pizarra/fonts"), { recursive: true });
      },
    },
    {
      // dist/apps/sw.js: keeps programs for offline use. Runs after the fonts are copied.
      name: "programs-service-worker",
      apply: "build",
      async closeBundle() {
        const dist = here("../dist/apps");
        const paths = listFiles(dist).filter((p) => p !== "sw.js");
        const files: BuiltFile[] = paths.map((p) => ({ path: p, bytes: readFileSync(join(dist, p)) }));
        const code = fillTemplate(readFileSync(here("sw/programs-sw.js"), "utf8"), {
          VERSION: JSON.stringify(await buildVersion(files)),
          ASSETS: JSON.stringify(programsAssets(paths)),
        });
        writeFileSync(join(dist, "sw.js"), code);
      },
    },
  ],
  server: { port: 5174, strictPort: true },
  worker: { format: "es" },
  resolve: {
    // Visor's DWG reader: the package does not export its wasm file (licence in static/visor/licencias/SOURCE.txt).
    alias: [{ find: /^libredwg-web.wasm/, replacement: here("../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm") }],
  },
  build: {
    outDir: here("../dist/apps"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        pizarra: here("pizarra/index.html"),
        lienzo: here("lienzo/index.html"),
        folio: here("folio/index.html"),
        plano: here("plano/index.html"),
        visor: here("visor/index.html"),
        archivo: here("archivo/index.html"),
        solido: here("solido/index.html"),
        bim: here("bim/index.html"),
        revelado: here("revelado/index.html"),
        trazo: here("trazo/index.html"),
      },
    },
  },
});
