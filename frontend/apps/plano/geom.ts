/**
 * Editing geometry for Plano: intersections, trim, offset, arcs through three points, closed
 * boundaries for hatching and the extra object snaps. Pure functions on the drawing model, so
 * every rule is unit-tested without a screen.
 */
import {
  angleIn, arcPoint, Block, closestOnSegment, dist, Entity, normAngle, pointInPolygon, polygonArea, primitives, Prim, Pt, Shape, Snap, TAU,
} from "./model";

const EPS = 1e-9;
type Curve = Extract<Prim, { t: "seg" } | { t: "arc" }>;
const curves = (prims: Prim[]): Curve[] => prims.filter((q): q is Curve => q.t === "seg" || q.t === "arc");

/* ---------- intersections ---------- */

function segSeg(p: Pt, p2: Pt, q: Pt, q2: Pt): Pt[] {
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return [];
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
  const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [{ x: p.x + t * r.x, y: p.y + t * r.y }] : [];
}

/** Line (not segment) through a and b against a full circle. */
function lineCircle(a: Pt, b: Pt, c: Pt, r: number): { p: Pt; t: number }[] {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: a.x - c.x, y: a.y - c.y };
  const A = d.x * d.x + d.y * d.y;
  const B = 2 * (f.x * d.x + f.y * d.y);
  const C = f.x * f.x + f.y * f.y - r * r;
  const disc = B * B - 4 * A * C;
  if (A < EPS || disc < -EPS) return [];
  const root = Math.sqrt(Math.max(disc, 0));
  const ts = disc < EPS ? [-B / (2 * A)] : [(-B - root) / (2 * A), (-B + root) / (2 * A)];
  return ts.map((t) => ({ t, p: { x: a.x + t * d.x, y: a.y + t * d.y } }));
}

function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const m = { x: c1.x + (a * (c2.x - c1.x)) / d, y: c1.y + (a * (c2.y - c1.y)) / d };
  const ox = (h * (c2.y - c1.y)) / d, oy = (h * (c2.x - c1.x)) / d;
  return h < EPS ? [m] : [{ x: m.x + ox, y: m.y - oy }, { x: m.x - ox, y: m.y + oy }];
}

const onArc = (q: Extract<Prim, { t: "arc" }>, p: Pt) => angleIn(Math.atan2(p.y - q.c.y, p.x - q.c.x), q.start, q.end);

export function curveIntersections(a: Curve, b: Curve): Pt[] {
  if (a.t === "seg" && b.t === "seg") return segSeg(a.a, a.b, b.a, b.b);
  if (a.t === "arc" && b.t === "seg") return curveIntersections(b, a);
  if (a.t === "seg" && b.t === "arc") {
    return lineCircle(a.a, a.b, b.c, b.r).filter(({ t, p }) => t >= -EPS && t <= 1 + EPS && onArc(b, p)).map(({ p }) => p);
  }
  const x = a as Extract<Prim, { t: "arc" }>, y = b as Extract<Prim, { t: "arc" }>;
  return circleCircle(x.c, x.r, y.c, y.r).filter((p) => onArc(x, p) && onArc(y, p));
}

export function entityIntersections(e: Entity, f: Entity, blocks: Record<string, Block> = {}): Pt[] {
  const out: Pt[] = [];
  for (const a of curves(primitives(e, blocks))) for (const b of curves(primitives(f, blocks))) out.push(...curveIntersections(a, b));
  return out;
}

/* ---------- arcs ---------- */

