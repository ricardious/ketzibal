import { bez, bezD1, mapLoop } from './curve';
import type { BezierPath, CubicSeg, Layer, RasterImage, Vec } from './types';
import { add, dist, dot, lerp, norm, scale, sub } from './vec';

export function reverseStroke(path: BezierPath): BezierPath {
  const starts = [path.start, ...path.segs.map(s => s.p)];
  return { start: starts[starts.length - 1], segs: path.segs.map((s, i) => ({ ...s, p: starts[i], c1: s.c2, c2: s.c1 })).reverse() };
}

type Color = [number, number, number, number];
interface End { id: number; member: string; p: Vec; dir: Vec; width: number; color: Color | null }
interface Bridge { a: number; b: number; score: number; segment: CubicSeg | null }

// El alfa premultiplicado distingue la tinta opaca del fondo transparente.
function sample(img: RasterImage, p: Vec, offset: Vec): Color | null {
  const x = Math.floor(p[0] + offset[0]), y = Math.floor(p[1] + offset[1]);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const i = (y * img.width + x) * 4, alpha = img.data[i + 3];
  return [img.data[i] * alpha / 255, img.data[i + 1] * alpha / 255, img.data[i + 2] * alpha / 255, alpha];
}
function difference(a: Color, b: Color) {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

function candidate(a: End, b: End, img: RasterImage, offset: Vec): Bridge | null {
  const gap = dist(a.p, b.p), width = (a.width + b.width) / 2;
  if (gap < 0.01) return { a: a.id, b: b.id, score: -1, segment: null };
  if (gap > Math.min(256, Math.max(8, width * 7)) || !a.color || !b.color) return null;
  const direction = norm(sub(b.p, a.p));
  const alignment = dot(a.dir, direction), arrival = -dot(b.dir, direction);
  if (Math.min(alignment, arrival) < -0.35 || difference(a.color, b.color) > 85) return null;
  let best: Bridge | null = null;
  const evaluate = (c1: Vec, c2: Vec, line: boolean) => {
    const curve = [a.p, c1, c2, b.p];
    const steps = Math.max(4, Math.ceil(gap / Math.max(1, width / 5)));
    let cost = 0, supported = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p = bez(curve, t), tangent = norm(bezD1(curve, t));
      const normal: Vec = [-tangent[1], tangent[0]];
      const center = sample(img, p, offset);
      if (!center || center[3] < 64) return;
      // Comparamos el centro con la tinta original de ambos extremos, y
      // comprobamos los dos bordes para evitar cruzar un relleno uniforme.
      const expected = a.color!.map((v, k) => v + (b.color![k] - v) * t) as Color;
      const delta = difference(center, expected);
      const w = a.width + (b.width - a.width) * t;
      let edges = 0, interior = 0;
      for (const side of [-1, 1]) {
        const inner = sample(img, add(p, scale(normal, side * w * 0.30)), offset);
        const outer = sample(img, add(p, scale(normal, side * (w * 0.7 + 0.5))), offset);
        if (inner) interior += Math.min(1, difference(inner, expected) / 65);
        if (outer) edges += Math.min(1, difference(outer, center) / 45);
      }
      if (delta <= 35 && edges >= 0.45) supported++;
      if (delta > 65) return;
      cost += delta / 45 + interior * 0.3 + (2 - edges) * 0.35;
    }
    if (supported < steps * 0.7) return;
    const curvature = (dist(a.p, c1) + dist(c1, c2) + dist(c2, b.p)) / gap - 1;
    const directionCost = line ? (2 - alignment - arrival) * 0.2 : 0;
    const score = cost / steps + gap / width * 0.09 + curvature * 0.15 + directionCost;
    if (!best || score < best.score) best = { a: a.id, b: b.id, score, segment: { c1, c2, p: b.p, line } };
  };
  evaluate(lerp(a.p, b.p, 1 / 3), lerp(a.p, b.p, 2 / 3), true);
  for (const u of [0.25, 0.55, 0.9]) for (const v of [0.25, 0.55, 0.9]) {
    evaluate(add(a.p, scale(a.dir, u * gap)), add(b.p, scale(b.dir, v * gap)), false);
  }
  return best;
}

type Cubic = [Vec, Vec, Vec, Vec];
type Junction = { from: number; to: number };

