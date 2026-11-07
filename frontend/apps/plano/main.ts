import { connect } from "../shared/bridge";
import "../shared/program.css";
import type { DwgResponse } from "../visor/dwg.worker";
import { fromDxf, toDxf } from "./dxf";
import { arcThrough, boundaryAt, intersectionSnap, offset as offsetShape, perpendicularSnap, tangentSnap, trim } from "./geom";
import {
  Affine, atLength, Block, dist, distanceTo, Drawing, drawingBounds, emptyDrawing, Entity, formatLength, HatchPattern, History,
  inside, mirroring, nearestSnap, newId, normAngle, ortho, parseDrawing, polarPoint, polygonArea, primitives, Prim, Pt, rotation,
  scaling, Shape, Snap, snapToGrid, TAU, transformEntity, translation,
} from "./model";
import { SCALES, Sheet, toPdf } from "./pdf";
import "./plano.css";
import { toSvg } from "./svg";

type Tool =
  | "select" | "line" | "polyline" | "rect" | "circle" | "arc"
  | "move" | "copy" | "rotate" | "mirror" | "scale" | "offset" | "trim"
  | "text" | "dim" | "dimlin" | "hatch" | "measure" | "insert" | "blockbase";

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
let rawCursor: Pt = { x: 0, y: 0 };
let snap: Snap | null = null;
let drag: { kind: "pan" | "move" | "box"; from: Pt; screen: Pt; moved: boolean } | null = null;
let colors = { fg: "#111", muted: "#888", line: "#ccc", bg: "#e6e6e6", sel: "#000" };
let needsFrame = false;
let offsetDistance: number | null = null;
let offsetTarget: Entity | null = null;
let insertName: string | null = null;
let pendingBlock: string | null = null;
let clipboard: Entity[] = [];

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
    renderBlocks();
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
  const b = drawingBounds(drawing.entities.filter(isVisible), blocks());
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

const blocks = (): Record<string, Block> => (drawing.blocks ??= {});
const layerOf = (e: Entity) => drawing.layers.find((l) => l.name === e.layer);
const isVisible = (e: Entity) => layerOf(e)?.visible !== false;
const isEditable = (e: Entity) => isVisible(e) && layerOf(e)?.locked !== true;
const visibleEntities = () => drawing.entities.filter(isVisible);
const selected = () => drawing.entities.filter((e) => selection.has(e.id) && isEditable(e));

function commit(change: () => void, message?: string): void {
  history.push(drawing);
  change();
  bridge.changed();
  if (message) status(message);
  redraw();
}

function currentLayerLocked(): boolean {
  const layer = drawing.layers.find((l) => l.name === drawing.current);
  if (layer?.locked) {
    status(`La capa ${layer.name} está bloqueada. Elige otra capa para dibujar.`, true);
    return true;
  }
  return false;
}

function add(shape: Shape, layer = drawing.current): void {
  if (layer === drawing.current && currentLayerLocked()) return;
  commit(() => drawing.entities.push({ ...shape, id: newId(), layer } as Entity));
}

function hitTest(p: Pt): Entity | null {
  const tolerance = 6 / view.s;
  let best: Entity | null = null;
  let bestDist = tolerance;
  for (const e of drawing.entities) {
    if (!isEditable(e)) continue;
    const d = distanceTo(e, p, blocks());
    // A hatch reports 0 everywhere inside it; outlines drawn on top of it should still win.
    const score = e.kind === "hatch" ? d + tolerance * 0.9 : d;
    if (score <= bestDist) {
      best = e;
      bestDist = score;
    }
  }
  return best;
}

/** Cursor after object snap, grid snap and ortho, in that priority. */
function resolve(raw: Pt): Pt {
  snap = null;
  const anchor = draft[draft.length - 1];
  if (osnapOn) {
    const tol = 10 / view.s;
    const vis = visibleEntities();
    const candidates = [
      nearestSnap(vis, raw, tol, blocks()),
      intersectionSnap(vis, raw, tol, blocks()),
      anchor ? perpendicularSnap(vis, anchor, raw, tol) : null,
      anchor ? tangentSnap(vis, anchor, raw, tol) : null,
    ].filter((s): s is Snap => !!s);
    // Exact points win over perpendicular and tangent, which are found from farther away.
    const weight = (s: Snap) => dist(s.p, raw) * (s.kind === "perpendicular" || s.kind === "tangent" ? 1.5 : 1);
    candidates.sort((a, b) => weight(a) - weight(b));
    if (candidates[0]) {
      snap = candidates[0];
      return snap.p;
    }
  }
  let p = raw;
  if (gridOn) {
    p = snapToGrid(raw, gridStep);
    snap = { p, kind: "grid" };
  }
  if (anchor && (orthoOn || shiftDown) && !["circle", "text", "scale"].includes(tool)) p = ortho(anchor, p);
  return p;
}

