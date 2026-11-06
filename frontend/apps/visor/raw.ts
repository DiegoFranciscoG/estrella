/**
 * Camera RAW preview. Every common RAW format stores one or more ready JPG previews next to the
 * sensor data; the largest is usually full size. Finding it needs no decoder and no library:
 * the JPG structure is walked marker by marker, so stray FF D8 bytes inside sensor data are
 * rejected instead of being taken as an image.
 */

export interface JpegPreview {
  start: number;
  end: number;
  width: number;
  height: number;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Returns the JPG that starts at `start`, or null if the bytes there are not a complete JPG. */
export function readJpeg(bytes: Uint8Array, start: number): JpegPreview | null {
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return null;
  let i = start + 2;
  let width = 0;
  let height = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; } // Fill byte.
    if (marker === 0xd9) return null; // End before any image data.
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (SOF.has(marker) && i + 9 <= bytes.length) {
      height = (bytes[i + 5] << 8) | bytes[i + 6];
      width = (bytes[i + 7] << 8) | bytes[i + 8];
    }
    if (marker === 0xda) {
      // Entropy-coded data: FF is followed by 00 (stuffing) or a restart marker until the end marker.
      let j = i + 2 + length;
      for (; j + 1 < bytes.length; j++) {
        if (bytes[j] !== 0xff) continue;
        const next = bytes[j + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j++; continue; }
        if (next !== 0xff) break;
      }
      if (j + 1 >= bytes.length) return null; // Truncated.
      if (bytes[j + 1] === 0xd9) return width && height ? { start, end: j + 2, width, height } : null;
      i = j; // Progressive JPGs carry more segments (DHT, SOS) between scans.
      continue;
    }
    i += 2 + length;
  }
  return null;
}

/** Finds the largest complete JPG embedded in a RAW file. */
export function largestPreview(bytes: Uint8Array): JpegPreview | null {
  let best: JpegPreview | null = null;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    const found = readJpeg(bytes, i);
    if (!found) continue;
    if (!best || found.width * found.height > best.width * best.height) best = found;
    i = found.end - 1; // A preview's own thumbnail lives inside it; skip past.
  }
  return best;
}
