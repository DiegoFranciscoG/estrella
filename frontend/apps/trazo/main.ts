import { connect } from "../shared/bridge";
import "../shared/program.css";
import "./trazo.css";
import {
  add, defaultStyle, duplicate, find, fitTo, localBox, move, newDrawing, parseDrawing, placed, remove, reorder, restyle, simplify,
  type Box, type Drawing, type Order, type Shape, type Style,
} from "./model";
import { describe, fromSvg, placementAttr, toSvg } from "./svg-io";

type Tool = "select" | "rect" | "ellipse" | "line" | "pen" | "pencil" | "text";
type Corner = "nw" | "ne" | "sw" | "se";

const NS = "http://www.w3.org/2000/svg";
const HISTORY = 200;
const HINTS: Record<Tool, string> = {
  select: "Clic para elegir (con Mayús, varias); arrastra para mover; arrastra en vacío para elegir con un marco.",
  rect: "Arrastra para dibujar un rectángulo. Con Mayús, un cuadrado.",
  ellipse: "Arrastra para dibujar una elipse. Con Mayús, un círculo.",
  line: "Arrastra para dibujar una línea. Con Mayús, en pasos de 45°.",
  pen: "Un clic por punto. Enter o doble clic termina; clic en el primer punto cierra la forma; Esc cancela.",
  pencil: "Arrastra para dibujar a mano alzada.",
  text: "Clic donde va el texto, escríbelo y pulsa Enter.",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const statusEl = $("status");
const editor = $<HTMLInputElement>("text-editor");

let drawing: Drawing = newDrawing();
let tool: Tool = "select";
const selection = new Set<string>();
let style: Style = defaultStyle();
let view: Box = { x: -40, y: -40, w: 1104, h: 848 };
const undoStack: string[] = [];
const redoStack: string[] = [];
let pending: string | null = null;

function status(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const bridge = connect({
  load(data) {
    if (!data) {
      fitView();
      render();
      return;
    }
    try {
      drawing = parseDrawing(data);
    } catch {
      drawing = newDrawing();
      status("No se pudo abrir el dibujo guardado: empiezas con una mesa nueva.", true);
    }
    syncBoardFields();
    fitView();
    render();
  },
  serialize: () => JSON.stringify(drawing),
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
  },
});

// ------------------------------------------------------------------------------- history

/** Call before changing the drawing; `commit` records it as one undoable step. */
function begin(): void {
  pending ??= JSON.stringify(drawing);
}

function commit(): void {
  if (pending === null) return;
  if (pending !== JSON.stringify(drawing)) {
    undoStack.push(pending);
    if (undoStack.length > HISTORY) undoStack.shift();
    redoStack.length = 0;
    bridge.changed();
  }
  pending = null;
  render();
}

function restore(from: string[], to: string[]): void {
  const snapshot = from.pop();
  if (!snapshot) return;
  to.push(JSON.stringify(drawing));
  drawing = parseDrawing(snapshot);
  for (const id of [...selection]) if (!drawing.shapes.some((s) => s.id === id)) selection.delete(id);
  bridge.changed();
  syncBoardFields();
  render();
}

// ------------------------------------------------------------------------------ geometry

function toDrawing(clientX: number, clientY: number): [number, number] {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return [p.x, p.y];
}

/** Drawing units per screen pixel at the current zoom. */
function unit(): number {
  const m = svg.getScreenCTM();
  return m ? 1 / m.a : 1;
}

function boxOf(s: Shape): Box | null {
  const local = localBox(s);
  if (local) return placed(s, local);
  const node = svg.querySelector<SVGGraphicsElement>(`[data-id="${s.id}"] > *`);
  if (!node) return null;
  const b = node.getBBox();
  return placed(s, { x: b.x, y: b.y, w: b.width, h: b.height });
}

/** Local box used to resize: measured for imported paths and text, computed for the rest. */
function measuredLocal(s: Shape): Box | null {
  if (s.kind !== "path" && s.kind !== "text") return localBox(s);
  const node = svg.querySelector<SVGGraphicsElement>(`[data-id="${s.id}"] > *`);
  if (!node) return localBox(s);
  const b = node.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

// ------------------------------------------------------------------------------- render

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

let overlay: SVGGElement = node("g");

function render(): void {
  svg.dataset.tool = tool;
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const defs = node("defs");
  const pattern = node("pattern", { id: "checker", width: 16, height: 16, patternUnits: "userSpaceOnUse" });
  pattern.append(node("rect", { width: 16, height: 16, fill: "#ffffff" }), node("rect", { width: 8, height: 8, fill: "#e4e4e4" }), node("rect", { x: 8, y: 8, width: 8, height: 8, fill: "#e4e4e4" }));
  defs.append(pattern);
  const board = node("rect", { class: "board", x: 0, y: 0, width: drawing.width, height: drawing.height, fill: drawing.background ?? "url(#checker)" });
  const shapes = node("g", { id: "shapes" });
  for (const s of drawing.shapes) {
    if (s.hidden) continue;
    const { tag, attrs, text } = describe(s);
    const g = node("g", { "data-id": s.id });
    const transform = placementAttr(s);
    if (transform) g.setAttribute("transform", transform);
    const el = node(tag, attrs);
    if (text !== undefined) el.textContent = text;
    g.append(el);
    shapes.append(g);
  }
  overlay = node("g", { id: "overlay" });
  svg.replaceChildren(defs, board, shapes, overlay);
  drawSelection();
  renderLayers();
  renderProps();
  $("zoom").textContent = `${Math.round(100 / unit())} %`;
  ($("undo") as HTMLButtonElement).disabled = !undoStack.length;
  ($("redo") as HTMLButtonElement).disabled = !redoStack.length;
}

function drawSelection(): void {
  const boxes = find(drawing, selection).filter((s) => !s.hidden).map(boxOf).filter((b): b is Box => b !== null);
  const all = union(boxes);
  if (!all) return;
  for (const b of boxes) overlay.append(node("rect", { class: "sel-box", x: b.x, y: b.y, width: b.w, height: b.h }));
  if (selection.size === 1 && all.w + all.h > 0) {
    const r = 5 * unit();
    const corners: [Corner, number, number][] = [["nw", all.x, all.y], ["ne", all.x + all.w, all.y], ["sw", all.x, all.y + all.h], ["se", all.x + all.w, all.y + all.h]];
    for (const [corner, x, y] of corners) {
      overlay.append(node("rect", { class: "handle", "data-corner": corner, x: x - r, y: y - r, width: 2 * r, height: 2 * r }));
    }
  }
}

function renderLayers(): void {
  const list = $("layers");
  list.replaceChildren();
  for (const s of [...drawing.shapes].reverse()) {
    const name = document.createElement("button");
    name.type = "button";
    name.className = "name";
    name.textContent = s.name;
    name.setAttribute("aria-pressed", String(selection.has(s.id)));
    name.addEventListener("click", (ev) => {
      if (!ev.shiftKey) selection.clear();
      if (selection.has(s.id) && ev.shiftKey) selection.delete(s.id);
      else selection.add(s.id);
      render();
      svg.focus();
    });
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye";
    eye.textContent = "Ver";
    eye.setAttribute("aria-pressed", String(!s.hidden));
    eye.setAttribute("aria-label", `${s.hidden ? "Mostrar" : "Ocultar"} ${s.name}`);
    eye.addEventListener("click", () => {
      begin();
      s.hidden = !s.hidden;
      if (s.hidden) selection.delete(s.id);
      commit();
    });
    const li = document.createElement("li");
    li.append(name, eye);
    list.append(li);
  }
  const none = selection.size === 0;
  for (const id of ["front", "up", "down", "back"]) ($(id) as HTMLButtonElement).disabled = none;
}

// --------------------------------------------------------------------------- properties

const fields = {
  fill: $<HTMLInputElement>("fill"), noFill: $<HTMLInputElement>("no-fill"),
  stroke: $<HTMLInputElement>("stroke"), noStroke: $<HTMLInputElement>("no-stroke"),
  width: $<HTMLInputElement>("stroke-width"), opacity: $<HTMLInputElement>("opacity"),
  size: $<HTMLInputElement>("font-size"), bold: $<HTMLInputElement>("bold"),
  x: $<HTMLInputElement>("geo-x"), y: $<HTMLInputElement>("geo-y"), w: $<HTMLInputElement>("geo-w"), h: $<HTMLInputElement>("geo-h"),
};

function renderProps(): void {
  const picked = find(drawing, selection);
  $("props").hidden = picked.length === 0;
  $("nothing").hidden = picked.length > 0;
  const first = picked[0];
  const shown: Style & { size?: number; bold?: boolean } = first ?? style;
  if (document.activeElement !== fields.fill) fields.fill.value = shown.fill ?? style.fill ?? "#d9d9d9";
  fields.noFill.checked = shown.fill === null;
  if (document.activeElement !== fields.stroke) fields.stroke.value = shown.stroke ?? style.stroke ?? "#111111";
  fields.noStroke.checked = shown.stroke === null;
  if (document.activeElement !== fields.width) fields.width.value = String(shown.strokeWidth);
  fields.opacity.value = String(Math.round(shown.opacity * 100));
  $("opacity-value").textContent = `${fields.opacity.value} %`;
  const text = first?.kind === "text" ? first : null;
  $("text-props").hidden = !text;
  if (text) {
    if (document.activeElement !== fields.size) fields.size.value = String(text.size);
    fields.bold.checked = text.bold;
  }
  const single = picked.length === 1 ? boxOf(first) : null;
  $("geometry").hidden = !single;
  if (single) {
    for (const [field, value] of [[fields.x, single.x], [fields.y, single.y], [fields.w, single.w], [fields.h, single.h]] as const) {
      if (document.activeElement !== field) field.value = String(Math.round(value * 10) / 10);
    }
  }
}

/** Changes the selected shapes, or the style for new ones when nothing is selected. */
function applyStyle(change: Partial<Style>, record = true): void {
  style = { ...style, ...change };
  if (!selection.size) return;
  if (record) begin();
  restyle(drawing, selection, change);
  if (record) commit();
  else render();
}

fields.fill.addEventListener("change", () => applyStyle({ fill: fields.fill.value }));
fields.noFill.addEventListener("change", () => applyStyle({ fill: fields.noFill.checked ? null : fields.fill.value }));
fields.stroke.addEventListener("change", () => applyStyle({ stroke: fields.stroke.value }));
fields.noStroke.addEventListener("change", () => applyStyle({ stroke: fields.noStroke.checked ? null : fields.stroke.value }));
fields.width.addEventListener("change", () => {
  const w = Number(fields.width.value);
  if (Number.isFinite(w) && w >= 0 && w <= 500) applyStyle({ strokeWidth: w });
});
// Dragging or using the arrow keys records one step: the state before the first change.
fields.opacity.addEventListener("input", () => {
  $("opacity-value").textContent = `${fields.opacity.value} %`;
  begin();
  applyStyle({ opacity: Number(fields.opacity.value) / 100 }, false);
});
fields.opacity.addEventListener("change", () => commit());

function editText(change: { size?: number; bold?: boolean }): void {
  const texts = find(drawing, selection).filter((s) => s.kind === "text");
  if (!texts.length) return;
  begin();
  for (const t of texts) Object.assign(t, change);
  commit();
}
fields.size.addEventListener("change", () => {
  const n = Number(fields.size.value);
  if (Number.isFinite(n) && n >= 1 && n <= 2000) editText({ size: n });
});
fields.bold.addEventListener("change", () => editText({ bold: fields.bold.checked }));

function editGeometry(): void {
  const [s] = find(drawing, selection);
  if (!s || selection.size !== 1) return;
  const local = measuredLocal(s);
  const box = boxOf(s);
  if (!local || !box) return;
  const to = { x: Number(fields.x.value), y: Number(fields.y.value), w: Number(fields.w.value), h: Number(fields.h.value) };
  if (![to.x, to.y, to.w, to.h].every(Number.isFinite) || to.w <= 0 || to.h <= 0) return;
  begin();
  if (local.w > 0 && local.h > 0) fitTo(s, local, to);
  else move(drawing, [s.id], to.x - box.x, to.y - box.y);
  commit();
}
for (const f of [fields.x, fields.y, fields.w, fields.h]) f.addEventListener("change", editGeometry);

// --------------------------------------------------------------------------------- board

function syncBoardFields(): void {
  $<HTMLInputElement>("board-w").value = String(drawing.width);
  $<HTMLInputElement>("board-h").value = String(drawing.height);
  if (drawing.background) $<HTMLInputElement>("board-bg").value = drawing.background;
  $<HTMLInputElement>("board-clear").checked = drawing.background === null;
}

for (const id of ["board-w", "board-h"]) {
  $(id).addEventListener("change", () => {
    const w = Number($<HTMLInputElement>("board-w").value);
    const h = Number($<HTMLInputElement>("board-h").value);
    if (![w, h].every((n) => Number.isFinite(n) && n >= 1 && n <= 20000)) {
      syncBoardFields();
      return status("La mesa mide de 1 a 20 000 px por lado.", true);
    }
    begin();
    drawing.width = w;
    drawing.height = h;
    commit();
  });
}
$("board-bg").addEventListener("change", () => {
  begin();
  drawing.background = $<HTMLInputElement>("board-bg").value;
  $<HTMLInputElement>("board-clear").checked = false;
  commit();
});
$("board-clear").addEventListener("change", () => {
  begin();
  drawing.background = $<HTMLInputElement>("board-clear").checked ? null : $<HTMLInputElement>("board-bg").value;
  commit();
});

// ---------------------------------------------------------------------------------- view

function fitView(): void {
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 4 / 3;
  const margin = Math.max(drawing.width, drawing.height) * 0.06;
  let w = drawing.width + 2 * margin;
  let h = drawing.height + 2 * margin;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  view = { x: drawing.width / 2 - w / 2, y: drawing.height / 2 - h / 2, w, h };
}

function zoom(factor: number, around?: [number, number]): void {
  const [cx, cy] = around ?? [view.x + view.w / 2, view.y + view.h / 2];
  const w = Math.min(Math.max(view.w * factor, 10), 400000);
  const h = view.h * (w / view.w);
  view = { x: cx - (cx - view.x) * (w / view.w), y: cy - (cy - view.y) * (h / view.h), w, h };
  render();
}

svg.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, toDrawing(ev.clientX, ev.clientY));
}, { passive: false });
$("zoom-in").addEventListener("click", () => zoom(1 / 1.25));
$("zoom-out").addEventListener("click", () => zoom(1.25));
$("fit").addEventListener("click", () => {
  fitView();
  render();
});
window.addEventListener("resize", () => render());