/* ---------- tools ---------- */

const HINTS: Record<Tool, string> = {
  select: "Clic para seleccionar (Mayús suma). Arrastra un objeto para moverlo, o el fondo para seleccionar por área.",
  line: "Clic en el punto inicial. Luego clic, o escribe la longitud (250) o longitud y ángulo (250<30). Esc termina.",
  polyline: "Clic en cada vértice. Doble clic o Enter termina; escribe una longitud para el siguiente tramo.",
  rect: "Clic en una esquina, luego en la opuesta, o escribe ancho,alto.",
  circle: "Clic en el centro, luego en el borde, o escribe el radio.",
  arc: "Clic en el inicio, en un punto del arco y en el final.",
  move: "Clic en el punto base y luego en el destino, o escribe la distancia (250, @dx,dy o 250<90).",
  copy: "Clic en el punto base y luego en cada destino; puedes copiar varias veces. Esc termina.",
  rotate: "Clic en el punto base y luego escribe el ángulo en grados (positivo: antihorario), o haz clic.",
  mirror: "Clic en dos puntos de la línea de simetría.",
  scale: "Clic en el punto base y luego escribe el factor (2 duplica, 0,5 reduce a la mitad).",
  offset: "Escribe la distancia y pulsa Enter; luego clic en el objeto y en el lado hacia donde copiarlo.",
  trim: "Clic en la parte que quieres quitar: se corta en las intersecciones con otros objetos.",
  text: "Clic donde va el texto y escríbelo abajo.",
  dim: "Clic en el primer punto, en el segundo y luego en la posición de la cota.",
  dimlin: "Clic en dos puntos y luego arriba o abajo (cota horizontal) o a un lado (cota vertical).",
  hatch: "Elige patrón y escala arriba; luego clic dentro de un contorno cerrado (polilínea cerrada, rectángulo o círculo).",
  measure: "Clic en cada punto: verás la distancia acumulada y, con tres o más, el área. Esc empieza de nuevo.",
  insert: "Clic donde va el bloque. Esc termina.",
  blockbase: "Clic en el punto base del bloque: será su punto de inserción.",
};

const NEEDS_SELECTION = new Set<Tool>(["move", "copy", "rotate", "mirror", "scale"]);

function setTool(next: Tool): void {
  if (NEEDS_SELECTION.has(next) && !selected().length) {
    status("Primero selecciona lo que quieres editar (herramienta Seleccionar, tecla V), luego elige la herramienta.", true);
    return;
  }
  tool = next;
  draft = [];
  textAt = null;
  offsetTarget = null;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.tool === next)));
  $("hatch-options").hidden = next !== "hatch";
  status(next === "offset" && offsetDistance ? `Desfase a ${formatLength(offsetDistance)} mm. Clic en el objeto (o escribe otra distancia).` : HINTS[next]);
  cmd.placeholder = next === "text" ? "Primero haz clic en el dibujo" : "Escribe una medida o un comando (L, PL, REC, C, A, M, CO, RO, O, TR, H…)";
  redraw();
}

function transformSelection(m: Affine, keepOriginals: boolean, message: string): void {
  const chosen = selected();
  if (!chosen.length) return status("No hay nada seleccionado.", true);
  commit(() => {
    if (keepOriginals) {
      drawing.entities.push(...chosen.map((e) => ({ ...transformEntity(e, m), id: newId() })));
    } else {
      const ids = new Set(chosen.map((e) => e.id));
      drawing.entities = drawing.entities.map((e) => (ids.has(e.id) ? transformEntity(e, m) : e));
    }
  }, message);
}

