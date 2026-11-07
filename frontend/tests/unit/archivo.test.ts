import { describe, expect, it } from "vitest";
import {
  addTags, formatSize, isNoise, kindOf, labelText, newCatalog, opensWith, parseCatalog, parseTags, renamePlan, safeName, scan,
  setLabel, setRating, setSize, setTags, visible, type Catalog,
} from "../../apps/archivo/catalog";
import { crc32, zipLayout } from "../../apps/shared/zip";

const DAY = 86_400_000;
const files = [
  { path: "Entrega/planos/planta.dxf", size: 2048, modified: 10 * DAY },
  { path: "Entrega/fotos/fachada.JPG", size: 3_500_000, modified: 12 * DAY },
  { path: "Entrega/fotos/IMG_0042.NEF", size: 25_000_000, modified: 11 * DAY },
  { path: "Entrega/memoria.pdf", size: 900_000, modified: 13 * DAY },
  { path: "Entrega/.DS_Store", size: 10, modified: 1 },
  { path: "Entrega/~$memoria.docx", size: 10, modified: 1 },
  { path: "Entrega/Thumbs.db", size: 10, modified: 1 },
];
const scanned = (): Catalog => scan(newCatalog(), files, "Entrega").catalog;

describe("Archivo: what each file is", () => {
  it("recognises the formats students use and says which program opens them", () => {
    expect(kindOf("fachada.JPG")).toBe("imagen");
    expect(kindOf("IMG_0042.NEF")).toBe("raw");
    expect(kindOf("casa.ifc")).toBe("bim");
    expect(kindOf("pieza.stl")).toBe("modelo3d");
    expect(kindOf("sin-extension")).toBe("otro");
    expect(kindOf(".bashrc")).toBe("otro");
    expect(opensWith("planta.dxf")).toBe("Plano para editarlo, Visor para verlo");
    expect(opensWith("IMG_0042.NEF")).toBe("Revelado");
    expect(opensWith("memoria.pdf")).toBe("Folio");
    expect(opensWith("casa.skp")).toBe("");
    expect(labelText("verde")).toBe("Verde · Aprobado");
  });

  it("leaves out hidden, temporary and cache files", () => {
    expect(isNoise("a/.git/config")).toBe(true);
    expect(isNoise("a/~$memoria.docx")).toBe(true);
    expect(isNoise("a/Thumbs.db")).toBe(true);
    expect(isNoise("a/b/fachada.jpg")).toBe(false);
    expect(scanned().entries.map((e) => e.name)).toEqual(["planta.dxf", "fachada.JPG", "IMG_0042.NEF", "memoria.pdf"]);
  });
});

