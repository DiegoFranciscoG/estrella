import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { connect } from "../shared/bridge";
import "../shared/program.css";
import "./folio.css";
import * as ops from "./ops";

// Rendering runs in pdf.js's worker, off the page's main thread.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Larger documents can be edited and downloaded, but are not kept inside the project. */
const MAX_PROJECT_BYTES = 30 * 1024 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const thumbs = $("thumbs");
const canvas = $<HTMLCanvasElement>("canvas");
const overlay = $("overlay");

let bytes: Uint8Array | null = null;
let doc: pdfjs.PDFDocumentProxy | null = null;
let loading: pdfjs.PDFDocumentLoadingTask | null = null;
let current = 0;
let zoom = 1;
let tool: "select" | "text" | "highlight" = "select";
let viewport: pdfjs.PageViewport | null = null;
const selected = new Set<number>();
const history = new ops.History();

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  async load(data) {
    if (!data) return;
    try {
      const saved = JSON.parse(data) as { pdf?: string | null; page?: number };
      if (saved.pdf) await show(ops.fromBase64(saved.pdf), saved.page ?? 0);
    } catch {
      status("No se pudo abrir el documento guardado.", true);
    }
  },
  serialize() {
    const keep = bytes && bytes.length <= MAX_PROJECT_BYTES;
    return JSON.stringify({ v: 1, pdf: keep ? ops.toBase64(bytes!) : null, page: current });
  },
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
  },
});

async function show(next: Uint8Array, page = current): Promise<void> {
  bytes = next;
  // pdf.js takes ownership of the buffer it receives, so it gets a copy.
  const task = pdfjs.getDocument({ data: next.slice() });
  const loaded = await task.promise;
  await loading?.destroy();
  loading = task;
  doc = loaded;
  current = Math.min(Math.max(0, page), doc.numPages - 1);
  for (const i of [...selected]) if (i >= doc.numPages) selected.delete(i);
  $("empty").hidden = true;
  $("page").hidden = false;
  await renderThumbs();
  await renderPage();
  updateButtons();
  if (next.length > MAX_PROJECT_BYTES) {
    status(`Este PDF pesa ${(next.length / 1048576).toFixed(0)} MB: puedes editarlo y descargarlo, pero no se guarda dentro del proyecto. Descárgalo antes de salir.`, true);
  }
}

async function apply(label: string, work: (b: Uint8Array) => Promise<Uint8Array>, page = current): Promise<void> {
  if (!bytes) return;
  try {
    const result = await bridge.busy(() => work(bytes!));
    history.push(bytes);
    await show(result, page);
    status(label);
    bridge.changed();
  } catch (e) {
    status(e instanceof ops.PdfError ? e.message : "No se pudo completar la operación.", true);
  }
}

async function renderPage(): Promise<void> {
  if (!doc) return;
  const page = await doc.getPage(current + 1);
  const ratio = window.devicePixelRatio || 1;
  viewport = page.getViewport({ scale: zoom * 1.25 });
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
  overlay.replaceChildren();
  $("zoom").textContent = `${Math.round(zoom * 100)} %`;
  thumbs.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", i === current ? "page" : "false"));
}

