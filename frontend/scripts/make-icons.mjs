// Draws the ESTRELLA star into the icons that installers and home screens need: PNG for the web
// app manifest (any and maskable), the Apple touch icon, and the .ico of the Windows app.
// Run with `node scripts/make-icons.mjs` from frontend/ after changing the star; the results are
// committed, so builds need no image tools.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STAR = "M50 4 L61.8 37.6 L97.6 38.2 L69.1 59.9 L79.4 94.1 L50 73.8 L20.6 94.1 L30.9 59.9 L2.4 38.2 L38.2 37.6 Z";
/** Vertical centre of the star's outline (it spans y = 4 to 94.1). */
const STAR_CENTER_Y = 49.05;

/** White star on a black tile. `radius` rounds the tile (0 = full bleed); `scale` sizes the star. */
function svg(size, radius, scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">`
    + `<rect width="100" height="100" rx="${radius}" fill="#111111"/>`
    + `<path d="${STAR}" fill="#ffffff" transform="translate(50 50) scale(${scale}) translate(-50 -${STAR_CENTER_Y})"/></svg>`;
}

const ICONS = [
  // Any purpose: rounded tile, as a launcher shows it.
  { file: "public/icons/icon-192.png", size: 192, radius: 22, scale: 0.72 },
  { file: "public/icons/icon-512.png", size: 512, radius: 22, scale: 0.72 },
  // Maskable: full bleed, star inside the central 80 % safe zone (W3C manifest, icon masks).
  { file: "public/icons/maskable-512.png", size: 512, radius: 0, scale: 0.56 },
  // iOS rounds the corners itself and shows transparency as black.
  { file: "public/icons/apple-touch-icon.png", size: 180, radius: 0, scale: 0.66 },
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICO_FILE = "../desktop/windows/Estrella.Desktop/estrella.ico";

/** ICO with PNG-compressed images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (size, radius, scale) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, radius, scale)}</body></html>`);
    return page.locator("svg").screenshot({ omitBackground: true });
  };
  for (const icon of ICONS) {
    const out = resolve(here, "..", icon.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await render(icon.size, icon.radius, icon.scale));
    console.log(`${icon.file} (${icon.size} px)`);
  }
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(size, 18, 0.74) });
  const out = resolve(here, "..", ICO_FILE);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, ico(images));
  console.log(`${ICO_FILE} (${ICO_SIZES.join(", ")} px)`);
} finally {
  await browser.close();
}