// --------------------------------------------------------------------------------- tools

function setTool(next: Tool): void {
  finishPen(false);
  closeEditor(false);
  tool = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === next));
  status(HINTS[next]);
  render();
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool as Tool));

type Drag =
  | { kind: "move"; last: [number, number]; moved: boolean }
  | { kind: "resize"; id: string; corner: Corner; local: Box; start: Box; ratio: number }
  | { kind: "marquee"; from: [number, number]; add: boolean }
  | { kind: "draw"; from: [number, number]; to: [number, number] }
  | { kind: "pencil"; points: [number, number][] }
  | { kind: "pan"; client: [number, number]; view: Box };

let drag: Drag | null = null;
let pen: [number, number][] = [];
let cursor: [number, number] = [0, 0];
let spaceDown = false;

function constrain(from: [number, number], to: [number, number], square: boolean): [number, number] {
  if (!square) return to;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (tool === "line") {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + Math.sign(dx || 1) * side, from[1] + Math.sign(dy || 1) * side];
}

function preview(): void {
  overlay.querySelectorAll(".preview, .marquee").forEach((n) => n.remove());
  if (drag?.kind === "draw") {
    const [x1, y1] = drag.from;
    const [x2, y2] = drag.to;
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (tool === "rect") overlay.append(node("rect", { class: "preview", x: box.x, y: box.y, width: box.w, height: box.h }));
    else if (tool === "ellipse") overlay.append(node("ellipse", { class: "preview", cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 }));
    else overlay.append(node("line", { class: "preview", x1, y1, x2, y2 }));
  } else if (drag?.kind === "pencil" && drag.points.length > 1) {
    overlay.append(node("polyline", { class: "preview", points: drag.points.map((p) => p.join(",")).join(" ") }));
  } else if (drag?.kind === "marquee") {
    const [x1, y1] = drag.from;
    const [x2, y2] = cursor;
    overlay.append(node("rect", { class: "marquee", x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }));
  }
  if (tool === "pen" && pen.length) {
    overlay.append(node("polyline", { class: "preview", points: [...pen, cursor].map((p) => p.join(",")).join(" ") }));
  }
}

