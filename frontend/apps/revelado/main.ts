import { fromBase64, toBase64 } from "../shared/base64";
import { connect } from "../shared/bridge";
import "../shared/program.css";
import { largestPreview } from "../visor/raw";
import { cropFor, develop, histogram, NEUTRAL, outputSize, parseSettings, range, SLIDERS, type Crop, type Settings, type Slider } from "./develop";
import "./revelado.css";

/** Larger photos can be developed and exported, but are not kept inside the project. */
const MAX_PROJECT_BYTES = 30 * 1024 * 1024;
/** Above this, the photo is scaled down to work with, so memory stays reasonable on modest devices. */
const MAX_PIXELS = 36_000_000;
const RAW = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|pef|srw|raf|erf|kdc|3fr|mrw|x3f)$/i;
const LABELS: Record<Slider, string> = {
  exposure: "Exposición", contrast: "Contraste", highlights: "Luces", shadows: "Sombras",
  temperature: "Temperatura", tint: "Matiz", saturation: "Saturación", vibrance: "Intensidad",
};
const GROUPS: Record<"light" | "color", Slider[]> = {
  light: ["exposure", "contrast", "highlights", "shadows"],
  color: ["temperature", "tint", "saturation", "vibrance"],
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $<HTMLCanvasElement>("view");
const stage = $("stage");
const cropBox = $("crop-box");
const statusEl = $("status");

let original: { bytes: Uint8Array; mime: string; name: string } | null = null;
let bitmap: ImageBitmap | null = null;
let settings: Settings = { ...NEUTRAL };
let cropping = false;
let before = false;
let base: ImageData | null = null;
let developed: ImageData | null = null;
let frame = 0;
let rawNote = "";
const undoStack: string[] = [];
const redoStack: string[] = [];
let pending: string | null = null;
let worker: Worker | null = null;

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  async load(data) {
    if (!data) return refresh();
    try {
      const saved = JSON.parse(data) as { name?: string; mime?: string; image?: string | null; settings?: unknown };
      settings = parseSettings(saved.settings);
      if (saved.image && typeof saved.mime === "string") {
        const bytes = fromBase64(saved.image);
        await show(bytes, saved.mime, typeof saved.name === "string" ? saved.name : "foto");
      } else if (saved.name) {
        status(`Vuelve a abrir «${saved.name}» para seguir: era muy grande para guardarla dentro del proyecto. Tus ajustes se conservan.`, true);
      }
    } catch {
      status("No se pudo abrir el revelado guardado.", true);
    }
    refresh();
  },
  serialize() {
    const keep = original && original.bytes.length <= MAX_PROJECT_BYTES;
    return JSON.stringify({
      v: 1,
      name: original?.name ?? null,
      mime: original?.mime ?? null,
      image: keep ? toBase64(original!.bytes) : null,
      settings,
    });
  },
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
    drawHistogram();
  },
});

// ---------------------------------------------------------------------------- history

function begin(): void {
  pending ??= JSON.stringify(settings);
}

function commit(): void {
  if (pending === null) return;
  if (pending !== JSON.stringify(settings)) {
    undoStack.push(pending);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    bridge.changed();
  }
  pending = null;
  refresh();
}

function restore(from: string[], to: string[]): void {
  const snapshot = from.pop();
  if (!snapshot) return;
  to.push(JSON.stringify(settings));
  settings = parseSettings(JSON.parse(snapshot));
  bridge.changed();
  rebuild();
}

/** Records one change made in one go (a button, a reset). */
function change(work: () => void): void {
  begin();
  work();
  commit();
  rebuild();
}

// ----------------------------------------------------------------------------- photos

async function decode(bytes: Uint8Array, mime: string): Promise<ImageBitmap> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const full = await createImageBitmap(blob);
  const pixels = full.width * full.height;
  if (pixels <= MAX_PIXELS) return full;
  const k = Math.sqrt(MAX_PIXELS / pixels);
  const smaller = await createImageBitmap(blob, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: "high" });
  full.close();
  return smaller;
}

