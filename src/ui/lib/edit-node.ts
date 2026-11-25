import type { BezierPath, Shape, Vec } from '../../engine/types';

export interface CurveNode { loop: number; segment: number; point: 'start' | 'p' | 'c1' | 'c2' }

export function moveNode(shape: Shape, node: CurveNode, delta: Vec): Shape {
  const shift = ([x, y]: Vec): Vec => [x + delta[0], y + delta[1]];
  const i = node.segment;
  if (shape.type === 'circle') {
    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const [x, y] = directions[i];
    return { ...shape, r: Math.max(0.5, shape.r + x * delta[0] + y * delta[1]) };
  }
  if (shape.type === 'ellipse' || shape.type === 'rect') {
    const a = shape.rotation * Math.PI / 180;
    const dx = delta[0] * Math.cos(a) + delta[1] * Math.sin(a);
    const dy = delta[1] * Math.cos(a) - delta[0] * Math.sin(a);
    if (shape.type === 'ellipse') return i % 2 === 0
      ? { ...shape, rx: Math.max(0.5, shape.rx + (i === 0 ? dx : -dx)) }
      : { ...shape, ry: Math.max(0.5, shape.ry + (i === 1 ? dy : -dy)) };
    const w = Math.max(1, shape.w + 2 * (i === 0 || i === 3 ? -dx : dx));
    const h = Math.max(1, shape.h + 2 * (i < 2 ? -dy : dy));
    return { ...shape, w, h, rx: Math.min(shape.rx, w / 2, h / 2) };
  }
  if (shape.type === 'polygon') return { ...shape, points: shape.points.map((p, i) => i === node.segment ? shift(p) : p) };
  if (shape.type !== 'path' && shape.type !== 'strokes') return shape;
  const loops: BezierPath[] = shape.type === 'path' ? [shape.loop] : shape.paths;
  const original = loops[node.loop];
  const loop = { ...original, segs: original.segs.map(s => ({ ...s })) };
  const last = loop.segs.length - 1;
  const closesAtStart = last >= 0 && loop.segs[last].p[0] === loop.start[0] && loop.segs[last].p[1] === loop.start[1];
  if (node.point === 'c1' || node.point === 'c2') {
    const seg = loop.segs[node.segment];
    seg[node.point] = shift(seg[node.point]);
  } else if (node.point === 'start' || (closesAtStart && node.segment === last)) {
    loop.start = shift(loop.start);
    if (last >= 0) loop.segs[0].c1 = shift(loop.segs[0].c1);
    if (closesAtStart) {
      loop.segs[last].p = loop.start;
      loop.segs[last].c2 = shift(loop.segs[last].c2);
    }
  } else {
    const seg = loop.segs[node.segment];
    seg.p = shift(seg.p);
    seg.c2 = shift(seg.c2);
    if (node.segment < last) loop.segs[node.segment + 1].c1 = shift(loop.segs[node.segment + 1].c1);
  }
  return shape.type === 'path' ? { type: 'path', loop } : { type: 'strokes', paths: loops.map((p, i) => i === node.loop ? loop : p) };
}

/** Elimina un ancla y enlaza sus vecinos conservando los controles exteriores. */
export function removeNode(shape: Shape, node: CurveNode): Shape | null {
  if (node.point !== 'start' && node.point !== 'p') return null;
  if (shape.type === 'polygon') {
    if (shape.points.length <= 3 || node.segment < 0 || node.segment >= shape.points.length) return null;
    return { ...shape, points: shape.points.filter((_, i) => i !== node.segment) };
  }
  if (shape.type !== 'path' && shape.type !== 'strokes') return null;
  const original = shape.type === 'path' ? shape.loop : shape.paths[node.loop];
  if (!original || !original.segs.length) return null;
  const loop: BezierPath = { ...original, segs: [...original.segs] };
  const segs = loop.segs;
  const closed = shape.type === 'path' || loop.closed;
  const end = segs[segs.length - 1].p;
  if (closed && (end[0] !== loop.start[0] || end[1] !== loop.start[1])) {
    segs.push({ c1: end, c2: loop.start, p: loop.start, line: true });
  }
  if (segs.length <= (closed ? 3 : 1)) return null;
  let i = node.point === 'start' ? -1 : node.segment;
  if (i >= segs.length || i < -1) return null;
  if (closed && (i === -1 || i === segs.length - 1)) {
    // Mueve el inicio al vecino anterior para tratar el cierre como cualquier ancla.
    loop.start = segs[segs.length - 2].p;
    segs.unshift(segs.pop()!);
    i = 0;
  }
  if (i === -1) loop.start = segs.shift()!.p;
  else if (i === segs.length - 1) segs.pop();
  else {
    const a = segs[i], b = segs[i + 1];
    segs.splice(i, 2, { c1: a.c1, c2: b.c2, p: b.p, line: !!a.line && !!b.line });
  }
  return shape.type === 'path' ? { ...shape, loop }
    : { ...shape, paths: shape.paths.map((p, i) => i === node.loop ? loop : p) };
}
