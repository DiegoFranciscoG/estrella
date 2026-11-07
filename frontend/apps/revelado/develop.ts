/**
 * Revelado's photo development: pure functions over RGBA pixels, shared by the live preview and
 * the full-size export (in a worker). Exposure and white balance act on linear light, as a camera
 * sensor sees it; tone and color act on the perceptual (sRGB) values the eye compares.
 */

export interface Crop { x: number; y: number; w: number; h: number }

export interface Settings {
  v: 1;
  /** Stops of light, −3 to +3. */
  exposure: number;
  /** The rest go from −100 to +100. */
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  bw: boolean;
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  /** Fractions of the rotated image; null keeps it whole. */
  crop: Crop | null;
}

export const NEUTRAL: Settings = {
  v: 1, exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0,
  bw: false, rotate: 0, flip: false, crop: null,
};

export const SLIDERS = ["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance"] as const;
export type Slider = (typeof SLIDERS)[number];

export function range(key: Slider): [number, number] {
  return key === "exposure" ? [-3, 3] : [-100, 100];
}

/** Reads saved settings, keeping each value inside its range; anything unreadable is neutral. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Settings = { ...NEUTRAL };
  for (const key of SLIDERS) {
    const value = r[key];
    const [min, max] = range(key);
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.min(max, Math.max(min, value));
  }
  out.bw = r.bw === true;
  out.flip = r.flip === true;
  out.rotate = [0, 90, 180, 270].includes(r.rotate as number) ? (r.rotate as Settings["rotate"]) : 0;
  const c = r.crop as Record<string, unknown> | null | undefined;
  if (c && [c.x, c.y, c.w, c.h].every((n) => typeof n === "number" && Number.isFinite(n))) {
    const x = Math.min(1, Math.max(0, c.x as number));
    const y = Math.min(1, Math.max(0, c.y as number));
    const w = Math.min(1 - x, Math.max(0, c.w as number));
    const h = Math.min(1 - y, Math.max(0, c.h as number));
    out.crop = w > 0.001 && h > 0.001 ? { x, y, w, h } : null;
  }
  return out;
}

/** True when the tone and color settings change nothing (geometry aside). */
export function neutralTone(s: Settings): boolean {
  return SLIDERS.every((k) => s[k] === 0) && !s.bw;
}

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const GAMMA_STEPS = 4096;
const TO_GAMMA = new Float32Array(GAMMA_STEPS + 1);
for (let i = 0; i <= GAMMA_STEPS; i++) {
  const c = i / GAMMA_STEPS;
  TO_GAMMA[i] = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function gamma(linear: number): number {
  if (linear <= 0) return 0;
  if (linear >= 1) return 1;
  return TO_GAMMA[Math.round(linear * GAMMA_STEPS)];
}

/** Develops RGBA pixels into `out` (a new array if omitted); alpha is kept. */
export function develop(src: Uint8ClampedArray, s: Settings, out = new Uint8ClampedArray(src.length)): Uint8ClampedArray {
  if (neutralTone(s)) {
    out.set(src);
    return out;
  }
  const exposure = 2 ** s.exposure;
  const t = s.temperature / 100;
  const tint = s.tint / 100;
  const gr = exposure * (1 + 0.25 * t);
  const gg = exposure * (1 - 0.2 * tint);
  const gb = exposure * (1 - 0.25 * t);
  const contrast = 1 + s.contrast / 100;
  const shadows = s.shadows / 100;
  const highlights = s.highlights / 100;
  const saturation = 1 + s.saturation / 100;
  const vibrance = s.vibrance / 100;
  for (let i = 0; i < src.length; i += 4) {
    let r = gamma(TO_LINEAR[src[i]] * gr);
    let g = gamma(TO_LINEAR[src[i + 1]] * gg);
    let b = gamma(TO_LINEAR[src[i + 2]] * gb);
    let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if ((shadows || highlights) && l > 1e-4) {
      // Lift or deepen darks and lights by luminance, scaling the three channels alike so hue stays.
      const target = l + shadows * 0.5 * l * (1 - l) * (1 - l) + highlights * 0.5 * l * l * (1 - l);
      const k = target / l;
      r *= k;
      g *= k;
      b *= k;
      l = target;
    }
    if (contrast !== 1) {
      r = 0.5 + (r - 0.5) * contrast;
      g = 0.5 + (g - 0.5) * contrast;
      b = 0.5 + (b - 0.5) * contrast;
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    let colorful = saturation;
    if (vibrance) {
      // Vibrance favors the dull colors and spares the ones already saturated.
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      colorful *= 1 + vibrance * (1 - Math.min(1, spread));
    }
    if (s.bw) colorful = 0;
    if (colorful !== 1) {
      r = l + (r - l) * colorful;
      g = l + (g - l) * colorful;
      b = l + (b - l) * colorful;
    }
    out[i] = r * 255 + 0.5;
    out[i + 1] = g * 255 + 0.5;
    out[i + 2] = b * 255 + 0.5;
    out[i + 3] = src[i + 3];
  }
  return out;
}

/** Luminance histogram, 256 bins. */
export function histogram(data: Uint8ClampedArray): Uint32Array {
  const bins = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    bins[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
  }
  return bins;
}

/** Size of the developed image: rotation swaps the sides, the crop keeps its fraction. */
export function outputSize(width: number, height: number, s: Settings): { w: number; h: number } {
  const turned = s.rotate === 90 || s.rotate === 270;
  const w = turned ? height : width;
  const h = turned ? width : height;
  if (!s.crop) return { w, h };
  return { w: Math.max(1, Math.round(w * s.crop.w)), h: Math.max(1, Math.round(h * s.crop.h)) };
}

/** A crop of the given aspect (width/height), as large as fits, centered on (cx, cy). */
export function cropFor(aspect: number | null, imageAspect: number, from: [number, number], to: [number, number]): Crop {
  let x = Math.min(from[0], to[0]);
  let y = Math.min(from[1], to[1]);
  let w = Math.abs(to[0] - from[0]);
  let h = Math.abs(to[1] - from[1]);
  if (aspect) {
    // Fractions of a rotated image of aspect `imageAspect`: compare real proportions.
    const real = (w * imageAspect) / Math.max(h, 1e-9);
    if (real > aspect) w = (h * aspect) / imageAspect;
    else h = (w * imageAspect) / aspect;
    if (to[0] < from[0]) x = from[0] - w;
    if (to[1] < from[1]) y = from[1] - h;
  }
  x = Math.min(Math.max(0, x), 1);
  y = Math.min(Math.max(0, y), 1);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}
