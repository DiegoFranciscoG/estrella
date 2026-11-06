/// <reference lib="webworker" />
/**
 * DWG reader. LibreDWG (GPL-3.0, unmodified build of @mlightcad/libredwg-web; licence and source in
 * /apps/visor/licencias/SOURCE.txt) runs only inside this worker: it is a separate program that
 * Visor talks to with messages, it keeps the page responsive while parsing, and a crash in the
 * WebAssembly module ends the worker instead of the program.
 */
import { createModule, Dwg_File_Type, LibreDwg } from "@mlightcad/libredwg-web";
// The package exports only its JavaScript; an alias points at its wasm file (apps/vite.config.ts),
// so the build serves it once, with a content hash, from the cached assets folder.
import wasmUrl from "libredwg-web.wasm?url";
import { entityBounds, frameSvg } from "./cad-bounds";

export type DwgRequest = { op: "open" | "dxf"; bytes: ArrayBuffer };
export type DwgResponse =
  | { ok: true; op: "open"; svg: string; layers: string[]; counts: Record<string, number>; warning: boolean }
  | { ok: true; op: "dxf"; dxf: Uint8Array }
  | { ok: false; error: string };

let lib: Awaited<ReturnType<typeof LibreDwg.create>> | null = null;

/** LibreDWG reports problems as bit flags; 128 and above means the file could not be read. */
const CRITICAL = 128;

self.onmessage = async (event: MessageEvent<DwgRequest>) => {
  const { op, bytes } = event.data;
  try {
    lib ??= LibreDwg.createByWasmInstance(await createModule({ locateFile: () => wasmUrl }));
    if (op === "dxf") {
      const dxf = lib.dwg_write_dxf(bytes);
      if (!dxf) throw new Error("dxf");
      self.postMessage({ ok: true, op, dxf } satisfies DwgResponse, [dxf.buffer]);
      return;
    }
    let code = 0;
    const { log, warn } = console;
    // The wrapper prints the read status (with console.log or console.warn) instead of returning it.
    console.log = console.warn = (...args: unknown[]) => {
      const m = /error code:\s*(\d+)/.exec(args.map(String).join(" "));
      if (m) code = Number(m[1]);
    };
    let ptr: number | undefined;
    try {
      ptr = lib.dwg_read_data(bytes, Dwg_File_Type.DWG);
    } finally {
      console.log = log;
      console.warn = warn;
    }
    if (ptr === undefined || code >= CRITICAL) throw new Error("read");
    const db = lib.convert(ptr);
    const svg = frameSvg(lib.dwg_to_svg(db), entityBounds(db.entities as never));
    const counts: Record<string, number> = {};
    for (const e of db.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const layers = db.tables.LAYER.entries.map((l) => l.name).filter((n) => !n.startsWith("*"));
    lib.dwg_free(ptr);
    self.postMessage({ ok: true, op, svg, layers, counts, warning: code > 0 } satisfies DwgResponse);
  } catch (failure) {
    // The technical reason goes to the console for whoever helps the student; the screen explains.
    console.warn("DWG reader:", failure);
    self.postMessage({ ok: false, error: "No se pudo leer este DWG. Puede estar dañado o usar funciones que el lector libre aún no entiende. Pide que lo guarden como DXF." } satisfies DwgResponse);
    // The WebAssembly memory may be inconsistent after a failure: start clean next time.
    self.close();
  }
};
