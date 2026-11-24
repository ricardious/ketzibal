import type { BezierLoop, CubicSeg, Vec } from './types';
import { add, dot, len, lerp, norm, scale, sub } from './vec';

/** Suavizado gaussiano circular de un contorno cerrado. */
export function smoothClosed(p: Vec[], sigma: number): Vec[] {
  const n = p.length;
  if (sigma < 0.3 || n < 5) return p.map((q) => [q[0], q[1]]);
  const r = Math.min(Math.ceil(sigma * 2.5), Math.floor((n - 1) / 2));
  const k: number[] = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); ks += v; }
  const out: Vec[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = -r; j <= r; j++) {
      const q = p[(((i + j) % n) + n) % n], w = k[j + r];
      x += q[0] * w; y += q[1] * w;
    }
    out[i] = [x / ks, y / ks];
  }
  return out;
}

/** Suavizado gaussiano de una polilínea abierta con extremos fijos. */
export function smoothOpen(p: Vec[], sigma: number): Vec[] {
  const n = p.length;
  if (sigma < 0.3 || n < 4) return p.map((q) => [q[0], q[1]]);
  const r = Math.ceil(sigma * 2.5);
  const out: Vec[] = new Array(n);
  out[0] = p[0]; out[n - 1] = p[n - 1];
  for (let i = 1; i < n - 1; i++) {
    // ventana simétrica recortada para no arrastrar los extremos
    const rr = Math.min(r, i, n - 1 - i);
    let x = 0, y = 0, s = 0;
    for (let j = -rr; j <= rr; j++) {
      const w = Math.exp(-(j * j) / (2 * sigma * sigma));
      x += p[i + j][0] * w; y += p[i + j][1] * w; s += w;
    }
    out[i] = [x / s, y / s];
  }
  return out;
}

/**
 * Detecta esquinas: puntos con un giro local fuerte que son máximos locales.
 * Devuelve índices ordenados.
 */
export function detectCorners(p: Vec[], minTurnDeg = 42): number[] {
  const n = p.length;
  if (n < 12) return [];
  const k = Math.max(2, Math.min(6, Math.round(n / 24)));
  const turn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = norm(sub(p[i], p[(i - k + n) % n]));
    const b = norm(sub(p[(i + k) % n], p[i]));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * (180 / Math.PI);
  }
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < minTurnDeg) continue;
    let isMax = true;
    for (let j = 1; j <= k && isMax; j++) {
      if (turn[(i + j) % n] > turn[i] || turn[(i - j + n) % n] >= turn[i]) isMax = false;
    }
    if (isMax) res.push(i);
  }
  return res;
}

/** Ajusta la posición de una esquina a la intersección de las tangentes de ambos lados. */
export function refineCorner(p: Vec[], i: number, span: number): Vec {
  const n = p.length;
  const before: Vec[] = [], after: Vec[] = [];
  for (let j = 2; j <= span + 1; j++) { before.push(p[(i - j + n) % n]); after.push(p[(i + j) % n]); }
  const l1 = fitLine(before), l2 = fitLine(after);
  if (!l1 || !l2) return p[i];
  const x = intersectLines(l1.p, l1.d, l2.p, l2.d);
  if (!x || len(sub(x, p[i])) > 2) return p[i];
  return x;
}

export function fitLine(pts: Vec[]): { p: Vec; d: Vec } | null {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const q of pts) { mx += q[0]; my += q[1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of pts) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [mx, my], d: [Math.cos(theta), Math.sin(theta)] };
}

