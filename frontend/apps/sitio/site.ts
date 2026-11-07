/**
 * The site: a lot and the buildings around it, drawn in plan in metres (x east, y north before
 * turning the north arrow). Shadows, hours of direct sun and the land-use ratios are computed
 * here, without the screen, so they are unit tested.
 */
import { instant, sunDay, sunPosition, type LocalDate } from "./sun";

export type Point = [number, number];

export interface Building {
  id: string;
  name: string;
  points: Point[];
  height: number;
  floors: number;
}

export interface Site {
  v: 1;
  place: string;
  lat: number;
  lon: number;
  /** Fixed offset from UTC in hours (Ecuador: -5 mainland, -6 Galápagos). */
  utcOffset: number;
  /** Degrees from the plan's "up" to true north, clockwise. */
  north: number;
  date: string;
  /** Local clock minutes after midnight. */
  minutes: number;
  lot: Point[] | null;
  buildings: Building[];
  /** Spacing of the sun-hours grid, metres. */
  spacing: number;
}

/** Approximate centre of each city (two decimals, about 1 km): enough for the sun's position. */
export const PLACES: { name: string; lat: number; lon: number; utcOffset: number }[] = [
  { name: "Quito", lat: -0.22, lon: -78.51, utcOffset: -5 },
  { name: "Guayaquil", lat: -2.19, lon: -79.89, utcOffset: -5 },
  { name: "Cuenca", lat: -2.9, lon: -79.0, utcOffset: -5 },
  { name: "Loja", lat: -3.99, lon: -79.2, utcOffset: -5 },
  { name: "Ambato", lat: -1.25, lon: -78.62, utcOffset: -5 },
  { name: "Riobamba", lat: -1.66, lon: -78.65, utcOffset: -5 },
  { name: "Ibarra", lat: 0.35, lon: -78.12, utcOffset: -5 },
  { name: "Manta", lat: -0.97, lon: -80.71, utcOffset: -5 },
  { name: "Portoviejo", lat: -1.05, lon: -80.45, utcOffset: -5 },
  { name: "Machala", lat: -3.26, lon: -79.96, utcOffset: -5 },
  { name: "Esmeraldas", lat: 0.97, lon: -79.65, utcOffset: -5 },
  { name: "Puerto Ayora (Galápagos)", lat: -0.74, lon: -90.31, utcOffset: -6 },
];

export const MAX_BUILDINGS = 300;
export const MAX_POINTS = 200;
const MAX_GRID = 12_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID = /^b\d{1,6}$/;

export function newSite(today: string): Site {
  const q = PLACES[0];
  return { v: 1, place: q.name, lat: q.lat, lon: q.lon, utcOffset: q.utcOffset, north: 0, date: DATE.test(today) ? today : "2026-06-21", minutes: 720, lot: null, buildings: [], spacing: 1 };
}