function place(p: Pt): void {
  switch (tool) {
    case "line":
      if (draft.length) add({ kind: "line", a: draft[0], b: p });
      draft = [p];
      break;
    case "polyline":
      draft.push(p);
      break;
    case "rect":
      if (!draft.length) draft = [p];
      else {
        const a = draft[0];
        if (a.x !== p.x && a.y !== p.y) add({ kind: "polyline", closed: true, pts: [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }] });
        draft = [];
      }
      break;
    case "circle":
      if (!draft.length) draft = [p];
      else {
        const r = dist(draft[0], p);
        if (r > 0) add({ kind: "circle", c: draft[0], r });
        draft = [];
      }
      break;
    case "arc":
      draft.push(p);
      if (draft.length === 3) {
        const arc = arcThrough(draft[0], draft[1], draft[2]);
        if (arc) add({ kind: "arc", ...arc });
        else status("Los tres puntos están en línea: no forman un arco.", true);
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
        const len = dist(a, b);
        if (len > 0) add({ kind: "dim", a, b, offset: ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / len });
        draft = [];
      }
      break;
    case "dimlin":
      if (draft.length < 2) draft.push(p);
      else {
        add(linearDim(draft[0], draft[1], p));
        draft = [];
      }
      break;
    case "hatch": {
      const pts = boundaryAt(visibleEntities(), rawCursor);
      if (!pts) {
        status("Ahí no hay un contorno cerrado. Usa un rectángulo, un círculo o una polilínea cerrada.", true);
        break;
      }
      const pattern = $<HTMLSelectElement>("hatch-pattern").value as HatchPattern;
      const scale = Number($<HTMLInputElement>("hatch-scale").value) || 1;
      add({ kind: "hatch", pts, pattern, scale, angle: 0 });
      break;
    }
    case "move":
    case "copy":
      if (!draft.length) draft = [p];
      else moveOrCopyTo(p);
      break;
    case "rotate":
      if (!draft.length) draft = [p];
      else {
        const angle = Math.atan2(p.y - draft[0].y, p.x - draft[0].x);
        rotateBy(angle);
      }
      break;
    case "mirror":
      draft.push(p);
      if (draft.length === 2) {
        if (dist(draft[0], draft[1]) === 0) { draft = [draft[0]]; break; }
        transformSelection(mirroring(draft[0], draft[1]), true, "Copia simétrica creada. Los originales siguen seleccionados: pulsa Supr si no los quieres.");
        draft = [];
      }
      break;
    case "scale":
      if (!draft.length) {
        draft = [p];
        status("Ahora escribe el factor de escala y pulsa Enter.");
        cmd.focus();
      }
      break;
    case "offset":
      pickOffset(p);
      break;
    case "trim": {
      const hit = hitTest(rawCursor);
      if (!hit) break;
      const pieces = trim(hit, rawCursor, visibleEntities(), blocks());
      if (!pieces) {
        status("No hay intersecciones a los lados de ese punto: no hay nada que recortar ahí.", true);
        break;
      }
      commit(() => {
        drawing.entities = drawing.entities.filter((e) => e.id !== hit.id);
        drawing.entities.push(...pieces.map((s) => ({ ...s, id: newId(), layer: hit.layer } as Entity)));
      }, "Recortado.");
      break;
    }
    case "measure":
      draft.push(p);
      reportMeasure();
      break;
    case "insert":
      if (insertName && blocks()[insertName]) add({ kind: "insert", name: insertName, p, rot: 0, s: 1 });
      break;
    case "blockbase":
      if (pendingBlock) makeBlock(pendingBlock, p);
      break;
    default:
  }
  redraw();
}

function linearDim(a: Pt, b: Pt, at: Pt): Shape {
  const outY = Math.max(0, at.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - at.y);
  const outX = Math.max(0, at.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - at.x);
  return outY >= outX ? { kind: "dim", a, b, offset: at.y - a.y, mode: "h" } : { kind: "dim", a, b, offset: at.x - a.x, mode: "v" };
}

function moveOrCopyTo(dest: Pt): void {
  const base = draft[0];
  const m = translation(dest.x - base.x, dest.y - base.y);
  if (tool === "copy") {
    transformSelection(m, true, `Copiado a ${formatLength(dist(base, dest))} mm. Clic para otra copia, o Esc.`);
  } else {
    transformSelection(m, false, `Movido ${formatLength(dist(base, dest))} mm.`);
    draft = [];
  }
}

function rotateBy(angle: number): void {
  transformSelection(rotation(draft[0], angle), false, `Rotado ${formatLength((angle * 180) / Math.PI)}°.`);
  draft = [];
}

function pickOffset(p: Pt): void {
  if (!offsetDistance) return status("Primero escribe la distancia del desfase y pulsa Enter.", true);
  if (!offsetTarget) {
    const hit = hitTest(rawCursor);
    if (!hit) return;
    if (!["line", "polyline", "circle", "arc"].includes(hit.kind)) return status("El desfase funciona con líneas, polilíneas, círculos y arcos.", true);
    offsetTarget = hit;
    status("Ahora clic en el lado hacia donde va la copia.");
    return;
  }
  const shape = offsetShape(offsetTarget, offsetDistance, p);
  if (shape) add(shape, offsetTarget.layer);
  else status("Ese desfase deja el objeto sin tamaño.", true);
  offsetTarget = null;
  status(`Desfase a ${formatLength(offsetDistance)} mm. Clic en otro objeto, o Esc.`);
}

function reportMeasure(): void {
  let total = 0;
  for (let i = 1; i < draft.length; i++) total += dist(draft[i - 1], draft[i]);
  const area = draft.length >= 3 ? polygonArea(draft) : 0;
  status(`Distancia: ${formatLength(total)} mm${area ? ` · Área cerrando el polígono: ${formatLength(area)} mm² (${formatLength(area / 1e6)} m²)` : ""}. Esc para medir de nuevo.`);
}