function created(shape: Shape): void {
  selection.clear();
  selection.add(shape.id);
}

function finishPen(close: boolean): void {
  const points = pen.filter((p, i) => i === 0 || Math.hypot(p[0] - pen[i - 1][0], p[1] - pen[i - 1][1]) > 1e-6);
  pen = [];
  if (points.length < 2) {
    render();
    return;
  }
  begin();
  created(add(drawing, { kind: "poly", points, closed: close && points.length >= 3 }, close ? style : { ...style, fill: null }));
  commit();
}

svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.button !== 1) return;
  svg.focus();
  const p = toDrawing(ev.clientX, ev.clientY);
  cursor = p;
  if (ev.button === 1 || spaceDown) {
    drag = { kind: "pan", client: [ev.clientX, ev.clientY], view: { ...view } };
    svg.classList.add("panning");
    svg.setPointerCapture(ev.pointerId);
    return;
  }
  const target = ev.target as Element;
  if (tool === "select") {
    const corner = (target as SVGElement).dataset?.corner as Corner | undefined;
    if (corner && selection.size === 1) {
      const [s] = find(drawing, selection);
      const local = measuredLocal(s);
      const start = boxOf(s);
      if (local && start) {
        begin();
        drag = { kind: "resize", id: s.id, corner, local, start, ratio: start.h > 0 ? start.w / start.h : 1 };
        svg.setPointerCapture(ev.pointerId);
      }
      return;
    }
    const id = target.closest("[data-id]")?.getAttribute("data-id");
    if (id) {
      if (ev.shiftKey) {
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
      } else if (!selection.has(id)) {
        selection.clear();
        selection.add(id);
      }
      begin();
      drag = { kind: "move", last: p, moved: false };
    } else {
      if (!ev.shiftKey) selection.clear();
      drag = { kind: "marquee", from: p, add: ev.shiftKey };
    }
    svg.setPointerCapture(ev.pointerId);
    render();
    return;
  }
  if (tool === "pen") {
    if (pen.length >= 3 && Math.hypot(p[0] - pen[0][0], p[1] - pen[0][1]) < 8 * unit()) {
      finishPen(true);
      return;
    }
    pen.push(p);
    preview();
    return;
  }
  if (tool === "text") {
    openEditor(p, null);
    ev.preventDefault();
    return;
  }
  if (tool === "pencil") drag = { kind: "pencil", points: [p] };
  else drag = { kind: "draw", from: p, to: p };
  svg.setPointerCapture(ev.pointerId);
});

