import type { RasterImage } from '../../engine';

const SIZE = 360;

/**
 * Precisión visual: porcentaje de píxeles cuyo color vectorizado coincide con el original
 * (diferencia RGB media < 8%). Se calcula rasterizando el SVG en un lienzo reducido.
 */
export async function measureAccuracy(svg: string, src: RasterImage): Promise<number> {
  const s = Math.min(1, SIZE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const a = await rasterize(new Blob([svg], { type: 'image/svg+xml' }), w, h);
  const b = await rasterizeRaster(src, w, h);
  let ok = 0, tot = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (b[p + 3] < 128 && a[p + 3] < 128) { ok++; tot++; continue; }
    tot++;
    const d = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) + Math.abs(a[p + 3] - b[p + 3]);
    if (d < 0.08 * 255 * 3) ok++;
  }
  return tot ? ok / tot : 0;
}

async function rasterize(blob: Blob, w: number, h: number) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterizeRaster(src: RasterImage, w: number, h: number) {
  const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h).data;
}