async function show(bytes: Uint8Array, mime: string, name: string): Promise<void> {
  const next = await decode(bytes, mime);
  bitmap?.close();
  bitmap = next;
  original = { bytes, mime, name };
  $("empty").hidden = true;
  view.hidden = false;
  rebuild();
}

function mimeOf(name: string, type: string): string {
  if (/^image\/(jpeg|png|webp)$/.test(type)) return type;
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "";
}

$<HTMLInputElement>("open").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await bridge.busy(async () => {
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      let mime = mimeOf(file.name, file.type);
      rawNote = "";
      if (RAW.test(file.name)) {
        const preview = largestPreview(bytes);
        if (!preview) throw new Error("Este RAW no trae una vista previa JPG que se pueda revelar.");
        bytes = bytes.slice(preview.start, preview.end);
        mime = "image/jpeg";
        rawNote = `RAW: se revela la vista previa de ${preview.width} × ${preview.height} px que guarda la cámara.`;
      }
      if (!mime) throw new Error("Revelado abre fotos JPG, PNG, WebP y RAW de cámara.");
      undoStack.length = 0;
      redoStack.length = 0;
      settings = { ...NEUTRAL };
      await show(bytes, mime, file.name);
      bridge.changed();
      status(bytes.length > MAX_PROJECT_BYTES
        ? `Foto abierta. Pesa ${(bytes.length / 1048576).toFixed(0)} MB: puedes revelarla y exportarla, pero no se guarda dentro del proyecto.`
        : "Foto abierta. Ajusta la luz y el color a la derecha.", bytes.length > MAX_PROJECT_BYTES);
    } catch (e) {
      status(e instanceof Error && e.message ? e.message : "No se pudo abrir la foto.", true);
    }
  });
});

// ------------------------------------------------------------------------ geometry

/** The photo turned, flipped and (optionally) cropped, at `scale` of its size. */
function geometry(bmp: ImageBitmap, s: Settings, scale: number, withCrop: boolean): HTMLCanvasElement {
  const turned = s.rotate === 90 || s.rotate === 270;
  const fullW = (turned ? bmp.height : bmp.width) * scale;
  const fullH = (turned ? bmp.width : bmp.height) * scale;
  const crop: Crop = withCrop && s.crop ? s.crop : { x: 0, y: 0, w: 1, h: 1 };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(fullW * crop.w));
  canvas.height = Math.max(1, Math.round(fullH * crop.h));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(-crop.x * fullW + fullW / 2, -crop.y * fullH + fullH / 2);
  if (s.flip) ctx.scale(-1, 1);
  ctx.rotate((s.rotate * Math.PI) / 180);
  ctx.drawImage(bmp, (-bmp.width * scale) / 2, (-bmp.height * scale) / 2, bmp.width * scale, bmp.height * scale);
  return canvas;
}

/** Recomputes the preview's undeveloped pixels: after opening, turning, cropping or resizing. */
function rebuild(): void {
  if (!bitmap) return refresh();
  const turned = settings.rotate === 90 || settings.rotate === 270;
  const w = turned ? bitmap.height : bitmap.width;
  const h = turned ? bitmap.width : bitmap.height;
  const crop = !cropping && settings.crop ? settings.crop : { w: 1, h: 1 };
  const room = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const limit = bridge.lite ? 1000 : 1800;
  const side = Math.min(limit, Math.max(room.width, room.height) * dpr || limit);
  const scale = Math.min(1, side / Math.max(w * crop.w, h * crop.h));
  const canvas = geometry(bitmap, settings, scale, !cropping);
  base = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  developed = new ImageData(base.width, base.height);
  view.width = base.width;
  view.height = base.height;
  refresh();
}

function paint(): void {
  frame = 0;
  if (!base || !developed) return;
  if (before) developed.data.set(base.data);
  else develop(base.data, settings, developed.data);
  view.getContext("2d")!.putImageData(developed, 0, 0);
  drawHistogram();
  placeCropBox();
}

function schedule(): void {
  if (!frame) frame = requestAnimationFrame(paint);
}

