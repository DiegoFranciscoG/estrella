import { connect } from "../shared/bridge";
import { csv } from "../shared/csv";
import "../shared/program.css";
import { crc32, MAX_ENTRIES as ZIP_MAX_ENTRIES, MAX_TOTAL as ZIP_MAX_TOTAL, zipLayout } from "../shared/zip";
import { largestPreview } from "../visor/raw";
import "./archivo.css";
import {
  addTags, extensionOf, formatSize, isoDate, KIND_LABELS, kindOf, labelText, LABELS, newCatalog, opensWith, parseCatalog, parseTags,
  renamePlan, scan, setLabel, setRating, setSize, setTags, visible, type Catalog, type Entry, type FileKind, type Label, type Sort,
} from "./catalog";

/** Tiles drawn at once; the search and filters narrow larger folders. */
const MAX_TILES = 1000;
const THUMB = 320;
const PICTURE = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const grid = $<HTMLUListElement>("grid");
const query = $<HTMLInputElement>("query");
const kindEl = $<HTMLSelectElement>("kind");
const minRatingEl = $<HTMLSelectElement>("min-rating");
const labelFilter = $<HTMLSelectElement>("label-filter");
const sortEl = $<HTMLSelectElement>("sort");
const ratingEl = $<HTMLSelectElement>("rating");
const labelEl = $<HTMLSelectElement>("label");
const tagsEl = $<HTMLInputElement>("tags");
const dialog = $<HTMLDialogElement>("rename-dialog");
const patternEl = $<HTMLInputElement>("pattern");
const startEl = $<HTMLInputElement>("start");

let catalog: Catalog = newCatalog();
/** The files themselves, only while this tab is open: they are never stored in the project. */
const files = new Map<string, File>();
const thumbs = new Map<string, string>();
let selected = new Set<string>();
let current: string | null = null;
let anchor: string | null = null;
let shown: Entry[] = [];

for (const [value, text] of [["", "Todo tipo"], ...Object.entries(KIND_LABELS)]) kindEl.append(new Option(text, value));
for (const [value, text] of [["", "Toda etiqueta"], ...Object.keys(LABELS).map((l) => [l, labelText(l as Label)])]) labelFilter.append(new Option(text, value));
for (const [value, text] of [["", "Sin etiqueta"], ...Object.keys(LABELS).map((l) => [l, labelText(l as Label)])]) labelEl.append(new Option(text, value));

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  load(data) {
    try {
      catalog = parseCatalog(data ? JSON.parse(data) : null);
    } catch {
      catalog = newCatalog();
      status("No se pudo leer el catálogo guardado.", true);
    }
    showFilters();
    render();
    if (catalog.entries.length) {
      const where = catalog.folder ? `la carpeta «${catalog.folder}»` : "tus archivos";
      status(`Vuelve a elegir ${where} para ver las miniaturas y renombrar. Tus calificaciones, etiquetas y palabras clave están guardadas.`);
    }
  },
  serialize() {
    return JSON.stringify(catalog);
  },
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
  },
});

function change(next: Catalog): void {
  catalog = next;
  bridge.changed();
}

// ---------------------------------------------------------------------------- reading files

function addFiles(list: FileList | null, folderMode: boolean): void {
  if (!list?.length) return;
  const picked = [...list];
  const found = picked.map((f) => ({ path: (folderMode && f.webkitRelativePath) || f.name, size: f.size, modified: f.lastModified }));
  const folder = folderMode ? (picked[0].webkitRelativePath.split("/")[0] || null) : null;
  if (folderMode) {
    files.clear();
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    thumbs.clear();
  }
  const result = scan(catalog, found, folder, !folderMode);
  for (let i = 0; i < picked.length; i++) files.set(found[i].path.replace(/\\/g, "/").replace(/^\/+/, ""), picked[i]);
  selected = new Set([...selected].filter((p) => result.catalog.entries.some((e) => e.path === p)));
  if (current && !selected.has(current)) current = null;
  change(result.catalog);
  render();
  const n = result.catalog.entries.length;
  status(`${n.toLocaleString("es")} ${n === 1 ? "archivo" : "archivos"} en el catálogo.${result.skipped ? ` Se dejaron fuera ${result.skipped.toLocaleString("es")}: el máximo es ${(10_000).toLocaleString("es")}.` : ""}`);
}

$<HTMLInputElement>("folder").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  addFiles(input.files, true);
  input.value = "";
});
$<HTMLInputElement>("add").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  addFiles(input.files, false);
  input.value = "";
});

// ---------------------------------------------------------------------------- thumbnails

const queue: string[] = [];
let working = false;

