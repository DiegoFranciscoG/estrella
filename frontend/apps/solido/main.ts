import { connect } from "../shared/bridge";
import "../shared/program.css";
import {
  create, createPrism, duplicate, footprint, KIND_NAMES, newModel, parseModel, remove, snap, STEPS, update, volume,
  type Kind, type Model, type Patch, type Point2,
} from "./model";
import { createScene, type Moved, type SolidScene, type ViewName } from "./scene";
import "./solido.css";

type Tool = "select" | Exclude<Kind, "prism"> | "polygon";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $("view3d");
const statusEl = $("status");
const listEl = $<HTMLUListElement>("solids");
const form = $<HTMLFormElement>("props");
const noSelection = $("no-selection");
const stepEl = $<HTMLSelectElement>("step");
const field = (name: string) => $<HTMLInputElement>(`p-${name}`);
const NUMERIC = ["x", "y", "z", "width", "depth", "height", "rotation"] as const;

let model: Model = newModel();
let selected: string | null = null;
let tool: Tool = "select";
let gizmoMode: "translate" | "rotate" = "translate";
let draft: Point2[] = [];
let scene: SolidScene | null = null;
let dark = false;
const undoStack: string[] = [];
const redoStack: string[] = [];
let pending: string | null = null;

const fmt = (n: number, decimals = 2) => n.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  load(data) {
    let raw: unknown = null;
    try {
      raw = data ? JSON.parse(data) : null;
    } catch {
      status("No se pudo leer el modelo guardado: empieza uno nuevo o deshaz los últimos cambios desde la copia del panel.", true);
    }
    model = parseModel(raw);
    selected = null;
    undoStack.length = 0;
    redoStack.length = 0;
    stepEl.value = String(model.step);
    if (!startScene()) return;
    refresh();
    scene!.view("iso");
  },
  serialize() {
    return JSON.stringify(model);
  },
  onTheme(theme) {
    dark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    scene?.setTheme(dark);
  },
});

function startScene(): boolean {
  if (scene) return true;
  try {
    scene = createScene(host, { lite: bridge.lite, dark, onMoveStart: begin, onMove: moved });
    scene.setGizmo(gizmoMode, model.step);
    return true;
  } catch {
    status("Este navegador o equipo no tiene 3D activado (WebGL). Prueba con otro navegador o actualiza el controlador de video.", true);
    for (const b of document.querySelectorAll<HTMLButtonElement>(".bar button")) b.disabled = true;
    return false;
  }
}

// ---------------------------------------------------------------------------- history

function begin(): void {
  pending ??= JSON.stringify(model);
}

function commit(): void {
  if (pending === null) return;
  if (pending !== JSON.stringify(model)) {
    undoStack.push(pending);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    bridge.changed();
  }
  pending = null;
}

function apply(next: Model): void {
  begin();
  model = next;
  commit();
  refresh();
}

function travel(from: string[], to: string[]): void {
  const previous = from.pop();
  if (previous === undefined) return;
  to.push(JSON.stringify(model));
  model = parseModel(JSON.parse(previous));
  stepEl.value = String(model.step);
  if (selected && !model.solids.some((s) => s.id === selected)) selected = null;
  refresh();
  bridge.changed();
}

// ---------------------------------------------------------------------------- screen

function current() {
  return model.solids.find((s) => s.id === selected) ?? null;
}

function refresh(): void {
  scene?.sync(model, selected);
  scene?.setGizmo(gizmoMode, model.step);
  renderList();
  renderProps();
  const solid = current();
  for (const id of ["duplicate", "delete", "move", "rotate"]) $<HTMLButtonElement>(id).disabled = !solid;
  $<HTMLButtonElement>("undo").disabled = !undoStack.length;
  $<HTMLButtonElement>("redo").disabled = !redoStack.length;
  const total = model.solids.reduce((sum, s) => sum + volume(s), 0);
  const n = model.solids.length;
  $("totals").textContent = n ? `${n} ${n === 1 ? "sólido" : "sólidos"} · volumen total ${fmt(total)} m³` : "Todavía no hay sólidos.";
}