function drawHistogram(): void {
  const canvas = $<HTMLCanvasElement>("histogram");
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!developed) return;
  const bins = histogram(developed.data);
  const top = Math.max(1, ...bins.slice(1, 255));
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#111";
  for (let i = 0; i < 256; i++) {
    const h = Math.min(canvas.height, (bins[i] / top) * canvas.height);
    ctx.fillRect(i, canvas.height - h, 1, h);
  }
}

// -------------------------------------------------------------------------- controls

const outputs = new Map<Slider, { input: HTMLInputElement; output: HTMLOutputElement }>();

function format(key: Slider, value: number): string {
  if (key === "exposure") return `${value > 0 ? "+" : ""}${value.toFixed(2)} EV`;
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

for (const [group, keys] of Object.entries(GROUPS)) {
  const holder = $(group);
  for (const key of keys) {
    const [min, max] = range(key);
    const wrap = document.createElement("div");
    wrap.className = "slider";
    const label = document.createElement("label");
    label.htmlFor = `s-${key}`;
    label.textContent = LABELS[key];
    const output = document.createElement("output");
    output.htmlFor.add(`s-${key}`);
    const input = document.createElement("input");
    input.type = "range";
    input.id = `s-${key}`;
    input.min = String(min);
    input.max = String(max);
    input.step = key === "exposure" ? "0.05" : "1";
    input.value = "0";
    input.addEventListener("input", () => {
      begin();
      settings[key] = Number(input.value);
      output.value = format(key, settings[key]);
      schedule();
    });
    input.addEventListener("change", () => commit());
    input.addEventListener("dblclick", () => {
      begin();
      settings[key] = 0;
      commit();
      schedule();
    });
    wrap.append(label, output, input);
    holder.append(wrap);
    outputs.set(key, { input, output });
  }
}

$<HTMLInputElement>("bw").addEventListener("change", (ev) => {
  begin();
  settings.bw = (ev.target as HTMLInputElement).checked;
  commit();
  schedule();
});

/** Brings controls, buttons and the info line in line with the current state. */
function refresh(): void {
  for (const key of SLIDERS) {
    const { input, output } = outputs.get(key)!;
    if (document.activeElement !== input) input.value = String(settings[key]);
    output.value = format(key, settings[key]);
  }
  $<HTMLInputElement>("bw").checked = settings.bw;
  const has = bitmap !== null;
  for (const id of ["rotate-left", "rotate-right", "flip", "crop", "aspect", "before", "reset", "export-jpg", "export-png"]) {
    ($(id) as HTMLButtonElement).disabled = !has;
  }
  ($("uncrop") as HTMLButtonElement).disabled = !has || !settings.crop;
  ($("undo") as HTMLButtonElement).disabled = !undoStack.length;
  ($("redo") as HTMLButtonElement).disabled = !redoStack.length;
  $("flip").setAttribute("aria-pressed", String(settings.flip));
  $("crop").setAttribute("aria-pressed", String(cropping));
  $("before").setAttribute("aria-pressed", String(before));
  view.classList.toggle("cropping", cropping);
  if (bitmap) {
    const out = outputSize(bitmap.width, bitmap.height, settings);
    $("info").textContent = `${rawNote ? rawNote + " " : ""}Exporta ${out.w} × ${out.h} px.`;
  } else {
    $("info").textContent = "";
  }
  schedule();
}

/** Keeps the crop over the same part of the photo when it turns or flips. */
function turnCrop(c: Crop | null, how: "right" | "left" | "flip"): Crop | null {
  if (!c) return null;
  if (how === "right") return { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w };
  if (how === "left") return { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
  return { ...c, x: 1 - (c.x + c.w) };
}

// A flip mirrors the turn too: on a flipped photo, a quarter turn the other way looks right.
$("rotate-right").addEventListener("click", () => change(() => {
  settings.rotate = ((settings.rotate + (settings.flip ? 270 : 90)) % 360) as Settings["rotate"];
  settings.crop = turnCrop(settings.crop, "right");
}));
$("rotate-left").addEventListener("click", () => change(() => {
  settings.rotate = ((settings.rotate + (settings.flip ? 90 : 270)) % 360) as Settings["rotate"];
  settings.crop = turnCrop(settings.crop, "left");
}));
$("flip").addEventListener("click", () => change(() => {
  settings.flip = !settings.flip;
  settings.crop = turnCrop(settings.crop, "flip");
}));
$("reset").addEventListener("click", () => change(() => {
  settings = { ...NEUTRAL };
}));
$("uncrop").addEventListener("click", () => change(() => {
  settings.crop = null;
}));
$("before").addEventListener("click", () => {
  before = !before;
  refresh();
});
$("crop").addEventListener("click", () => {
  cropping = !cropping;
  status(cropping ? "Arrastra sobre la foto para marcar el recorte; pulsa Recortar otra vez para verlo." : "");
  rebuild();
});
$("undo").addEventListener("click", () => restore(undoStack, redoStack));
$("redo").addEventListener("click", () => restore(redoStack, undoStack));
window.addEventListener("resize", () => rebuild());
window.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement && ev.target.type !== "range") return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    if (ev.shiftKey) restore(redoStack, undoStack);
    else restore(undoStack, redoStack);
  } else if (ctrl && ev.key.toLowerCase() === "y") {
    ev.preventDefault();
    restore(redoStack, undoStack);
  }
});

