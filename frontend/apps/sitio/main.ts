import { connect } from "../shared/bridge";
import { csv } from "../shared/csv";
import "../shared/program.css";
import {
  addBuilding, area, bounds, cleanPolygon, daySamples, floorsFor, fromGeoJSON, grid, inside, localDate, newSite, parseSite, PLACES,
  planSun, ratios, rectangle, shadowPieces, sunHours, type Point, type Site,
} from "./site";
import "./sitio.css";
import { clock, compass, instant, sunDay, sunPosition } from "./sun";

type Tool = "select" | "lot" | "building";

/** Minutes between sun positions in the hours-of-sun analysis. */
const STEP = 10;
const SNAP = 0.1;
const MAX_IMPORT = 20 * 1024 * 1024;
const RAMP = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("plan");
const ctx = canvas.getContext("2d")!;
const statusEl = $("status");
const field = (id: string) => $<HTMLInputElement>(id);
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const fmt = (n: number, decimals = 2) => n.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

let site: Site = newSite(TODAY);
let tool: Tool = "select";
/** A building id, "lot", or nothing. */
let selected: string | null = null;
let draft: Point[] = [];
let cursor: Point | null = null;
const view = { cx: 0, cy: 0, scale: 10 };
let hours: { points: Point[]; values: (number | null)[]; spacing: number } | null = null;
let hoursToken = 0;
let hoursTimer = 0;
const undoStack: string[] = [];
const redoStack: string[] = [];
let pending: string | null = null;

for (const p of PLACES) $<HTMLSelectElement>("place").append(new Option(p.name, p.name));
$<HTMLSelectElement>("place").append(new Option("Otra ubicación", ""));

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
      status("No se pudo leer el sitio guardado.", true);
    }
    site = parseSite(raw, TODAY);
    selected = null;
    undoStack.length = 0;
    redoStack.length = 0;
    fit();
    refresh();
  },
  serialize() {
    return JSON.stringify(site);
  },
  onTheme(theme) {
    document.documentElement.dataset.theme = theme;
    draw();
    drawSunPath();
  },
});

// ---------------------------------------------------------------------------- history

function begin(): void {
  pending ??= JSON.stringify(site);
}

function commit(): void {
  if (pending === null) return;
  if (pending !== JSON.stringify(site)) {
    undoStack.push(pending);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    bridge.changed();
  }
  pending = null;
}

function apply(next: Site): void {
  begin();
  site = next;
  commit();
  refresh();
}

function travel(from: string[], to: string[]): void {
  const previous = from.pop();
  if (previous === undefined) return;
  to.push(JSON.stringify(site));
  site = parseSite(JSON.parse(previous), TODAY);
  if (selected && selected !== "lot" && !site.buildings.some((b) => b.id === selected)) selected = null;
  if (selected === "lot" && !site.lot) selected = null;
  refresh();
  bridge.changed();
}

// ---------------------------------------------------------------------------- coordinates

function size(): { w: number; h: number } {
  return { w: canvas.clientWidth || 1, h: canvas.clientHeight || 1 };
}

function toScreen([x, y]: Point): Point {
  const { w, h } = size();
  return [w / 2 + (x - view.cx) * view.scale, h / 2 - (y - view.cy) * view.scale];
}

