import { fromBase64, toBase64 } from "../shared/base64";
import { connect } from "../shared/bridge";
import "../shared/program.css";
import "./bim.css";
import type { OpenedModel } from "./ifc-model";
import {
  addMeasure, csv, defaultView, distance, formatLevel, formatNumber, looksLikeIfc, NO_LEVEL, parseView, PLAN_CUT, search, sortCategories,
  type BimElement, type BimLevel, type Measure, type ViewState,
} from "./model";
import type { BimView } from "./view";

/** Larger files are opened but not kept inside the project (the panel stores up to 50 MB of text). */
const MAX_PROJECT_BYTES = 30 * 1024 * 1024;
/** Above this, web-ifc needs more memory than a browser tab usually gets. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const empty = $("empty");
const host = $("view3d");
const input = $<HTMLInputElement>("open");
const levelsEl = $<HTMLUListElement>("levels");
const categoriesEl = $<HTMLUListElement>("categories");
const searchEl = $<HTMLInputElement>("search");
const resultsEl = $<HTMLUListElement>("results");
const propertiesEl = $("properties");
const measuresEl = $<HTMLOListElement>("measures");
const sectionOn = $<HTMLInputElement>("section-on");
const sectionEl = $<HTMLInputElement>("section");
const sectionValue = $<HTMLOutputElement>("section-value");
const measureBtn = $<HTMLButtonElement>("measure");
const controls = ["fit", "top", "measure", "clear-measures", "export-png", "export-csv"].map((id) => $<HTMLButtonElement>(id));

class ReadError extends Error {}

let file: { name: string; bytes: Uint8Array } | null = null;
let model: OpenedModel | null = null;
let view: BimView | null = null;
let byId = new Map<number, BimElement>();
let state: ViewState = defaultView();
/** A saved view whose model was too large to keep: used again if the student reopens that file. */
let waiting: { name: string; view: ViewState } | null = null;
let measuring = false;
let pending: [number, number, number] | null = null;
let dark = false;
let opening = false;
let selectToken = 0;

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  async load(data) {
    if (!data) return;
    try {
      const saved = JSON.parse(data) as { name?: unknown; ifc?: unknown; view?: unknown };
      const name = typeof saved.name === "string" ? saved.name.slice(0, 200) : "modelo.ifc";
      const savedView = parseView(saved.view);
      if (typeof saved.ifc === "string" && saved.ifc) await open(name, fromBase64(saved.ifc), savedView, false);
      else if (typeof saved.name === "string") {
        waiting = { name, view: savedView };
        status(`Vuelve a abrir «${name}» para seguir: era muy grande para guardarlo dentro del proyecto. Tu vista se conserva.`, true);
      }
    } catch {
      status("No se pudo abrir el modelo guardado.", true);
    }
  },
  serialize() {
    const keep = file !== null && file.bytes.length <= MAX_PROJECT_BYTES;
    return JSON.stringify({ v: 1, name: file?.name ?? waiting?.name ?? null, ifc: keep ? toBase64(file!.bytes) : null, view: state });
  },
  onTheme(theme) {
    dark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    view?.setTheme(dark);
  },
});

// ---------------------------------------------------------------------------- opening

