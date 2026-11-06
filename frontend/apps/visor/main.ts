import { fromBase64, toBase64 } from "../shared/base64";
import { connect } from "../shared/bridge";
import "../shared/program.css";
import { mimeOf, renameTo, targetsFor, type Target } from "./convert";
import { detect, MAX_FILE_BYTES, type Detected } from "./detect";
import type { DwgRequest, DwgResponse } from "./dwg.worker";
import "./visor.css";
import type { Viewer3D } from "./view3d";

/**
 * Visor opens what a student receives, entirely in their computer. Each reader is downloaded only
 * when a file needs it: opening a JPG never downloads the DWG or 3D readers.
 */

/** Files up to this size are kept in the project so they reopen after a crash; larger ones are not. */
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
/** Largest side of a PNG made from a vector drawing. */
const MAX_RASTER = 8192;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const view2d = $("view2d");
const view3d = $("view3d");
const statusEl = $("status");
const convert = $<HTMLSelectElement>("convert");

interface Opened {
  name: string;
  bytes: Uint8Array;
  detected: Detected;
  /** Element shown in the 2D view, at its natural size. */
  element?: HTMLImageElement | HTMLCanvasElement;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Vector drawing (DXF, DWG) for SVG export. */
  svg?: string;
  /** Embedded JPG of a RAW file. */
  preview?: Uint8Array;
  viewer?: Viewer3D;
  pdf?: { doc: import("pdfjs-dist").PDFDocumentProxy; task: import("pdfjs-dist").PDFDocumentLoadingTask; page: number };
  urls: string[];
}

let opened: Opened | null = null;
let dark = false;
let worker: Worker | null = null;

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  async load(data) {
    if (!data) return;
    try {
      const saved = JSON.parse(data) as { name?: string; file?: string | null };
      if (saved.file && saved.name) await openBytes(saved.name, fromBase64(saved.file));
      else if (saved.name) status(`«${saved.name}» era demasiado grande para guardarlo en el proyecto. Ábrelo otra vez.`);
    } catch {
      status("No se pudo abrir el archivo guardado.", true);
    }
  },
  serialize() {
    if (!opened) return JSON.stringify({ v: 1 });
    const keep = opened.bytes.length <= MAX_PROJECT_BYTES;
    return JSON.stringify({ v: 1, name: opened.name, file: keep ? toBase64(opened.bytes) : null });
  },
  onTheme(theme) {
    dark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    opened?.viewer?.setTheme(dark);
  },
});

// ---------------------------------------------------------------------------------------------
// Opening

function close(): void {
  if (!opened) return;
  opened.viewer?.dispose();
  void opened.pdf?.task.destroy();
  for (const url of opened.urls) URL.revokeObjectURL(url);
  opened = null;
  view2d.replaceChildren();
  view3d.replaceChildren();
}

async function openFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    status(`«${file.name}» pesa ${mb(file.size)}. Visor abre archivos de hasta ${mb(MAX_FILE_BYTES)} para no agotar la memoria de equipos modestos.`, true);
    return;
  }
  await openBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  bridge.changed();
}

async function openBytes(name: string, bytes: Uint8Array): Promise<void> {
  const detected = detect(name, bytes.subarray(0, 4096), bytes.length);
  close();
  opened = { name, bytes, detected, urls: [] };
  const current = opened;
  bridge.setTitle(name);
  showInfo(current, []);
  if (detected.kind === "unsupported") {
    showStage("none");
    status(detected.note ?? "Visor no abre este archivo.", true);
    updateControls();
    return;
  }
  status(`Abriendo ${detected.label}…`);
  try {
    const facts = await bridge.busy(() => render(current));
    if (opened !== current) return;
    showInfo(current, facts);
    const { label, note } = current.detected;
    status(note ? `${label} abierto. ${note}` : `${label} abierto.`);
  } catch (error) {
    if (opened !== current) return;
    showStage("none");
    status(error instanceof ReadError ? error.message : `No se pudo abrir este ${detected.label}. Puede estar dañado o usar funciones que el lector libre no entiende.`, true);
  }
  updateControls();
}

