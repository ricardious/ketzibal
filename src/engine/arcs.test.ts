import { expect, it } from 'vitest';
import { fitClippedCircle } from './arcs';
import { sampleLoop } from './curve';
import { inPolygon } from './vec';

it('completa dos arcos desde la zona expuesta detrás de oclusiones laterales', () => {
  const w = 201, h = 121;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inLens = Math.hypot(x - 100, y - 113) <= 98 && Math.hypot(x - 100, y + 130) <= 240;
    const hidden = Math.abs(x - 100) > 39 && Math.abs(x - 100) < 83 && y < 77;
    data[y * w + x] = Number(inLens && !hidden);
  }
  const loop = fitClippedCircle({ w, h, ox: 0, oy: 0, data }, 1);
  expect(loop).not.toBeNull();
  const boundary = sampleLoop(loop!);
  expect(inPolygon([155, 62], boundary)).toBe(true);
  expect(inPolygon([100, 115], boundary)).toBe(false);
  expect(loop!.segs.length).toBeLessThanOrEqual(4);
});