svg.addEventListener("pointermove", (ev) => {
  const p = toDrawing(ev.clientX, ev.clientY);
  cursor = p;
  if (!drag) {
    if (tool === "pen" && pen.length) preview();
    return;
  }
  switch (drag.kind) {
    case "pan": {
      const k = unit();
      view = { ...drag.view, x: drag.view.x - (ev.clientX - drag.client[0]) * k, y: drag.view.y - (ev.clientY - drag.client[1]) * k };
      svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
      return;
    }
    case "move": {
      const dx = p[0] - drag.last[0];
      const dy = p[1] - drag.last[1];
      if (dx || dy) {
        move(drawing, selection, dx, dy);
        drag.last = p;
        drag.moved = true;
        render();
      }
      return;
    }
    case "resize": {
      const s = find(drawing, [drag.id])[0];
      if (!s) return;
      const { start, corner } = drag;
      const fixedX = corner === "nw" || corner === "sw" ? start.x + start.w : start.x;
      const fixedY = corner === "nw" || corner === "ne" ? start.y + start.h : start.y;
      let w = Math.max(1 * unit(), Math.abs(p[0] - fixedX));
      let h = Math.max(1 * unit(), Math.abs(p[1] - fixedY));
      if (ev.shiftKey && drag.ratio > 0) {
        if (w / h > drag.ratio) h = w / drag.ratio;
        else w = h * drag.ratio;
      }
      const to = { x: p[0] < fixedX ? fixedX - w : fixedX, y: p[1] < fixedY ? fixedY - h : fixedY, w, h };
      if (drag.local.w > 0 && drag.local.h > 0) fitTo(s, drag.local, to);
      render();
      return;
    }
    case "marquee":
      preview();
      return;
    case "draw":
      drag.to = constrain(drag.from, p, ev.shiftKey);
      preview();
      return;
    case "pencil": {
      const last = drag.points[drag.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5 * unit()) drag.points.push(p);
      preview();
    }
  }
});