class ReadError extends Error {}

type Fact = [string, string];

async function render(o: Opened): Promise<Fact[]> {
  const { kind } = o.detected;
  if (kind === "image") {
    const img = await image(new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type: o.detected.subtype }), o);
    show2d(o, img, "checker");
    return [["Tamaño", `${img.naturalWidth} × ${img.naturalHeight} px`]];
  }
  if (kind === "svg") {
    // An <img> runs no scripts and loads nothing external, so an SVG from anyone is safe to show.
    const img = await image(new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" }), o);
    show2d(o, img, "checker");
    return [["Tamaño", `${img.naturalWidth} × ${img.naturalHeight} px`]];
  }
  if (kind === "raw") {
    const { largestPreview } = await import("./raw");
    const p = largestPreview(o.bytes);
    if (!p) throw new ReadError("Este RAW no trae una vista previa que Visor pueda mostrar. Ábrelo con darktable o RawTherapee (escritorio, gratis).");
    o.preview = o.bytes.slice(p.start, p.end);
    const img = await image(new Blob([o.preview as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), o);
    show2d(o, img, "paper");
    return [["Vista previa", `${p.width} × ${p.height} px`]];
  }
  if (kind === "psd") {
    const { openPsd } = await import("./psd");
    const r = openPsd(o.bytes);
    show2d(o, r.canvas, "checker");
    if (r.rebuilt) o.detected = { ...o.detected, note: "El archivo no guarda una imagen combinada; se rearmó con sus capas visibles y los efectos o modos de fusión pueden verse distintos." };
    listItems("Capas", r.layers.map((l) => ({ text: `${"· ".repeat(l.depth)}${l.name}`, off: !l.visible })));
    return [["Tamaño", `${r.width} × ${r.height} px`], ["Capas", String(r.layers.length)]];
  }
  if (kind === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: o.bytes.slice() });
    const doc = await task.promise;
    o.pdf = { doc, task, page: 1 };
    await showPdfPage(o);
    return [["Páginas", String(doc.numPages)]];
  }
  if (kind === "dxf") {
    const { fromDxf } = await import("../plano/dxf");
    const { toSvg } = await import("../plano/svg");
    const result = fromDxf(new TextDecoder().decode(o.bytes));
    o.svg = toSvg(result.drawing);
    const img = await image(new Blob([o.svg], { type: "image/svg+xml" }), o);
    show2d(o, img, "paper");
    const skipped = Object.entries(result.skipped);
    if (skipped.length) {
      o.detected = { ...o.detected, note: "Algunos elementos no se dibujan todavía; la lista está a la derecha. Para verlos todos, pide el plano en PDF." };
      listItems("No se muestran", skipped.map(([type, n]) => ({ text: `${type}: ${n}` })));
    }
    return [["Elementos", String(result.imported)], ["Capas", String(result.drawing.layers.length)]];
  }
  if (kind === "dwg") {
    status(`Abriendo ${o.detected.label}… la primera vez se descarga el lector de DWG (1,7 MB).`);
    const r = await dwg({ op: "open", bytes: o.bytes.slice().buffer });
    if (!r.ok) throw new ReadError(r.error);
    if (r.op !== "open") throw new ReadError("Respuesta inesperada del lector de DWG.");
    o.svg = r.svg;
    const img = await image(new Blob([r.svg], { type: "image/svg+xml" }), o);
    show2d(o, img, "cad");
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    o.detected = {
      ...o.detected,
      note: (r.warning ? "El lector avisó de partes que no entendió del todo. " : "")
        + "Lectura con LibreDWG: tramas, tipos de línea, cotas y textos especiales pueden verse distintos. Para medir, descárgalo como DXF y ábrelo en Plano.",
    };
    listItems("Capas", r.layers.map((name) => ({ text: name })));
    return [["Elementos", String(total)], ["Capas", String(r.layers.length)]];
  }
  if (kind === "mesh" || kind === "ifc") {
    const view = await import("./view3d");
    let model;
    const facts: Fact[] = [];
    if (kind === "ifc") {
      status("Abriendo IFC… la primera vez se descarga el lector de IFC (1,1 MB).");
      const { readIfc } = await import("./ifc");
      const r = await readIfc(o.bytes);
      if (!r.parts.length) throw new ReadError("El IFC no contiene geometría que se pueda mostrar.");
      model = view.groupFromParts(r.parts);
      facts.push(["Esquema", r.schema]);
      listItems("Elementos", r.counts.map((c) => ({ text: `${c.label}: ${c.count}` })));
    } else {
      model = await view.parseMesh(o.detected.subtype ?? "", o.bytes);
    }
    showStage("3d");
    try {
      o.viewer = view.createViewer(view3d, model, { lite: bridge.lite, dark });
    } catch {
      throw new ReadError("Este navegador o equipo no tiene 3D activado (WebGL). Prueba con otro navegador o actualiza el controlador de video.");
    }
    const { size, triangles } = o.viewer.info;
    // web-ifc converts IFC lengths to metres; other mesh formats do not say their unit.
    const unit = kind === "ifc" ? " m" : "";
    facts.push(["Triángulos", triangles.toLocaleString("es")], ["Medidas", `${num(size.x)} × ${num(size.y)} × ${num(size.z)}${unit}`]);
    if (kind === "mesh") facts.push(["Unidades", "las del archivo (sin indicar)"]);
    return facts;
  }
  throw new ReadError("Formato no soportado.");
}

