import { connect } from "../shared/bridge";
import "../shared/program.css";
import { fromDxf, toDxf } from "./dxf";
import {
  atLength, dimensionGeometry, dist, distanceTo, Drawing, drawingBounds, emptyDrawing, Entity, formatLength,
  History, inside, nearestSnap, newId, ortho, parseDrawing, Pt, Snap, snapToGrid, translate,
} from "./model";
import "./plano.css";
import { toSvg } from "./svg";

type Tool = "select" | "line" | "polyline" | "rect" | "circle" | "text" | "dim";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const cmd = $<HTMLInputElement>("cmd");
const statusEl = $("status");

let drawing: Drawing = emptyDrawing();
const history = new History();
let selection = new Set<string>();
let tool: Tool = "select";
let draft: Pt[] = [];
let textAt: Pt | null = null;
let gridOn = true;
let gridStep = 10;
let osnapOn = true;
let orthoOn = false;
let shiftDown = false;
let spaceDown = false;
const view = { s: 2, tx: 0, ty: 0 }; // screen = (x*s + tx, -y*s + ty)
let cursor: Pt = { x: 0, y: 0 };
let snap: Snap | null = null;
let drag: { kind: "pan" | "move" | "box"; from: Pt; screen: Pt; moved: boolean } | null = null;
let colors = { fg: "#111", muted: "#888", line: "#ccc", bg: "#e6e6e6", sel: "#000" };
let needsFrame = false;

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  load(data) {
    try {
      drawing = data ? parseDrawing(data) : emptyDrawing();
    } catch {
      drawing = emptyDrawing();
      status("No se pudo leer el dibujo guardado; empieza uno nuevo.", true);
    }
    renderLayers();
    fit();
  },
  serialize: () => JSON.stringify(drawing),
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
    readColors();
    redraw();
  },
});

function readColors(): void {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  colors = { fg: v("--fg"), muted: v("--muted"), line: v("--line"), bg: v("--canvas"), sel: v("--strong") };
}

/* ---------- view ---------- */

const toScreen = (p: Pt): Pt => ({ x: p.x * view.s + view.tx, y: -p.y * view.s + view.ty });
const toWorld = (sx: number, sy: number): Pt => ({ x: (sx - view.tx) / view.s, y: -(sy - view.ty) / view.s });

function resize(): void {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function fit(): void {
  const rect = canvas.getBoundingClientRect();
  const b = drawingBounds(drawing.entities.filter(isVisible));
  if (!b) {
    view.s = Math.max(rect.width, 1) / 400;
    view.tx = rect.width * 0.1;
    view.ty = rect.height * 0.9;
  } else {
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    view.s = Math.min((rect.width * 0.85) / w, (rect.height * 0.85) / h);
    view.tx = rect.width / 2 - ((b.minX + b.maxX) / 2) * view.s;
    view.ty = rect.height / 2 + ((b.minY + b.maxY) / 2) * view.s;
  }
  redraw();
}

/* ---------- model helpers ---------- */

const layerOf = (e: Entity) => drawing.layers.find((l) => l.name === e.layer);
const isVisible = (e: Entity) => layerOf(e)?.visible !== false;
const isEditable = (e: Entity) => isVisible(e) && layerOf(e)?.locked !== true;

function commit(change: () => void, message?: string): void {
  history.push(drawing);
  change();
  bridge.changed();
  if (message) status(message);
  redraw();
}

function add(entity: Omit<Entity, "id" | "layer">): void {
  const layer = drawing.layers.find((l) => l.name === drawing.current);
  if (layer?.locked) {
    status(`La capa ${layer.name} está bloqueada. Elige otra capa para dibujar.`, true);
    return;
  }
  commit(() => drawing.entities.push({ ...entity, id: newId(), layer: drawing.current } as Entity));
}

function hitTest(p: Pt): Entity | null {
  const tolerance = 6 / view.s;
  let best: Entity | null = null;
  let bestDist = tolerance;
  for (const e of drawing.entities) {
    if (!isEditable(e)) continue;
    const d = distanceTo(e, p);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/** Cursor after object snap, grid snap and ortho, in that priority. */
function resolve(raw: Pt): Pt {
  snap = null;
  if (osnapOn) {
    snap = nearestSnap(drawing.entities.filter(isVisible), raw, 10 / view.s);
    if (snap) return snap.p;
  }
  let p = raw;
  if (gridOn) {
    p = snapToGrid(raw, gridStep);
    snap = { p, kind: "grid" };
  }
  const anchor = draft[draft.length - 1];
  if (anchor && (orthoOn || shiftDown) && tool !== "circle" && tool !== "text") p = ortho(anchor, p);
  return p;
}

/* ---------- drawing tools ---------- */

function setTool(next: Tool): void {
  tool = next;
  draft = [];
  textAt = null;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.tool === next)));
  const hints: Record<Tool, string> = {
    select: "Clic para seleccionar (Mayús suma). Arrastra un objeto para moverlo, o el fondo para seleccionar por área.",
    line: "Clic en el punto inicial. Luego clic o escribe la longitud. Esc termina.",
    polyline: "Clic en cada vértice. Doble clic o Enter termina; escribe una longitud para el siguiente tramo.",
    rect: "Clic en una esquina, luego en la opuesta, o escribe ancho,alto.",
    circle: "Clic en el centro, luego en el borde, o escribe el radio.",
    text: "Clic donde va el texto y escríbelo abajo.",
    dim: "Clic en el primer punto, en el segundo y luego en la posición de la cota.",
  };
  status(hints[next]);
  cmd.placeholder = next === "text" ? "Primero haz clic en el dibujo" : "Escribe una medida en mm y pulsa Enter";
  redraw();
}

