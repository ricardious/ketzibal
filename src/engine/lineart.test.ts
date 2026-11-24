import { expect, it } from 'vitest';
import { detectBrownInk } from './lineart';
import { vectorize } from './pipeline';
import { DEFAULT_PARAMS } from './types';
import { sampleLoop } from './curve';
import { segDist } from './vec';

it('mantiene los huecos y los extremos de una línea ramificada al separar piezas', () => {
  const width = 160, height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  const inkAt = (x: number, y: number) => {
    const r = Math.hypot(x - 48, y - 50);
    const s = Math.hypot(x - 104, y - 50);
    return (r >= 19 && r <= 24) || (s >= 19 && s <= 24) || (x >= 48 && x <= 146 && Math.abs(y - 50) <= 2);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tone = inkAt(x, y) ? 25 : 248;
    data.set([tone, tone, tone, 255], (y * width + x) * 4);
  }
  const result = vectorize({ width, height, data }, { ...DEFAULT_PARAMS, colors: 2 });
  const pieces = result.layers.filter(l => l.id.startsWith('tinta-'));
  expect(pieces.length).toBeGreaterThan(1);
  const paintedMask = new Uint8Array(width * height);
  for (const piece of pieces) {
    expect(piece.fill).toBe('none');
    if (piece.shape.type !== 'strokes' || !piece.stroke) throw new Error('Se esperaba un trazo SVG con grosor');
    const radius = piece.stroke.width / 2;
    for (const path of piece.shape.paths) {
      const pts = [...sampleLoop(path), path.segs[path.segs.length - 1].p];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius)); y < height && y <= Math.max(a[1], b[1]) + radius; y++) {
          for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius)); x < width && x <= Math.max(a[0], b[0]) + radius; x++) {
            if (segDist([x + 0.5, y + 0.5], a, b) <= radius) paintedMask[y * width + x] = 1;
          }
        }
      }
    }
  }
  let intersection = 0, union = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const painted = paintedMask[y * width + x];
    if (painted && inkAt(x, y)) intersection++;
    if (painted || inkAt(x, y)) union++;
  }
  expect(intersection / union).toBeGreaterThan(0.9);
});

it('separa el marrón del gris aunque compartan una etiqueta de paleta', () => {
  const width = 120, height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const stripe = x >= 10 && x < 110 && y >= 20 && y < 23;
    data.set(stripe ? [47, 26, 22, 255] : [48, 48, 48, 255], (y * width + x) * 4);
  }
  const labels = new Int32Array(width * height);
  const ink = detectBrownInk({ width, height, data }, labels, 1);
  expect(ink?.mask.reduce((a, b) => a + b, 0)).toBe(300);
  expect(ink?.mask[21 * width + 60]).toBe(1);
  expect(ink?.mask[24 * width + 60]).toBe(0);
});