/** Arc from start through a middle point to an end, or null if the three points are in line. */
export function arcThrough(p1: Pt, p2: Pt, p3: Pt): { c: Pt; r: number; start: number; end: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < EPS * Math.max(1, dist(p1, p3) ** 2)) return null;
  const s1 = p1.x ** 2 + p1.y ** 2, s2 = p2.x ** 2 + p2.y ** 2, s3 = p3.x ** 2 + p3.y ** 2;
  const c = { x: (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d, y: (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d };
  const ang = (p: Pt) => normAngle(Math.atan2(p.y - c.y, p.x - c.x));
  const a1 = ang(p1), a2 = ang(p2), a3 = ang(p3);
  // Arcs are counter-clockwise: if the middle point is not on the CCW way from p1 to p3, swap ends.
  const ccw = angleIn(a2, a1, a3);
  return { c, r: dist(c, p1), start: ccw ? a1 : a3, end: ccw ? a3 : a1 };
}

/* ---------- trim ---------- */

type Piece = Shape;

/**
 * Removes the part of `e` around `click` that lies between its nearest cutting points. Every
 * other entity in `cutters` is a cutting edge. Returns the pieces that remain, or null when the
 * clicked part has no cutting point on either side (nothing to trim).
 */
export function trim(e: Entity, click: Pt, cutters: Entity[], blocks: Record<string, Block> = {}): Piece[] | null {
  const cuts = cutters.filter((c) => c.id !== e.id).flatMap((c) => entityIntersections(e, c, blocks));
  switch (e.kind) {
    case "line": {
      const len = dist(e.a, e.b);
      if (len < EPS) return null;
      const param = (p: Pt) => ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.y - e.a.y) * (e.b.y - e.a.y)) / (len * len);
      const ts = cuts.map(param).filter((t) => t > EPS && t < 1 - EPS);
      const tc = param(closestOnSegment(click, e.a, e.b));
      const lo = Math.max(0, ...ts.filter((t) => t < tc));
      const hi = Math.min(1, ...ts.filter((t) => t > tc));
      if (lo === 0 && hi === 1) return null;
      const at = (t: number): Pt => ({ x: e.a.x + t * (e.b.x - e.a.x), y: e.a.y + t * (e.b.y - e.a.y) });
      const out: Piece[] = [];
      if (lo > EPS) out.push({ kind: "line", a: e.a, b: at(lo) });
      if (hi < 1 - EPS) out.push({ kind: "line", a: at(hi), b: e.b });
      return out;
    }
    case "circle":
    case "arc": {
      const full = e.kind === "circle";
      const start = full ? 0 : e.start;
      const span = full ? TAU : normAngle(e.end - e.start) || TAU;
      const rel = (p: Pt) => normAngle(Math.atan2(p.y - e.c.y, p.x - e.c.x) - start);
      const us = cuts.map(rel).filter((u) => (full ? true : u > EPS && u < span - EPS));
      const uc = rel(click);
      if (full) {
        if (us.length < 2) return null;
        const sorted = [...new Set(us.map((u) => Math.round(u * 1e9) / 1e9))].sort((m, n) => m - n);
        if (sorted.length < 2) return null;
        // The removed span runs from the last cut before the click to the first one after it.
        const before = [...sorted].reverse().find((u) => u <= uc) ?? sorted[sorted.length - 1];
        const after = sorted.find((u) => u > uc) ?? sorted[0];
        return [{ kind: "arc", c: e.c, r: e.r, start: normAngle(start + after), end: normAngle(start + before) }];
      }
      const lo = Math.max(0, ...us.filter((u) => u < uc));
      const hi = Math.min(span, ...us.filter((u) => u > uc));
      if (lo === 0 && hi === span) return null;
      const out: Piece[] = [];
      if (lo > EPS) out.push({ kind: "arc", c: e.c, r: e.r, start, end: normAngle(start + lo) });
      if (hi < span - EPS) out.push({ kind: "arc", c: e.c, r: e.r, start: normAngle(start + hi), end: e.end });
      return out;
    }
    case "polyline": {
      // Position along the polyline: segment index plus fraction, so cuts sort in drawing order.
      const pts = e.closed ? [...e.pts, e.pts[0]] : e.pts;
      const along = (p: Pt) => {
        let best = { u: 0, d: Infinity };
        for (let i = 0; i + 1 < pts.length; i++) {
          const q = closestOnSegment(p, pts[i], pts[i + 1]);
          const d = dist(p, q);
          const len = dist(pts[i], pts[i + 1]) || 1;
          if (d < best.d) best = { u: i + dist(pts[i], q) / len, d };
        }
        return best.u;
      };
      const n = pts.length - 1;
      const at = (u: number): Pt => {
        const i = Math.min(Math.floor(u), n - 1), t = u - i;
        return { x: pts[i].x + t * (pts[i + 1].x - pts[i].x), y: pts[i].y + t * (pts[i + 1].y - pts[i].y) };
      };
      const path = (from: number, to: number): Pt[] => {
        const out = [at(from)];
        for (let i = Math.floor(from) + 1; i < to; i++) if (i > from + EPS) out.push(pts[i]);
        out.push(at(to));
        return out;
      };
      const us = cuts.map(along).filter((u) => e.closed || (u > EPS && u < n - EPS));
      const uc = along(click);
      if (e.closed) {
        const sorted = [...new Set(us.map((u) => Math.round(u * 1e9) / 1e9))].sort((m, k) => m - k);
        if (sorted.length < 2) return null;
        const before = [...sorted].reverse().find((u) => u <= uc) ?? sorted[sorted.length - 1];
        const after = sorted.find((u) => u > uc) ?? sorted[0];
        // What remains runs from `after` forward around the loop to `before`.
        const kept = after <= before ? path(after, before) : [...path(after, n), ...path(0, before).slice(1)];
        return [{ kind: "polyline", pts: kept, closed: false }];
      }
      const lo = Math.max(0, ...us.filter((u) => u < uc));
      const hi = Math.min(n, ...us.filter((u) => u > uc));
      if (lo === 0 && hi === n) return null;
      const out: Piece[] = [];
      if (lo > EPS) out.push({ kind: "polyline", pts: path(0, lo), closed: false });
      if (hi < n - EPS) out.push({ kind: "polyline", pts: path(hi, n), closed: false });
      return out;
    }
    default:
      return null;
  }
}