function toWorld(sx: number, sy: number): Point {
  const { w, h } = size();
  return [view.cx + (sx - w / 2) / view.scale, view.cy - (sy - h / 2) / view.scale];
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const local = (e: MouseEvent): Point => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

function fit(): void {
  const pts = [...(site.lot ?? []), ...site.buildings.flatMap((b) => b.points)];
  const box = pts.length ? bounds(pts) : { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const { w, h } = size();
  const spanX = Math.max(box.maxX - box.minX, 4);
  const spanY = Math.max(box.maxY - box.minY, 4);
  view.cx = (box.minX + box.maxX) / 2;
  view.cy = (box.minY + box.maxY) / 2;
  view.scale = Math.max(0.05, Math.min(400, Math.min((w * 0.8) / spanX, (h * 0.8) / spanY)));
  draw();
}

// ---------------------------------------------------------------------------- sun

function sunNow() {
  const s = sunPosition(instant(localDate(site), site.minutes, site.utcOffset), site.lat, site.lon);
  return { ...s, plan: planSun(s.altitude, s.azimuth, site.north) };
}

function color(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const f = x - i;
  const a = RAMP[i].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const b = RAMP[i + 1].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

// ---------------------------------------------------------------------------- drawing

const shadowCanvas = document.createElement("canvas");

function path(c: CanvasRenderingContext2D, points: Point[], close = true): void {
  c.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toScreen(p);
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  if (close) c.closePath();
}

function draw(): void {
  const { w, h } = size();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || "#888";
  const fg = v("--fg");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = v("--canvas");
  ctx.fillRect(0, 0, w, h);

  // Grid: the finest step at least 12 px apart, a stronger line every 5 steps.
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const minor = steps.find((s) => s * view.scale >= 12) ?? 1000;
  const [x0, y1] = toWorld(0, 0);
  const [x1, y0] = toWorld(w, h);
  ctx.lineWidth = 1;
  for (const [step, alpha] of [[minor, 0.08], [minor * 5, 0.18]] as const) {
    ctx.strokeStyle = fg;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = Math.round(toScreen([x, 0])[0]) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = Math.round(toScreen([0, y])[1]) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const showHours = $<HTMLInputElement>("show-hours").checked && hours !== null;
  if (showHours) {
    const max = Math.max(1, ...hours!.values.filter((x): x is number => x !== null));
    const cell = hours!.spacing * view.scale + 0.6;
    hours!.points.forEach((p, i) => {
      const value = hours!.values[i];
      if (value === null) return;
      const [sx, sy] = toScreen(p);
      ctx.fillStyle = color(value / max);
      ctx.fillRect(sx - cell / 2, sy - cell / 2, cell, cell);
    });
  }

  if (site.lot) {
    path(ctx, site.lot);
    if (!showHours) {
      ctx.fillStyle = v("--surface");
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([8, 5]);
    ctx.lineWidth = selected === "lot" ? 3 : 1.5;
    ctx.strokeStyle = fg;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const sun = sunNow();
  if ($<HTMLInputElement>("show-shadows").checked && sun.altitude > 0 && site.buildings.length) {
    // Every piece is drawn opaque on its own layer, then the layer once, half transparent:
    // overlapping pieces and neighbouring shadows never look darker than one shadow.
    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;
    const s = shadowCanvas.getContext("2d")!;
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.fillStyle = "#000";
    for (const b of site.buildings) {
      for (const piece of shadowPieces(b, sun.plan)) {
        path(s, piece);
        s.fill();
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.32;
    ctx.drawImage(shadowCanvas, 0, 0);
    ctx.restore();
  }

  ctx.font = "12px system-ui, sans-serif";
  for (const b of site.buildings) {
    path(ctx, b.points);
    ctx.fillStyle = v("--surface");
    ctx.fill();
    ctx.lineWidth = b.id === selected ? 3 : 1.5;
    ctx.strokeStyle = fg;
    ctx.stroke();
    const box = bounds(b.points);
    const [lx, ly] = toScreen([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.fillText(`${b.name} · ${fmt(b.height, 1)} m`, lx, ly + 4);
  }

  const handles = selected === "lot" ? site.lot : site.buildings.find((b) => b.id === selected)?.points;
  if (handles) {
    ctx.fillStyle = v("--inverse-bg");
    for (const p of handles) {
      const [sx, sy] = toScreen(p);
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
    }
  }

  if (draft.length) {
    path(ctx, cursor ? [...draft, cursor] : draft, false);
    ctx.lineWidth = 2;
    ctx.strokeStyle = fg;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = fg;
    for (const p of draft) {
      const [sx, sy] = toScreen(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawNorth(w, fg, v("--surface"));
  drawScale(h, fg);
  if (sun.altitude > 0) drawSunMark(w, h, sun.plan.azimuth, sun.altitude, fg);
}

function drawNorth(w: number, fg: string, bg: string): void {
  const cx = w - 36;
  const cy = 48;
  ctx.save();
  ctx.fillStyle = bg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.translate(cx, cy);
  ctx.rotate((site.north * Math.PI) / 180);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(7, 9);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 9);
  ctx.closePath();
  ctx.fill();
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -27);
  ctx.restore();
}

function drawScale(h: number, fg: string): void {
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const metres = nice.find((m) => m * view.scale >= 80) ?? 5000;
  const px = metres * view.scale;
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, h - 18);
  ctx.lineTo(16 + px, h - 18);
  ctx.moveTo(16, h - 24);
  ctx.lineTo(16, h - 12);
  ctx.moveTo(16 + px, h - 24);
  ctx.lineTo(16 + px, h - 12);
  ctx.stroke();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${metres.toLocaleString("es")} m`, 20 + px, h - 14);
}

function drawSunMark(w: number, h: number, planAzimuth: number, altitude: number, fg: string): void {
  const a = (planAzimuth * Math.PI) / 180;
  const r = Math.min(w, h) / 2 - 28;
  const x = w / 2 + Math.sin(a) * r;
  const y = h / 2 - Math.cos(a) * r;
  ctx.save();
  ctx.fillStyle = "#f2b705";
  ctx.strokeStyle = fg;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${fmt(altitude, 0)}°`, x, y + 24);
  ctx.restore();
}

/** Sun path diagram: the sky seen from above, zenith in the centre, horizon on the circle. */
function drawSunPath(): void {
  const c = $<HTMLCanvasElement>("sunpath");
  const g = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue("--fg").trim() || "#111";
  const muted = css.getPropertyValue("--muted").trim() || "#555";
  const W = c.width;
  const R = W / 2 - 22;
  const cx = W / 2;
  const cy = W / 2;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = muted;
  g.lineWidth = 1;
  for (const alt of [0, 30, 60]) {
    g.beginPath();
    g.arc(cx, cy, (R * (90 - alt)) / 90, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = fg;
  g.font = "12px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["O", 270]] as const) {
    const a = (az * Math.PI) / 180;
    g.fillText(label, cx + Math.sin(a) * (R + 12), cy - Math.cos(a) * (R + 12));
  }
  const point = (alt: number, az: number): Point => {
    const r = (R * (90 - alt)) / 90;
    const a = (az * Math.PI) / 180;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  };
  const year = localDate(site).year;
  const curve = (month: number, day: number, dash: number[], width: number) => {
    g.setLineDash(dash);
    g.lineWidth = width;
    g.strokeStyle = fg;
    g.beginPath();
    let open = false;
    for (let m = 0; m <= 1440; m += 5) {
      const s = sunPosition(instant({ year, month, day }, m, site.utcOffset), site.lat, site.lon);
      if (s.altitude < 0) {
        open = false;
        continue;
      }
      const [x, y] = point(s.altitude, s.azimuth);
      if (open) g.lineTo(x, y);
      else g.moveTo(x, y);
      open = true;
    }
    g.stroke();
    g.setLineDash([]);
  };
  curve(6, 21, [3, 3], 1);
  curve(12, 21, [3, 3], 1);
  const d = localDate(site);
  curve(d.month, d.day, [], 2);
  g.fillStyle = fg;
  for (let m = 0; m < 1440; m += 60) {
    const s = sunPosition(instant(d, m, site.utcOffset), site.lat, site.lon);
    if (s.altitude <= 0) continue;
    const [x, y] = point(s.altitude, s.azimuth);
    g.beginPath();
    g.arc(x, y, 2, 0, Math.PI * 2);
    g.fill();
  }
  const sun = sunNow();
  if (sun.altitude > 0) {
    const [x, y] = point(sun.altitude, sun.azimuth);
    g.fillStyle = "#f2b705";
    g.strokeStyle = fg;
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  c.setAttribute("aria-label", `Carta solar del ${site.date}: ${sun.altitude > 0 ? `a las ${clock(site.minutes)} el sol está a ${fmt(sun.altitude, 0)}° de altura hacia el ${compass(sun.azimuth)}` : `a las ${clock(site.minutes)} el sol está bajo el horizonte`}. Líneas punteadas: solsticios de junio y diciembre.`);
}

// ---------------------------------------------------------------------------- side panel

function setValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}

function refresh(): void {
  setValue($<HTMLSelectElement>("place"), PLACES.some((p) => p.name === site.place) ? site.place : "");
  setValue(field("lat"), String(site.lat));
  setValue(field("lon"), String(site.lon));
  setValue(field("tz"), String(site.utcOffset));
  setValue(field("north"), String(site.north));
  setValue(field("date"), site.date);
  setValue(field("time"), String(site.minutes));
  $("time-value").textContent = clock(site.minutes);

  const day = sunDay(localDate(site), site.lat, site.lon, site.utcOffset);
  const sun = sunNow();
  const rows: [string, string][] = day.polar
    ? [["Sol", day.polar === "day" ? "No se pone en todo el día" : "No sale en todo el día"]]
    : [
      ["Amanecer", clock(day.sunrise!)],
      ["Mediodía solar", clock(day.noon)],
      ["Atardecer", clock(day.sunset!)],
      ["Horas de luz", `${Math.floor(day.dayLength / 60)} h ${pad(Math.round(day.dayLength % 60))} min`],
    ];
  rows.push(
    ["Altura del sol", sun.altitude > 0 ? `${fmt(sun.altitude, 1)}°` : "Bajo el horizonte"],
    ["Dirección", sun.altitude > 0 ? `${compass(sun.azimuth)} (${fmt(sun.azimuth, 0)}°)` : "—"],
  );
  $("sun").replaceChildren(...rows.flatMap(([k, val]) => [
    Object.assign(document.createElement("dt"), { textContent: k }),
    Object.assign(document.createElement("dd"), { textContent: val, id: `sun-${k.toLowerCase().replace(/\s+/g, "-")}` }),
  ]));

  const r = ratios(site);
  const pct = (x: number | null) => (x === null ? "Dibuja el lote" : `${fmt(x * 100, 1)} %`);
  $("ratios").replaceChildren(...([
    ["Área del lote", r.lot ? `${fmt(r.lot)} m²` : "Sin lote"],
    ["Área en planta", `${fmt(r.footprint)} m²`],
    ["COS PB", pct(r.cosPB)],
    ["Área construida", `${fmt(r.built)} m²`],
    ["COS total", pct(r.cosTotal)],
  ] as [string, string][]).flatMap(([k, val]) => [
    Object.assign(document.createElement("dt"), { textContent: k }),
    Object.assign(document.createElement("dd"), { textContent: val }),
  ]));

  $("buildings").replaceChildren(...site.buildings.map((b) => {
    const li = document.createElement("li");
    const button = Object.assign(document.createElement("button"), { type: "button", className: "name", textContent: `${b.name} · ${fmt(b.height, 1)} m` });
    button.setAttribute("aria-current", String(b.id === selected));
    button.addEventListener("click", () => select(b.id));
    li.append(button);
    return li;
  }));
  const building = site.buildings.find((b) => b.id === selected);
  $("editor").hidden = !building;
  if (building) {
    setValue(field("b-name"), building.name);
    setValue(field("b-height"), String(building.height));
    setValue(field("b-floors"), String(building.floors));
    $("b-area").textContent = `${fmt(area(building.points))} m²`;
  }
  $<HTMLButtonElement>("delete").disabled = !selected;
  $<HTMLButtonElement>("undo").disabled = !undoStack.length;
  $<HTMLButtonElement>("redo").disabled = !redoStack.length;
  draw();
  drawSunPath();
  scheduleHours();
}

function select(id: string | null): void {
  selected = id;
  refresh();
}

function setTool(next: Tool): void {
  tool = next;
  draft = [];
  cursor = null;
  canvas.classList.toggle("drawing", next !== "select");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === next));
  if (next !== "select") status(`${next === "lot" ? "Lote" : "Edificio"}: haz clic en cada esquina sobre el plano y pulsa Enter para cerrarlo. Esc cancela.`);
  draw();
}

// ---------------------------------------------------------------------------- hours of sun

/** What the analysis depends on: selecting or renaming a building does not recompute it. */
let hoursKey = "";
const analysisKey = () => JSON.stringify([site.lat, site.lon, site.utcOffset, site.north, site.date, site.spacing, site.lot, site.buildings.map((b) => [b.points, b.height])]);

function scheduleHours(): void {
  clearTimeout(hoursTimer);
  const on = $<HTMLInputElement>("show-hours").checked;
  $("legend").hidden = !on;
  if (!on) {
    hours = null;
    hoursKey = "";
    hoursToken++;
    return;
  }
  if (hours && hoursKey === analysisKey()) return;
  hoursTimer = window.setTimeout(() => void computeHours(), 250);
}

async function computeHours(): Promise<void> {
  const token = ++hoursToken;
  const summary = $("hours-summary");
  if (!site.lot) {
    hours = null;
    summary.textContent = "Dibuja o crea el lote para calcular las horas de sol.";
    draw();
    return;
  }
  const snapshot = site;
  const key = analysisKey();
  const g = grid(snapshot.lot!, snapshot.spacing);
  const samples = daySamples(snapshot, STEP);
  const values: (number | null)[] = [];
  summary.textContent = "Calculando…";
  await bridge.busy(async () => {
    for (let i = 0; i < g.points.length; i += 300) {
      values.push(...sunHours(g.points.slice(i, i + 300), samples, snapshot, STEP));
      await new Promise((ok) => setTimeout(ok, 0));
      if (token !== hoursToken) return;
    }
  });
  if (token !== hoursToken) return;
  hours = { points: g.points, values, spacing: g.spacing };
  hoursKey = key;
  const open = values.filter((x): x is number => x !== null);
  const day = sunDay(localDate(snapshot), snapshot.lat, snapshot.lon, snapshot.utcOffset);
  $("legend-max").textContent = `${fmt(Math.max(1, ...open), 1)} h`;
  if (!open.length) {
    summary.textContent = "Todo el lote está construido: no queda suelo libre que analizar.";
  } else {
    const avg = open.reduce((n, x) => n + x, 0) / open.length;
    summary.textContent = `Sol directo en el suelo libre del lote el ${snapshot.date}: promedio ${fmt(avg, 1)} h, mínimo ${fmt(Math.min(...open), 1)} h, máximo ${fmt(Math.max(...open), 1)} h (de ${fmt(day.dayLength / 60, 1)} h de luz). ${open.length.toLocaleString("es")} puntos cada ${fmt(g.spacing, 2)} m.`;
  }
  draw();
}

// ---------------------------------------------------------------------------- pointer

interface Drag { kind: "pan" | "vertex" | "move"; sx: number; sy: number; moved: boolean; index?: number; start?: Point; original?: Point[] }
let drag: Drag | null = null;

function selectedPoints(): Point[] | null {
  if (selected === "lot") return site.lot;
  return site.buildings.find((b) => b.id === selected)?.points ?? null;
}

function replacePoints(points: Point[]): void {
  if (selected === "lot") site = { ...site, lot: points };
  else site = { ...site, buildings: site.buildings.map((b) => (b.id === selected ? { ...b, points } : b)) };
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const [sx, sy] = local(e);
  canvas.setPointerCapture(e.pointerId);
  if (e.button !== 0) {
    drag = { kind: "pan", sx, sy, moved: false };
    return;
  }
  if (tool !== "select") {
    drag = { kind: "pan", sx, sy, moved: false };
    return;
  }
  const own = selectedPoints();
  const near = own?.findIndex((p) => {
    const [px, py] = toScreen(p);
    return Math.hypot(px - sx, py - sy) <= 8;
  }) ?? -1;
  if (own && near >= 0) {
    begin();
    drag = { kind: "vertex", sx, sy, moved: false, index: near };
    return;
  }
  const p = toWorld(sx, sy);
  const hit = [...site.buildings].reverse().find((b) => inside(p, b.points));
  const target = hit ? hit.id : site.lot && inside(p, site.lot) ? "lot" : null;
  if (target) {
    if (target !== selected) select(target);
    begin();
    drag = { kind: "move", sx, sy, moved: false, start: p, original: selectedPoints()!.map((q): Point => [q[0], q[1]]) };
    return;
  }
  if (selected) select(null);
  drag = { kind: "pan", sx, sy, moved: false };
});

canvas.addEventListener("pointermove", (e) => {
  const [sx, sy] = local(e);
  if (tool !== "select" && !drag) {
    const p = toWorld(sx, sy);
    cursor = [snap(p[0]), snap(p[1])];
    if (draft.length) draw();
  }
  if (!drag) return;
  if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true;
  if (!drag.moved) return;
  if (drag.kind === "pan") {
    view.cx -= (sx - drag.sx) / view.scale;
    view.cy += (sy - drag.sy) / view.scale;
    drag.sx = sx;
    drag.sy = sy;
    draw();
  } else if (drag.kind === "vertex") {
    const p = toWorld(sx, sy);
    const points = selectedPoints()!.map((q, i): Point => (i === drag!.index ? [snap(p[0]), snap(p[1])] : q));
    replacePoints(points);
    draw();
  } else if (drag.kind === "move") {
    const p = toWorld(sx, sy);
    const dx = snap(p[0] - drag.start![0]);
    const dy = snap(p[1] - drag.start![1]);
    replacePoints(drag.original!.map(([x, y]): Point => [x + dx, y + dy]));
    draw();
  }
});

canvas.addEventListener("pointerup", (e) => {
  const [sx, sy] = local(e);
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === "vertex" || d.kind === "move") {
    const points = selectedPoints();
    if (points && !cleanPolygon(points)) {
      // A drag that folded the polygon onto itself is undone.
      site = parseSite(JSON.parse(pending!), TODAY);
      pending = null;
      status("Ese cambio deja el polígono sin área: se deshizo.", true);
    } else {
      commit();
    }
    refresh();
    return;
  }
  if (d.moved || e.button !== 0 || tool === "select") return;
  const p = toWorld(sx, sy);
  const point: Point = [snap(p[0]), snap(p[1])];
  const first = draft[0] ? toScreen(draft[0]) : null;
  if (draft.length >= 3 && first && Math.hypot(first[0] - sx, first[1] - sy) <= 10) return close();
  draft.push(point);
  status(`Esquina ${draft.length}: ${fmt(point[0], 1)}; ${fmt(point[1], 1)} m. ${draft.length >= 3 ? "Enter o clic en la primera esquina para cerrar." : "Sigue con la siguiente esquina."}`);
  draw();
});

canvas.addEventListener("dblclick", (e) => {
  if (tool === "select" || draft.length < 3) return;
  e.preventDefault();
  close();
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [sx, sy] = local(e);
  const before = toWorld(sx, sy);
  view.scale = Math.max(0.05, Math.min(400, view.scale * Math.exp(-e.deltaY * 0.0015)));
  const after = toWorld(sx, sy);
  view.cx += before[0] - after[0];
  view.cy += before[1] - after[1];
  draw();
}, { passive: false });

function close(): void {
  const points = cleanPolygon(draft);
  if (!points) {
    draft = [];
    draw();
    return status("Ese polígono no sirve: necesita al menos 3 esquinas y área.", true);
  }
  if (tool === "lot") {
    selected = "lot";
    apply({ ...site, lot: points });
    status(`Lote de ${fmt(area(points))} m² listo.`);
  } else {
    const made = addBuilding(site, points, 6);
    if (!made) return status("Llegaste al máximo de edificios de un sitio.", true);
    selected = made.building.id;
    apply(made.site);
    status(`${made.building.name} con ${fmt(area(points))} m² en planta. Cambia su altura en el panel.`);
  }
  setTool("select");
}

function removeSelected(): void {
  if (!selected) return;
  const next = selected === "lot" ? { ...site, lot: null } : { ...site, buildings: site.buildings.filter((b) => b.id !== selected) };
  selected = null;
  apply(next);
  status("Eliminado. Deshacer lo recupera.");
}

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
  if (typing) return;
  if (e.key === "Escape") {
    if (tool !== "select") setTool("select");
    else if (selected) select(null);
  } else if (e.key === "Enter" && tool !== "select" && draft.length >= 3) {
    e.preventDefault();
    close();
  } else if (e.key === "Backspace" && draft.length) {
    e.preventDefault();
    draft.pop();
    draw();
  } else if (e.key === "Delete") {
    removeSelected();
  }
});

new ResizeObserver(() => draw()).observe(canvas);

// ---------------------------------------------------------------------------- panel inputs

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
$("delete").addEventListener("click", removeSelected);
$("undo").addEventListener("click", () => travel(undoStack, redoStack));
$("redo").addEventListener("click", () => travel(redoStack, undoStack));
$("fit").addEventListener("click", fit);
$("show-shadows").addEventListener("change", () => draw());
$("show-hours").addEventListener("change", () => {
  scheduleHours();
  draw();
});

$("place").addEventListener("change", () => {
  const p = PLACES.find((x) => x.name === $<HTMLSelectElement>("place").value);
  if (p) apply({ ...site, place: p.name, lat: p.lat, lon: p.lon, utcOffset: p.utcOffset });
});

function numberField(id: string, min: number, max: number, set: (value: number) => Site): void {
  field(id).addEventListener("change", () => {
    const value = Number(field(id).value.replace(",", "."));
    if (field(id).value.trim() === "" || !Number.isFinite(value) || value < min || value > max) {
      status(`Escribe un valor entre ${min.toLocaleString("es")} y ${max.toLocaleString("es")}.`, true);
      return refresh();
    }
    apply(set(value));
  });
}

numberField("lat", -90, 90, (v) => ({ ...site, lat: v, place: "" }));
numberField("lon", -180, 180, (v) => ({ ...site, lon: v, place: "" }));
numberField("tz", -12, 14, (v) => ({ ...site, utcOffset: Math.round(v * 4) / 4 }));
numberField("north", -360, 360, (v) => ({ ...site, north: v }));
numberField("b-height", 0.1, 1000, (v) => ({ ...site, buildings: site.buildings.map((b) => (b.id === selected ? { ...b, height: v, floors: floorsFor(v) } : b)) }));
numberField("b-floors", 1, 300, (v) => ({ ...site, buildings: site.buildings.map((b) => (b.id === selected ? { ...b, floors: Math.round(v) } : b)) }));
field("b-name").addEventListener("change", () => {
  const name = field("b-name").value.trim().slice(0, 80);
  if (name) apply({ ...site, buildings: site.buildings.map((b) => (b.id === selected ? { ...b, name } : b)) });
});

field("date").addEventListener("change", () => {
  const value = field("date").value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) apply({ ...site, date: value });
});
$("key-date").addEventListener("change", () => {
  const select = $<HTMLSelectElement>("key-date");
  if (select.value) apply({ ...site, date: `${localDate(site).year}-${select.value}` });
  select.value = "";
});
field("time").addEventListener("input", () => {
  begin();
  site = { ...site, minutes: Number(field("time").value) };
  $("time-value").textContent = clock(site.minutes);
  draw();
  drawSunPath();
});
field("time").addEventListener("change", () => {
  commit();
  refresh();
});

$("make-lot").addEventListener("click", () => {
  const w = Number(field("lot-width").value);
  const d = Number(field("lot-depth").value);
  if (!(w >= 1 && w <= 5000 && d >= 1 && d <= 5000)) return status("El ancho y el fondo del lote van de 1 a 5000 m.", true);
  selected = "lot";
  apply({ ...site, lot: rectangle(w, d) });
  fit();
  status(`Lote de ${fmt(w, 1)} × ${fmt(d, 1)} m (${fmt(w * d)} m²) creado, centrado en el plano.`);
});

$("make-building").addEventListener("click", () => {
  const w = Number(field("new-width").value);
  const d = Number(field("new-depth").value);
  const h = Number(field("new-height").value);
  if (!(w >= 0.5 && d >= 0.5 && h >= 0.1 && w <= 2000 && d <= 2000 && h <= 1000)) return status("Revisa las medidas del edificio.", true);
  const made = addBuilding(site, rectangle(w, d), h);
  if (!made) return status("Llegaste al máximo de edificios de un sitio.", true);
  selected = made.building.id;
  apply(made.site);
  status(`${made.building.name}: ${fmt(w, 1)} × ${fmt(d, 1)} m y ${fmt(h, 1)} m de alto (${made.building.floors} ${made.building.floors === 1 ? "piso" : "pisos"}).`);
});

$<HTMLInputElement>("import").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT) return status("Ese GeoJSON pesa más de 20 MB: recorta la zona antes de exportarlo.", true);
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return status(`«${file.name}» no es un JSON válido.`, true);
  }
  const result = fromGeoJSON(data);
  if (!result.buildings.length && !result.lot) return status("No se encontraron polígonos en ese GeoJSON.", true);
  let next: Site = { ...site, place: "", lat: Math.round(result.origin.lat * 1e6) / 1e6, lon: Math.round(result.origin.lon * 1e6) / 1e6, lot: result.lot ?? null, buildings: [] };
  for (const b of result.buildings) next = addBuilding(next, b.points, b.height, b.name || undefined)?.site ?? next;
  selected = null;
  apply(next);
  fit();
  status(`Importados ${next.buildings.length} ${next.buildings.length === 1 ? "edificio" : "edificios"}${result.lot ? " y el lote" : ""}. La ubicación del sitio se ajustó a la del archivo.${result.skipped ? ` Se ${result.skipped === 1 ? "omitió 1 elemento que no era un polígono válido" : `omitieron ${result.skipped} elementos que no eran polígonos válidos`}.` : ""}`);
});

