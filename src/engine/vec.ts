import type { Vec } from './types';

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
};
export const rot = (a: Vec, ang: number): Vec => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};

export function segDist(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

/** Cierre convexo (cadena monótona de Andrew). */
export function convexHull(pts: Vec[]): Vec[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Vec[] = [], upper: Vec[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(q, lower[lower.length - 2])) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(q, upper[upper.length - 2])) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Punto dentro de polígono (par-impar). */
export function inPolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function polygonArea(p: Vec[]) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) a += p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1];
  return a / 2;
}

/** Simplificación Ramer–Douglas–Peucker de un lazo cerrado. Devuelve índices. */
export function rdpClosed(p: Vec[], eps: number): number[] {
  const n = p.length;
  if (n < 4) return [...Array(n).keys()];
  // anclar en el par de puntos más alejado aproximado
  let a = 0, far = 0, fd = -1;
  for (let i = 0; i < n; i++) { const d = dist(p[a], p[i]); if (d > fd) { fd = d; far = i; } }
  a = far; fd = -1;
  let b = 0;
  for (let i = 0; i < n; i++) { const d = dist(p[a], p[i]); if (d > fd) { fd = d; b = i; } }
  const keep = new Uint8Array(n);
  keep[a] = keep[b] = 1;
  const rec = (i: number, j: number) => {
    // recorre de i a j en sentido circular
    let md = -1, mi = -1;
    for (let k = (i + 1) % n; k !== j; k = (k + 1) % n) {
      const d = segDist(p[k], p[i], p[j]);
      if (d > md) { md = d; mi = k; }
    }
    if (md > eps && mi >= 0) { keep[mi] = 1; rec(i, mi); rec(mi, j); }
  };
  rec(a, b); rec(b, a);
  const res: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) res.push(i);
  return res;
}
