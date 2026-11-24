import type { LocalMask } from './regions';
import type { BezierLoop, CubicSeg, Shape, SymmetryAxis, Vec } from './types';
import { dist, dot, lerp, sub } from './vec';

const DEG = Math.PI / 180;

export function reflectPoint(p: Vec, axis: { p: Vec; angle: number }): Vec {
  const a = axis.angle * DEG, u: Vec = [Math.cos(a), Math.sin(a)];
  const d = sub(p, axis.p);
  const t = dot(d, u);
  const proj: Vec = [axis.p[0] + u[0] * t, axis.p[1] + u[1] * t];
  return [2 * proj[0] - p[0], 2 * proj[1] - p[1]];
}

/** IoU entre la máscara y su reflejo respecto al eje. */
function mirrorScore(m: LocalMask, xs: Float32Array, ys: Float32Array, axis: { p: Vec; angle: number }) {
  const a = axis.angle * DEG, ux = Math.cos(a), uy = Math.sin(a);
  let hit = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - axis.p[0], dy = ys[i] - axis.p[1];
    const t = dx * ux + dy * uy;
    const rx = 2 * (axis.p[0] + ux * t) - xs[i], ry = 2 * (axis.p[1] + uy * t) - ys[i];
    const lx = Math.floor(rx - m.ox), ly = Math.floor(ry - m.oy);
    if (lx >= 0 && ly >= 0 && lx < m.w && ly < m.h && m.data[ly * m.w + lx]) hit++;
  }
  return hit / (2 * n - hit);
}

/**
 * Busca el mejor eje de simetría especular de una máscara:
 * candidatos vertical, horizontal y ejes principales, refinados localmente.
 */
export function detectSymmetry(m: LocalMask, threshold = 0.94): SymmetryAxis | null {
  const xsA: number[] = [], ysA: number[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) { xsA.push(m.ox + x + 0.5); ysA.push(m.oy + y + 0.5); }
  const n = xsA.length;
  if (n < 30) return null;
  // submuestreo para rendimiento
  const stride = Math.max(1, Math.floor(n / 6000));
  const xs = new Float32Array(Math.ceil(n / stride)), ys = new Float32Array(xs.length);
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += xsA[i]; cy += ysA[i]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0, j = 0; i < n; i++) {
    const dx = xsA[i] - cx, dy = ysA[i] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    if (i % stride === 0 && j < xs.length) { xs[j] = xsA[i]; ys[j] = ysA[i]; j++; }
  }
  const pa = (0.5 * Math.atan2(2 * sxy, sxx - syy)) / DEG;
  const c: Vec = [cx, cy];
  let best: SymmetryAxis | null = null;
  for (const angle of [90, 0, pa, pa + 90]) {
    const s = mirrorScore(m, xs, ys, { p: c, angle });
    if (!best || s > best.score) best = { p: c, angle, score: s };
  }
  if (!best || best.score < threshold - 0.06) return null;
  // refinamiento local de posición y ángulo
  let cur: SymmetryAxis = best;
  const a0 = cur.angle;
  for (const step of [1, 0.25]) {
    let improved = true;
    while (improved) {
      improved = false;
      const nrm: Vec = [-Math.sin(cur.angle * DEG), Math.cos(cur.angle * DEG)];
      for (const [dp, da] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const cand: { p: Vec; angle: number } = { p: [cur.p[0] + nrm[0] * dp, cur.p[1] + nrm[1] * dp] as Vec, angle: cur.angle + da };
        if (Math.abs(cand.angle - a0) > 4 || dist(cand.p, c) > 4) continue;
        const s = mirrorScore(m, xs, ys, cand);
        if (s > cur.score + 1e-4) { cur = { ...cand, score: s }; improved = true; }
      }
    }
  }
  // ejes casi alineados se fijan a vertical / horizontal
  let ang = ((cur.angle % 180) + 180) % 180;
  for (const t of [0, 45, 90, 135, 180]) if (Math.abs(ang - t) < 1.5) ang = t % 180;
  cur.angle = ang;
  return cur.score >= threshold ? cur : null;
}

/** Eje global vertical u horizontal de toda la composición (mapa de etiquetas). */
export function detectGlobalSymmetry(labels: Int32Array, W: number, H: number): SymmetryAxis | null {
  const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 80000)));
  const evalV = (ax: number) => {
    let same = 0, tot = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const mx = Math.round(2 * ax - x - 1);
      if (mx < 0 || mx >= W) continue;
      tot++;
      if (labels[y * W + x] === labels[y * W + mx]) same++;
    }
    return tot ? same / tot : 0;
  };
  const evalH = (ay: number) => {
    let same = 0, tot = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const my = Math.round(2 * ay - y - 1);
      if (my < 0 || my >= H) continue;
      tot++;
      if (labels[y * W + x] === labels[my * W + x]) same++;
    }
    return tot ? same / tot : 0;
  };
  let best: SymmetryAxis | null = null;
  for (let ax = W / 2 - W * 0.04; ax <= W / 2 + W * 0.04; ax += 0.5) {
    const s = evalV(ax);
    if (!best || s > best.score) best = { p: [ax, H / 2], angle: 90, score: s, global: true };
  }
  for (let ay = H / 2 - H * 0.04; ay <= H / 2 + H * 0.04; ay += 0.5) {
    const s = evalH(ay);
    if (!best || s > best.score) best = { p: [W / 2, ay], angle: 0, score: s, global: true };
  }
  return best && best.score > 0.93 ? best : null;
}