// ---------------------------------------------------------------------------- exports

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileBase = () => `${(site.place || "sitio").replace(/[^\p{L}\p{N}._ -]+/gu, "_")}-${site.date}`;

$("export-png").addEventListener("click", () => {
  draw();
  canvas.toBlob((blob) => {
    if (!blob) return status("No se pudo crear la imagen.", true);
    download(blob, `${fileBase()}.png`);
    status("Plano exportado como imagen, tal como se ve.");
  }, "image/png");
});

$("export-csv").addEventListener("click", () => {
  const date = localDate(site);
  const rows: (string | number | null)[][] = [["Hora", "Altura del sol (°)", "Azimut (°)", "Dirección"]];
  for (let m = 0; m < 1440; m += 30) {
    const s = sunPosition(instant(date, m, site.utcOffset), site.lat, site.lon);
    if (s.altitude > 0) rows.push([clock(m), s.altitude, s.azimuth, compass(s.azimuth)]);
  }
  download(new Blob([csv(rows, 1)], { type: "text/csv;charset=utf-8" }), `sol-${fileBase()}.csv`);
  status(`Tabla solar exportada: ${rows.length - 1} horas con sol, cada 30 minutos, a la hora local UTC${site.utcOffset >= 0 ? "+" : ""}${site.utcOffset}.`);
});