// ------------------------------------------------------------------------------ crop

let cropFrom: [number, number] | null = null;

function fraction(ev: PointerEvent): [number, number] {
  const r = view.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
}

function placeCropBox(): void {
  const c = settings.crop;
  cropBox.hidden = !cropping || !c;
  if (!cropping || !c) return;
  const r = view.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  Object.assign(cropBox.style, {
    left: `${r.left - s.left + c.x * r.width}px`,
    top: `${r.top - s.top + c.y * r.height}px`,
    width: `${c.w * r.width}px`,
    height: `${c.h * r.height}px`,
  });
}

view.addEventListener("pointerdown", (ev) => {
  if (!cropping || !base) return;
  cropFrom = fraction(ev);
  begin();
  view.setPointerCapture(ev.pointerId);
});
view.addEventListener("pointermove", (ev) => {
  if (!cropFrom || !base) return;
  const aspect = Number($<HTMLSelectElement>("aspect").value) || null;
  settings.crop = cropFor(aspect, base.width / base.height, cropFrom, fraction(ev));
  placeCropBox();
});
view.addEventListener("pointerup", (ev) => {
  if (!cropFrom) return;
  cropFrom = null;
  view.releasePointerCapture(ev.pointerId);
  if (settings.crop && (settings.crop.w < 0.01 || settings.crop.h < 0.01)) settings.crop = null;
  commit();
});

// ---------------------------------------------------------------------------- export

function developFull(pixels: ImageData): Promise<ImageData> {
  worker ??= new Worker(new URL("./develop.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const w = worker!;
    w.onmessage = (ev: MessageEvent<{ data: Uint8ClampedArray<ArrayBuffer> }>) => resolve(new ImageData(ev.data.data, pixels.width, pixels.height));
    w.onerror = () => reject(new Error("worker"));
    w.postMessage({ data: pixels.data, settings }, [pixels.data.buffer]);
  });
}

function fileName(ext: string): string {
  const stem = (bridge.title() || original?.name.replace(/\.[^.]+$/, "") || "foto").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "foto";
  return `${stem}-revelada.${ext}`;
}

async function exportAs(mime: "image/jpeg" | "image/png", ext: string): Promise<void> {
  if (!bitmap) return;
  await bridge.busy(async () => {
    try {
      status("Revelando a tamaño completo…");
      const canvas = geometry(bitmap!, settings, 1, true);
      const ctx = canvas.getContext("2d")!;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.putImageData(await developFull(pixels), 0, 0);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, mime, 0.92));
      if (!blob) throw new Error("blob");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName(ext);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      status(`Foto exportada: ${canvas.width} × ${canvas.height} px, sin datos de la cámara ni ubicación.`);
    } catch {
      worker?.terminate();
      worker = null;
      status("No se pudo exportar la foto. Si es muy grande, prueba en un equipo con más memoria.", true);
    }
  });
}

$("export-jpg").addEventListener("click", () => void exportAs("image/jpeg", "jpg"));
$("export-png").addEventListener("click", () => void exportAs("image/png", "png"));

refresh();