function place(p: Pt): void {
  switch (tool) {
    case "line":
      if (draft.length) add({ kind: "line", a: draft[0], b: p } as Entity);
      draft = [p];
      break;
    case "polyline":
      draft.push(p);
      break;
    case "rect":
      if (!draft.length) draft = [p];
      else {
        const a = draft[0];
        if (a.x !== p.x && a.y !== p.y) add({ kind: "polyline", closed: true, pts: [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }] } as Entity);
        draft = [];
      }
      break;
    case "circle":
      if (!draft.length) draft = [p];
      else {
        const r = dist(draft[0], p);
        if (r > 0) add({ kind: "circle", c: draft[0], r } as Entity);
        draft = [];
      }
      break;
    case "text":
      textAt = p;
      cmd.placeholder = "Escribe el texto y pulsa Enter";
      cmd.focus();
      break;
    case "dim":
      if (draft.length < 2) draft.push(p);
      else {
        const [a, b] = draft;
        const len = dist(a, b) || 1;
        const offset = ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / len;
        if (len > 0) add({ kind: "dim", a, b, offset } as Entity);
        draft = [];
      }
      break;
    default:
  }
  redraw();
}

function finishPolyline(): void {
  if (tool === "polyline" && draft.length >= 2) add({ kind: "polyline", pts: [...draft], closed: false } as Entity);
  draft = [];
  redraw();
}

function numberList(text: string): number[] | null {
  const parts = text.replace(/\s+/g, "").replace(/;/g, ",").split(",").filter(Boolean);
  const nums = parts.map((p) => Number(p.replace(",", ".")));
  return nums.length && nums.every(Number.isFinite) ? nums : null;
}

/** Typed input: a length along the cursor direction, a radius, or width,height. */
function runCommand(text: string): void {
  const value = text.trim();
  if (!value) {
    if (tool === "polyline") finishPolyline();
    return;
  }
  if (tool === "text") {
    if (!textAt) return status("Primero haz clic donde va el texto.", true);
    add({ kind: "text", p: textAt, text: value.slice(0, 500), h: Math.max(gridStep / 2, 1) } as Entity);
    textAt = null;
    return;
  }
  const nums = numberList(value.replace(/^@/, ""));
  if (!nums) return status("Escribe solo números en milímetros, por ejemplo 250 o 300,200.", true);
  const anchor = draft[draft.length - 1];
  if (!anchor) {
    if (nums.length === 2) place({ x: nums[0], y: nums[1] });
    else status("Primero marca un punto inicial, o escribe x,y para empezar en una coordenada.", true);
    return;
  }
  if (tool === "rect" && nums.length === 2) {
    const sx = Math.sign(cursor.x - anchor.x) || 1;
    const sy = Math.sign(cursor.y - anchor.y) || 1;
    return place({ x: anchor.x + sx * Math.abs(nums[0]), y: anchor.y + sy * Math.abs(nums[1]) });
  }
  if (nums.length === 2) return place({ x: anchor.x + nums[0], y: anchor.y + nums[1] });
  const toward = (orthoOn || shiftDown) ? ortho(anchor, cursor) : cursor;
  place(atLength(anchor, toward, Math.abs(nums[0])));
}

