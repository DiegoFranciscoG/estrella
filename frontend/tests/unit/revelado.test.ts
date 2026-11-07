import { describe, expect, it } from "vitest";
import { cropFor, develop, histogram, NEUTRAL, outputSize, parseSettings, type Settings } from "../../apps/revelado/develop";

/** One RGBA pixel per color given. */
function pixels(...colors: [number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
}
const at = (data: Uint8ClampedArray, i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const with_ = (change: Partial<Settings>): Settings => ({ ...NEUTRAL, ...change });

describe("Revelado development", () => {
  const photo = pixels([40, 60, 90], [128, 128, 128], [200, 150, 100], [250, 250, 250]);

  it("leaves the photo untouched with neutral settings and keeps alpha", () => {
    const src = photo.slice();
    src[3] = 77;
    expect(Array.from(develop(src, NEUTRAL))).toEqual(Array.from(src));
  });

  it("brightens with exposure and darkens below zero", () => {
    expect(luma(at(develop(photo, with_({ exposure: 1 })), 1))).toBeGreaterThan(165);
    expect(luma(at(develop(photo, with_({ exposure: -1 })), 1))).toBeLessThan(100);
  });

  it("warms and cools with temperature, and moves green with tint", () => {
    const [r1, , b1] = at(develop(photo, with_({ temperature: 60 })), 1);
    expect(r1).toBeGreaterThan(b1);
    const [r2, , b2] = at(develop(photo, with_({ temperature: -60 })), 1);
    expect(b2).toBeGreaterThan(r2);
    const [, g3] = at(develop(photo, with_({ tint: 60 })), 1);
    expect(g3).toBeLessThan(128);
  });

  it("removes color with saturation −100 and with black and white", () => {
    for (const s of [with_({ saturation: -100 }), with_({ bw: true })]) {
      const [r, g, b] = at(develop(photo, s), 2);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
    }
  });

  it("separates darks and lights with contrast, and lifts darks with shadows", () => {
    const strong = develop(photo, with_({ contrast: 60 }));
    expect(luma(at(strong, 0))).toBeLessThan(luma(at(photo, 0)));
    expect(luma(at(strong, 3))).toBeGreaterThanOrEqual(luma(at(photo, 3)));
    expect(luma(at(develop(photo, with_({ shadows: 100 })), 0))).toBeGreaterThan(luma(at(photo, 0)));
    expect(luma(at(develop(photo, with_({ highlights: -100 })), 2))).toBeLessThan(luma(at(photo, 2)));
  });

  it("boosts dull colors more than vivid ones with vibrance", () => {
    const src = pixels([120, 128, 136], [255, 0, 0]);
    const out = develop(src, with_({ vibrance: 100 }));
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(at(out, 0))).toBeGreaterThan(spread(at(src, 0)) * 1.5);
    expect(at(out, 1)).toEqual([255, 0, 0]);
  });

  it("counts every pixel in the histogram", () => {
    const bins = histogram(photo);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(4);
    expect(bins[128]).toBe(1);
  });
});

describe("Revelado geometry and saved settings", () => {
  it("swaps sides when turned and keeps the crop's fraction", () => {
    expect(outputSize(4000, 3000, with_({ rotate: 90 }))).toEqual({ w: 3000, h: 4000 });
    expect(outputSize(4000, 3000, with_({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }))).toEqual({ w: 2000, h: 1500 });
  });

  it("draws a crop of a fixed aspect, whichever way the drag goes", () => {
    const square = cropFor(1, 4 / 3, [0.8, 0.8], [0.2, 0.3]);
    expect((square.w * 4) / 3 / square.h).toBeCloseTo(1, 5);
    expect(square.x + square.w).toBeCloseTo(0.8, 5);
    const free = cropFor(null, 1, [0.1, 0.2], [0.6, 0.9]);
    expect(free).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: expect.closeTo(0.7, 5) });
  });

  it("keeps saved values inside their ranges and ignores anything else", () => {
    const s = parseSettings({ exposure: 9, contrast: -500, temperature: 20, rotate: 45, bw: "yes", crop: { x: -1, y: 0.5, w: 3, h: 0.25 }, evil: "<script>" });
    expect(s).toMatchObject({ exposure: 3, contrast: -100, temperature: 20, rotate: 0, bw: false, crop: { x: 0, y: 0.5, w: 1, h: 0.25 } });
    expect(s).not.toHaveProperty("evil");
    expect(parseSettings(null)).toEqual(NEUTRAL);
  });
});