export function intersectLines(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

// ───────────────────────── Ajuste de Bézier (Schneider, Graphics Gems 1990) ─────────────────────────

function bez(c: Vec[], t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
  return [a * c[0][0] + b * c[1][0] + cc * c[2][0] + d * c[3][0], a * c[0][1] + b * c[1][1] + cc * c[2][1] + d * c[3][1]];
}
function bezD1(c: Vec[], t: number): Vec {
  const mt = 1 - t;
  return [
    3 * (mt * mt * (c[1][0] - c[0][0]) + 2 * mt * t * (c[2][0] - c[1][0]) + t * t * (c[3][0] - c[2][0])),
    3 * (mt * mt * (c[1][1] - c[0][1]) + 2 * mt * t * (c[2][1] - c[1][1]) + t * t * (c[3][1] - c[2][1])),
  ];
}
function bezD2(c: Vec[], t: number): Vec {
  const mt = 1 - t;
  return [
    6 * (mt * (c[2][0] - 2 * c[1][0] + c[0][0]) + t * (c[3][0] - 2 * c[2][0] + c[1][0])),
    6 * (mt * (c[2][1] - 2 * c[1][1] + c[0][1]) + t * (c[3][1] - 2 * c[2][1] + c[1][1])),
  ];
}

function chordParams(p: Vec[]): number[] {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + len(sub(p[i], p[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generate(p: Vec[], u: number[], t1: Vec, t2: Vec): Vec[] {
  const first = p[0], last = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a1 = scale(t1, b1), a2 = scale(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(p[i], add(scale(first, b0 + b1), scale(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  const segLen = len(sub(last, first));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) { al = ar = segLen / 3; }
  return [first, add(first, scale(t1, al)), add(last, scale(t2, ar)), last];
}

function maxError(p: Vec[], c: Vec[], u: number[]): { err: number; idx: number } {
  let err = 0, idx = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) {
    const d = sub(bez(c, u[i]), p[i]);
    const e = dot(d, d);
    if (e >= err) { err = e; idx = i; }
  }
  return { err, idx };
}

function reparam(p: Vec[], c: Vec[], u: number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bez(c, t), p[i]);
    const d1 = bezD1(c, t), d2 = bezD2(c, t);
    const num = dot(d, d1), den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}

function fitCubic(p: Vec[], t1: Vec, t2: Vec, err: number, out: Vec[][], depth = 0) {
  if (p.length === 2) {
    const d = len(sub(p[1], p[0])) / 3;
    out.push([p[0], add(p[0], scale(t1, d)), add(p[1], scale(t2, d)), p[1]]);
    return;
  }
  let u = chordParams(p);
  let c = generate(p, u, t1, t2);
  let { err: e, idx } = maxError(p, c, u);
  const err2 = err * err;
  if (e < err2) { out.push(c); return; }
  if (e < err2 * 9) {
    for (let it = 0; it < 6; it++) {
      u = reparam(p, c, u);
      c = generate(p, u, t1, t2);
      ({ err: e, idx } = maxError(p, c, u));
      if (e < err2) { out.push(c); return; }
    }
  }
  if (depth > 24 || p.length < 4) { out.push(c); return; }
  idx = Math.max(1, Math.min(p.length - 2, idx));
  const tc = norm(sub(p[idx - 1], p[idx + 1]));
  fitCubic(p.slice(0, idx + 1), t1, tc, err, out, depth + 1);
  fitCubic(p.slice(idx), scale(tc, -1), t2, err, out, depth + 1);
}

function tangentAt(p: Vec[], i: number, dir: 1 | -1, span = 3): Vec {
  const n = p.length;
  let acc: Vec = [0, 0];
  for (let j = 1; j <= Math.min(span, n - 1); j++) {
    const q = p[Math.max(0, Math.min(n - 1, i + dir * j))];
    acc = add(acc, norm(sub(q, p[i])));
  }
  return norm(acc);
}

/** Ajusta cúbicas a una polilínea abierta. Devuelve segmentos (sin el punto inicial). */
export function fitOpen(p: Vec[], err: number, t1?: Vec, t2?: Vec): CubicSeg[] {
  if (p.length < 2) return [];
  const raw: Vec[][] = [];
  fitCubic(p, t1 ?? tangentAt(p, 0, 1), t2 ?? tangentAt(p, p.length - 1, -1), err, raw);
  return raw.map(toSeg);
}

function toSeg(c: Vec[]): CubicSeg {
  const chord = sub(c[3], c[0]);
  const L = len(chord);
  const seg: CubicSeg = { c1: c[1], c2: c[2], p: c[3] };
  if (L > 1e-6) {
    const nrm: Vec = [-chord[1] / L, chord[0] / L];
    const d1 = Math.abs(dot(sub(c[1], c[0]), nrm)), d2 = Math.abs(dot(sub(c[2], c[0]), nrm));
    if (d1 < 0.12 * Math.max(1, L * 0.02) && d2 < 0.12 * Math.max(1, L * 0.02)) {
      seg.line = true;
      seg.c1 = lerp(c[0], c[3], 1 / 3);
      seg.c2 = lerp(c[0], c[3], 2 / 3);
    }
  }
  return seg;
}

/**
 * Convierte un contorno cerrado en un lazo de Bézier, respetando esquinas.
 * `corners` son índices en `p` que se mantienen como vértices agudos.
 */
export function fitClosed(p: Vec[], corners: number[], err: number): BezierLoop {
  const n = p.length;
  if (corners.length === 0) {
    // sin esquinas: comenzar en el punto de mayor curvatura con tangente continua
    const ring = [...p, p[0]];
    const t = norm(sub(p[1], p[n - 1]));
    const segs = fitOpen(ring, err, t, scale(t, -1));
    return { start: p[0], segs };
  }
  const segs: CubicSeg[] = [];
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c], b = corners[(c + 1) % corners.length];
    const run: Vec[] = [];
    for (let i = a; ; i = (i + 1) % n) { run.push(p[i]); if (i === b && run.length > 1) break; }
    segs.push(...fitOpen(run, err));
  }
  return { start: p[corners[0]], segs };
}

/** Muestrea un lazo de Bézier en una polilínea cerrada. */
export function sampleLoop(loop: BezierLoop, perSeg = 12): Vec[] {
  const out: Vec[] = [];
  let prev = loop.start;
  for (const s of loop.segs) {
    const c = [prev, s.c1, s.c2, s.p];
    const k = s.line ? 1 : perSeg;
    for (let i = 0; i < k; i++) out.push(bez(c, i / k));
    prev = s.p;
  }
  return out;
}

/** Aplica una transformación afín a un lazo. */
export function mapLoop(loop: BezierLoop, f: (v: Vec) => Vec): BezierLoop {
  return { start: f(loop.start), segs: loop.segs.map((s) => ({ c1: f(s.c1), c2: f(s.c2), p: f(s.p), line: s.line })) };
}