function cut(c: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(c[0], c[1], t), b = lerp(c[1], c[2], t), d = lerp(c[2], c[3], t);
  const e = lerp(a, b, t), f = lerp(b, d, t), p = lerp(e, f, t);
  return [[c[0], a, e, p], [p, f, d, c[3]]];
}

/** El esqueleto de un cruce puede contener un escalón corto de la rama
 * transversal. Inferir la continuación desde fuera de la zona compartida. */
function repairCrossings(path: BezierPath, joins: Junction[], width: number, img: RasterImage, offset: Vec): BezierPath {
  if (!joins.length || !path.segs.length) return path;
  const lengths = [0];
  const curves: Cubic[] = path.segs.map((s, i) => {
    const p = i ? path.segs[i - 1].p : path.start;
    return s.line ? [p, lerp(p, s.p, 1 / 3), lerp(p, s.p, 2 / 3), s.p] : [p, s.c1, s.c2, s.p];
  });
  const steps = 20;
  const tables = curves.map(c => {
    const table = [0];
    let prev = c[0];
    for (let i = 1; i <= steps; i++) {
      const p = bez(c, i / steps);
      table.push(table[i - 1] + dist(prev, p)); prev = p;
    }
    lengths.push(lengths[lengths.length - 1] + table[steps]);
    return table;
  });
  const total = lengths[lengths.length - 1];
  const locate = (length: number) => {
    let i = 0;
    while (i < curves.length - 1 && lengths[i + 1] <= length) i++;
    const table = tables[i], local = length - lengths[i];
    let k = 1;
    while (k < steps && table[k] < local) k++;
    const t = (k - 1 + (local - table[k - 1]) / (table[k] - table[k - 1] || 1)) / steps;
    return { i, t: Math.max(0, Math.min(1, t)) };
  };
  const groups: Junction[] = [];
  for (const j of joins) {
    const from = lengths[j.from], to = lengths[j.to];
    if (to - from > width * 1.8) continue;
    const prev = groups[groups.length - 1];
    if (prev && to - prev.from <= width * 1.8) prev.to = to;
    else groups.push({ from, to });
  }
  const result: CubicSeg[] = [];
  const appendRange = (start: number, end: number) => {
    if (end <= start) return;
    const a = locate(start), b = locate(end);
    for (let i = a.i; i <= b.i; i++) {
      const lo = i === a.i ? a.t : 0, hi = i === b.i ? b.t : 1;
      if (hi <= lo + 1e-8) continue;
      if (lo === 0 && hi === 1) { result.push(path.segs[i]); continue; }
      const c = cut(cut(curves[i], hi)[0], lo / hi)[1];
      result.push({ c1: c[1], c2: c[2], p: c[3], line: path.segs[i].line });
    }
  };
  let cursor = 0;
  for (let i = 0; i < groups.length; i++) {
    const { from, to } = groups[i];
    const left = Math.max(from - width * 1.6, (from + (groups[i - 1]?.to ?? 0)) / 2);
    const right = Math.min(to + width * 1.6, (to + (groups[i + 1]?.from ?? total)) / 2);
    if (from - left < width * 0.55 || right - to < width * 0.55) continue;
    const a = locate(left), b = locate(right);
    const p = bez(curves[a.i], a.t), q = bez(curves[b.i], b.t);
    const u = norm(bezD1(curves[a.i], a.t)), v = norm(bezD1(curves[b.i], b.t));
    const chord = norm(sub(q, p)), length = dist(p, q);
    if (dot(u, v) < 0.65 || Math.min(dot(chord, u), dot(chord, v)) < 0.78) continue;
    const arm = length / 3;
    const smooth: Cubic = [p, add(p, scale(u, arm)), add(q, scale(v, -arm)), q];
    const ink = sample(img, p, offset), endInk = sample(img, q, offset);
    if (!ink || !endInk || ink[3] < 128 || difference(ink, endInk) > 40) continue;
    let worstTurn = 1, branched = false, followsInk = true, outlined = 0;
    const samples = Math.max(12, Math.ceil(length / Math.max(1, width / 8)));
    for (let k = 0; k <= samples; k++) {
      const t = k / samples, xy = bez(smooth, t), tangent = norm(bezD1(smooth, t));
      const old = locate(left + (right - left) * t);
      worstTurn = Math.min(worstTurn, dot(tangent, norm(bezD1(curves[old.i], old.t))));
      const center = sample(img, xy, offset);
      if (!center || difference(center, ink) > 50) { followsInk = false; break; }
      const normal: Vec = [-tangent[1], tangent[0]];
      const sides = [-1, 1].map(side => sample(img, add(xy, scale(normal, side * width * 0.78)), offset));
      if (sides.every(s => s && difference(s, ink) < 35)) branched = true;
      if (sides.some(s => s && difference(s, ink) > 40)) outlined++;
    }
    if (!followsInk || !branched || outlined < samples * 0.35 || worstTurn > 0.9) continue;
    appendRange(cursor, left);
    result.push({ c1: smooth[1], c2: smooth[2], p: q });
    cursor = right;
  }
  if (!result.length) return path;
  appendRange(cursor, total);
  return { ...path, segs: result };
}