function finishPolyline(): void {
  if (tool === "polyline" && draft.length >= 2) add({ kind: "polyline", pts: [...draft], closed: false });
  draft = [];
  redraw();
}

/* ---------- command line ---------- */

const ALIASES: Record<string, Tool | "erase" | "undo" | "redo" | "zoom" | "print"> = {
  l: "line", line: "line", linea: "line",
  pl: "polyline", pline: "polyline", polilinea: "polyline",
  rec: "rect", rectang: "rect", rectangulo: "rect",
  c: "circle", circle: "circle", circulo: "circle",
  a: "arc", arc: "arc", arco: "arc",
  m: "move", move: "move", mover: "move",
  co: "copy", cp: "copy", copy: "copy", copiar: "copy",
  ro: "rotate", rotate: "rotate", rotar: "rotate",
  mi: "mirror", mirror: "mirror", simetria: "mirror",
  sc: "scale", scale: "scale", escala: "scale",
  o: "offset", offset: "offset", desfase: "offset", equidistancia: "offset",
  tr: "trim", trim: "trim", recortar: "trim", recorta: "trim",
  t: "text", dt: "text", text: "text", texto: "text",
  dal: "dim", dimaligned: "dim", cota: "dim",
  dli: "dimlin", dimlinear: "dimlin",
  h: "hatch", bh: "hatch", hatch: "hatch", sombreado: "hatch", sombrear: "hatch",
  di: "measure", dist: "measure", aa: "measure", area: "measure", medir: "measure",
  e: "erase", erase: "erase", borrar: "erase",
  u: "undo", undo: "undo", deshacer: "undo", redo: "redo", rehacer: "redo",
  z: "zoom", zoom: "zoom", ver: "zoom",
  plot: "print", imprimir: "print",
};

function numberList(text: string): number[] | null {
  const parts = text.replace(/\s+/g, "").replace(/;/g, ",").split(",").filter(Boolean);
  const nums = parts.map((p) => Number(p.replace(",", ".")));
  return nums.length && nums.every(Number.isFinite) ? nums : null;
}

const POLAR = /^@?(-?\d+(?:[.,]\d+)?)<(-?\d+(?:[.,]\d+)?)$/;

/** Typed input: a command name, a length, width,height, @dx,dy, length<angle, an angle, a factor or text. */
function runCommand(text: string): void {
  const value = text.trim();
  if (!value) {
    if (tool === "polyline") finishPolyline();
    return;
  }
  if (tool === "text" && textAt) {
    // Readable at the current zoom (about 14 px tall), but never smaller than half a grid step.
    add({ kind: "text", p: textAt, text: value.slice(0, 500), h: Math.max(gridStep / 2, Math.round((14 / view.s) * 10) / 10, 1) });
    textAt = null;
    return;
  }
  const word = value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/^[a-z]+$/.test(word)) {
    const action = ALIASES[word];
    if (!action) return status(`No conozco el comando «${value}». Prueba L, PL, REC, C, A, M, CO, RO, MI, SC, O, TR, T, H, DI.`, true);
    if (action === "erase") return deleteSelection();
    if (action === "undo" || action === "redo") return undoRedo(action);
    if (action === "zoom") return fit();
    if (action === "print") return openPrint();
    return setTool(action);
  }
  if (tool === "text") return status("Primero haz clic donde va el texto.", true);
  const anchor = draft[draft.length - 1];
  const polar = POLAR.exec(value.replace(/\s+/g, ""));
  if (polar) {
    if (!anchor) return status("Primero marca un punto; luego escribe longitud<ángulo.", true);
    return placeTyped(polarPoint(anchor, Math.abs(Number(polar[1].replace(",", "."))), Number(polar[2].replace(",", "."))));
  }
  const nums = numberList(value.replace(/^@/, ""));
  if (!nums) return status("Escribe números en milímetros (250, 300,200, @50,-20 o 250<30) o un comando.", true);
  switch (tool) {
    case "offset":
      if (nums[0] > 0) {
        offsetDistance = nums[0];
        offsetTarget = null;
        status(`Desfase a ${formatLength(offsetDistance)} mm. Ahora clic en el objeto.`);
      }
      return;
    case "hatch":
      $<HTMLInputElement>("hatch-scale").value = String(Math.abs(nums[0]));
      return status(`Escala del patrón: ${formatLength(Math.abs(nums[0]))}. Clic dentro de un contorno.`);
    case "rotate":
      // Without a base point yet, "x,y" sets it (handled below like any typed point).
      if (!anchor) break;
      return rotateBy((nums[0] * Math.PI) / 180);
    case "scale":
      if (!anchor) break;
      if (!(nums[0] > 0)) return status("El factor debe ser mayor que cero.", true);
      transformSelection(scaling(anchor, nums[0]), false, `Escalado × ${formatLength(nums[0])}.`);
      draft = [];
      return;
    default:
  }
  if (!anchor) {
    if (nums.length === 2) place({ x: nums[0], y: nums[1] });
    else status("Primero marca un punto inicial, o escribe x,y para empezar en una coordenada.", true);
    return;
  }
  if (tool === "rect" && nums.length === 2) {
    const sx = Math.sign(cursor.x - anchor.x) || 1;
    const sy = Math.sign(cursor.y - anchor.y) || 1;
    return placeTyped({ x: anchor.x + sx * Math.abs(nums[0]), y: anchor.y + sy * Math.abs(nums[1]) });
  }
  if (tool === "circle" && nums.length === 1) return placeTyped(atLength(anchor, { x: anchor.x + 1, y: anchor.y }, Math.abs(nums[0])));
  if (nums.length === 2) return placeTyped({ x: anchor.x + nums[0], y: anchor.y + nums[1] });
  const toward = (orthoOn || shiftDown) ? ortho(anchor, cursor) : cursor;
  placeTyped(atLength(anchor, toward, Math.abs(nums[0])));
}