/* ---------- rendering ---------- */

function redraw(): void {
  if (needsFrame) return;
  needsFrame = true;
  requestAnimationFrame(() => {
    needsFrame = false;
    paint();
  });
}

function strokeEntity(e: Entity, dashed = false): void {
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.beginPath();
  const S = toScreen;
  switch (e.kind) {
    case "line": {
      const a = S(e.a), b = S(e.b);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      break;
    }
    case "polyline": {
      e.pts.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      if (e.closed) ctx.closePath();
      break;
    }
    case "circle": {
      const c = S(e.c);
      ctx.arc(c.x, c.y, e.r * view.s, 0, Math.PI * 2);
      break;
    }
    case "arc": {
      const c = S(e.c);
      ctx.arc(c.x, c.y, e.r * view.s, -e.start, -e.end, true);
      break;
    }
    case "text": {
      const p = S(e.p);
      ctx.font = `${Math.max(e.h * view.s, 1)}px system-ui, sans-serif`;
      ctx.fillText(e.text, p.x, p.y);
      break;
    }
    case "dim": {
      const g = dimensionGeometry(e);
      g.segments.forEach(([a, b]) => { const sa = S(a), sb = S(b); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); });
      const t = S(g.textAt);
      ctx.save();
      ctx.translate(t.x, t.y);
      let angle = -g.angle;
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      ctx.rotate(angle);
      ctx.font = `${Math.max(g.textHeight * view.s, 9)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(g.value, 0, 0);
      ctx.restore();
      break;
    }
  }
  ctx.stroke();
}

function paintGrid(w: number, h: number): void {
  let step = gridStep;
  while (step * view.s < 12) step *= 5;
  const tl = toWorld(0, 0);
  const br = toWorld(w, h);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { const s = toScreen({ x, y: 0 }).x; ctx.moveTo(s, 0); ctx.lineTo(s, h); }
  for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) { const s = toScreen({ x: 0, y }).y; ctx.moveTo(0, s); ctx.lineTo(w, s); }
  ctx.stroke();
  const o = toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.moveTo(o.x, 0); ctx.lineTo(o.x, h);
  ctx.moveTo(0, o.y); ctx.lineTo(w, o.y);
  ctx.stroke();
}

function paint(): void {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, rect.width, rect.height);
  paintGrid(rect.width, rect.height);
  ctx.fillStyle = colors.fg;
  for (const e of drawing.entities) {
    if (!isVisible(e)) continue;
    const selected = selection.has(e.id);
    ctx.strokeStyle = colors.fg;
    ctx.fillStyle = colors.fg;
    ctx.lineWidth = selected ? 3 : 1.25;
    strokeEntity(e, selected);
  }
  // Preview of what the next click creates.
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  const anchor = draft[draft.length - 1];
  const preview = (e: Omit<Entity, "id" | "layer">) => strokeEntity({ ...e, id: "preview", layer: drawing.current } as Entity, true);
  if (anchor) {
    if (tool === "line" || tool === "polyline") {
      if (draft.length > 1) preview({ kind: "polyline", pts: draft, closed: false } as Entity);
      preview({ kind: "line", a: anchor, b: cursor } as Entity);
      showLength(anchor, cursor);
    } else if (tool === "rect") {
      preview({ kind: "polyline", closed: true, pts: [anchor, { x: cursor.x, y: anchor.y }, cursor, { x: anchor.x, y: cursor.y }] } as Entity);
      label(cursor, `${formatLength(Math.abs(cursor.x - anchor.x))} × ${formatLength(Math.abs(cursor.y - anchor.y))}`);
    } else if (tool === "circle") {
      preview({ kind: "circle", c: anchor, r: Math.max(dist(anchor, cursor), 0.0001) } as Entity);
      label(cursor, `r ${formatLength(dist(anchor, cursor))}`);
    } else if (tool === "dim") {
      if (draft.length === 1) preview({ kind: "line", a: anchor, b: cursor } as Entity);
      else {
        const [a, b] = draft;
        const len = dist(a, b) || 1;
        const offset = ((cursor.x - a.x) * -(b.y - a.y) + (cursor.y - a.y) * (b.x - a.x)) / len;
        preview({ kind: "dim", a, b, offset } as Entity);
      }
    }
  }
  if (drag?.kind === "box") {
    const a = toScreen(drag.from), b = toScreen(cursor);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = colors.sel;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  if (snap && snap.kind !== "grid" && tool !== "select") {
    const s = toScreen(snap.p);
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.sel;
    ctx.lineWidth = 2;
    if (snap.kind === "mid") { ctx.beginPath(); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y + 5); ctx.lineTo(s.x - 6, s.y + 5); ctx.closePath(); ctx.stroke(); }
    else if (snap.kind === "center") { ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
  }
  if (textAt) {
    const s = toScreen(textAt);
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.sel;
    ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke();
  }
}

function label(at: Pt, text: string): void {
  const s = toScreen(at);
  ctx.setLineDash([]);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = colors.fg;
  ctx.fillText(text, s.x + 12, s.y - 12);
}

function showLength(a: Pt, b: Pt): void {
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  label(b, `${formatLength(dist(a, b))} mm  ${formatLength(((angle % 360) + 360) % 360)}°`);
}

/* ---------- pointer and keyboard ---------- */

function screenPoint(ev: PointerEvent | WheelEvent | MouseEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

canvas.addEventListener("pointerdown", (ev) => {
  canvas.focus();
  canvas.setPointerCapture(ev.pointerId);
  const sp = screenPoint(ev);
  const raw = toWorld(sp.x, sp.y);
  if (ev.button === 1 || spaceDown) {
    drag = { kind: "pan", from: raw, screen: sp, moved: false };
    return;
  }
  if (ev.button !== 0) return;
  if (tool !== "select") {
    place(resolve(raw));
    return;
  }
  const hit = hitTest(raw);
  if (hit) {
    if (ev.shiftKey) {
      if (selection.has(hit.id)) selection.delete(hit.id); else selection.add(hit.id);
    } else if (!selection.has(hit.id)) selection = new Set([hit.id]);
    drag = { kind: "move", from: resolve(raw), screen: sp, moved: false };
  } else {
    if (!ev.shiftKey) selection = new Set();
    drag = { kind: "box", from: raw, screen: sp, moved: false };
  }
  updateSelectionStatus();
  redraw();
});

canvas.addEventListener("pointermove", (ev) => {
  const sp = screenPoint(ev);
  const raw = toWorld(sp.x, sp.y);
  if (drag?.kind === "pan") {
    view.tx += sp.x - drag.screen.x;
    view.ty += sp.y - drag.screen.y;
    drag.screen = sp;
    redraw();
    return;
  }
  cursor = drag?.kind === "box" ? raw : resolve(raw);
  $("coords").textContent = `x ${formatLength(cursor.x)} · y ${formatLength(cursor.y)} mm`;
  if (drag?.kind === "move") {
    const dx = cursor.x - drag.from.x;
    const dy = cursor.y - drag.from.y;
    if (dx || dy) {
      if (!drag.moved) history.push(drawing);
      drag.moved = true;
      drawing.entities = drawing.entities.map((e) => (selection.has(e.id) && isEditable(e) ? translate(e, dx, dy) : e));
      drag.from = cursor;
    }
  }
  redraw();
});

canvas.addEventListener("pointerup", () => {
  if (drag?.kind === "box") {
    const a = drag.from;
    const box = { minX: Math.min(a.x, cursor.x), minY: Math.min(a.y, cursor.y), maxX: Math.max(a.x, cursor.x), maxY: Math.max(a.y, cursor.y) };
    if (box.maxX - box.minX > 0 || box.maxY - box.minY > 0) {
      drawing.entities.filter((e) => isEditable(e) && inside(e, box)).forEach((e) => selection.add(e.id));
    }
    updateSelectionStatus();
  }
  if (drag?.kind === "move" && drag.moved) {
    bridge.changed();
    status("Selección movida.");
  }
  drag = null;
  redraw();
});

canvas.addEventListener("dblclick", () => { if (tool === "polyline") finishPolyline(); });

canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const sp = screenPoint(ev);
  const before = toWorld(sp.x, sp.y);
  view.s = Math.min(Math.max(view.s * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), 0.0005), 5000);
  view.tx = sp.x - before.x * view.s;
  view.ty = sp.y + before.y * view.s;
  redraw();
}, { passive: false });

function updateSelectionStatus(): void {
  if (tool !== "select") return;
  status(selection.size ? `${selection.size} objeto(s) seleccionado(s). Supr borra, arrastra para mover.` : "");
}

function deleteSelection(): void {
  if (!selection.size) return;
  const count = selection.size;
  commit(() => {
    drawing.entities = drawing.entities.filter((e) => !selection.has(e.id) || !isEditable(e));
    selection = new Set();
  }, `${count} objeto(s) borrado(s).`);
}

function undoRedo(direction: "undo" | "redo"): void {
  const next = direction === "undo" ? history.undo(drawing) : history.redo(drawing);
  if (!next) return;
  drawing = next;
  selection = new Set();
  renderLayers();
  bridge.changed();
  redraw();
}

const SHORTCUTS: Record<string, Tool> = { v: "select", l: "line", p: "polyline", r: "rect", c: "circle", t: "text", d: "dim" };

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Shift") shiftDown = true;
  const typing = ev.target instanceof HTMLInputElement;
  if (typing && ev.target !== cmd) return;
  if (ev.key === "Escape") {
    if (tool === "polyline" && draft.length >= 2) finishPolyline();
    draft = []; textAt = null; selection = new Set(); cmd.value = ""; canvas.focus(); redraw();
    return;
  }
  if (typing) return;
  if (ev.key === " ") { spaceDown = true; ev.preventDefault(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); undoRedo("undo"); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); undoRedo("redo"); return; }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === "Delete" || ev.key === "Backspace") { deleteSelection(); return; }
  if (ev.key === "Enter") { if (tool === "polyline") finishPolyline(); return; }
  if (ev.key === "F8") { ev.preventDefault(); toggle("ortho"); return; }
  const key = ev.key.toLowerCase();
  if (SHORTCUTS[key]) { setTool(SHORTCUTS[key]); return; }
  if (key === "f") { fit(); return; }
  if (key === "g") { toggle("grid"); return; }
  if (key === "s") { toggle("osnap"); return; }
  // Typing a number while drawing goes straight to the measure box.
  if (/^[0-9.,@-]$/.test(ev.key) && draft.length) {
    cmd.focus();
  }
});
window.addEventListener("keyup", (ev) => {
  if (ev.key === "Shift") shiftDown = false;
  if (ev.key === " ") spaceDown = false;
});

cmd.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    runCommand(cmd.value);
    cmd.value = "";
    if (tool !== "text") canvas.focus();
  }
});

function toggle(which: "grid" | "osnap" | "ortho"): void {
  if (which === "grid") gridOn = !gridOn;
  if (which === "osnap") osnapOn = !osnapOn;
  if (which === "ortho") orthoOn = !orthoOn;
  const on = which === "grid" ? gridOn : which === "osnap" ? osnapOn : orthoOn;
  $(which).setAttribute("aria-pressed", String(on));
  status(`${which === "grid" ? "Rejilla" : which === "osnap" ? "Imán" : "Orto"} ${on ? "activado" : "desactivado"}.`);
}

/* ---------- layers ---------- */

function renderLayers(): void {
  const list = $("layers");
  list.replaceChildren(...drawing.layers.map((l) => {
    const li = document.createElement("li");
    li.className = l.name === drawing.current ? "current" : "";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "name";
    name.textContent = l.name;
    name.title = "Dibujar en esta capa (doble clic para renombrar)";
    name.addEventListener("click", () => { drawing.current = l.name; renderLayers(); status(`Dibujando en la capa ${l.name}.`); });
    name.addEventListener("dblclick", () => {
      const next = window.prompt("Nuevo nombre de la capa", l.name)?.trim().slice(0, 64);
      if (!next || next === l.name || drawing.layers.some((x) => x.name === next)) return;
      commit(() => {
        drawing.entities.forEach((e) => { if (e.layer === l.name) e.layer = next; });
        if (drawing.current === l.name) drawing.current = next;
        l.name = next;
      });
      renderLayers();
    });
    const eye = document.createElement("button");
    eye.type = "button";
    eye.textContent = "Ver";
    eye.setAttribute("aria-pressed", String(l.visible));
    eye.setAttribute("aria-label", `Mostrar u ocultar la capa ${l.name}`);
    eye.addEventListener("click", () => { commit(() => { l.visible = !l.visible; }); renderLayers(); });
    const lock = document.createElement("button");
    lock.type = "button";
    lock.textContent = "Fija";
    lock.setAttribute("aria-pressed", String(l.locked));
    lock.setAttribute("aria-label", `Bloquear o desbloquear la capa ${l.name}`);
    lock.addEventListener("click", () => { commit(() => { l.locked = !l.locked; }); renderLayers(); });
    li.append(name, eye, lock);
    return li;
  }));
}

$("add-layer").addEventListener("click", () => {
  let i = drawing.layers.length;
  while (drawing.layers.some((l) => l.name === `Capa ${i}`)) i++;
  commit(() => {
    drawing.layers.push({ name: `Capa ${i}`, visible: true, locked: false });
    drawing.current = `Capa ${i}`;
  }, `Capa ${i} creada; ahora dibujas en ella.`);
  renderLayers();
});

/* ---------- files ---------- */

function save(content: string, type: string, extension: string): void {
  const name = (bridge.title().trim() || "plano").replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 80) || "plano";
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export-dxf").addEventListener("click", () => save(toDxf(drawing), "application/dxf", "dxf"));
$("export-svg").addEventListener("click", () => save(toSvg(drawing), "image/svg+xml", "svg"));
$<HTMLInputElement>("import").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 50 * 1048576) return status("El DXF supera 50 MB; es demasiado para el navegador.", true);
  try {
    const result = await bridge.busy(async () => fromDxf(await file.text()));
    commit(() => {
      for (const l of result.drawing.layers) if (!drawing.layers.some((x) => x.name === l.name)) drawing.layers.push(l);
      drawing.entities.push(...result.drawing.entities);
    });
    renderLayers();
    fit();
    const skipped = Object.entries(result.skipped).map(([k, v]) => `${v} ${k}`).join(", ");
    status(`Importados ${result.imported} objetos de ${file.name}.${skipped ? ` No se pudieron leer: ${skipped}.` : ""}`, Boolean(skipped));
  } catch (err) {
    status(err instanceof Error ? err.message : "No se pudo leer el DXF.", true);
  }
});

/* ---------- toolbar ---------- */

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool as Tool)));
$("undo").addEventListener("click", () => undoRedo("undo"));
$("redo").addEventListener("click", () => undoRedo("redo"));
$("delete").addEventListener("click", deleteSelection);
$("grid").addEventListener("click", () => toggle("grid"));
$("osnap").addEventListener("click", () => toggle("osnap"));
$("ortho").addEventListener("click", () => toggle("ortho"));
$("fit").addEventListener("click", fit);
$<HTMLInputElement>("grid-step").addEventListener("change", (ev) => {
  const v = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(v) && v > 0) { gridStep = v; redraw(); }
});

new ResizeObserver(resize).observe(canvas);
readColors();
renderLayers();
setTool("select");