async function open(name: string, bytes: Uint8Array, saved: ViewState | null, isNew: boolean): Promise<void> {
  if (opening) return;
  if (bytes.length > MAX_FILE_BYTES) {
    status(`«${name}» pesa más de 200 MB: es demasiado para el navegador. Exporta desde tu programa BIM solo los niveles o disciplinas que necesitas.`, true);
    return;
  }
  if (!looksLikeIfc(bytes)) {
    status(`«${name}» no es un IFC en formato STEP (.ifc). Si es .ifczip, descomprímelo primero; IFC-XML no se admite.`, true);
    return;
  }
  opening = true;
  status("Abriendo el modelo… la primera vez se descargan el lector de IFC y el visor 3D (unos 1,6 MB).");
  try {
    await bridge.busy(async () => {
      const [{ openIfc }, { createView }] = await Promise.all([import("./ifc-model"), import("./view")]);
      let next: OpenedModel;
      try {
        next = await openIfc(bytes);
      } catch {
        throw new ReadError(`No se pudo leer «${name}». Puede estar dañado o usar un esquema que el lector no conoce.`);
      }
      if (!next.parts.length) {
        next.close();
        throw new ReadError(`«${name}» no tiene geometría que se pueda mostrar.`);
      }
      closeModel();
      empty.hidden = true;
      host.hidden = false;
      try {
        view = createView(host, next.parts, { lite: bridge.lite, dark });
      } catch {
        next.close();
        empty.hidden = false;
        host.hidden = true;
        throw new ReadError("Este navegador o equipo no tiene 3D activado (WebGL). Prueba con otro navegador o actualiza el controlador de video.");
      }
      next.parts.length = 0; // The geometry now lives in the 3D view.
      model = next;
      file = { name, bytes };
      waiting = null;
      byId = new Map(next.elements.map((e) => [e.id, e]));
      state = saved ?? defaultView();
      state.hiddenLevels = state.hiddenLevels.filter((id) => id === NO_LEVEL || next.levels.some((l) => l.id === id));
      if (state.selected !== null && !byId.has(state.selected)) state.selected = null;
      showModel();
    });
    const levels = model!.levels.length;
    status(`Modelo abierto: ${model!.elements.length.toLocaleString("es")} elementos en ${levels} ${levels === 1 ? "nivel" : "niveles"}.`);
    if (state.selected !== null) await select(state.selected, false);
    if (isNew) bridge.changed();
  } catch (error) {
    status(error instanceof ReadError ? error.message : "No se pudo abrir el modelo.", true);
  } finally {
    opening = false;
  }
}

function closeModel(): void {
  view?.dispose();
  view = null;
  model?.close();
  model = null;
  measuring = false;
  pending = null;
  measureBtn.setAttribute("aria-pressed", "false");
  host.classList.remove("measuring");
}

function showModel(): void {
  if (!model || !view) return;
  $("summary").textContent = `${file!.name} · ${model.schema} · ${model.elements.length.toLocaleString("es")} elementos`;
  for (const button of controls) button.disabled = false;
  searchEl.disabled = false;
  searchEl.value = "";
  resultsEl.replaceChildren();
  renderLevels();
  renderCategories();
  applyVisibility();

  const { min, max } = view.heights;
  sectionEl.min = String(Math.floor(min * 100) / 100);
  sectionEl.max = String(Math.ceil(max * 100) / 100);
  sectionOn.disabled = false;
  setSection(state.section, false);
  view.setMeasures(state.measures, null);
  renderMeasures();
  showProperties(null);
}

// ---------------------------------------------------------------------------- levels and categories

function visible(id: number): boolean {
  const e = byId.get(id);
  return !e || (!state.hiddenLevels.includes(e.level) && !state.hiddenCategories.includes(e.category));
}

function applyVisibility(): void {
  view?.setVisible(visible);
}

function checkbox(label: string, extra: string, checked: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  const wrap = document.createElement("label");
  const note = document.createElement("span");
  note.className = "count";
  note.textContent = extra;
  wrap.append(box, ` ${label} `, note);
  return wrap;
}

function toggled<T>(list: T[], value: T, show: boolean): T[] {
  return show ? list.filter((v) => v !== value) : [...new Set([...list, value])];
}

function showLevel(id: number, show: boolean): void {
  state.hiddenLevels = toggled(state.hiddenLevels, id, show);
  applyVisibility();
  bridge.changed();
}

function showCategory(category: string, show: boolean): void {
  state.hiddenCategories = toggled(state.hiddenCategories, category, show);
  applyVisibility();
  bridge.changed();
}

function renderLevels(): void {
  const levels: BimLevel[] = [...model!.levels];
  if (model!.elements.some((e) => e.level === NO_LEVEL)) levels.push({ id: NO_LEVEL, name: "Sin nivel", elevation: NaN, y: NaN });
  levelsEl.replaceChildren(...levels.map((level) => {
    const li = document.createElement("li");
    const height = Number.isFinite(level.elevation) ? formatLevel(level.elevation) : "";
    li.append(checkbox(level.name, height, !state.hiddenLevels.includes(level.id), (on) => showLevel(level.id, on)));
    if (level.id !== NO_LEVEL) {
      const plan = document.createElement("button");
      plan.type = "button";
      plan.textContent = "Ver planta";
      plan.setAttribute("aria-label", `Ver planta de ${level.name}`);
      plan.addEventListener("click", () => showPlan(level));
      li.append(plan);
    }
    return li;
  }));
  if (!levels.length) levelsEl.replaceChildren(Object.assign(document.createElement("li"), { className: "hint", textContent: "El modelo no define niveles." }));
}