function placeTyped(p: Pt): void {
  place(p);
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

function drawPrim(q: Prim): void {
  const S = toScreen;
  switch (q.t) {
    case "seg": {
      const a = S(q.a), b = S(q.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      break;
    }
    case "arc": {
      const c = S(q.c);
      const full = (normAngle(q.end - q.start) || TAU) >= TAU - 1e-9;
      const start = S({ x: q.c.x + q.r * Math.cos(q.start), y: q.c.y + q.r * Math.sin(q.start) });
      ctx.moveTo(start.x, start.y);
      if (full) ctx.arc(c.x, c.y, q.r * view.s, 0, TAU);
      else ctx.arc(c.x, c.y, q.r * view.s, -q.start, -q.end, true);
      break;
    }
    case "text": {
      const p = S(q.p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-q.rot);
      ctx.font = `${Math.max(q.h * view.s, q.center ? 9 : 1)}px system-ui, sans-serif`;
      ctx.textAlign = q.center ? "center" : "left";
      ctx.fillText(q.value, 0, 0);
      ctx.restore();
      break;
    }
    case "fill": {
      ctx.save();
      ctx.beginPath();
      q.pts.forEach((pt, i) => { const s = S(pt); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.closePath();
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      break;
    }
  }
}

function strokeShape(e: Entity | Shape, dashed = false): void {
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.beginPath();
  for (const q of primitives({ id: "", layer: "", ...e } as Entity, blocks())) drawPrim(q);
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
  for (const e of drawing.entities) {
    if (!isVisible(e)) continue;
    const sel = selection.has(e.id);
    ctx.strokeStyle = colors.fg;
    ctx.fillStyle = colors.fg;
    ctx.lineWidth = sel ? 3 : 1.25;
    strokeShape(e, sel);
  }
  paintPreview();
  if (drag?.kind === "box") {
    const a = toScreen(drag.from), b = toScreen(cursor);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = colors.sel;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  if (snap && snap.kind !== "grid" && tool !== "select") paintSnap(snap);
  if (textAt) {
    const s = toScreen(textAt);
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.sel;
    ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke();
  }
}

/** Ghost of what the next click creates or changes. */
function paintPreview(): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  const anchor = draft[draft.length - 1];
  const ghost = (s: Shape) => strokeShape(s, true);
  const ghosts = (m: Affine) => selected().forEach((e) => strokeShape(transformEntity(e, m), true));
  if (tool === "offset" && offsetTarget && offsetDistance) {
    const s = offsetShape(offsetTarget, offsetDistance, cursor);
    if (s) ghost(s);
    return;
  }
  if (!anchor) return;
  switch (tool) {
    case "line":
    case "polyline":
      if (draft.length > 1) ghost({ kind: "polyline", pts: draft, closed: false });
      ghost({ kind: "line", a: anchor, b: cursor });
      showLength(anchor, cursor);
      break;
    case "rect":
      ghost({ kind: "polyline", closed: true, pts: [anchor, { x: cursor.x, y: anchor.y }, cursor, { x: anchor.x, y: cursor.y }] });
      label(cursor, `${formatLength(Math.abs(cursor.x - anchor.x))} × ${formatLength(Math.abs(cursor.y - anchor.y))}`);
      break;
    case "circle":
      ghost({ kind: "circle", c: anchor, r: Math.max(dist(anchor, cursor), 0.0001) });
      label(cursor, `r ${formatLength(dist(anchor, cursor))}`);
      break;
    case "arc":
      if (draft.length === 1) ghost({ kind: "line", a: anchor, b: cursor });
      else {
        const arc = arcThrough(draft[0], draft[1], cursor);
        if (arc) ghost({ kind: "arc", ...arc });
      }
      break;
    case "dim":
      if (draft.length === 1) ghost({ kind: "line", a: anchor, b: cursor });
      else {
        const [a, b] = draft;
        const len = dist(a, b) || 1;
        ghost({ kind: "dim", a, b, offset: ((cursor.x - a.x) * -(b.y - a.y) + (cursor.y - a.y) * (b.x - a.x)) / len });
      }
      break;
    case "dimlin":
      if (draft.length === 1) ghost({ kind: "line", a: anchor, b: cursor });
      else ghost(linearDim(draft[0], draft[1], cursor));
      break;
    case "move":
    case "copy":
      ghosts(translation(cursor.x - anchor.x, cursor.y - anchor.y));
      ghost({ kind: "line", a: anchor, b: cursor });
      showLength(anchor, cursor);
      break;
    case "rotate": {
      const angle = Math.atan2(cursor.y - anchor.y, cursor.x - anchor.x);
      ghosts(rotation(anchor, angle));
      label(cursor, `${formatLength(((angle * 180) / Math.PI + 360) % 360)}°`);
      break;
    }
    case "mirror":
      if (dist(anchor, cursor) > 0) ghosts(mirroring(anchor, cursor));
      ghost({ kind: "line", a: anchor, b: cursor });
      break;
    case "measure":
      ghost({ kind: "polyline", pts: [...draft, cursor], closed: false });
      showLength(anchor, cursor);
      break;
    default:
  }
}

function paintSnap(s: Snap): void {
  const p = toScreen(s.p);
  ctx.setLineDash([]);
  ctx.strokeStyle = colors.sel;
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (s.kind) {
    case "mid": ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y + 5); ctx.lineTo(p.x - 6, p.y + 5); ctx.closePath(); break;
    case "center": ctx.arc(p.x, p.y, 6, 0, TAU); break;
    case "quadrant": ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 7, p.y); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 7, p.y); ctx.closePath(); break;
    case "intersection": ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); break;
    case "perpendicular": ctx.moveTo(p.x - 6, p.y + 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x, p.y + 6); ctx.lineTo(p.x, p.y - 6); break;
    case "tangent": ctx.arc(p.x, p.y, 5, 0, TAU); ctx.moveTo(p.x - 8, p.y - 5); ctx.lineTo(p.x + 8, p.y - 5); break;
    default: ctx.rect(p.x - 5, p.y - 5, 10, 10);
  }
  ctx.stroke();
  const names: Partial<Record<Snap["kind"], string>> = {
    end: "Extremo", mid: "Punto medio", center: "Centro", quadrant: "Cuadrante", intersection: "Intersección",
    perpendicular: "Perpendicular", tangent: "Tangente", insert: "Inserción",
  };
  if (names[s.kind]) {
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = colors.sel;
    ctx.fillText(names[s.kind]!, p.x + 10, p.y + 18);
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
  rawCursor = raw;
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
  rawCursor = raw;
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
      drawing.entities = drawing.entities.map((e) => (selection.has(e.id) && isEditable(e) ? transformEntity(e, translation(dx, dy)) : e));
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
      drawing.entities.filter((e) => isEditable(e) && inside(e, box, blocks())).forEach((e) => selection.add(e.id));
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
  status(selection.size ? `${selection.size} objeto(s) seleccionado(s). Supr borra; Mover, Copiar, Rotar, Simetría o Escala los editan.` : "");
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
  renderBlocks();
  bridge.changed();
  redraw();
}

function selectAll(): void {
  selection = new Set(drawing.entities.filter(isEditable).map((e) => e.id));
  if (tool !== "select") setTool("select");
  updateSelectionStatus();
  redraw();
}

function copyToClipboard(): void {
  clipboard = selected().map((e) => structuredClone(e));
  status(clipboard.length ? `${clipboard.length} objeto(s) copiado(s). Ctrl+V los pega en el cursor.` : "No hay nada seleccionado para copiar.", !clipboard.length);
}

function paste(): void {
  if (!clipboard.length) return;
  const b = drawingBounds(clipboard, blocks())!;
  const m = translation(cursor.x - b.minX, cursor.y - b.minY);
  const copies = clipboard.map((e) => ({ ...transformEntity(e, m), id: newId() }));
  commit(() => drawing.entities.push(...copies), `${copies.length} objeto(s) pegado(s).`);
  selection = new Set(copies.map((e) => e.id));
}

const SHORTCUTS: Record<string, Tool> = {
  v: "select", l: "line", p: "polyline", r: "rect", c: "circle", a: "arc", t: "text", d: "dim", e: "dimlin", h: "hatch",
  m: "move", k: "copy", q: "rotate", w: "mirror", z: "scale", o: "offset", x: "trim", i: "measure",
};

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Shift") shiftDown = true;
  const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement;
  if (typing && ev.target !== cmd) return;
  if (ev.key === "Escape") {
    if (tool === "polyline" && draft.length >= 2) finishPolyline();
    const resetTool = tool === "insert" || tool === "blockbase";
    draft = []; textAt = null; offsetTarget = null; pendingBlock = null; cmd.value = "";
    if (resetTool) setTool("select");
    else if (tool === "select") selection = new Set();
    canvas.focus();
    redraw();
    return;
  }
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "p") { ev.preventDefault(); openPrint(); return; }
  if (typing) return;
  if (ev.key === " ") { spaceDown = true; ev.preventDefault(); return; }
  if (mod) {
    const k = ev.key.toLowerCase();
    if (k === "z") { ev.preventDefault(); undoRedo("undo"); }
    else if (k === "y") { ev.preventDefault(); undoRedo("redo"); }
    else if (k === "a") { ev.preventDefault(); selectAll(); }
    else if (k === "c") { ev.preventDefault(); copyToClipboard(); }
    else if (k === "v") { ev.preventDefault(); paste(); }
    return;
  }
  if (ev.altKey) return;
  if (ev.key === "Delete" || ev.key === "Backspace") { deleteSelection(); return; }
  if (ev.key === "Enter") {
    if (tool === "polyline") finishPolyline();
    else if (tool === "measure") { draft = []; redraw(); }
    return;
  }
  if (ev.key === "F8") { ev.preventDefault(); toggle("ortho"); return; }
  const key = ev.key.toLowerCase();
  if (SHORTCUTS[key]) { setTool(SHORTCUTS[key]); return; }
  if (key === "f") { fit(); return; }
  if (key === "g") { toggle("grid"); return; }
  if (key === "s") { toggle("osnap"); return; }
  // Typing a number while drawing goes straight to the command box.
  if (/^[0-9.,@<-]$/.test(ev.key) && (draft.length || tool === "offset" || tool === "hatch")) cmd.focus();
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
    if (tool !== "text" || !textAt) canvas.focus();
    redraw();
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
        const rename = (e: Entity) => { if (e.layer === l.name) e.layer = next; };
        drawing.entities.forEach(rename);
        Object.values(blocks()).forEach((b) => b.entities.forEach(rename));
        if (drawing.current === l.name) drawing.current = next;
        l.name = next;
      });
      renderLayers();
    });
    const eye = document.createElement("button");
    eye.type = "button";
    eye.textContent = "Ver";
    eye.setAttribute("aria-pressed", String(l.visible));
    // The spoken name starts with the visible word (WCAG 2.5.3): voice users say what they see.
    eye.setAttribute("aria-label", `Ver la capa ${l.name}`);
    eye.addEventListener("click", () => { commit(() => { l.visible = !l.visible; }); renderLayers(); });
    const lock = document.createElement("button");
    lock.type = "button";
    lock.textContent = "Fija";
    lock.setAttribute("aria-pressed", String(l.locked));
    lock.setAttribute("aria-label", `Fija la capa ${l.name}, sin poder editarla`);
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

