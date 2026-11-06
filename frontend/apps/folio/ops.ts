import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * PDF operations, all on the student's device with pdf-lib. Every operation takes the current
 * bytes and returns new bytes, which keeps undo simple (a stack of byte arrays).
 */

export class PdfError extends Error {}

export async function open(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const text = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(text)) throw new PdfError("Este PDF está protegido con contraseña. Quita la protección antes de editarlo.");
    throw new PdfError("No se pudo leer el archivo. ¿Es un PDF válido?");
  }
}

async function edit(bytes: Uint8Array, change: (doc: PDFDocument) => void | Promise<void>): Promise<Uint8Array> {
  const doc = await open(bytes);
  await change(doc);
  return doc.save({ useObjectStreams: true });
}

export function pageCount(bytes: Uint8Array): Promise<number> {
  return open(bytes).then((d) => d.getPageCount());
}

/** Appends every page of `other` after the current pages. */
export function merge(bytes: Uint8Array, other: Uint8Array): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const source = await open(other);
    const pages = await doc.copyPages(source, source.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
  });
}

export function rotate(bytes: Uint8Array, indices: number[], by = 90): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    for (const i of indices) {
      const page = doc.getPage(i);
      page.setRotation(degrees((((page.getRotation().angle + by) % 360) + 360) % 360));
    }
  });
}

export function remove(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    if (indices.length >= doc.getPageCount()) throw new PdfError("Un PDF necesita al menos una página.");
    [...new Set(indices)].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  });
}

/** Moves one page to a new position (0-based). */
export function move(bytes: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const count = doc.getPageCount();
    if (from < 0 || from >= count || to < 0 || to >= count || from === to) return;
    const order = doc.getPageIndices();
    order.splice(to, 0, order.splice(from, 1)[0]);
    const copies = await doc.copyPages(doc, order);
    for (let i = count - 1; i >= 0; i--) doc.removePage(i);
    copies.forEach((p) => doc.addPage(p));
  });
}

/** New PDF with only the chosen pages, in their current order. */
export async function extract(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  if (!indices.length) throw new PdfError("Selecciona al menos una página.");
  const source = await open(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, [...new Set(indices)].sort((a, b) => a - b));
  pages.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

/** Standard PDF fonts only cover WinAnsi: Spanish is fine, anything else becomes "?". */
export function printable(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF€‘’“”–—…]/g, "?");
}

/** Writes text at a point given in PDF user space (origin bottom-left, in points). */
export function addText(bytes: Uint8Array, index: number, x: number, y: number, text: string, size = 12): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(index);
    printable(text).split("\n").forEach((line, i) => {
      page.drawText(line, { x, y: y - size - i * size * 1.25, size, font, color: rgb(0, 0, 0) });
    });
  });
}

/** Translucent highlight over a rectangle in PDF user space. */
export function addHighlight(bytes: Uint8Array, index: number, x1: number, y1: number, x2: number, y2: number): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    const page = doc.getPage(index);
    page.drawRectangle({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      color: rgb(1, 0.9, 0.2),
      opacity: 0.35,
    });
  });
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(value: string): Uint8Array {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Bounded undo history of whole documents. */
export class History {
  private past: Uint8Array[] = [];
  private future: Uint8Array[] = [];

  constructor(private readonly limit = 15) {}

  push(previous: Uint8Array): void {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Uint8Array): Uint8Array | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: Uint8Array): Uint8Array | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