function renderCategories(): void {
  const counts = new Map<string, number>();
  for (const e of model!.elements) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  categoriesEl.replaceChildren(...sortCategories(counts.keys()).map((category) => {
    const li = document.createElement("li");
    li.append(checkbox(category, (counts.get(category) ?? 0).toLocaleString("es"), !state.hiddenCategories.includes(category), (on) => showCategory(category, on)));
    return li;
  }));
}

// ---------------------------------------------------------------------------- section and plans

function setSection(y: number | null, save = true): void {
  if (!view || !model) return;
  const { min, max } = view.heights;
  const value = y === null ? null : Math.min(Math.max(y, min), max);
  state.section = value;
  sectionOn.checked = value !== null;
  sectionEl.disabled = value === null;
  if (value !== null) sectionEl.value = String(value);
  sectionValue.textContent = value === null ? "" : formatLevel(value - model.baseY);
  view.setSection(value);
  if (save) bridge.changed();
}

function showPlan(level: BimLevel): void {
  if (!view || !model) return;
  setSection(level.y + PLAN_CUT);
  view.frame("top");
  status(`Planta de «${level.name}»: corte horizontal a ${sectionValue.textContent}, vista desde arriba.`);
}

sectionOn.addEventListener("change", () => {
  if (!model) return;
  const first = model.levels[0];
  setSection(sectionOn.checked ? (first ? first.y + PLAN_CUT : (view!.heights.min + view!.heights.max) / 2) : null);
});
sectionEl.addEventListener("input", () => {
  if (!model || !view) return;
  state.section = Number(sectionEl.value);
  sectionValue.textContent = formatLevel(state.section - model.baseY);
  view.setSection(state.section);
});
sectionEl.addEventListener("change", () => bridge.changed());

// ---------------------------------------------------------------------------- search and selection

function renderResults(): void {
  if (!model) return;
  const found = search(model.elements, model.levels, searchEl.value);
  const levelName = new Map(model.levels.map((l) => [l.id, l.name]));
  resultsEl.replaceChildren(...found.map((e) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = String(e.id);
    const detail = document.createElement("span");
    detail.className = "muted";
    detail.textContent = ` · ${e.category} · ${levelName.get(e.level) ?? "Sin nivel"}`;
    button.append(e.name, detail);
    button.addEventListener("click", () => void select(e.id));
    li.append(button);
    return li;
  }));
  markResults();
  if (searchEl.value.trim() && !found.length) {
    resultsEl.replaceChildren(Object.assign(document.createElement("li"), { className: "hint", textContent: "Ningún elemento coincide." }));
  }
}

function markResults(): void {
  for (const button of resultsEl.querySelectorAll<HTMLButtonElement>("button[data-id]")) {
    button.setAttribute("aria-current", String(Number(button.dataset.id) === state.selected));
  }
}

searchEl.addEventListener("input", renderResults);

async function select(id: number | null, save = true): Promise<void> {
  if (!model || !view) return;
  const token = ++selectToken;
  state.selected = id !== null && byId.has(id) ? id : null;
  view.select(state.selected);
  markResults();
  if (save) bridge.changed();
  if (state.selected === null) return showProperties(null);
  const element = byId.get(state.selected)!;
  const details = await model.details(element.id);
  if (token === selectToken) showProperties(element, details);
}

function definitionList(rows: { label: string; value: string }[]): HTMLDListElement {
  const dl = document.createElement("dl");
  dl.className = "props";
  for (const row of rows) {
    const dt = document.createElement("dt");
    dt.textContent = row.label;
    const dd = document.createElement("dd");
    dd.textContent = row.value;
    dl.append(dt, dd);
  }
  return dl;
}