/* ---------- offset ---------- */

function offsetLine(a: Pt, b: Pt, d: number): [Pt, Pt] {
  const len = dist(a, b) || 1;
  const nx = (-(b.y - a.y) / len) * d, ny = ((b.x - a.x) / len) * d;
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }];
}

function lineMeet(a: Pt, a2: Pt, b: Pt, b2: Pt): Pt | null {
  const r = { x: a2.x - a.x, y: a2.y - a.y }, s = { x: b2.x - b.x, y: b2.y - b.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((b.x - a.x) * s.y - (b.y - a.y) * s.x) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** Which side of segment a→b the point is on: +1 left, -1 right. */
const side = (a: Pt, b: Pt, p: Pt) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) || 1;

/** Parallel copy of `e` at distance `d`, on the side where `toward` is. */
export function offset(e: Entity, d: number, toward: Pt): Piece | null {
  if (!(d > 0)) return null;
  switch (e.kind) {
    case "line": {
      const [a, b] = offsetLine(e.a, e.b, d * side(e.a, e.b, toward));
      return { kind: "line", a, b };
    }
    case "circle":
    case "arc": {
      const r = dist(toward, e.c) < e.r ? e.r - d : e.r + d;
      if (r <= EPS) return null;
      return e.kind === "circle" ? { kind: "circle", c: e.c, r } : { kind: "arc", c: e.c, r, start: e.start, end: e.end };
    }
    case "polyline": {
      const pts = e.pts;
      const n = e.closed ? pts.length : pts.length - 1;
      // The side comes from the segment nearest to the click; corners are mitred (lines extended to meet).
      let nearest = 0, best = Infinity;
      for (let i = 0; i < n; i++) {
        const q = closestOnSegment(toward, pts[i], pts[(i + 1) % pts.length]);
        if (dist(q, toward) < best) { best = dist(q, toward); nearest = i; }
      }
      const s = side(pts[nearest], pts[(nearest + 1) % pts.length], toward);
      const segs = Array.from({ length: n }, (_, i) => offsetLine(pts[i], pts[(i + 1) % pts.length], d * s));
      const out: Pt[] = [];
      for (let i = 0; i < pts.length; i++) {
        const prev = e.closed ? segs[(i - 1 + n) % n] : segs[i - 1];
        const next = e.closed ? segs[i % n] : segs[i];
        if (prev && next) out.push(lineMeet(prev[0], prev[1], next[0], next[1]) ?? next[0]);
        else if (next) out.push(next[0]);
        else if (prev) out.push(prev[1]);
      }
      return { kind: "polyline", pts: out, closed: e.closed };
    }
    default:
      return null;
  }
}

/* ---------- hatch boundary ---------- */

/** The smallest closed outline (closed polyline or circle) that contains the point. */
export function boundaryAt(entities: Entity[], p: Pt): Pt[] | null {
  let best: Pt[] | null = null;
  let bestArea = Infinity;
  for (const e of entities) {
    let pts: Pt[] | null = null;
    if (e.kind === "polyline" && (e.closed || dist(e.pts[0], e.pts[e.pts.length - 1]) < 1e-6) && e.pts.length >= 3) pts = e.pts;
    if (e.kind === "circle") pts = Array.from({ length: 72 }, (_, i) => arcPoint(e, (i * TAU) / 72));
    if (!pts || !pointInPolygon(p, pts)) continue;
    const area = polygonArea(pts);
    if (area < bestArea) { bestArea = area; best = pts; }
  }
  return best;
}

/* ---------- more object snaps ---------- */

/** Intersections between visible entities near the cursor. */
export function intersectionSnap(entities: Entity[], p: Pt, tolerance: number, blocks: Record<string, Block> = {}): Snap | null {
  // Only entities that pass near the cursor can meet there; this keeps big drawings fast.
  const near = entities.filter((e) => e.kind !== "text" && e.kind !== "hatch" && curves(primitives(e, blocks)).some((q) => distToCurve(p, q) <= tolerance));
  let best: Snap | null = null;
  let bestDist = tolerance;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const x of entityIntersections(near[i], near[j], blocks)) {
        const d = dist(x, p);
        if (d <= bestDist) { bestDist = d; best = { p: x, kind: "intersection" }; }
      }
    }
  }
  return best;
}