function dwg(request: DwgRequest): Promise<DwgResponse> {
  return new Promise((resolve) => {
    worker ??= new Worker(new URL("./dwg.worker.ts", import.meta.url), { type: "module" });
    const w = worker;
    const done = (r: DwgResponse) => {
      w.onmessage = null;
      w.onerror = null;
      // After a failure the worker closes itself; a new one starts with clean memory.
      if (!r.ok) worker = null;
      resolve(r);
    };
    w.onmessage = (e: MessageEvent<DwgResponse>) => done(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      done({ ok: false, error: "El lector de DWG se detuvo. El archivo puede ser demasiado grande para este equipo." });
    };
    w.postMessage(request, [request.bytes]);
  });
}

function image(blob: Blob, o: Opened): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  o.urls.push(url);
  const img = new Image();
  img.alt = o.name;
  img.decoding = "async";
  img.draggable = false;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ReadError(`El navegador no pudo decodificar este ${o.detected.label}.`));
    img.src = url;
  });
}

async function showPdfPage(o: Opened): Promise<void> {
  if (!o.pdf) return;
  const page = await o.pdf.doc.getPage(o.pdf.page);
  const viewport = page.getViewport({ scale: bridge.lite ? 1.25 : 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const keep = o.element && o.naturalWidth === canvas.width;
  show2d(o, canvas, "paper", !!keep);
  $("page").textContent = `${o.pdf.page} / ${o.pdf.doc.numPages}`;
}

// ---------------------------------------------------------------------------------------------
// 2D view: zoom by resizing the element (vector drawings stay sharp), pan by moving it.

const view = { scale: 1, x: 0, y: 0 };

function showStage(which: "2d" | "3d" | "none"): void {
  // With a file open, an empty stage means it could not be shown; the status line says why.
  $("empty").hidden = which !== "none" || !!opened;
  view2d.hidden = which !== "2d";
  view3d.hidden = which !== "3d";
}

function show2d(o: Opened, element: HTMLImageElement | HTMLCanvasElement, look: "paper" | "checker" | "cad", keepView = false): void {
  o.element = element;
  o.naturalWidth = element instanceof HTMLImageElement ? element.naturalWidth || 1000 : element.width;
  o.naturalHeight = element instanceof HTMLImageElement ? element.naturalHeight || 1000 : element.height;
  element.classList.add(look);
  element.setAttribute("data-look", look);
  view2d.replaceChildren(element);
  showStage("2d");
  if (keepView) applyView();
  else fit();
  const drawing = o.detected.kind === "dwg" || o.detected.kind === "dxf";
  $("dark").hidden = !drawing;
  $("dark").setAttribute("aria-pressed", String(look === "cad"));
}

function applyView(): void {
  const o = opened;
  if (!o?.element || !o.naturalWidth || !o.naturalHeight) return;
  o.element.style.width = `${o.naturalWidth * view.scale}px`;
  o.element.style.height = `${o.naturalHeight * view.scale}px`;
  o.element.style.transform = `translate(${view.x}px, ${view.y}px)`;
  $("zoom").textContent = `${Math.round(view.scale * 100)} %`;
}

function fit(): void {
  const o = opened;
  if (o?.viewer) return o.viewer.fit();
  if (!o?.naturalWidth || !o.naturalHeight) return;
  const w = view2d.clientWidth || 800;
  const h = view2d.clientHeight || 600;
  view.scale = Math.min((w - 32) / o.naturalWidth, (h - 32) / o.naturalHeight);
  view.x = (w - o.naturalWidth * view.scale) / 2;
  view.y = (h - o.naturalHeight * view.scale) / 2;
  applyView();
}

function zoomAt(factor: number, cx = view2d.clientWidth / 2, cy = view2d.clientHeight / 2): void {
  const next = Math.min(Math.max(view.scale * factor, 0.01), 64);
  const k = next / view.scale;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.scale = next;
  applyView();
}

view2d.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = view2d.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

let drag: { id: number; x: number; y: number } | null = null;
view2d.addEventListener("pointerdown", (e) => {
  drag = { id: e.pointerId, x: e.clientX - view.x, y: e.clientY - view.y };
  view2d.setPointerCapture(e.pointerId);
  view2d.classList.add("panning");
});
view2d.addEventListener("pointermove", (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  view.x = e.clientX - drag.x;
  view.y = e.clientY - drag.y;
  applyView();
});
const endDrag = () => { drag = null; view2d.classList.remove("panning"); };
view2d.addEventListener("pointerup", endDrag);
view2d.addEventListener("pointercancel", endDrag);
new ResizeObserver(() => { if (opened?.element) fit(); }).observe(view2d);

function setDark(on: boolean): void {
  view2d.querySelector(".cad, .paper")?.classList.toggle("cad", on);
  view2d.querySelector(".cad, .paper")?.classList.toggle("paper", !on);
  $("dark").setAttribute("aria-pressed", String(on));
}

// ---------------------------------------------------------------------------------------------
// Side panel and toolbar

function showInfo(o: Opened, facts: Fact[]): void {
  $("side").hidden = false;
  $("name").textContent = o.name;
  const format = $("format");
  format.hidden = false;
  format.textContent = o.detected.label;
  const dl = $("facts");
  dl.replaceChildren();
  for (const [k, v] of [["Formato", o.detected.label], ["Peso", mb(o.bytes.length)], ...facts] as Fact[]) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const note = $("note");
  note.hidden = !o.detected.note;
  note.textContent = o.detected.note ?? "";
  if (!facts.length) listItems("", []);
}

function listItems(title: string, items: { text: string; off?: boolean }[]): void {
  const heading = $("list-title");
  heading.hidden = !items.length;
  heading.textContent = title;
  const ul = $("list");
  ul.replaceChildren(...items.slice(0, 500).map((item) => {
    const li = document.createElement("li");
    li.textContent = item.text;
    if (item.off) {
      li.className = "off";
      li.title = "Capa oculta en el archivo";
    }
    return li;
  }));
}

function updateControls(): void {
  const o = opened;
  const has2d = !!o?.element && !view2d.hidden;
  const has3d = !!o?.viewer;
  $<HTMLButtonElement>("fit").disabled = !(has2d || has3d);
  for (const id of ["zoom-in", "zoom-out"]) $<HTMLButtonElement>(id).disabled = !has2d;
  if (!has2d) $("zoom").textContent = "—";
  $("pages").hidden = !o?.pdf || o.pdf.doc.numPages < 2;
  $("wire").hidden = !has3d;
  if (!has2d || !["dwg", "dxf"].includes(o?.detected.kind ?? "")) $("dark").hidden = true;
  const targets = o && (has2d || has3d) ? targetsFor(o.detected.kind) : [];
  convert.replaceChildren(...targets.map((t) => new Option(t.label, t.value)));
  convert.disabled = !targets.length;
  $<HTMLButtonElement>("download").disabled = !targets.length;
}

$<HTMLInputElement>("open").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await openFile(file);
});

stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("drop"); });
stage.addEventListener("dragleave", () => stage.classList.remove("drop"));
stage.addEventListener("drop", async (e) => {
  e.preventDefault();
  stage.classList.remove("drop");
  const file = e.dataTransfer?.files?.[0];
  if (file) await openFile(file);
});

$("fit").addEventListener("click", fit);
$("zoom-in").addEventListener("click", () => zoomAt(1.25));
$("zoom-out").addEventListener("click", () => zoomAt(0.8));
$("dark").addEventListener("click", () => setDark($("dark").getAttribute("aria-pressed") !== "true"));
$("wire").addEventListener("click", () => {
  const on = $("wire").getAttribute("aria-pressed") !== "true";
  $("wire").setAttribute("aria-pressed", String(on));
  opened?.viewer?.setWireframe(on);
});
for (const [id, step] of [["prev", -1], ["next", 1]] as const) {
  $(id).addEventListener("click", async () => {
    const o = opened;
    if (!o?.pdf) return;
    const page = o.pdf.page + step;
    if (page < 1 || page > o.pdf.doc.numPages) return;
    o.pdf.page = page;
    await bridge.busy(() => showPdfPage(o));
  });
}
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === "+" || e.key === "=") zoomAt(1.25);
  else if (e.key === "-") zoomAt(0.8);
  else if (e.key === "0") fit();
});

