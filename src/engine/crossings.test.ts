import { expect, it } from 'vitest';
import { resolveCrossings } from './crossings';
import { distanceTransform, skeletonPaths, thin } from './lineart';
import type { Vec } from './types';
import { segDist } from './vec';

type Segment = [Vec, Vec, number];

function trace(segments: Segment[]) {
  const size = 200;
  const mask = Uint8Array.from({ length: size * size }, (_, i) => {
    const p: Vec = [i % size + 0.5, Math.floor(i / size) + 0.5];
    return Number(segments.some(([a, b, radius]) => segDist(p, a, b) <= radius));
  });
  const runs = skeletonPaths(thin(mask, size, size), size, size, 3);
  return resolveCrossings(runs, mask, distanceTransform(mask, size, size), size, 8);
}

it.each([1, -1])('mantiene cada eje al atravesar dos cruces oblicuos (sentido %i)', sign => {
  const x = (y: number) => 100 + sign * (y - 100) / 3;
  const segments: Segment[] = [
    [[x(12), 12], [x(188), 188], 5],
    [[20, 58], [180, 70], 4],
    [[20, 123], [180, 135], 4],
  ];
  const paths = trace(segments);
  expect(paths).toHaveLength(3);
  for (const [a, b] of segments) {
    const path = paths.find(p => [p[0], p[p.length - 1]].every(v => segDist(v, a, b) < 2));
    expect(path).toBeDefined();
    expect(Math.max(...path!.map(p => segDist(p, a, b)))).toBeLessThan(2);
  }
});

it('conserva los tres brazos de una T y un trazo vecino separado', () => {
  const paths = trace([[[20, 90], [180, 90], 4], [[100, 90], [100, 180], 4], [[20, 75], [180, 75], 4]]);
  expect(paths).toHaveLength(4);
  expect(paths.filter(p => [p[0], p[p.length - 1]].some(([x, y]) => Math.hypot(x - 100, y - 90) < 4))).toHaveLength(3);
});