const observer = new IntersectionObserver((items) => {
  for (const item of items) {
    if (!item.isIntersecting) continue;
    observer.unobserve(item.target);
    const path = (item.target as HTMLElement).dataset.path!;
    if (!thumbs.has(path) && files.has(path)) queue.push(path);
  }
  void drain();
}, { rootMargin: "200px" });

/** The picture inside a file: the file itself, or the camera's JPG preview inside a RAW. */
async function pictureOf(file: File): Promise<Blob | null> {
  const ext = extensionOf(file.name);
  if (PICTURE.has(ext)) return file;
  if (kindOf(file.name) === "raw" && file.size <= 150 * 1024 * 1024) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = largestPreview(bytes);
    return preview ? new Blob([bytes.slice(preview.start, preview.end)], { type: "image/jpeg" }) : null;
  }
  return null;
}

async function drain(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const path = queue.shift()!;
      const file = files.get(path);
      if (!file || thumbs.has(path)) continue;
      try {
        if (extensionOf(file.name) === "svg") {
          // Shown through <img>: SVG scripts never run there.
          thumbs.set(path, URL.createObjectURL(file));
        } else {
          const picture = await pictureOf(file);
          if (!picture) continue;
          const bitmap = await createImageBitmap(picture, { imageOrientation: "from-image" });
          const scale = Math.min(1, THUMB / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const entry = catalog.entries.find((e) => e.path === path);
          if (entry && (entry.width !== bitmap.width || entry.height !== bitmap.height)) change(setSize(catalog, path, bitmap.width, bitmap.height));
          bitmap.close();
          const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
          if (!blob) continue;
          thumbs.set(path, URL.createObjectURL(blob));
        }
        paintThumb(path);
        if (path === current) showDetails();
      } catch {
        // A damaged or unsupported picture keeps its type badge.
      }
    }
  } finally {
    working = false;
  }
}

function paintThumb(path: string): void {
  const url = thumbs.get(path);
  const box = grid.querySelector<HTMLElement>(`.tile[data-path="${CSS.escape(path)}"] .thumb`);
  if (!url || !box) return;
  const img = Object.assign(document.createElement("img"), { src: url, alt: "", decoding: "async" });
  box.replaceChildren(img);
}

// ---------------------------------------------------------------------------- grid

function stars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function tile(entry: Entry): HTMLLIElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tile";
  button.dataset.path = entry.path;
  button.setAttribute("aria-pressed", String(selected.has(entry.path)));
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  const url = thumbs.get(entry.path);
  if (url) thumb.append(Object.assign(document.createElement("img"), { src: url, alt: "", decoding: "async" }));
  else thumb.append(Object.assign(document.createElement("span"), { className: "badge", textContent: (extensionOf(entry.name) || "?").toUpperCase().slice(0, 5) }));
  const name = Object.assign(document.createElement("span"), { className: "name", textContent: entry.name, title: entry.path });
  const meta = document.createElement("span");
  meta.className = "meta";
  const starText = Object.assign(document.createElement("span"), { className: "stars", textContent: stars(entry.rating) });
  starText.setAttribute("aria-hidden", "true");
  const spoken = Object.assign(document.createElement("span"), {
    className: "visually-hidden",
    textContent: `, ${entry.rating ? `${entry.rating} de 5 estrellas` : "sin calificar"}${entry.label ? `, ${labelText(entry.label)}` : ""}`,
  });
  meta.append(starText, spoken);
  if (entry.label) {
    const dot = Object.assign(document.createElement("span"), { className: `dot ${entry.label}` });
    dot.setAttribute("aria-hidden", "true");
    meta.append(dot);
  }
  button.append(thumb, name, meta);
  li.append(button);
  if (!url && files.has(entry.path)) observer.observe(button);
  return li;
}

function render(): void {
  shown = visible(catalog);
  const total = catalog.entries.length;
  $("empty").hidden = total > 0;
  observer.disconnect();
  grid.replaceChildren(...shown.slice(0, MAX_TILES).map(tile));
  const of = total === shown.length ? "" : ` de ${total.toLocaleString("es")}`;
  $("count").textContent = total
    ? `${shown.length.toLocaleString("es")}${of} ${total === 1 ? "archivo" : "archivos"}${shown.length > MAX_TILES ? ` · se muestran los primeros ${MAX_TILES.toLocaleString("es")}: busca o filtra para ver el resto` : ""}${selected.size ? ` · ${selected.size.toLocaleString("es")} seleccionados` : ""}`
    : "Sin archivos";
  showDetails();
}

function refreshTiles(): void {
  for (const button of grid.querySelectorAll<HTMLButtonElement>(".tile")) button.setAttribute("aria-pressed", String(selected.has(button.dataset.path!)));
  const total = catalog.entries.length;
  const of = total === shown.length ? "" : ` de ${total.toLocaleString("es")}`;
  $("count").textContent = `${shown.length.toLocaleString("es")}${of} ${total === 1 ? "archivo" : "archivos"}${selected.size ? ` · ${selected.size.toLocaleString("es")} seleccionados` : ""}`;
  showDetails();
}

