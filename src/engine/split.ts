import paper from 'paper';
import { shapeToD } from './svg';
import type { BezierPath, Layer, Shape, Vec } from './types';

function subpaths(item: paper.PathItem): paper.Path[] {
  return item instanceof paper.Path ? [item] : item.children as paper.Path[];
}

function geometry(path: paper.Path): BezierPath {
  const point = (p: paper.Point): Vec => [p.x, p.y];
  return {
    start: point(path.firstSegment.point), closed: path.closed,
    segs: path.curves.map(c => ({
      c1: point(c.point1.add(c.handle1)), c2: point(c.point2.add(c.handle2)),
      p: point(c.point2), line: c.isStraight(),
    })),
  };
}

function splitStrokes(source: paper.PathItem, a: paper.Point, b: paper.Point, normal: paper.Point) {
  const line = new paper.Path.Line(a, b);
  const halves: paper.Path[][] = [[], []];
  for (const path of [...subpaths(source)]) {
    const offsets = path.getIntersections(line).map(hit => hit.offset).sort((x, y) => y - x);
    if (path.closed && offsets.length) path.splitAt(0);
    const fragments = [path];
    for (const offset of offsets) {
      if (offset < 1e-6 || offset >= path.length - 1e-6) continue;
      const fragment = path.splitAt(offset);
      if (fragment) fragments.push(fragment);
    }
    for (const fragment of fragments) {
      if (!fragment.length) continue;
      const mid = fragment.getPointAt(fragment.length / 2);
      halves[mid.subtract(a).dot(normal) >= 0 ? 0 : 1].push(fragment);
    }
  }
  return halves;
}

/** La recta separa los dos lados incluso cuando la capa contiene trazos desconectados. */
export function splitLayer(layer: Layer, start: Vec, end: Vec): Layer[] | null {
  if (layer.kind === 'background' || Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.001) return null;
  const project = new paper.Project(new paper.Size(1, 1));
  try {
    const stroke = layer.shape.type === 'strokes';
    const item = (shapes: Shape[]) => paper.PathItem.create(shapes.map(s => shapeToD(s, 6)).join(''));
    let source: paper.PathItem = item([layer.shape, ...layer.holes]);
    if (!stroke) {
      source.fillRule = 'evenodd';
      source.reorient(false, true);
      if (layer.kind === 'clipped-circle') source = source.intersect(item([layer.freeform, ...layer.holes]));
    }
    const from = new paper.Point(start[0] - layer.dx, start[1] - layer.dy);
    const dir = new paper.Point(end[0] - start[0], end[1] - start[1]).normalize();
    const normal = new paper.Point(-dir.y, dir.x);
    const bounds = source.bounds;
    const extent = from.getDistance(bounds.center) + bounds.width + bounds.height + 2;
    const a = from.subtract(dir.multiply(extent)), b = from.add(dir.multiply(extent));
    const halves = stroke ? splitStrokes(source, a, b, normal) : null;
    const pieces: Layer[] = [];
    for (const side of [1, -1]) {
      const shift = normal.multiply(extent * side);
      const half = new paper.Path({ segments: [a, b, b.add(shift), a.add(shift)], closed: true });
      const paths = (halves ? halves[pieces.length] : subpaths(source.intersect(half)))
        .filter(p => p.curves.length && (stroke ? p.length > 0.001 : Math.abs(p.area) > 0.001))
        .sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
      if (!paths.length) return null;
      const loops = paths.map(geometry);
      const shape: Shape = stroke ? { type: 'strokes', paths: loops } : { type: 'path', loop: loops[0] };
      const holes: Shape[] = stroke ? [] : loops.slice(1).map(loop => ({ type: 'path', loop }));
      pieces.push({
        ...layer, id: pieces.length ? crypto.randomUUID() : layer.id, name: `${layer.name} · ${pieces.length + 1}`,
        kind: stroke ? 'stroke' : 'path', shape, freeform: shape, holes, recognized: undefined,
        reconstructed: false, symmetry: null, fitError: 0,
        area: stroke ? paths.reduce((sum, p) => sum + p.length, 0) * (layer.stroke?.width ?? 1) : Math.abs(paths.reduce((sum, p) => sum + p.area, 0)),
      });
    }
    return pieces;
  } finally {
    project.remove();
  }
}