function renderList(): void {
  listEl.replaceChildren(...model.solids.map((s) => {
    const li = document.createElement("li");
    const name = Object.assign(document.createElement("button"), { type: "button", className: "name", textContent: s.name });
    name.setAttribute("aria-current", String(s.id === selected));
    name.addEventListener("click", () => select(s.id));
    const eye = Object.assign(document.createElement("button"), { type: "button", className: "eye", textContent: "Ver" });
    eye.setAttribute("aria-label", `Ver ${s.name}`);
    eye.setAttribute("aria-pressed", String(!s.hidden));
    eye.addEventListener("click", () => apply(update(model, s.id, { hidden: !s.hidden })));
    li.append(name, eye);
    return li;
  }));
}

function renderProps(): void {
  const s = current();
  form.hidden = !s;
  noSelection.hidden = !!s;
  if (!s) return;
  const active = document.activeElement;
  const set = (input: HTMLInputElement, value: string) => {
    if (input !== active) input.value = value;
  };
  set(field("name"), s.name);
  for (const key of NUMERIC) {
    const input = field(key);
    input.step = key === "rotation" ? "15" : String(model.step);
    set(input, String(s[key]));
  }
  set(field("color"), s.color);
  $("p-kind").textContent = KIND_NAMES[s.kind];
  $("p-area").textContent = `${fmt(footprint(s))} m²`;
  $("p-volume").textContent = `${fmt(volume(s))} m³`;
}

function select(id: string | null): void {
  selected = id;
  refresh();
}

function setTool(next: Tool): void {
  tool = next;
  draft = [];
  scene?.setDraft([], null);
  host.classList.toggle("placing", next !== "select");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === next));
  if (next === "polygon") status("Polígono: haz clic en cada esquina de la planta sobre el suelo y pulsa Enter para cerrarla. Esc cancela.");
  else if (next !== "select") status(`${KIND_NAMES[next]}: haz clic en el suelo donde quieras colocarla.`);
}

function setGizmo(mode: "translate" | "rotate"): void {
  gizmoMode = mode;
  $("move").setAttribute("aria-pressed", String(mode === "translate"));
  $("rotate").setAttribute("aria-pressed", String(mode === "rotate"));
  scene?.setGizmo(mode, model.step);
}

// ---------------------------------------------------------------------------- editing

function moved(m: Moved): void {
  begin();
  model = update(model, m.id, { x: m.x, y: Math.max(m.y, -100_000), z: m.z, rotation: Math.round(m.rotation * 1000) / 1000 });
  commit();
  refresh();
}

function edit(patch: Patch): void {
  if (!selected) return;
  apply(update(model, selected, patch));
}

for (const key of NUMERIC) {
  field(key).addEventListener("change", () => {
    const value = Number(field(key).value.replace(",", "."));
    if (field(key).value.trim() === "" || !Number.isFinite(value)) return renderProps();
    edit({ [key]: value } as Patch);
  });
}
field("name").addEventListener("change", () => edit({ name: field("name").value }));
field("color").addEventListener("input", () => {
  if (!selected) return;
  begin();
  model = update(model, selected, { color: field("color").value });
  scene?.sync(model, selected);
});
field("color").addEventListener("change", () => {
  commit();
  refresh();
});
form.addEventListener("submit", (e) => e.preventDefault());

function place(kind: Exclude<Kind, "prism">, at: Point2): void {
  try {
    const { model: next, solid } = create(model, kind, { x: snap(at[0], model.step), z: snap(at[1], model.step) });
    selected = solid.id;
    apply(next);
    setTool("select");
    status(`Listo: ${solid.name} en el suelo. Escribe sus medidas en Propiedades o muévelo con las flechas.`);
  } catch {
    status("Llegaste al máximo de sólidos de un modelo.", true);
  }
}

function closePolygon(): void {
  if (draft.length < 3) return status("La planta necesita al menos 3 esquinas.", true);
  let made: ReturnType<typeof createPrism> = null;
  try {
    made = createPrism(model, draft);
  } catch {
    return status("Llegaste al máximo de sólidos de un modelo.", true);
  }
  if (!made) {
    draft = [];
    scene?.setDraft([], null);
    return status("Esa planta no sirve: sus lados no pueden cruzarse ni tener área cero. Dibújala de nuevo.", true);
  }
  selected = made.solid.id;
  apply(made.model);
  setTool("select");
  status(`${made.solid.name} levantado ${fmt(made.solid.height)} m. Cambia Alto en Propiedades para subirlo o bajarlo.`);
}

function removeSelected(): void {
  const s = current();
  if (!s) return;
  selected = null;
  apply(remove(model, s.id));
  status(`Se eliminó ${s.name}. Deshacer lo recupera.`);
}