function endDrag(ev: PointerEvent): void {
  const current = drag;
  drag = null;
  svg.classList.remove("panning");
  if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
  if (!current) return;
  switch (current.kind) {
    case "pan":
      render();
      return;
    case "move":
    case "resize":
      commit();
      return;
    case "marquee": {
      const [x1, y1] = current.from;
      const [x2, y2] = cursor;
      const area = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (area.w > 2 * unit() || area.h > 2 * unit()) {
        for (const s of drawing.shapes) {
          const b = s.hidden ? null : boxOf(s);
          if (b && intersects(area, b)) selection.add(s.id);
        }
      }
      render();
      return;
    }
    case "draw": {
      const [x1, y1] = current.from;
      const [x2, y2] = current.to;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (Math.max(w, h) < 2 * unit()) {
        render();
        return;
      }
      begin();
      if (tool === "rect") created(add(drawing, { kind: "rect", x: Math.min(x1, x2), y: Math.min(y1, y2), w, h, r: 0 }, style));
      else if (tool === "ellipse") created(add(drawing, { kind: "ellipse", cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: w / 2, ry: h / 2 }, style));
      else created(add(drawing, { kind: "line", x1, y1, x2, y2 }, { ...style, stroke: style.stroke ?? "#111111" }));
      commit();
      return;
    }
    case "pencil": {
      const points = simplify(current.points, 0.75 * unit());
      if (points.length < 2) {
        render();
        return;
      }
      begin();
      created(add(drawing, { kind: "poly", points, closed: false }, { ...style, fill: null, stroke: style.stroke ?? "#111111" }));
      commit();
    }
  }
}
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