function showProperties(element: BimElement | null, details?: Awaited<ReturnType<OpenedModel["details"]>>): void {
  if (!element || !details) {
    propertiesEl.replaceChildren(Object.assign(document.createElement("p"), { className: "hint", textContent: "Selecciona un elemento en el modelo o en la búsqueda." }));
    return;
  }
  const title = document.createElement("h3");
  title.textContent = element.name;
  const actions = document.createElement("div");
  actions.className = "props-actions";
  const zoom = Object.assign(document.createElement("button"), { type: "button", textContent: "Acercar" });
  zoom.addEventListener("click", () => view?.frame("fit", element.id));
  const clear = Object.assign(document.createElement("button"), { type: "button", textContent: "Quitar selección" });
  clear.addEventListener("click", () => void select(null));
  actions.append(zoom, clear);
  const rows = [...details.attributes];
  if (details.typeName) rows.push({ name: "Tipo", label: "Tipo", value: details.typeName });
  if (details.materials.length) rows.push({ name: "Materiales", label: "Materiales", value: details.materials.join(", ") });
  const parts: HTMLElement[] = [title, actions, definitionList(rows)];
  for (const group of details.groups) {
    const box = document.createElement("details");
    box.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.name;
    box.append(summary, definitionList(group.rows));
    parts.push(box);
  }
  if (!details.groups.length) parts.push(Object.assign(document.createElement("p"), { className: "hint", textContent: "Este elemento no trae conjuntos de propiedades ni cantidades." }));
  propertiesEl.replaceChildren(...parts);
}

// ---------------------------------------------------------------------------- picking and measuring

let down: { x: number; y: number } | null = null;
host.addEventListener("pointerdown", (e) => {
  down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
});
host.addEventListener("pointerup", (e) => {
  if (!down || !view || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  down = null;
  const hit = view.pick(e.clientX, e.clientY);
  if (!measuring) return void select(hit?.id ?? null);
  if (!hit) return status("Haz clic sobre una superficie del modelo.");
  if (!pending) {
    pending = hit.point;
    view.setMeasures(state.measures, pending);
    status("Primer punto marcado. Haz clic en el segundo punto.");
    return;
  }
  const m: Measure = [...pending, ...hit.point];
  pending = null;
  state.measures = addMeasure(state.measures, m);
  view.setMeasures(state.measures, null);
  renderMeasures();
  status(`Distancia: ${formatNumber(distance(m))} m.`);
  bridge.changed();
});

function setMeasuring(on: boolean): void {
  measuring = on;
  pending = null;
  measureBtn.setAttribute("aria-pressed", String(on));
  host.classList.toggle("measuring", on);
  view?.setMeasures(state.measures, null);
  if (on) status("Medir: haz clic en el primer punto sobre el modelo. Esc para terminar.");
}

function renderMeasures(): void {
  measuresEl.replaceChildren(...state.measures.map((m, i) => Object.assign(document.createElement("li"), { textContent: `Medida ${i + 1}: ${formatNumber(distance(m))} m` })));
}

measureBtn.addEventListener("click", () => setMeasuring(!measuring));
$("clear-measures").addEventListener("click", () => {
  state.measures = [];
  pending = null;
  view?.setMeasures([], null);
  renderMeasures();
  status("Medidas borradas.");
  bridge.changed();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (measuring) setMeasuring(false);
  else if (state.selected !== null) void select(null);
});

$("fit").addEventListener("click", () => view?.frame("fit"));
$("top").addEventListener("click", () => view?.frame("top"));

// ---------------------------------------------------------------------------- files

function baseName(): string {
  return (file?.name ?? "modelo").replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 80) || "modelo";
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$("export-png").addEventListener("click", async () => {
  if (!view) return;
  download(await view.snapshot(), `${baseName()}.png`);
  status("Imagen exportada tal como se ve el modelo.");
});

$("export-csv").addEventListener("click", async () => {
  if (!model) return;
  const current = model;
  const rows = await bridge.busy(async () => current.schedule(current.elements.filter((e) => visible(e.id)).map((e) => e.id)));
  download(new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }), `${baseName()}-cuadro.csv`);
  const n = rows.length - 1;
  status(`Cuadro exportado: ${n.toLocaleString("es")} ${n === 1 ? "elemento" : "elementos"} visibles con longitud, área y volumen cuando el IFC los trae.`);
});

async function openPicked(picked: File | undefined): Promise<void> {
  if (!picked) return;
  const bytes = new Uint8Array(await picked.arrayBuffer());
  const saved = waiting && waiting.name === picked.name ? waiting.view : null;
  await open(picked.name, bytes, saved, true);
}

input.addEventListener("change", () => {
  const picked = input.files?.[0];
  input.value = "";
  void openPicked(picked);
});

const stage = host.parentElement!;
stage.addEventListener("dragover", (e) => e.preventDefault());
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  void openPicked(e.dataTransfer?.files[0]);
});
