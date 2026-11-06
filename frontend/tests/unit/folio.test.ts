import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import * as ops from "../../apps/folio/ops";

async function makePdf(pages: number, label = "Doc"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200 + i, 300]); // width encodes the original position
    page.drawText(`${label} ${i + 1}`, { x: 20, y: 250, size: 12, font });
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

describe("Folio operations", () => {
  it("merges two documents in order", async () => {
    const merged = await ops.merge(await makePdf(2), await makePdf(3));
    expect(await ops.pageCount(merged)).toBe(5);
    expect(await widths(merged)).toEqual([200, 201, 200, 201, 202]);
  });

  it("rotates only the chosen pages, wrapping at 360", async () => {
    let bytes = await makePdf(3);
    bytes = await ops.rotate(bytes, [1]);
    bytes = await ops.rotate(bytes, [1, 2], 270);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0, 270]);
  });

  it("removes pages but never the last one", async () => {
    const bytes = await makePdf(4);
    expect(await widths(await ops.remove(bytes, [0, 2, 2]))).toEqual([201, 203]);
    await expect(ops.remove(bytes, [0, 1, 2, 3])).rejects.toThrow(/al menos una página/);
  });

  it("moves a page and ignores impossible moves", async () => {
    const bytes = await makePdf(4);
    expect(await widths(await ops.move(bytes, 0, 2))).toEqual([201, 202, 200, 203]);
    expect(await widths(await ops.move(bytes, 3, 0))).toEqual([203, 200, 201, 202]);
    expect(await widths(await ops.move(bytes, 0, 9))).toEqual([200, 201, 202, 203]);
  });

  it("extracts selected pages in document order", async () => {
    const out = await ops.extract(await makePdf(5), [3, 1, 3]);
    expect(await widths(out)).toEqual([201, 203]);
    await expect(ops.extract(await makePdf(1), [])).rejects.toThrow(/al menos una página/);
  });

  it("adds Spanish text and highlights without failing", async () => {
    let bytes = await makePdf(1);
    bytes = await ops.addText(bytes, 0, 20, 200, "Revisión: ñandú, acción\nsegunda línea ✓", 12);
    bytes = await ops.addHighlight(bytes, 0, 10, 10, 60, 40);
    expect(await ops.pageCount(bytes)).toBe(1);
    expect(ops.printable("ñandú ✓ €")).toBe("ñandú ? €");
  });

  it("explains files that are not PDFs", async () => {
    await expect(ops.open(new TextEncoder().encode("hola"))).rejects.toThrow(ops.PdfError);
  });

  it("round-trips bytes through base64, including large files", async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(ops.fromBase64(ops.toBase64(bytes))).toEqual(bytes);
  });

  it("keeps a bounded undo history", () => {
    const h = new ops.History(2);
    const a = new Uint8Array([1]), b = new Uint8Array([2]), c = new Uint8Array([3]), d = new Uint8Array([4]);
    h.push(a); h.push(b); h.push(c);
    expect(h.undo(d)).toEqual(c);
    expect(h.undo(c)).toEqual(b);
    expect(h.undo(b)).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo(b)).toEqual(c);
    h.push(a);
    expect(h.canRedo).toBe(false);
  });
});