svg.addEventListener("dblclick", (ev) => {
  if (tool === "pen") {
    finishPen(false);
    return;
  }
  if (tool !== "select") return;
  const id = (ev.target as Element).closest("[data-id]")?.getAttribute("data-id");
  const [s] = id ? find(drawing, [id]) : [];
  if (s?.kind === "text") openEditor([s.tx + s.x * s.sx, s.ty + s.y * s.sy], s.id);
});

// ------------------------------------------------------------------------------- text

let editing: { at: [number, number]; id: string | null } | null = null;

function openEditor(at: [number, number], id: string | null): void {
  closeEditor(true);
  editing = { at, id };
  const m = svg.getScreenCTM()!;
  const stage = svg.getBoundingClientRect();
  const size = id ? (find(drawing, [id])[0] as Extract<Shape, { kind: "text" }>).size : 32;
  editor.style.left = `${m.a * at[0] + m.e - stage.left}px`;
  editor.style.top = `${m.d * at[1] + m.f - stage.top - Math.min(48, size * m.a)}px`;
  editor.value = id ? (find(drawing, [id])[0] as Extract<Shape, { kind: "text" }>).text : "";
  editor.hidden = false;
  editor.focus();
}

function closeEditor(save: boolean): void {
  if (!editing) return;
  const { at, id } = editing;
  editing = null;
  editor.hidden = true;
  const text = editor.value.trim();
  if (!save || !text) {
    if (save && !text && id) {
      begin();
      remove(drawing, [id]);
      selection.delete(id);
      commit();
    }
    render();
    return;
  }
  begin();
  if (id) {
    const s = find(drawing, [id])[0];
    if (s?.kind === "text") s.text = text;
  } else {
    created(add(drawing, { kind: "text", x: at[0], y: at[1], text, size: 32, bold: false }, { ...style, fill: style.fill ?? style.stroke ?? "#111111", stroke: null }));
  }
  commit();
  svg.focus();
}

editor.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    closeEditor(true);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    closeEditor(false);
  }
});
editor.addEventListener("blur", () => closeEditor(true));

// ----------------------------------------------------------------------------- actions

function act(work: () => void): void {
  if (!selection.size) return;
  begin();
  work();
  commit();
}

$("delete").addEventListener("click", () => act(() => {
  remove(drawing, selection);
  selection.clear();
}));
$("duplicate").addEventListener("click", () => act(() => {
  const copies = duplicate(drawing, selection);
  selection.clear();
  copies.forEach((id) => selection.add(id));
}));
for (const order of ["front", "up", "down", "back"] as Order[]) $(order).addEventListener("click", () => act(() => reorder(drawing, selection, order)));
$("undo").addEventListener("click", () => restore(undoStack, redoStack));
$("redo").addEventListener("click", () => restore(redoStack, undoStack));

