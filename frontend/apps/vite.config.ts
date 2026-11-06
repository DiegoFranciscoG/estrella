import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
      // Drawing fonts are served from here, never from a CDN: programs have no external network.
      name: "copy-whiteboard-fonts",
      closeBundle() {
        cpSync(here("../node_modules/@excalidraw/excalidraw/dist/prod/fonts"), here("../dist/apps/pizarra/fonts"), { recursive: true });
      },
    },
  ],
  server: { port: 5174, strictPort: true },
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
      },
    },
  },
});
