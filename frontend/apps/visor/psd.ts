/**
 * PSD reader (ag-psd, MIT). Most files store a flattened copy of the image ("maximize
 * compatibility"); it is shown as is, so effects and blend modes look right. Files saved without
 * it are rebuilt by stacking the visible layers with normal blending, and the student is told
 * that effects may differ.
 */
import { readPsd, type Layer } from "ag-psd";

export interface PsdLayer { name: string; visible: boolean; depth: number }

export interface PsdResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  layers: PsdLayer[];
  rebuilt: boolean;
}

export function listLayers(children: Layer[] | undefined, depth = 0, out: PsdLayer[] = []): PsdLayer[] {
  // PSD files list layers bottom to top; a layer panel shows them top to bottom.
  for (const layer of [...(children ?? [])].reverse()) {
    out.push({ name: layer.name ?? "Capa", visible: !layer.hidden, depth });
    if (layer.children) listLayers(layer.children, depth + 1, out);
  }
  return out;
}

function drawLayers(ctx: CanvasRenderingContext2D, children: Layer[] | undefined, parentOpacity = 1): void {
  for (const layer of children ?? []) {
    if (layer.hidden) continue;
    const opacity = parentOpacity * (layer.opacity ?? 1);
    if (layer.children) {
      drawLayers(ctx, layer.children, opacity);
      continue;
    }
    if (!layer.canvas) continue;
    ctx.globalAlpha = opacity;
    ctx.drawImage(layer.canvas, layer.left ?? 0, layer.top ?? 0);
  }
  ctx.globalAlpha = 1;
}

export function openPsd(bytes: Uint8Array): PsdResult {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const flat = readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const layers = listLayers(flat.children);
  if (flat.canvas) return { canvas: flat.canvas, width: flat.width, height: flat.height, layers, rebuilt: false };

  const full = readPsd(buffer, { skipThumbnail: true, skipLinkedFilesData: true });
  const canvas = document.createElement("canvas");
  canvas.width = full.width;
  canvas.height = full.height;
  drawLayers(canvas.getContext("2d")!, full.children);
  return { canvas, width: full.width, height: full.height, layers, rebuilt: true };
}