export function localDate(site: Site): LocalDate {
  const m = DATE.exec(site.date)!;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

// ---------------------------------------------------------------------------- plane geometry

export function area(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function inside(p: Point, polygon: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function bounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Distance along a ray (unit direction) to where it first enters a polygon; 0 if it starts inside. */
export function entry(origin: Point, dir: Point, polygon: Point[]): number | null {
  if (inside(origin, polygon)) return 0;
  let best: number | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denominator = dir[0] * ey - dir[1] * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const t = (ax * ey - ay * ex) / denominator;
    const u = (ax * dir[1] - ay * dir[0]) / denominator;
    if (t >= 0 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------- sun on the plan

export interface PlanSun {
  altitude: number;
  /** Direction on the plan, degrees clockwise from the plan's top. */
  azimuth: number;
  /** Unit vector on the plan pointing towards the sun. */
  toward: Point;
}

/**
 * `north` is where true north points on the plan, in degrees clockwise from the plan's top. A
 * direction with true azimuth A therefore sits at A + north on the plan.
 */
export function planSun(altitude: number, azimuth: number, north: number): PlanSun {
  const a = ((azimuth + north) * Math.PI) / 180;
  return { altitude, azimuth: azimuth + north, toward: [Math.sin(a), Math.cos(a)] };
}

/**
 * A building's shadow on flat ground: its footprint swept along the shadow's direction. The
 * pieces (footprint, footprint moved, and the band swept by each wall) overlap; drawn together
 * they make the whole shadow, also for L- or U-shaped buildings.
 */
export function shadowPieces(b: Building, sun: PlanSun): Point[][] {
  if (sun.altitude <= 0) return [];
  const length = b.height / Math.tan((sun.altitude * Math.PI) / 180);
  const d: Point = [-sun.toward[0] * length, -sun.toward[1] * length];
  const moved = b.points.map(([x, y]): Point => [x + d[0], y + d[1]]);
  const bands = b.points.map((p, i) => {
    const q = b.points[(i + 1) % b.points.length];
    return [p, q, [q[0] + d[0], q[1] + d[1]], [p[0] + d[0], p[1] + d[1]]] as Point[];
  });
  return [b.points, moved, ...bands];
}

/** True when buildings block the sun seen from a point on the ground. */
export function shaded(p: Point, sun: PlanSun, buildings: Building[]): boolean {
  if (sun.altitude <= 0) return true;
  const rise = Math.tan((sun.altitude * Math.PI) / 180);
  for (const b of buildings) {
    const t = entry(p, sun.toward, b.points);
    if (t !== null && t * rise < b.height) return true;
  }
  return false;
}

export interface Sample { altitude: number; azimuth: number }

/** The sun every `step` minutes of the site's date, only while it is above the horizon. */
export function daySamples(site: Site, step = 10): Sample[] {
  const date = localDate(site);
  const out: Sample[] = [];
  for (let m = step / 2; m < 1440; m += step) {
    const s = sunPosition(instant(date, m, site.utcOffset), site.lat, site.lon);
    if (s.altitude > 0) out.push({ altitude: s.altitude, azimuth: s.azimuth });
  }
  return out;
}

/** Points of the analysis grid: cell centres inside the lot, spacing widened for very large lots. */
export function grid(lot: Point[], spacing: number): { points: Point[]; spacing: number } {
  const box = bounds(lot);
  let s = Math.max(0.25, spacing);
  while (((box.maxX - box.minX) / s) * ((box.maxY - box.minY) / s) > MAX_GRID) s *= 1.5;
  const points: Point[] = [];
  for (let y = box.minY + s / 2; y < box.maxY; y += s) {
    for (let x = box.minX + s / 2; x < box.maxX; x += s) if (inside([x, y], lot)) points.push([x, y]);
  }
  return { points, spacing: s };
}

/** Hours of direct sun at each point; points under a building are null (not open ground). */
export function sunHours(points: Point[], samples: Sample[], site: Site, step = 10): (number | null)[] {
  const suns = samples.map((s) => planSun(s.altitude, s.azimuth, site.north));
  return points.map((p) => {
    if (site.buildings.some((b) => inside(p, b.points))) return null;
    let lit = 0;
    for (const sun of suns) if (!shaded(p, sun, site.buildings)) lit++;
    return (lit * step) / 60;
  });
}

// ---------------------------------------------------------------------------- land use

export interface Ratios { lot: number; footprint: number; built: number; cosPB: number | null; cosTotal: number | null }

/**
 * Areas and ratios of the buildings on the lot, as Quito's municipal rules name them: COS PB (ground floor built area over lot
 * area) and COS total (all floors over lot area). Gross areas: the official "computable" areas
 * leave out some spaces, so these figures are an approximation for early design.
 */
export function ratios(site: Site): Ratios {
  const lot = site.lot ? area(site.lot) : 0;
  // Only buildings standing on the lot count; the neighbours drawn for their shadows do not.
  const own = site.lot ? site.buildings.filter((b) => inside(centroid(b.points), site.lot!)) : site.buildings;
  const footprint = own.reduce((n, b) => n + area(b.points), 0);
  const built = own.reduce((n, b) => n + area(b.points) * b.floors, 0);
  return { lot, footprint, built, cosPB: lot ? footprint / lot : null, cosTotal: lot ? built / lot : null };
}

/** Centre of mass of a polygon's area. */
export function centroid(points: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) return points[0];
  return [cx / (3 * a), cy / (3 * a)];
}

// ---------------------------------------------------------------------------- editing

export function floorsFor(height: number): number {
  return Math.max(1, Math.round(height / 3));
}

export function cleanPolygon(points: Point[]): Point[] | null {
  const out: Point[] = [];
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out.length >= 3 && out.length <= MAX_POINTS && area(out) > 1e-4 ? out : null;
}

export function addBuilding(site: Site, points: Point[], height = 6, name?: string): { site: Site; building: Building } | null {
  const clean = cleanPolygon(points);
  if (!clean || site.buildings.length >= MAX_BUILDINGS) return null;
  const used = site.buildings.map((b) => Number(b.id.slice(1)));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const h = Math.min(Math.max(height, 0.1), 1000);
  const building: Building = { id: `b${n}`, name: (name?.trim() || `Edificio ${n}`).slice(0, 80), points: clean, height: h, floors: floorsFor(h) };
  return { site: { ...site, buildings: [...site.buildings, building] }, building };
}

export function rectangle(width: number, depth: number, cx = 0, cy = 0): Point[] {
  const w = width / 2;
  const d = depth / 2;
  return [[cx - w, cy - d], [cx + w, cy - d], [cx + w, cy + d], [cx - w, cy + d]];
}

// ---------------------------------------------------------------------------- GeoJSON

const EARTH = 6_371_008.8;

/** Local metres around an origin (equirectangular): errors under a centimetre across a few hundred metres. */
export function toLocal(lon: number, lat: number, origin: { lon: number; lat: number }): Point {
  const k = Math.PI / 180;
  return [EARTH * (lon - origin.lon) * k * Math.cos(origin.lat * k), EARTH * (lat - origin.lat) * k];
}

function heightOf(props: Record<string, unknown>): number | null {
  const number = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v.replace(",", ".")) : Number.NaN);
  const h = number(props.height ?? props.altura);
  if (Number.isFinite(h) && h > 0) return h;
  const levels = number(props["building:levels"] ?? props.levels ?? props.pisos);
  return Number.isFinite(levels) && levels > 0 ? levels * 3 : null;
}

export interface Imported { origin: { lat: number; lon: number }; lot: Point[] | null; buildings: { name: string; points: Point[]; height: number }[]; skipped: number }

/**
 * Buildings (and optionally the lot) from a GeoJSON file (RFC 7946: WGS84, [longitude, latitude]).
 * Polygons become buildings; their height comes from "height"/"altura" or from "building:levels",
 * "levels" or "pisos" at 3 m per floor. A feature with "lote": true is the lot.
 */
export function fromGeoJSON(data: unknown): Imported {
  const features: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }[] = [];
  const d = data as { type?: string; features?: unknown[]; geometry?: unknown };
  if (d?.type === "FeatureCollection" && Array.isArray(d.features)) features.push(...(d.features as typeof features));
  else if (d?.type === "Feature") features.push(d as (typeof features)[number]);
  else if (d?.type === "Polygon" || d?.type === "MultiPolygon") features.push({ geometry: d as { type: string; coordinates: unknown } });
  const rings: { ring: [number, number][]; props: Record<string, unknown> }[] = [];
  let skipped = 0;
  const valid = (c: unknown): c is [number, number][] =>
    Array.isArray(c) && c.length >= 4 && c.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  for (const f of features.slice(0, 5000)) {
    const g = f?.geometry;
    const props = (f?.properties && typeof f.properties === "object" ? f.properties : {}) as Record<string, unknown>;
    const polygons = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" && Array.isArray(g.coordinates) ? g.coordinates : [];
    if (!polygons.length) skipped++;
    for (const poly of polygons) {
      const outer = Array.isArray(poly) ? poly[0] : null;
      if (valid(outer)) rings.push({ ring: outer, props });
      else skipped++;
    }
  }
  if (!rings.length) return { origin: { lat: 0, lon: 0 }, lot: null, buildings: [], skipped };
  const all = rings.flatMap((r) => r.ring);
  const origin = { lon: all.reduce((n, p) => n + p[0], 0) / all.length, lat: all.reduce((n, p) => n + p[1], 0) / all.length };
  let lot: Point[] | null = null;
  const buildings: Imported["buildings"] = [];
  for (const { ring, props } of rings) {
    const points = cleanPolygon(ring.map(([lon, lat]) => toLocal(lon, lat, origin)));
    if (!points) {
      skipped++;
      continue;
    }
    if (props.lote === true || props.lote === "si" || props.lote === "sí") lot = points;
    else if (buildings.length < MAX_BUILDINGS) {
      const name = typeof props.name === "string" ? props.name : typeof props.nombre === "string" ? props.nombre : "";
      buildings.push({ name, points, height: heightOf(props) ?? 6 });
    } else skipped++;
  }
  return { origin, lot, buildings, skipped };
}

// ---------------------------------------------------------------------------- saved site

const num = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

function polygon(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length > MAX_POINTS) return null;
  const pts = v.filter((p): p is Point => Array.isArray(p) && p.length === 2 && num(p[0], -1e6, 1e6) && num(p[1], -1e6, 1e6));
  return pts.length === v.length ? cleanPolygon(pts) : null;
}