function distToCurve(p: Pt, q: Curve): number {
  if (q.t === "seg") return dist(p, closestOnSegment(p, q.a, q.b));
  return onArc(q, p) ? Math.abs(dist(p, q.c) - q.r) : Math.min(dist(p, arcPoint(q, q.start)), dist(p, arcPoint(q, q.end)));
}

/** Foot of the perpendicular from `from` to the entity under the cursor. */
export function perpendicularSnap(entities: Entity[], from: Pt, p: Pt, tolerance: number): Snap | null {
  for (const e of entities) {
    for (const q of curves(primitives(e))) {
      if (distToCurve(p, q) > tolerance) continue;
      let foot: Pt;
      if (q.t === "seg") {
        const dx = q.b.x - q.a.x, dy = q.b.y - q.a.y, len2 = dx * dx + dy * dy;
        if (len2 < EPS) continue;
        const t = ((from.x - q.a.x) * dx + (from.y - q.a.y) * dy) / len2;
        if (t < -EPS || t > 1 + EPS) continue;
        foot = { x: q.a.x + t * dx, y: q.a.y + t * dy };
      } else {
        const d = dist(from, q.c);
        if (d < EPS) continue;
        foot = arcPoint(q, Math.atan2(from.y - q.c.y, from.x - q.c.x));
        if (!onArc(q, foot)) continue;
      }
      if (dist(foot, p) <= tolerance * 3) return { p: foot, kind: "perpendicular" };
    }
  }
  return null;
}

/** Tangent points from `from` to a circle or arc under the cursor. */
export function tangentSnap(entities: Entity[], from: Pt, p: Pt, tolerance: number): Snap | null {
  for (const e of entities) {
    if (e.kind !== "circle" && e.kind !== "arc") continue;
    const d = dist(from, e.c);
    if (d <= e.r + EPS || Math.abs(dist(p, e.c) - e.r) > tolerance) continue;
    const base = Math.atan2(from.y - e.c.y, from.x - e.c.x);
    const spread = Math.acos(e.r / d);
    const candidates = [base + spread, base - spread].map((a) => arcPoint(e, a))
      .filter((t) => e.kind === "circle" || angleIn(Math.atan2(t.y - e.c.y, t.x - e.c.x), e.start, e.end));
    const near = candidates.sort((m, n) => dist(m, p) - dist(n, p))[0];
    if (near && dist(near, p) <= tolerance * 3) return { p: near, kind: "tangent" };
  }
  return null;
}
