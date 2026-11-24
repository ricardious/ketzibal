import type { BezierPath, Layer, Vec } from './types';
import { dist } from './vec';

function reverse(path: BezierPath): BezierPath {
  const starts = [path.start, ...path.segs.map(s => s.p)];
  return { start: starts[starts.length - 1], segs: path.segs.map((s, i) => ({ ...s, p: starts[i], c1: s.c2, c2: s.c1 })).reverse() };
}

/** Mantiene la posición en el lienzo y une extremos que ya se tocan. */
export function joinStrokes(primary: Layer, members: Layer[]): Layer {
  const paths: BezierPath[] = [];
  for (const l of members) {
    if (l.shape.type !== 'strokes') continue;
    const offset = ([x, y]: Vec): Vec => [x + l.dx - primary.dx, y + l.dy - primary.dy];
    for (const p of l.shape.paths) paths.push({ ...p, start: offset(p.start), segs: p.segs.map(s => ({ ...s, p: offset(s.p), c1: offset(s.c1), c2: offset(s.c2) })) });
  }
  for (;;) {
    let best = primary.stroke!.width * 0.5;
    let pair: { i: number; j: number; flipA: boolean; flipB: boolean } | undefined;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i], b = paths[j];
      if (a.closed || b.closed || !a.segs.length || !b.segs.length) continue;
      for (const flipA of [false, true]) for (const flipB of [false, true]) {
        const d = dist(flipA ? a.start : a.segs[a.segs.length - 1].p, flipB ? b.segs[b.segs.length - 1].p : b.start);
        if (d <= best) { best = d; pair = { i, j, flipA, flipB }; }
      }
    }
    if (!pair) break;
    const { i, j, flipA, flipB } = pair;
    const a = flipA ? reverse(paths[i]) : paths[i], b = flipB ? reverse(paths[j]) : paths[j];
    const end = a.segs[a.segs.length - 1].p;
    const bridge = best > 0.01 ? [{ line: true, c1: end, c2: b.start, p: b.start }] : [];
    paths[i] = { start: a.start, segs: [...a.segs, ...bridge, ...b.segs] };
    paths.splice(j, 1);
  }
  const shape = { type: 'strokes' as const, paths };
  return { ...primary, shape, freeform: shape, area: members.reduce((a, l) => a + l.area, 0) };
}
