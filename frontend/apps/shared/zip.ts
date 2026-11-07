/**
 * ZIP archives without compression ("store", APPNOTE 6.3.x): enough to hand back copies of the
 * student's files with new names. The file contents are never copied into memory twice: the
 * caller puts each File between the headers built here and lets the browser assemble the Blob.
 * Limits of the classic format (no ZIP64): fewer than 65 535 entries and under 4 GB in total.
 */

export const MAX_ENTRIES = 65_534;
export const MAX_TOTAL = 0xfffffffe;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO 3309), resumable: pass the previous result to continue over the next chunk. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; size: number; crc: number; modified: Date }

/** MS-DOS time and date fields; the format cannot store dates before 1980. */
function dos(date: Date): { time: number; day: number } {
  const d = date.getFullYear() < 1980 ? new Date(1980, 0, 1) : date;
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    day: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * The bytes around each file: `local[i]` goes right before file i, `end` after the last one.
 * Names are written as UTF-8 (general purpose flag bit 11), so accents survive.
 */
export function zipLayout(entries: ZipEntry[]): { local: Uint8Array[]; end: Uint8Array } {
  if (entries.length > MAX_ENTRIES) throw new Error("too many entries");
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.name);
    const { time, day } = dos(e.modified);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, time, true);
    h.setUint16(12, day, true);
    h.setUint32(14, e.crc, true);
    h.setUint32(18, e.size, true);
    h.setUint32(22, e.size, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    head.set(name, 30);
    local.push(head);

    const dir = new Uint8Array(46 + name.length);
    const c = new DataView(dir.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.size, true);
    c.setUint32(24, e.size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);

    offset += head.length + e.size;
    if (offset > MAX_TOTAL) throw new Error("too large");
  }
  const size = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(size + 22);
  let at = 0;
  for (const d of central) {
    end.set(d, at);
    at += d.length;
  }
  const v = new DataView(end.buffer);
  v.setUint32(at, 0x06054b50, true);
  v.setUint16(at + 8, entries.length, true);
  v.setUint16(at + 10, entries.length, true);
  v.setUint32(at + 12, size, true);
  v.setUint32(at + 16, offset, true);
  return { local, end };
}