/**
 * Simetriza un contorno cerrado: promedia cada mitad con el reflejo de la otra.
 * Devuelve la mitad canónica (de un cruce del eje al otro) o null si no es aplicable.
 */
export function symmetrizeHalf(pts: Vec[], axis: SymmetryAxis): Vec[] | null {
  const n = pts.length;
  const a = axis.angle * DEG;
  const u: Vec = [Math.cos(a), Math.sin(a)], nrm: Vec = [-u[1], u[0]];
  const side = pts.map((p) => dot(sub(p, axis.p), nrm));
  const cross: { i: number; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if ((side[i] <= 0 && side[j] > 0) || (side[i] > 0 && side[j] <= 0)) cross.push({ i, t: dot(sub(pts[i], axis.p), u) });
  }
  if (cross.length < 2) return null;
  cross.sort((p, q) => p.t - q.t);
  const c1 = cross[0].i, c2 = cross[cross.length - 1].i;
  const walk = (from: number, to: number) => {
    const out: Vec[] = [];
    for (let i = (from + 1) % n; ; i = (i + 1) % n) { out.push(pts[i]); if (i === to) break; }
    return out;
  };
  const A = walk(c1, c2), B = walk(c2, c1);
  if (A.length < 3 || B.length < 3) return null;
  const Bm = B.reverse().map((p) => reflectPoint(p, axis));
  const M = Math.max(A.length, Bm.length);
  const ra = resample(A, M), rb = resample(Bm, M);
  const half = ra.map((p, i) => lerp(p, rb[i], 0.5));
  // fijar extremos sobre el eje
  const onAxis = (p: Vec): Vec => { const t = dot(sub(p, axis.p), u); return [axis.p[0] + u[0] * t, axis.p[1] + u[1] * t]; };
  half[0] = onAxis(half[0]);
  half[half.length - 1] = onAxis(half[half.length - 1]);
  return half;
}

export function mirrorClosed(half: Vec[], axis: SymmetryAxis): Vec[] {
  const back = half.slice(1, -1).reverse().map((p) => reflectPoint(p, axis));
  return [...half, ...back];
}

function resample(p: Vec[], m: number): Vec[] {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i], p[i - 1]));
  const L = cum[cum.length - 1];
  const out: Vec[] = [];
  let k = 0;
  for (let i = 0; i < m; i++) {
    const t = (L * i) / (m - 1);
    while (k < p.length - 2 && cum[k + 1] < t) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    out.push(lerp(p[k], p[k + 1], Math.min(1, Math.max(0, (t - cum[k]) / seg))));
  }
  return out;
}

/** Completa un lazo de Bézier a partir de los segmentos de una mitad (inicio y fin sobre el eje). */
export function mirrorLoop(start: Vec, half: CubicSeg[], axis: SymmetryAxis): BezierLoop {
  const segs: CubicSeg[] = [...half];
  const pts: Vec[] = [start, ...half.map((s) => s.p)];
  for (let i = half.length - 1; i >= 0; i--) {
    const s = half[i];
    segs.push({ c1: reflectPoint(s.c2, axis), c2: reflectPoint(s.c1, axis), p: reflectPoint(pts[i], axis), line: s.line });
  }
  // el último punto coincide con el inicio
  segs[segs.length - 1] = { ...segs[segs.length - 1], p: start };
  return { start, segs };
}

/** Refleja una forma completa respecto a un eje. */
export function mirrorShape(s: Shape, axis: SymmetryAxis): Shape {
  const f = (p: Vec) => reflectPoint(p, axis);
  const rot = (r: number) => 2 * axis.angle - r;
  switch (s.type) {
    case 'circle': { const [cx, cy] = f([s.cx, s.cy]); return { ...s, cx, cy }; }
    case 'ellipse': { const [cx, cy] = f([s.cx, s.cy]); return { ...s, cx, cy, rotation: normRot(rot(s.rotation)) }; }
    case 'rect': { const [cx, cy] = f([s.cx, s.cy]); return { ...s, cx, cy, rotation: normRot(rot(s.rotation), 90) }; }
    case 'polygon': return { type: 'polygon', points: s.points.map(f).reverse() };
    case 'path': return { type: 'path', loop: { start: f(s.loop.start), segs: s.loop.segs.map((g) => ({ c1: f(g.c1), c2: f(g.c2), p: f(g.p), line: g.line })) } };
  }
}

function normRot(r: number, period = 180) {
  let v = ((r % period) + period) % period;
  if (v > period / 2) v -= period;
  return Math.abs(v) < 1e-6 ? 0 : v;
}