function duplicateSelected(): void {
  if (!selected) return;
  const made = duplicate(model, selected);
  if (!made) return status("Llegaste al máximo de sólidos de un modelo.", true);
  selected = made.solid.id;
  apply(made.model);
  status(`Copia lista: ${made.solid.name}, al lado del original.`);
}

// ---------------------------------------------------------------------------- pointer and keys

let down: { x: number; y: number; onGizmo: boolean } | null = null;
host.addEventListener("pointerdown", (e) => {
  down = e.button === 0 ? { x: e.clientX, y: e.clientY, onGizmo: !!scene?.overGizmo() } : null;
});
host.addEventListener("pointermove", (e) => {
  if (tool !== "polygon" || !draft.length || !scene) return;
  const p = scene.ground(e.clientX, e.clientY);
  scene.setDraft(draft, p ? [snap(p[0], model.step), snap(p[1], model.step)] : null);
});
host.addEventListener("pointerup", (e) => {
  const start = down;
  down = null;
  if (!start || start.onGizmo || !scene || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
  if (tool === "select") return select(scene.pick(e.clientX, e.clientY));
  const p = scene.ground(e.clientX, e.clientY);
  if (!p) return status("Haz clic sobre el suelo.", true);
  if (tool !== "polygon") return place(tool, p);
  const point: Point2 = [snap(p[0], model.step), snap(p[1], model.step)];
  const first = draft[0];
  if (draft.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) <= model.step * 1.5) return closePolygon();
  draft.push(point);
  scene.setDraft(draft, null);
  status(`Esquina ${draft.length}: ${fmt(point[0])}; ${fmt(point[1])} m. ${draft.length >= 3 ? "Enter o clic en la primera esquina cierra la planta." : "Sigue con la siguiente esquina."}`);
});

document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !typing && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return e.shiftKey ? travel(redoStack, undoStack) : travel(undoStack, redoStack);
  }
  if (ctrl && !typing && e.key.toLowerCase() === "y") {
    e.preventDefault();
    return travel(redoStack, undoStack);
  }
  if (ctrl && e.key.toLowerCase() === "d") {
    e.preventDefault();
    return duplicateSelected();
  }
  if (typing) return;
  if (e.key === "Escape") {
    if (tool !== "select") {
      setTool("select");
      status("Herramienta cancelada.");
    } else if (selected) select(null);
  } else if (e.key === "Enter" && tool === "polygon") {
    e.preventDefault();
    closePolygon();
  } else if (e.key === "Backspace" && tool === "polygon" && draft.length) {
    e.preventDefault();
    draft.pop();
    scene?.setDraft(draft, null);
  } else if (e.key === "Delete") {
    removeSelected();
  }
});

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.addEventListener("click", () => scene?.view(b.dataset.view as ViewName));
$("move").addEventListener("click", () => setGizmo("translate"));
$("rotate").addEventListener("click", () => setGizmo("rotate"));
$("duplicate").addEventListener("click", duplicateSelected);
$("delete").addEventListener("click", removeSelected);
$("undo").addEventListener("click", () => travel(undoStack, redoStack));
$("redo").addEventListener("click", () => travel(redoStack, undoStack));
stepEl.addEventListener("change", () => {
  const step = Number(stepEl.value);
  if (STEPS.includes(step)) apply({ ...model, step });
});

// ---------------------------------------------------------------------------- export

function baseName(): string {
  return bridge.title().replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim().slice(0, 80) || "solido";
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const NOTES = { stl: "STL en milímetros a tamaño real, Z hacia arriba: en el programa de impresión escala a tu maqueta (1:100 = 1 %).", obj: "OBJ en metros.", glb: "glTF en metros, con los colores." };

async function exportAs(format: "stl" | "obj" | "glb"): Promise<void> {
  const view = scene;
  if (!view || !model.solids.some((s) => !s.hidden)) return status("No hay sólidos visibles para exportar.", true);
  const blob = await bridge.busy(() => view.exportAs(format));
  download(blob, `${baseName()}.${format}`);
  status(`Exportado. ${NOTES[format]}`);
}

$("export-stl").addEventListener("click", () => void exportAs("stl"));
$("export-obj").addEventListener("click", () => void exportAs("obj"));
$("export-glb").addEventListener("click", () => void exportAs("glb"));
$("export-png").addEventListener("click", async () => {
  if (!scene) return;
  download(await scene.snapshot(), `${baseName()}.png`);
  status("Imagen exportada tal como se ve la vista.");
});
