import { expect, it } from 'vitest';
import { joinStrokes } from './join';
import { bez } from './curve';
import { dist, segDist } from './vec';
import type { Layer, RasterImage, Vec } from './types';

function raster(painted: (p: Vec) => boolean): RasterImage {
  const width = 120, height = 110, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const ink = painted([i % width + 0.5, Math.floor(i / width) + 0.5]);
    data.set(ink ? [50, 25, 15, 255] : [235, 210, 190, 255], i * 4);
  }
  return { width, height, data };
}
function stroke(id: string, a: Vec, b: Vec, dx = 0, dy = 0): Layer {
  const shape = { type: 'strokes' as const, paths: [{ start: a, segs: [{ p: b, c1: a, c2: b, line: true }] }] };
  return { id, name: id, shape, freeform: shape, kind: 'stroke', fill: 'none', stroke: { width: 6, color: '#007700' },
    area: 100, holes: [], dx, dy, opacity: 1, visible: true, depth: 0, parentId: null, reconstructed: false, symmetry: null, fitError: 0 };
}

it('sigue un arco en la imagen aunque el color editado y los desplazamientos difieran', () => {
  const img = raster(p => Math.abs(dist(p, [55, 55]) - 18) <= 3);
  const left = stroke('a', [21, 50], [29.4, 41], 10, 5);
  const right = stroke('b', [72.6, 46], [79, 56], -2, 0);
  const result = joinStrokes(left, [left, right], img);
  expect(result.connections).toBe(1);
  if (result.layer.shape.type !== 'strokes') throw Error('Trazo esperado');
  const path = result.layer.shape.paths[0], bridge = path.segs[1];
  expect(bridge.line).toBeFalsy();
  const midpoint = bez([path.segs[0].p, bridge.c1, bridge.c2, bridge.p], 0.5);
  expect(Math.abs(dist([midpoint[0] + 10, midpoint[1] + 5], [55,55]) - 18)).toBeLessThan(2);
});

it('elige tinta continua y descarta un extremo más próximo en otra línea', () => {
  const img = raster(p => p[1] >= 47 && p[1] < 53 || p[0] >= 49 && p[0] < 55 && p[1] > 58);
  const a = stroke('a', [20,50], [48,50]), b = stroke('b',[70,50],[95,50]), c = stroke('c',[52,60],[52,85]);
  const r = joinStrokes(a, [a,b,c], img);
  expect(r.connections).toBe(1);
  if (r.layer.shape.type !== 'strokes') throw Error('Trazo esperado');
  expect(r.layer.shape.paths[0].segs.at(-1)?.p).toEqual([95,50]);
});

it('agrupa sin pintar sobre un hueco del original', () => {
  const a = stroke('a',[20,50],[40,50]), b = stroke('b',[55,50],[80,50]);
  const img = raster(p => Math.min(segDist(p,[20,50],[40,50]),segDist(p,[55,50],[80,50])) < 3);
  expect(joinStrokes(a, [a,b], img).connections).toBe(0);
});

it('continúa la mejilla a través del bigote sin seguir el escalón del esqueleto', () => {
  const img = raster(p => segDist(p, [17, 15], [91, 91]) <= 3 || Math.abs(p[1] - 52) <= 3);
  const upper = stroke('mejilla-a', [17, 15], [54, 52]);
  const lower = stroke('mejilla-b', [59, 52], [91, 91]);
  const setCurve = (l: Layer, start: Vec, c1: Vec, c2: Vec, p: Vec) => {
    l.shape = { type: 'strokes', paths: [{ start, segs: [{ c1, c2, p }] }] };
  };
  setCurve(upper, [17, 15], [29, 27], [53, 47], [54, 52]);
  setCurve(lower, [59, 52], [60, 58], [79, 78], [91, 91]);
  const middle = stroke('cruce', [54, 52], [59, 52]);
  for (const members of [[upper, lower], [upper, middle, lower]]) {
    const r = joinStrokes(upper, members, img);
    if (r.layer.shape.type !== 'strokes') throw Error('Trazo esperado');
    expect(r.layer.shape.paths).toHaveLength(1);
    const path = r.layer.shape.paths[0];
    expect(path.start).toEqual([17, 15]);
    expect(path.segs.at(-1)?.p).toEqual([91, 91]);
    expect(path.segs.some(s => dist(s.p, [54, 52]) < 0.01 || dist(s.p, [59, 52]) < 0.01)).toBe(false);
  }
});