grid.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(".tile");
  if (!button) return;
  const path = button.dataset.path!;
  if (e.shiftKey && anchor) {
    const order = shown.map((x) => x.path);
    const [a, b] = [order.indexOf(anchor), order.indexOf(path)].sort((x, y) => x - y);
    if (a >= 0) selected = new Set([...(e.ctrlKey || e.metaKey ? selected : []), ...order.slice(a, b + 1)]);
  } else if (e.ctrlKey || e.metaKey) {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    anchor = path;
  } else {
    selected = new Set([path]);
    anchor = path;
  }
  current = selected.has(path) ? path : [...selected].pop() ?? null;
  refreshTiles();
});

grid.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selectAll();
  } else if (/^[0-5]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && selected.size) {
    e.preventDefault();
    rate(Number(e.key));
  }
});

function selectAll(): void {
  selected = new Set(shown.map((x) => x.path));
  current = shown[0]?.path ?? null;
  anchor = current;
  refreshTiles();
}
$("select-all").addEventListener("click", selectAll);

// ---------------------------------------------------------------------------- details and marks

function showDetails(): void {
  const entry = current ? catalog.entries.find((e) => e.path === current) : undefined;
  const many = selected.size > 1;
  $("no-file").hidden = !!entry;
  $("editor").hidden = !entry;
  const preview = $("preview");
  const url = entry ? thumbs.get(entry.path) : undefined;
  preview.hidden = !url;
  preview.replaceChildren(...(url ? [Object.assign(document.createElement("img"), { src: url, alt: `Vista previa de ${entry!.name}` })] : []));
  const details = $("details");
  if (!entry) {
    details.replaceChildren();
    $("detail-title").textContent = "Detalles";
    return;
  }
  $("detail-title").textContent = many ? `${selected.size} archivos seleccionados` : "Detalles";
  const folder = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
  const rows: [string, string][] = [
    ["Nombre", entry.name],
    ["Carpeta", folder],
    ["Tipo", `${KIND_LABELS[entry.kind]} (${extensionOf(entry.name).toUpperCase() || "sin extensión"})`],
    ["Tamaño", formatSize(entry.size)],
    ["Fecha", new Date(entry.modified).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })],
    ["Medidas", entry.width && entry.height ? `${entry.width.toLocaleString("es")} × ${entry.height.toLocaleString("es")} px` : ""],
    ["Se abre en", opensWith(entry.name)],
    ["Disponible", files.has(entry.path) ? "Sí, en este equipo" : "Vuelve a elegir la carpeta"],
  ];
  details.replaceChildren(...rows.filter(([, v]) => v).flatMap(([k, v]) => [
    Object.assign(document.createElement("dt"), { textContent: k }),
    Object.assign(document.createElement("dd"), { textContent: v }),
  ]));
  const marked = catalog.entries.filter((e) => selected.has(e.path));
  const same = <T,>(get: (e: Entry) => T) => (marked.every((e) => get(e) === get(marked[0])) ? get(marked[0]) : null);
  ratingEl.value = String(same((e) => e.rating) ?? 0);
  labelEl.value = same((e) => e.label) ?? "";
  if (document.activeElement !== tagsEl) tagsEl.value = many ? "" : entry.tags.join(", ");
  tagsEl.placeholder = many ? "Se añaden a todos los seleccionados" : "Separadas por comas";
}

function targets(): string[] {
  return selected.size ? [...selected] : current ? [current] : [];
}

function rate(value: number): void {
  const paths = targets();
  if (!paths.length) return;
  change(setRating(catalog, paths, value));
  render();
  status(value ? `${paths.length === 1 ? "Archivo calificado" : `${paths.length} archivos calificados`} con ${value} ${value === 1 ? "estrella" : "estrellas"}.` : "Calificación quitada.");
}

ratingEl.addEventListener("change", () => rate(Number(ratingEl.value)));
labelEl.addEventListener("change", () => {
  const paths = targets();
  if (!paths.length) return;
  change(setLabel(catalog, paths, (labelEl.value || null) as Label | null));
  render();
});
tagsEl.addEventListener("change", () => {
  const paths = targets();
  if (!paths.length) return;
  const tags = parseTags(tagsEl.value);
  change(paths.length > 1 ? addTags(catalog, paths, tags) : setTags(catalog, paths, tags));
  if (paths.length > 1) tagsEl.value = "";
  render();
  status(paths.length > 1 ? `Palabras clave añadidas a ${paths.length} archivos.` : "Palabras clave guardadas.");
});

