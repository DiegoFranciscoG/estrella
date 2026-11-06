/**
 * Printing to scale. A small, dependency-free PDF writer (PDF 1.4, ISO 32000 predecessor): the
 * page works in millimetres through one transformation matrix, so a 1:100 plan measures exactly
 * 1/100 on paper. Lines and arcs stay vector; text uses the standard Helvetica font.
 */
import { arcPoint, Drawing, drawingBounds, formatLength, normAngle, primitives, Prim, Pt, TAU } from "./model";

export const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] } as const;
export type Sheet = keyof typeof SHEETS;
export const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 5000];

export interface PrintOptions {
  sheet: Sheet;
  landscape: boolean;
  /** 1:scale, or 0 to fit the drawing to the sheet. */
  scale: number;
  title: string;
  author: string;
  date: string;
}

export type PrintResult = { ok: true; pdf: Uint8Array; scale: number } | { ok: false; message: string; suggest?: number };

const MARGIN = 10;
const TITLE_W = 110;
const TITLE_H = 28;
const MM = 72 / 25.4;

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** PDF string with WinAnsi bytes: Spanish letters survive; anything else becomes "?". */
function pdfString(text: string): string {
  let out = "(";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code < 256) out += "\\" + code.toString(8).padStart(3, "0");
    else out += "?";
  }
  return out + ")";
}

/** Bézier approximation of an arc, at most 90° per piece. */
function arcPath(c: Pt, r: number, start: number, end: number, M: (p: Pt) => Pt): string {
  let span = normAngle(end - start) || TAU;
  const pieces = Math.ceil(span / (Math.PI / 2));
  span /= pieces;
  const kappa = (4 / 3) * Math.tan(span / 4);
  let a = start;
  const p0 = M(arcPoint({ c, r }, a));
  let out = `${f(p0.x)} ${f(p0.y)} m `;
  for (let i = 0; i < pieces; i++) {
    const b = a + span;
    const p1 = arcPoint({ c, r }, a), p2 = arcPoint({ c, r }, b);
    const c1 = M({ x: p1.x - kappa * r * Math.sin(a), y: p1.y + kappa * r * Math.cos(a) });
    const c2 = M({ x: p2.x + kappa * r * Math.sin(b), y: p2.y - kappa * r * Math.cos(b) });
    const e = M(p2);
    out += `${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(e.x)} ${f(e.y)} c `;
    a = b;
  }
  return out + "S\n";
}

function text(p: Pt, size: number, rot: number, value: string, center = false): string {
  // Entity heights are cap heights; Helvetica's cap height is about 0.72 of its size.
  const fs = size / 0.72;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const shift = center ? -(value.length * fs * 0.5) / 2 : 0;
  return `BT /F1 ${f(fs)} Tf ${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${f(p.x)} ${f(p.y)} Tm ${f(shift)} 0 Td ${pdfString(value)} Tj ET\n`;
}

function drawPrim(q: Prim, M: (p: Pt) => Pt, k: number): string {
  switch (q.t) {
    case "seg": {
      const a = M(q.a), b = M(q.b);
      return `${f(a.x)} ${f(a.y)} m ${f(b.x)} ${f(b.y)} l S\n`;
    }
    case "arc": return arcPath(q.c, q.r, q.start, q.end, M);
    case "text": return text(M(q.p), q.h * k, q.rot, q.value, q.center);
    case "fill": return q.pts.map(M).map((p, i) => `${f(p.x)} ${f(p.y)} ${i ? "l" : "m"}`).join(" ") + " h f\n";
  }
}

export function toPdf(d: Drawing, o: PrintOptions): PrintResult {
  const [long, short] = SHEETS[o.sheet];
  const W = o.landscape ? long : short;
  const H = o.landscape ? short : long;
  const blocks = d.blocks ?? {};
  const visible = new Set(d.layers.filter((l) => l.visible).map((l) => l.name));
  const entities = d.entities.filter((e) => visible.has(e.layer));
  const b = drawingBounds(entities, blocks);
  if (!b) return { ok: false, message: "No hay nada visible para imprimir." };

  // Drawing area: inside the frame, above the title block.
  const area = { x: MARGIN + 5, y: MARGIN + TITLE_H + 5, w: W - 2 * MARGIN - 10, h: H - 2 * MARGIN - TITLE_H - 10 };
  const bw = Math.max(b.maxX - b.minX, 1e-6), bh = Math.max(b.maxY - b.minY, 1e-6);
  const fitScale = Math.max(bw / area.w, bh / area.h);
  let scale = o.scale;
  if (scale <= 0) scale = fitScale;
  else if (bw / scale > area.w + 1e-6 || bh / scale > area.h + 1e-6) {
    const suggest = SCALES.find((s) => s >= fitScale);
    return {
      ok: false,
      message: `A 1:${o.scale} el dibujo mide ${formatLength(bw / scale)} × ${formatLength(bh / scale)} mm y no cabe en ${o.sheet}.`,
      suggest,
    };
  }
  const k = 1 / scale;
  const ox = area.x + (area.w - bw * k) / 2 - b.minX * k;
  const oy = area.y + (area.h - bh * k) / 2 - b.minY * k;
  const M = (p: Pt): Pt => ({ x: p.x * k + ox, y: p.y * k + oy });

  let content = `${f(MM)} 0 0 ${f(MM)} 0 0 cm 1 J 1 j\n`;
  // Frame and title block.
  content += `0.5 w ${MARGIN} ${MARGIN} ${f(W - 2 * MARGIN)} ${f(H - 2 * MARGIN)} re S\n`;
  const tx = W - MARGIN - TITLE_W, ty = MARGIN;
  content += `${f(tx)} ${f(ty)} ${TITLE_W} ${TITLE_H} re S ${f(tx)} ${f(ty + 14)} m ${f(tx + TITLE_W)} ${f(ty + 14)} l S ${f(tx + 70)} ${f(ty)} m ${f(tx + 70)} ${f(ty + 14)} l S\n`;
  const scaleLabel = o.scale > 0 ? `1:${o.scale}` : `Ajustado (1:${formatLength(scale)})`;
  content += "0 g " + text({ x: tx + 3, y: ty + 19 }, 3.5, 0, (o.title || "Plano sin nombre").slice(0, 60));
  content += text({ x: tx + 3, y: ty + 8 }, 2.2, 0, o.author ? `Autor: ${o.author.slice(0, 40)}` : "Autor:");
  content += text({ x: tx + 3, y: ty + 3 }, 2, 0, `Fecha: ${o.date}`);
  content += text({ x: tx + 73, y: ty + 8 }, 2.5, 0, `Escala ${scaleLabel}`);
  content += text({ x: tx + 73, y: ty + 3 }, 2, 0, `Hoja ${o.sheet} · mm`);
  // The drawing, clipped to its area so nothing crosses the frame.
  content += `q ${f(area.x)} ${f(area.y)} ${f(area.w)} ${f(area.h)} re W n 0.25 w\n`;
  for (const e of entities) for (const q of primitives(e, blocks)) content += drawPrim(q, M, k);
  content += "Q\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W * MM)} ${f(H * MM)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Producer (ESTRELLA Plano) /Title ${pdfString(o.title || "Plano")} >>`,
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o2) => `${String(o2).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Everything above is ASCII except the 4 marker bytes, so latin1 maps characters to bytes 1:1.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return { ok: true, pdf: bytes, scale };
}