export function parseSite(raw: unknown, today: string): Site {
  const site = newSite(today);
  if (typeof raw !== "object" || raw === null) return site;
  const r = raw as Record<string, unknown>;
  if (typeof r.place === "string") site.place = r.place.slice(0, 80);
  if (num(r.lat, -90, 90)) site.lat = r.lat;
  if (num(r.lon, -180, 180)) site.lon = r.lon;
  if (num(r.utcOffset, -12, 14)) site.utcOffset = r.utcOffset;
  if (num(r.north, -360, 360)) site.north = r.north;
  if (typeof r.date === "string" && DATE.test(r.date) && !Number.isNaN(Date.parse(r.date))) site.date = r.date;
  if (num(r.minutes, 0, 1439)) site.minutes = Math.round(r.minutes);
  if (num(r.spacing, 0.25, 50)) site.spacing = r.spacing;
  site.lot = polygon(r.lot);
  if (Array.isArray(r.buildings)) {
    const seen = new Set<string>();
    for (const item of r.buildings.slice(0, MAX_BUILDINGS)) {
      if (typeof item !== "object" || item === null) continue;
      const b = item as Record<string, unknown>;
      const points = polygon(b.points);
      if (typeof b.id !== "string" || !ID.test(b.id) || seen.has(b.id) || !points || !num(b.height, 0.1, 1000)) continue;
      seen.add(b.id);
      site.buildings.push({
        id: b.id,
        name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : "Edificio",
        points,
        height: b.height,
        floors: num(b.floors, 1, 300) ? Math.round(b.floors) : floorsFor(b.height),
      });
    }
  }
  return site;
}

export { sunDay };