window.addEventListener("keydown", (ev) => {
  const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement;
  // Space pans only over the drawing; on a button it still presses the button.
  if (ev.key === " " && (ev.target === svg || ev.target === document.body)) {
    spaceDown = true;
    ev.preventDefault();
    return;
  }
  if (typing) return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    if (ev.shiftKey) restore(redoStack, undoStack);
    else restore(undoStack, redoStack);
  } else if (ctrl && ev.key.toLowerCase() === "y") {
    ev.preventDefault();
    restore(redoStack, undoStack);
  } else if (ctrl && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    $("duplicate").click();
  } else if (ctrl && ev.key.toLowerCase() === "a") {
    ev.preventDefault();
    drawing.shapes.filter((s) => !s.hidden).forEach((s) => selection.add(s.id));
    render();
  } else if (ev.key === "Delete" || ev.key === "Backspace") {
    if (selection.size) {
      ev.preventDefault();
      $("delete").click();
    }
  } else if (ev.key === "Enter" && tool === "pen") {
    ev.preventDefault();
    finishPen(false);
  } else if (ev.key === "Escape") {
    if (tool === "pen" && pen.length) {
      pen = [];
      render();
    } else {
      selection.clear();
      render();
    }
  } else if (ev.key.startsWith("Arrow") && selection.size) {
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1;
    const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
    const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
    act(() => move(drawing, selection, dx, dy));
  } else if (!ctrl && !ev.altKey) {
    const keys: Record<string, Tool> = { v: "select", r: "rect", e: "ellipse", l: "line", p: "pen", b: "pencil", t: "text" };
    const next = keys[ev.key.toLowerCase()];
    if (next) setTool(next);
  }
});
window.addEventListener("keyup", (ev) => {
  if (ev.key === " ") spaceDown = false;
});

// ------------------------------------------------------------------------- files

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fileName(ext: string): string {
  const base = (bridge.title() || "trazo").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "trazo";
  return `${base}.${ext}`;
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$("export-svg").addEventListener("click", () => {
  download(new Blob([toSvg(drawing)], { type: "image/svg+xml" }), fileName("svg"));
  status("SVG descargado.");
});

$("export-png").addEventListener("click", () => {
  void bridge.busy(async () => {
    const scale = Math.min(2, 8000 / Math.max(drawing.width, drawing.height));
    const url = URL.createObjectURL(new Blob([toSvg(drawing)], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(drawing.width * scale));
      canvas.height = Math.max(1, Math.round(drawing.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error("png");
      download(blob, fileName("png"));
      status(`PNG descargado (${canvas.width} × ${canvas.height} px).`);
    } catch {
      status("No se pudo crear el PNG. Exporta en SVG.", true);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});

$<HTMLInputElement>("import").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = fromSvg(await file.text());
    if (!imported.shapes.length) {
      status("El SVG no tiene formas que Trazo pueda leer.", true);
      return;
    }
    begin();
    const wasEmpty = drawing.shapes.length === 0;
    if (wasEmpty && imported.width && imported.height) {
      drawing.width = Math.min(20000, Math.round(imported.width));
      drawing.height = Math.min(20000, Math.round(imported.height));
    }
    selection.clear();
    for (const shape of imported.shapes) {
      const s = add(drawing, shape.geometry as Parameters<typeof add>[1], shape.style);
      Object.assign(s, shape.placement);
      selection.add(s.id);
    }
    commit();
    syncBoardFields();
    if (wasEmpty) {
      fitView();
      render();
    }
    const n = imported.shapes.length;
    const notes = [
      imported.skipped ? `${plural(imported.skipped, "elemento no se pudo traer", "elementos no se pudieron traer")} (imágenes, rotaciones o contenido incrustado)` : "",
      imported.approximated ? `${plural(imported.approximated, "color especial (degradado) quedó", "colores especiales (degradados) quedaron")} en gris` : "",
    ].filter(Boolean);
    status(`${n === 1 ? "Se importó 1 forma" : `Se importaron ${n} formas`}.${notes.length ? " " + notes.join("; ") + "." : ""}`, notes.length > 0);
  } catch (e) {
    status(e instanceof Error ? e.message : "No se pudo leer el SVG.", true);
  }
});

status(HINTS.select);
render();
