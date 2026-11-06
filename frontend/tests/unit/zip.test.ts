import { describe, expect, it } from "vitest";
import { crc32, makeZip, safeName } from "../../src/core/zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Reads a ZIP back by its central directory, as unzip tools do (APPNOTE 4.3). */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; utf8: boolean }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localName = view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(local + 30 + localName, local + 30 + localName + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data, utf8: (flags & 0x0800) !== 0 });
    at += 46 + nameLength;
  }
  return out;
}

describe("ZIP export", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes entries that read back exactly, with UTF-8 names", () => {
    const binary = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    const zip = makeZip([
      { name: "LEEME.txt", data: enc.encode("Hola") },
      { name: "proyectos/año-diseño-ñandú.json", data: enc.encode("{\"a\":1}") },
      { name: "foto.webp", data: binary, date: new Date(2026, 10, 6, 14, 30, 10) },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["LEEME.txt", "proyectos/año-diseño-ñandú.json", "foto.webp"]);
    expect(entries.every((e) => e.utf8)).toBe(true);
    expect(dec.decode(entries[0].data)).toBe("Hola");
    expect(entries[2].data).toEqual(binary);
  });

  it("never lets a name climb out of the folder or use characters some systems reject", () => {
    expect(safeName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeName("..\\windows\\system32")).toBe("windows/system32");
    expect(safeName("a:b*c?.txt")).toBe("a_b_c_.txt");
    expect(safeName("")).toBe("archivo");
  });
});