// ---------------------------------------------------------------------------- filters

function showFilters(): void {
  query.value = catalog.view.query;
  kindEl.value = catalog.view.kind;
  minRatingEl.value = String(catalog.view.minRating);
  labelFilter.value = catalog.view.label;
  sortEl.value = catalog.view.sort;
}

function filter(): void {
  change({
    ...catalog,
    view: {
      query: query.value.slice(0, 200),
      kind: kindEl.value as FileKind | "",
      minRating: Number(minRatingEl.value),
      label: labelFilter.value as Label | "",
      sort: sortEl.value as Sort,
    },
  });
  render();
}

query.addEventListener("input", filter);
for (const el of [kindEl, minRatingEl, labelFilter, sortEl]) el.addEventListener("change", filter);

// ---------------------------------------------------------------------------- exports

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

$("export-csv").addEventListener("click", () => {
  if (!shown.length) return status("No hay archivos a la vista para exportar.", true);
  const rows: (string | number | null)[][] = [
    ["Ruta", "Nombre", "Tipo", "Tamaño (KB)", "Fecha", "Ancho (px)", "Alto (px)", "Calificación", "Etiqueta", "Palabras clave"],
    ...shown.map((e) => [e.path, e.name, KIND_LABELS[e.kind], Math.ceil(e.size / 1024), isoDate(e.modified), e.width, e.height, e.rating, e.label ? labelText(e.label) : "", e.tags.join(", ")]),
  ];
  const text = csv(rows, 0);
  download(new Blob([text], { type: "text/csv;charset=utf-8" }), `${(catalog.folder ?? "archivo").replace(/[^\p{L}\p{N}._ -]+/gu, "_")}-lista.csv`);
  status(`Lista exportada: ${shown.length.toLocaleString("es")} ${shown.length === 1 ? "archivo" : "archivos"}.`);
});

function renameTargets(): Entry[] {
  return selected.size ? shown.filter((e) => selected.has(e.path)) : shown;
}

function previewRename(): void {
  const list = renameTargets();
  const plan = renamePlan(list.slice(0, 8), patternEl.value, Number(startEl.value) || 0);
  $("rename-scope").textContent = `${list.length.toLocaleString("es")} ${list.length === 1 ? "archivo" : "archivos"} ${selected.size ? "seleccionados" : "a la vista"}, en el orden actual. Se descarga un ZIP con copias renombradas; tus archivos originales no cambian.`;
  $("rename-preview").replaceChildren(...plan.map((p) => Object.assign(document.createElement("li"), { textContent: `${p.entry.name} → ${p.name}` })));
}

$("rename").addEventListener("click", () => {
  if (!shown.length) return status("No hay archivos para renombrar.", true);
  previewRename();
  dialog.showModal();
});
patternEl.addEventListener("input", previewRename);
startEl.addEventListener("input", previewRename);

$("rename-cancel").addEventListener("click", () => dialog.close());
$("rename-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void renameDownload();
});

async function renameDownload(): Promise<void> {
  const list = renameTargets();
  const missing = list.filter((e) => !files.has(e.path));
  if (missing.length) {
    status(`Vuelve a elegir la carpeta: ${missing.length.toLocaleString("es")} ${missing.length === 1 ? "archivo no está" : "archivos no están"} abiertos en esta pestaña.`, true);
    dialog.close();
    return;
  }
  const plan = renamePlan(list, patternEl.value, Number(startEl.value) || 0);
  const total = list.reduce((n, e) => n + e.size, 0);
  if (plan.length > ZIP_MAX_ENTRIES || total > ZIP_MAX_TOTAL * 0.95) {
    status("Son demasiados archivos o pesan demasiado para un solo ZIP (máximo 4 GB). Selecciona menos.", true);
    return;
  }
  dialog.close();
  await bridge.busy(async () => {
    const entries = [];
    for (const [i, p] of plan.entries()) {
      status(`Preparando el ZIP: ${i + 1} de ${plan.length}…`);
      const file = files.get(p.entry.path)!;
      entries.push({ name: p.name, size: file.size, crc: crc32(new Uint8Array(await file.arrayBuffer())), modified: new Date(file.lastModified) });
    }
    const { local, end } = zipLayout(entries);
    const parts: BlobPart[] = [];
    plan.forEach((p, i) => parts.push(local[i] as Uint8Array<ArrayBuffer>, files.get(p.entry.path)!));
    parts.push(end as Uint8Array<ArrayBuffer>);
    download(new Blob(parts, { type: "application/zip" }), "renombrados.zip");
  });
  status(`ZIP listo con ${plan.length.toLocaleString("es")} ${plan.length === 1 ? "copia renombrada" : "copias renombradas"}.`);
}