// ---------------------------------------------------------------------------------------------
// Converting

$("download").addEventListener("click", async () => {
  const o = opened;
  if (!o) return;
  const target = convert.value as Target;
  try {
    const blob = await bridge.busy(() => produce(o, target));
    const suffix = o.pdf ? `-p${o.pdf.page}` : "";
    save(blob, renameTo(o.name, target, suffix));
    status(`Listo: ${renameTo(o.name, target, suffix)} (${mb(blob.size)}).`);
  } catch (error) {
    status(error instanceof ReadError ? error.message : "No se pudo convertir el archivo.", true);
  }
});

async function produce(o: Opened, target: Target): Promise<Blob> {
  if (o.viewer) return target === "png" ? o.viewer.snapshot() : o.viewer.exportAs(target as "stl" | "obj" | "glb");
  if (target === "svg" && o.svg) return new Blob([o.svg], { type: mimeOf("svg") });
  if (target === "jpg" && o.preview) return new Blob([o.preview as Uint8Array<ArrayBuffer>], { type: mimeOf("jpg") });
  if (target === "dxf") {
    const r = await dwg({ op: "dxf", bytes: o.bytes.slice().buffer });
    if (!r.ok || r.op !== "dxf") throw new ReadError(r.ok ? "No se pudo convertir a DXF." : r.error);
    return new Blob([r.dxf as Uint8Array<ArrayBuffer>], { type: mimeOf("dxf") });
  }
  return raster(o, target);
}

async function raster(o: Opened, target: Target): Promise<Blob> {
  const source = o.element;
  if (!source || !o.naturalWidth || !o.naturalHeight) throw new ReadError("No hay nada que convertir.");
  const k = Math.min(1, MAX_RASTER / Math.max(o.naturalWidth, o.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(o.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(o.naturalHeight * k));
  const ctx = canvas.getContext("2d")!;
  const look = source.getAttribute("data-look");
  // JPG has no transparency; drawings also need their paper behind them.
  if (target === "jpg" || look === "paper" || look === "cad") {
    ctx.fillStyle = source.classList.contains("cad") ? "#111111" : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ReadError("El navegador no pudo crear la imagen."))), mimeOf(target), 0.92));
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
}

function num(n: number): string {
  return n.toLocaleString("es", { maximumFractionDigits: n < 10 ? 3 : 1 });
}

updateControls();