/* ---------- blocks ---------- */

function renderBlocks(): void {
  const names = Object.keys(blocks()).sort((a, b) => a.localeCompare(b, "es"));
  const list = $("blocks");
  if (!names.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Sin bloques. Selecciona objetos y pulsa Crear bloque.";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...names.map((name) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const count = drawing.entities.filter((e) => e.kind === "insert" && e.name === name).length;
    label.title = `${count} inserción(es)`;
    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = "Insertar";
    insert.setAttribute("aria-label", `Insertar el bloque ${name}`);
    insert.addEventListener("click", () => {
      insertName = name;
      setTool("insert");
      status(`Clic donde va «${name}». Esc termina.`);
      canvas.focus();
    });
    li.append(label, insert);
    return li;
  }));
}

$("make-block").addEventListener("click", () => {
  if (!selected().length) return status("Primero selecciona los objetos que formarán el bloque.", true);
  const name = window.prompt("Nombre del bloque (por ejemplo, Puerta 90)")?.trim().slice(0, 64);
  if (!name) return;
  if (/[<>/\\":;?*|=`]/.test(name)) return status("El nombre no puede tener < > / \\ \" : ; ? * | = `.", true);
  if (blocks()[name]) return status(`Ya existe un bloque llamado «${name}».`, true);
  pendingBlock = name;
  setTool("blockbase");
});

function makeBlock(name: string, base: Pt): void {
  const chosen = selected();
  if (!chosen.length) return setTool("select");
  const ids = new Set(chosen.map((e) => e.id));
  commit(() => {
    blocks()[name] = { base, entities: chosen.map((e) => structuredClone(e)) };
    // The objects become one insert of the new block, where they were.
    drawing.entities = drawing.entities.filter((e) => !ids.has(e.id));
    drawing.entities.push({ id: newId(), layer: drawing.current, kind: "insert", name, p: base, rot: 0, s: 1 });
  }, `Bloque «${name}» creado. Usa Insertar en el panel Bloques para ponerlo donde quieras.`);
  pendingBlock = null;
  selection = new Set();
  renderBlocks();
  tool = "select";
  setTool("select");
}

/* ---------- printing ---------- */

const printDialog = $<HTMLDialogElement>("print-dialog");
const pScale = $<HTMLSelectElement>("p-scale");
pScale.replaceChildren(new Option("Ajustar a la hoja", "0"), ...SCALES.map((s) => new Option(`1:${s}`, String(s))));
pScale.value = "100";

function openPrint(): void {
  if (!drawing.entities.some(isVisible)) return status("No hay nada visible para imprimir.", true);
  $("p-message").textContent = "";
  printDialog.showModal();
}

$("print").addEventListener("click", openPrint);
$("p-cancel").addEventListener("click", () => printDialog.close());
$<HTMLFormElement>("print-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const result = toPdf(drawing, {
    sheet: $<HTMLSelectElement>("p-sheet").value as Sheet,
    landscape: $<HTMLSelectElement>("p-orient").value === "h",
    scale: Number(pScale.value),
    title: bridge.title().trim() || "Plano",
    author: $<HTMLInputElement>("p-author").value.trim(),
    date: new Date().toISOString().slice(0, 10),
  });
  if (!result.ok) {
    $("p-message").textContent = result.suggest ? `${result.message} Cabe a 1:${result.suggest}: ya la elegí.` : result.message;
    if (result.suggest) pScale.value = String(result.suggest);
    return;
  }
  save(result.pdf, "application/pdf", "pdf");
  printDialog.close();
  status(`PDF a escala ${pScale.value === "0" ? `ajustada (1:${formatLength(result.scale)})` : `1:${pScale.value}`} descargado. Imprímelo al 100 % (sin "ajustar a página") para que las medidas se respeten.`);
});