export function joinStrokes(primary: Layer, members: Layer[], img: RasterImage): { layer: Layer; connections: number } {
  const paths: BezierPath[] = [], ends: End[] = [];
  const offset: Vec = [primary.dx, primary.dy];
  for (const l of members) {
    if (l.shape.type !== 'strokes' || !l.stroke) continue;
    const translate = ([x, y]: Vec): Vec => [x + l.dx - primary.dx, y + l.dy - primary.dy];
    for (const original of l.shape.paths) {
      const path = { ...original, ...mapLoop(original, translate) };
      const id = paths.length * 2;
      paths.push(path);
      if (path.closed || !path.segs.length) continue;
      const first = path.segs[0], last = path.segs[path.segs.length - 1];
      const prev = path.segs[path.segs.length - 2]?.p ?? path.start;
      const end = (id: number, p: Vec, control: Vec, fallback: Vec): End => {
        const dir = norm(sub(p, dist(p, control) > 0.001 ? control : fallback));
        const color = sample(img, add(p, scale(dir, -Math.min(3, l.stroke!.width / 3))), offset);
        return { id, member: l.id, p, dir, width: l.stroke!.width, color };
      };
      ends.push(end(id, path.start, first.c1, first.p), end(id + 1, last.p, last.c2, prev));
    }
  }
  const candidates: Bridge[] = [];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].member === ends[j].member) continue;
    const bridge = candidate(ends[i], ends[j], img, offset);
    if (bridge) candidates.push(bridge);
  }
  const links = new Map<number, Bridge>();
  for (const bridge of candidates.sort((a, b) => a.score - b.score)) {
    if (links.has(bridge.a) || links.has(bridge.b)) continue;
    links.set(bridge.a, bridge); links.set(bridge.b, bridge);
  }
  const joined: BezierPath[] = [], used = new Set<number>();
  // Recorrer primero cadenas abiertas, luego anillos sin extremos libres.
  function follow(entry: number) {
    const first = entry;
    let result: BezierPath | undefined;
    const junctions: Junction[] = [];
    while (!used.has(entry >> 1)) {
      const index = entry >> 1, path = entry % 2 ? reverseStroke(paths[index]) : paths[index];
      used.add(index);
      if (!result) result = { ...path, segs: [...path.segs] };
      else result.segs.push(...path.segs);
      const exit = entry ^ 1, link = links.get(exit);
      if (!link) break;
      entry = link.a === exit ? link.b : link.a;
      const from = result.segs.length;
      const s = link.segment;
      if (s) {
        const next = paths[entry >> 1];
        result.segs.push(exit === link.a ? s : { ...s, c1: s.c2, c2: s.c1, p: entry % 2 ? next.segs[next.segs.length - 1].p : next.start });
      }
      junctions.push({ from, to: result.segs.length });
      if (entry === first) result.closed = true;
    }
    if (result) joined.push(repairCrossings(result, junctions, primary.stroke!.width, img, offset));
  }
  for (let i = 0; i < paths.length * 2; i++) if (!links.has(i)) follow(i);
  for (let i = 0; i < paths.length; i++) follow(i * 2);
  const shape = { type: 'strokes' as const, paths: joined };
  return { layer: { ...primary, shape, freeform: shape, area: members.reduce((a, l) => a + l.area, 0) }, connections: links.size / 2 };
}