/** Thumbnails are drawn only when they scroll into view, so long documents open fast. */
async function renderThumbs(): Promise<void> {
  if (!doc) return;
  const d = doc;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const c = entry.target as HTMLCanvasElement;
      observer.unobserve(c);
      void d.getPage(Number(c.dataset.page) + 1).then((p) => {
        const v = p.getViewport({ scale: 0.25 });
        c.width = v.width;
        c.height = v.height;
        return p.render({ canvas: c, viewport: v }).promise;
      }).catch(() => undefined);
    }
  }, { root: thumbs });
  const items: HTMLElement[] = [];
  for (let i = 0; i < d.numPages; i++) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Ir a la página ${i + 1}`);
    button.setAttribute("aria-current", i === current ? "page" : "false");
    const c = document.createElement("canvas");
    c.dataset.page = String(i);
    c.width = 120;
    c.height = 160;
    button.appendChild(c);
    button.addEventListener("click", () => { current = i; void renderPage(); updateButtons(); });
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(i);
    box.addEventListener("change", () => { if (box.checked) selected.add(i); else selected.delete(i); updateButtons(); });
    label.append(box, ` Página ${i + 1}`);
    li.append(button, label);
    items.push(li);
    observer.observe(c);
  }
  thumbs.replaceChildren(...items);
}

function targets(): number[] {
  return selected.size ? [...selected].sort((a, b) => a - b) : [current];
}

function updateButtons(): void {
  const has = doc !== null;
  for (const id of ["rotate", "delete", "left", "right", "download", "extract", "zoom-in", "zoom-out", "append"]) {
    const el = $(id) as HTMLButtonElement | HTMLInputElement;
    el.disabled = !has;
  }
  ($("left") as HTMLButtonElement).disabled = !has || current === 0;
  ($("right") as HTMLButtonElement).disabled = !has || current >= (doc?.numPages ?? 1) - 1;
  ($("extract") as HTMLButtonElement).disabled = !has || selected.size === 0;
  ($("undo") as HTMLButtonElement).disabled = !history.canUndo;
  ($("redo") as HTMLButtonElement).disabled = !history.canRedo;
}

function download(data: Uint8Array, suffix = ""): void {
  const name = (bridge.title().trim() || "documento").replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 80) || "documento";
  const url = URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}${suffix}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readFile(file: File): Promise<Uint8Array> {
  if (file.size > 200 * 1048576) throw new ops.PdfError("El archivo supera 200 MB; es demasiado para el navegador.");
  return new Uint8Array(await file.arrayBuffer());
}

/** Screen position inside the page to PDF user-space point (handles rotated pages). */
function toPdf(event: PointerEvent | MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return viewport!.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top) as [number, number];
}

$<HTMLInputElement>("open").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const data = await bridge.busy(() => readFile(file));
    await ops.pageCount(data);
    if (bytes) history.push(bytes);
    selected.clear();
    if (!bridge.title() || /sin título$/.test(bridge.title())) bridge.setTitle(file.name.replace(/\.pdf$/i, ""));
    await show(data, 0);
    status(`Abierto: ${file.name} (${doc!.numPages} páginas).`);
    bridge.changed();
  } catch (err) {
    status(err instanceof ops.PdfError ? err.message : "No se pudo abrir ese archivo.", true);
  }
});

$<HTMLInputElement>("append").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  for (const file of files) {
    try {
      const other = await readFile(file);
      await apply(`Se unió ${file.name} al final.`, (b) => ops.merge(b, other));
    } catch (err) {
      status(err instanceof ops.PdfError ? err.message : `No se pudo unir ${file.name}.`, true);
    }
  }
});

$("rotate").addEventListener("click", () => void apply("Páginas giradas.", (b) => ops.rotate(b, targets())));
$("delete").addEventListener("click", () => {
  const list = targets();
  if (!window.confirm(list.length === 1 ? `¿Borrar la página ${list[0] + 1}?` : `¿Borrar ${list.length} páginas?`)) return;
  selected.clear();
  void apply("Páginas borradas.", (b) => ops.remove(b, list), Math.min(current, (doc?.numPages ?? 1) - 1 - list.length));
});
$("left").addEventListener("click", () => void apply("Página movida.", (b) => ops.move(b, current, current - 1), current - 1));
$("right").addEventListener("click", () => void apply("Página movida.", (b) => ops.move(b, current, current + 1), current + 1));
$("download").addEventListener("click", () => { if (bytes) download(bytes); });
$("extract").addEventListener("click", async () => {
  if (!bytes) return;
  try {
    download(await ops.extract(bytes, targets()), "-paginas");
  } catch (err) {
    status(err instanceof ops.PdfError ? err.message : "No se pudo extraer.", true);
  }
});
$("zoom-in").addEventListener("click", () => { zoom = Math.min(4, zoom * 1.25); void renderPage(); });
$("zoom-out").addEventListener("click", () => { zoom = Math.max(0.25, zoom / 1.25); void renderPage(); });

async function undoRedo(direction: "undo" | "redo"): Promise<void> {
  if (!bytes) return;
  const next = direction === "undo" ? history.undo(bytes) : history.redo(bytes);
  if (!next) return;
  await show(next);
  bridge.changed();
  status(direction === "undo" ? "Deshecho." : "Rehecho.");
}
$("undo").addEventListener("click", () => void undoRedo("undo"));
$("redo").addEventListener("click", () => void undoRedo("redo"));

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
  b.addEventListener("click", () => {
    tool = b.dataset.tool as typeof tool;
    document.querySelectorAll("[data-tool]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    overlay.className = `overlay ${tool}`;
    status(tool === "text" ? "Haz clic donde quieras escribir. Enter guarda, Mayús+Enter cambia de línea, Esc cancela."
      : tool === "highlight" ? "Arrastra sobre la zona que quieres resaltar." : "");
  });
});

overlay.addEventListener("pointerdown", (start) => {
  if (!doc || !viewport) return;
  const rect = overlay.getBoundingClientRect();
  const x0 = start.clientX - rect.left;
  const y0 = start.clientY - rect.top;
  if (tool === "text") {
    start.preventDefault();
    const [px, py] = toPdf(start);
    const area = document.createElement("textarea");
    area.style.left = `${x0}px`;
    area.style.top = `${y0}px`;
    area.setAttribute("aria-label", "Texto para añadir a la página");
    overlay.replaceChildren(area);
    setTimeout(() => area.focus(), 0);
    area.addEventListener("keydown", (k) => {
      if (k.key === "Escape") overlay.replaceChildren();
      if (k.key === "Enter" && !k.shiftKey) {
        k.preventDefault();
        const text = area.value.trim();
        overlay.replaceChildren();
        if (text) void apply("Texto añadido.", (b) => ops.addText(b, current, px, py, text, 12));
      }
    });
  } else if (tool === "highlight") {
    const box = document.createElement("div");
    box.className = "box";
    overlay.replaceChildren(box);
    const [ax, ay] = toPdf(start);
    const moveHandler = (m: PointerEvent) => {
      const x = m.clientX - rect.left;
      const y = m.clientY - rect.top;
      Object.assign(box.style, { left: `${Math.min(x, x0)}px`, top: `${Math.min(y, y0)}px`, width: `${Math.abs(x - x0)}px`, height: `${Math.abs(y - y0)}px` });
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", moveHandler);
      window.removeEventListener("pointerup", up);
      overlay.replaceChildren();
      const [bx, by] = toPdf(u);
      if (Math.abs(bx - ax) > 3 && Math.abs(by - ay) > 3) void apply("Zona resaltada.", (b) => ops.addHighlight(b, current, ax, ay, bx, by));
    };
    window.addEventListener("pointermove", moveHandler);
    window.addEventListener("pointerup", up);
  }
});

window.addEventListener("keydown", (k) => {
  if ((k.target as HTMLElement).tagName === "TEXTAREA") return;
  if ((k.ctrlKey || k.metaKey) && k.key.toLowerCase() === "z") { k.preventDefault(); void undoRedo("undo"); }
  if ((k.ctrlKey || k.metaKey) && k.key.toLowerCase() === "y") { k.preventDefault(); void undoRedo("redo"); }
  if (!doc) return;
  if (k.key === "ArrowRight" || k.key === "PageDown") { current = Math.min(doc.numPages - 1, current + 1); void renderPage(); updateButtons(); }
  if (k.key === "ArrowLeft" || k.key === "PageUp") { current = Math.max(0, current - 1); void renderPage(); updateButtons(); }
});

updateButtons();