/* ---------- files ---------- */

function save(content: string | Uint8Array, type: string, extension: string): void {
  const name = (bridge.title().trim() || "plano").replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 80) || "plano";
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** DWG goes through Visor's reader (its own worker, GPL-3.0, see visor/dwg.worker.ts) to become DXF. */
function dwgToDxf(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../visor/dwg.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<DwgResponse>) => {
      worker.terminate();
      if (e.data.ok && e.data.op === "dxf") resolve(new TextDecoder("latin1").decode(e.data.dxf));
      else reject(new Error(e.data.ok ? "No se pudo convertir el DWG." : e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      reject(new Error("El lector de DWG se detuvo. El archivo puede ser demasiado grande para este equipo."));
    };
    worker.postMessage({ op: "dxf", bytes }, [bytes]);
  });
}

$("export-dxf").addEventListener("click", () => save(toDxf(drawing), "application/dxf", "dxf"));
$("export-svg").addEventListener("click", () => save(toSvg(drawing), "image/svg+xml", "svg"));
$<HTMLInputElement>("import").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 50 * 1048576) return status("El archivo supera 50 MB; es demasiado para el navegador.", true);
  const isDwg = /\.dwg$/i.test(file.name);
  try {
    if (isDwg) status("Convirtiendo el DWG… la primera vez se descarga el lector (1,7 MB).");
    const result = await bridge.busy(async () => fromDxf(isDwg ? await dwgToDxf(await file.arrayBuffer()) : await file.text()));
    const renamed = new Map<string, string>();
    commit(() => {
      for (const l of result.drawing.layers) if (!drawing.layers.some((x) => x.name === l.name)) drawing.layers.push(l);
      for (const [name, block] of Object.entries(result.drawing.blocks ?? {})) {
        let target = name;
        for (let i = 2; blocks()[target]; i++) target = `${name} (${i})`;
        renamed.set(name, target);
        blocks()[target] = block;
      }
      drawing.entities.push(...result.drawing.entities.map((e) => (e.kind === "insert" ? { ...e, name: renamed.get(e.name) ?? e.name } : e)));
    });
    renderLayers();
    renderBlocks();
    fit();
    const skipped = Object.entries(result.skipped).map(([k, v]) => `${v} ${k}`).join(", ");
    status(`Importados ${result.imported} objetos y ${renamed.size} bloques de ${file.name}.${skipped ? ` No se pudieron leer: ${skipped}.` : ""}`, Boolean(skipped));
  } catch (err) {
    status(err instanceof Error ? err.message : "No se pudo leer el archivo.", true);
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
renderBlocks();
setTool("select");
