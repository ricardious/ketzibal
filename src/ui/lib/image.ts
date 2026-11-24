import type { RasterImage } from '../../engine';

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export interface SourceImage {
  name: string;
  url: string;
  width: number;
  height: number;
  raster: RasterImage;
}

/** Decodifica PNG, JPG o WebP a RGBA en el navegador (sin subir nada a ningún servidor). */
export async function loadImageFile(file: File): Promise<SourceImage> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Formato no admitido. Usa PNG, JPG o WebP.');
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    name: file.name,
    url: URL.createObjectURL(file),
    width: id.width,
    height: id.height,
    raster: { width: id.width, height: id.height, data: id.data },
  };
}