describe("Archivo: ratings, labels and keywords", () => {
  it("keeps what the student marked when the folder is read again", () => {
    let c = scanned();
    c = setRating(c, ["Entrega/fotos/fachada.JPG"], 4);
    c = setLabel(c, ["Entrega/fotos/fachada.JPG", "Entrega/memoria.pdf"], "verde");
    c = setTags(c, ["Entrega/fotos/fachada.JPG"], ["Fachada", "entrega final", "fachada"]);
    c = setSize(c, "Entrega/fotos/fachada.JPG", 4000, 3000);
    const again = scan(c, files.filter((f) => !f.path.endsWith("planta.dxf")), "Entrega").catalog;
    const photo = again.entries.find((e) => e.name === "fachada.JPG")!;
    expect(photo).toMatchObject({ rating: 4, label: "verde", tags: ["Fachada", "entrega final"], width: 4000, height: 3000 });
    expect(again.entries.some((e) => e.name === "planta.dxf")).toBe(false);
    // A file that changed keeps its marks, but its size in pixels must be read again.
    const edited = scan(c, [{ ...files[1], size: 1 }], "Entrega").catalog.entries[0];
    expect(edited).toMatchObject({ rating: 4, width: null });
    // Adding files keeps the ones already there.
    expect(scan(c, [{ path: "otra.png", size: 1, modified: 1 }], null, true).catalog.entries).toHaveLength(5);
  });

  it("clamps ratings, ignores unknown labels and merges keywords", () => {
    let c = setRating(scanned(), ["Entrega/memoria.pdf"], 9);
    c = setLabel(c, ["Entrega/memoria.pdf"], "fucsia" as never);
    c = addTags(c, ["Entrega/memoria.pdf", "Entrega/planos/planta.dxf"], ["entrega"]);
    c = addTags(c, ["Entrega/memoria.pdf"], ["Entrega", "texto"]);
    const pdf = c.entries.find((e) => e.name === "memoria.pdf")!;
    expect(pdf).toMatchObject({ rating: 5, label: null, tags: ["entrega", "texto"] });
    expect(parseTags(" a ;b,, A ,c\nd")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("Archivo: finding files", () => {
  it("searches names, folders and keywords, filters and sorts", () => {
    let c = setRating(scanned(), ["Entrega/fotos/fachada.JPG"], 4);
    c = setTags(c, ["Entrega/memoria.pdf"], ["entrega final"]);
    const names = (cat: Catalog) => visible(cat).map((e) => e.name);
    expect(names({ ...c, view: { ...c.view, query: "fotos" } })).toEqual(["fachada.JPG", "IMG_0042.NEF"]);
    expect(names({ ...c, view: { ...c.view, query: "FINAL" } })).toEqual(["memoria.pdf"]);
    expect(names({ ...c, view: { ...c.view, minRating: 3 } })).toEqual(["fachada.JPG"]);
    expect(names({ ...c, view: { ...c.view, kind: "cad" } })).toEqual(["planta.dxf"]);
    expect(names({ ...c, view: { ...c.view, sort: "date" } })).toEqual(["memoria.pdf", "fachada.JPG", "IMG_0042.NEF", "planta.dxf"]);
    expect(names({ ...c, view: { ...c.view, sort: "size" } })[0]).toBe("IMG_0042.NEF");
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(3_500_000)).toBe("3,3 MB");
  });
});

describe("Archivo: batch rename", () => {
  it("fills the pattern, keeps extensions and never repeats a name", () => {
    const list = visible(scanned());
    expect(list.map((e) => e.name)).toEqual(["fachada.JPG", "IMG_0042.NEF", "memoria.pdf", "planta.dxf"]);
    expect(renamePlan(list, "entrega-{n}", 1).map((p) => p.name)).toEqual(["entrega-01.JPG", "entrega-02.NEF", "entrega-03.pdf", "entrega-04.dxf"]);
    expect(renamePlan(list, "obra", 1).map((p) => p.name)).toEqual(["obra.JPG", "obra.NEF", "obra.pdf", "obra.dxf"]);
    expect(renamePlan([list[3], list[3]], "{nombre}").map((p) => p.name)).toEqual(["planta.dxf", "planta (2).dxf"]);
    expect(renamePlan([list[2]], "{fecha} {nombre}")[0].name).toMatch(/^1970-01-1\d memoria\.pdf$/);
    expect(safeName("a<b>:c\"d/e\\f|g?h*  . ")).toBe("a-b--c-d-e-f-g-h-");
    expect(safeName("CON")).toBe("_CON");
    expect(safeName("   ")).toBe("archivo");
  });
});

describe("Archivo: saved catalog", () => {
  it("restores a valid catalog and drops what does not fit", () => {
    const c = setRating(scanned(), ["Entrega/memoria.pdf"], 3);
    const saved = JSON.parse(JSON.stringify({ ...c, view: { ...c.view, sort: "rating", kind: "pdf" } }));
    expect(parseCatalog(saved)).toEqual({ ...c, view: { ...c.view, sort: "rating", kind: "pdf" } });
    const broken = parseCatalog({
      folder: 5,
      view: { sort: "evil", minRating: 9, label: "x", kind: "nope" },
      entries: [
        saved.entries[0], saved.entries[0], { path: "a.jpg", size: -1, modified: 0 },
        { path: "b.jpg", size: 1, modified: 1, rating: 7, label: "rojo", tags: ["x", 3] },
      ],
    });
    expect(broken.folder).toBeNull();
    expect(broken.view).toEqual(newCatalog().view);
    expect(broken.entries.map((e) => [e.name, e.rating, e.label, e.tags])).toEqual([["planta.dxf", 0, null, []], ["b.jpg", 0, "rojo", ["x"]]]);
    expect(parseCatalog("x")).toEqual(newCatalog());
  });
});

describe("ZIP for renamed copies", () => {
  it("computes the standard CRC-32, also in chunks", () => {
    const data = new TextEncoder().encode("123456789");
    expect(crc32(data)).toBe(0xcbf43926);
    expect(crc32(data.subarray(4), crc32(data.subarray(0, 4)))).toBe(0xcbf43926);
  });

  it("lays out local headers, a central directory and the end record", () => {
    const a = new TextEncoder().encode("hola");
    const b = new Uint8Array([1, 2, 3]);
    const when = new Date(2026, 10, 7, 15, 30, 10);
    const { local, end } = zipLayout([
      { name: "año/fachada.jpg", size: a.length, crc: crc32(a), modified: when },
      { name: "b.bin", size: b.length, crc: crc32(b), modified: new Date(1970, 0, 1) },
    ]);
    const parts = [local[0], a, local[1], b, end];
    const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      zip.set(p, at);
      at += p.length;
    }
    const v = new DataView(zip.buffer);
    // Walk the local entries the way an unzip program does.
    const names: string[] = [];
    let offset = 0;
    while (v.getUint32(offset, true) === 0x04034b50) {
      expect(v.getUint16(offset + 6, true) & 0x0800).toBe(0x0800);
      const size = v.getUint32(offset + 18, true);
      const nameLength = v.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
      const data = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
      expect(crc32(data)).toBe(v.getUint32(offset + 14, true));
      names.push(name);
      offset += 30 + nameLength + size;
    }
    expect(names).toEqual(["año/fachada.jpg", "b.bin"]);
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    expect(v.getUint32(eocd + 16, true)).toBe(offset);
    expect(v.getUint32(offset, true)).toBe(0x02014b50);
    // DOS date and time of the first entry: 2026-11-07 15:30:10.
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 7);
    expect(v.getUint16(10, true)).toBe((15 << 11) | (30 << 5) | 5);
  });
});
