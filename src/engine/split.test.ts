import { describe, expect, it } from 'vitest';
import { splitLayer } from './split';
import type { Layer, Shape, Vec } from './types';

function layer(shape: Shape, holes: Shape[] = []): Layer {
  return { id: 'pieza', name: 'Pieza', kind: shape.type === 'strokes' ? 'stroke' : 'path', shape, freeform: shape, holes,
    dx: 40, dy: 10, fill: '#abcd00', stroke: { color: '#000000', width: 2 }, visible: true, opacity: 0.8,
    area: 0, depth: 0, parentId: null, symmetry: null, reconstructed: false, fitError: 0 };
}
describe('división en dos capas', () => {
  it('conserva el hueco, el desplazamiento y el área', () => {
    const ring = layer({ type: 'circle', cx: 0, cy: 0, r: 30 }, [{ type: 'circle', cx: -15, cy: 0, r: 5 }]);
    const pieces = splitLayer(ring, [40, -40], [40, 50])!;
    expect(pieces).toHaveLength(2);
    expect(pieces.map(p => p.holes.length).sort()).toEqual([0, 1]);
    expect(Math.abs(pieces.reduce((n, p) => n + p.area, 0) - Math.PI * 875)).toBeLessThan(2);
    expect(splitLayer(ring, [100, -40], [100, 50])).toBeNull();
  });
  it('mantiene trazos abiertos como curvas vectoriales y separa subtrazos desconectados', () => {
    const path = (y: number) => ({ start: [0, y] as Vec, segs: [{ c1: [10, y - 2] as Vec, c2: [20, y + 2] as Vec, p: [30, y] as Vec }] });
    const lines = layer({ type: 'strokes', paths: [path(0), path(20)] });
    for (const x of [true, false]) {
      const pieces = x ? splitLayer(lines, [55, -10], [55, 40]) : splitLayer(lines, [30, 20], [80, 20]);
      expect(pieces).toHaveLength(2);
      for (const p of pieces!) {
        if (p.shape.type !== 'strokes') throw Error('Se esperaba un trazo');
        expect(p.shape.paths).toHaveLength(x ? 2 : 1);
        expect(p.shape.paths.every(s => !s.closed)).toBe(true);
      }
    }
  });
});
