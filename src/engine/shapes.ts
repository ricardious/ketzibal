import { fitLine, intersectLines } from './curve';
import type { Shape, ShapeKind, Vec } from './types';
import { convexHull, dist, inPolygon, polygonArea, rdpClosed, segDist, sub } from './vec';

const DEG = Math.PI / 180;

export interface FitInput {
  /** Contorno exterior suavizado levemente. */
  pts: Vec[];
  /** true = borde real; false = borde tapado por otra capa o por el límite de la imagen. */
  visible: Uint8Array;
  /** Área encerrada por el contorno. */
  area: number;
  /** Tolerancia del usuario (px). */
  tol: number;
  /** ¿Se permite completar bajo otras capas? */
  allowCompletion: boolean;
  /** Validación de la compleción: ¿es (x,y) píxel de la región o de una capa superior/fuera de la imagen? */
  coverOk?: (x: number, y: number) => 0 | 1 | 2; // 0 = inválido, 1 = propio, 2 = tapado
}

export interface FitResult {
  kind: ShapeKind;
  shape: Shape;
  error: number;
  reconstructed: boolean;
}

// ───────────────────────── Métricas ─────────────────────────

export function shapeDistance(s: Shape, p: Vec): number {
  switch (s.type) {
    case 'circle':
      return Math.abs(Math.hypot(p[0] - s.cx, p[1] - s.cy) - s.r);
    case 'ellipse': {
      const a = -s.rotation * DEG, c = Math.cos(a), sn = Math.sin(a);
      const x = (p[0] - s.cx) * c - (p[1] - s.cy) * sn, y = (p[0] - s.cx) * sn + (p[1] - s.cy) * c;
      const F = (x * x) / (s.rx * s.rx) + (y * y) / (s.ry * s.ry) - 1;
      const g = Math.hypot((2 * x) / (s.rx * s.rx), (2 * y) / (s.ry * s.ry));
      return g > 1e-9 ? Math.abs(F) / g : Math.min(s.rx, s.ry);
    }
    case 'rect':
      return Math.abs(rectSdf(s, p));
    case 'polygon': {
      let d = Infinity;
      for (let i = 0; i < s.points.length; i++) d = Math.min(d, segDist(p, s.points[i], s.points[(i + 1) % s.points.length]));
      return d;
    }
    default:
      return 0;
  }
}

function rectSdf(s: Extract<Shape, { type: 'rect' }>, p: Vec) {
  const a = -s.rotation * DEG, c = Math.cos(a), sn = Math.sin(a);
  const x = Math.abs((p[0] - s.cx) * c - (p[1] - s.cy) * sn), y = Math.abs((p[0] - s.cx) * sn + (p[1] - s.cy) * c);
  const r = Math.min(s.rx, s.w / 2, s.h / 2);
  const qx = x - (s.w / 2 - r), qy = y - (s.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export function shapeContains(s: Shape, p: Vec): boolean {
  switch (s.type) {
    case 'circle':
      return Math.hypot(p[0] - s.cx, p[1] - s.cy) <= s.r;
    case 'ellipse': {
      const a = -s.rotation * DEG, c = Math.cos(a), sn = Math.sin(a);
      const x = (p[0] - s.cx) * c - (p[1] - s.cy) * sn, y = (p[0] - s.cx) * sn + (p[1] - s.cy) * c;
      return (x * x) / (s.rx * s.rx) + (y * y) / (s.ry * s.ry) <= 1;
    }
    case 'rect':
      return rectSdf(s, p) <= 0;
    case 'polygon':
      return inPolygon(p, s.points);
    default:
      return false;
  }
}

export function shapeBounds(s: Shape): [number, number, number, number] {
  switch (s.type) {
    case 'circle': return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'ellipse': {
      const m = Math.max(s.rx, s.ry);
      return [s.cx - m, s.cy - m, s.cx + m, s.cy + m];
    }
    case 'rect': {
      const m = Math.hypot(s.w, s.h) / 2;
      return [s.cx - m, s.cy - m, s.cx + m, s.cy + m];
    }
    case 'polygon': {
      const xs = s.points.map((q) => q[0]), ys = s.points.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case 'path': {
      const all = [s.loop.start, ...s.loop.segs.flatMap((g) => [g.c1, g.c2, g.p])];
      const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
}

export function shapeArea(s: Shape): number {
  switch (s.type) {
    case 'circle': return Math.PI * s.r * s.r;
    case 'ellipse': return Math.PI * s.rx * s.ry;
    case 'rect': { const r = Math.min(s.rx, s.w / 2, s.h / 2); return s.w * s.h - (4 - Math.PI) * r * r; }
    case 'polygon': return Math.abs(polygonArea(s.points));
    default: return 0;
  }
}

interface Err { mean: number; p95: number }

function fitError(s: Shape, pts: Vec[], vis: Uint8Array): Err {
  const d: number[] = [];
  for (let i = 0; i < pts.length; i++) if (vis[i]) d.push(shapeDistance(s, pts[i]));
  if (d.length === 0) return { mean: Infinity, p95: Infinity };
  d.sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return { mean, p95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] };
}

// ───────────────────────── Ajustes ─────────────────────────

export function fitCircle(pts: Vec[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length;
  if (n < 5) return null;
  // Kåsa algebraico en coordenadas centradas
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  let cx = (b1 * svv - b2 * suv) / det + mx;
  let cy = (suu * b2 - suv * b1) / det + my;
  // refinamiento geométrico (Landau)
  let r = 0;
  for (let it = 0; it < 40; it++) {
    let sr = 0, sx = 0, sy = 0;
    for (const p of pts) {
      const dx = cx - p[0], dy = cy - p[1], d = Math.hypot(dx, dy) || 1e-9;
      sr += d; sx += dx / d; sy += dy / d;
    }
    r = sr / n;
    const ncx = mx + r * (sx / n), ncy = my + r * (sy / n);
    // Landau usa la media de los puntos; se aplica con amortiguación
    const ox = cx, oy = cy;
    cx = ncx; cy = ncy;
    if (Math.hypot(cx - ox, cy - oy) < 1e-4) break;
  }
  return Number.isFinite(r) && r > 0.5 ? { cx, cy, r } : null;
}

/** Ajuste directo de elipse (Halir y Flusser, 1998). */
export function fitEllipse(pts: Vec[]): Extract<Shape, { type: 'ellipse' }> | null {
  const n = pts.length;
  if (n < 6) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sc = 0;
  for (const p of pts) sc += Math.hypot(p[0] - mx, p[1] - my);
  sc = sc / n || 1;
  const S1 = new Float64Array(9), S2 = new Float64Array(9), S3 = new Float64Array(9);
  for (const p of pts) {
    const x = (p[0] - mx) / sc, y = (p[1] - my) / sc;
    const d1 = [x * x, x * y, y * y], d2 = [x, y, 1];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      S1[i * 3 + j] += d1[i] * d1[j];
      S2[i * 3 + j] += d1[i] * d2[j];
      S3[i * 3 + j] += d2[i] * d2[j];
    }
  }
  const S3i = inv3(S3);
  if (!S3i) return null;
  // T = -S3^-1 S2^T
  const S2T = tr3(S2);
  const T = mul3(S3i, S2T).map((v) => -v);
  const M = mul3(S2, T);
  for (let i = 0; i < 9; i++) M[i] += S1[i];
  // premultiplicar por C1^-1
  const Mp = [M[6] / 2, M[7] / 2, M[8] / 2, -M[3], -M[4], -M[5], M[0] / 2, M[1] / 2, M[2] / 2];
  const vecs = eig3(Mp);
  let a1: number[] | null = null;
  for (const v of vecs) if (4 * v[0] * v[2] - v[1] * v[1] > 0) { a1 = v; break; }
  if (!a1) return null;
  const a2 = [0, 1, 2].map((i) => T[i * 3] * a1![0] + T[i * 3 + 1] * a1![1] + T[i * 3 + 2] * a1![2]);
  const [A, B, C] = a1, [D, E, F] = a2;
  // centro
  const den = 4 * A * C - B * B;
  const x0 = (B * E - 2 * C * D) / den, y0 = (B * D - 2 * A * E) / den;
  const F0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
  const tr = A + C, dd = Math.sqrt((A - C) * (A - C) + B * B);
  const l1 = (tr + dd) / 2, l2 = (tr - dd) / 2;
  const r1 = -F0 / l1, r2 = -F0 / l2;
  if (!(r1 > 0 && r2 > 0)) return null;
  const theta = 0.5 * Math.atan2(B, A - C); // dirección del semieje asociado a l1
  let rx = Math.sqrt(r1) * sc, ry = Math.sqrt(r2) * sc;
  let rotation = theta / DEG;
  // normalizar: rx es el semieje mayor, rotación en [-90, 90)
  if (ry > rx) { [rx, ry] = [ry, rx]; rotation += 90; }
  rotation = ((((rotation + 90) % 180) + 180) % 180) - 90;
  return { type: 'ellipse', cx: x0 * sc + mx, cy: y0 * sc + my, rx, ry, rotation };
}

function minAreaRect(pts: Vec[]): Extract<Shape, { type: 'rect' }> | null {
  const h = convexHull(pts);
  if (h.length < 3) return null;
  let best: Extract<Shape, { type: 'rect' }> | null = null, bestA = Infinity;
  for (let i = 0; i < h.length; i++) {
    const e = sub(h[(i + 1) % h.length], h[i]);
    const ang = Math.atan2(e[1], e[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of h) {
      const x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const A = (x1 - x0) * (y1 - y0);
    if (A < bestA) {
      bestA = A;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const ci = Math.cos(ang), si = Math.sin(ang);
      best = { type: 'rect', cx: mx * ci - my * si, cy: mx * si + my * ci, w: x1 - x0, h: y1 - y0, rx: 0, rotation: ang / DEG };
    }
  }
  if (best) {
    // normalizar rotación a (-45, 45]
    let r = best.rotation;
    while (r > 45) { r -= 90; [best.w, best.h] = [best.h, best.w]; }
    while (r <= -45) { r += 90; [best.w, best.h] = [best.h, best.w]; }
    best.rotation = r;
  }
  return best;
}

/** Polígono por rectas: RDP para segmentar y rectas de mínimos cuadrados sobre los tramos visibles. */
function fitPolygon(pts: Vec[], vis: Uint8Array, tol: number, size: number): Vec[] | null {
  const n = pts.length;
  const eps = Math.max(1.2, tol * 1.2, size * 0.012);
  const idx = rdpClosed(pts, eps);
  if (idx.length < 3 || idx.length > 24) return null;
  type L = { p: Vec; d: Vec; n: number };
  let lines: L[] = [];
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k], b = idx[(k + 1) % idx.length];
    const cnt = (b - a + n) % n;
    if (cnt < Math.max(5, n * 0.025)) continue; // tramo demasiado corto (esquina recortada)
    const margin = Math.max(1, Math.floor(cnt * 0.15));
    const run: Vec[] = [];
    let visCount = 0;
    for (let j = margin; j <= cnt - margin; j++) {
      const i = (a + j) % n;
      if (vis[i]) { run.push(pts[i]); visCount++; }
    }
    if (run.length < 2 || visCount < (cnt - 2 * margin + 1) * 0.3) continue; // lado oculto
    const l = fitLine(run);
    if (l) lines.push({ ...snapLine(l), n: cnt });
  }
  // fusionar rectas consecutivas casi colineales
  let changed = true;
  while (changed && lines.length > 3) {
    changed = false;
    for (let k = 0; k < lines.length; k++) {
      const A = lines[k], B = lines[(k + 1) % lines.length];
      const [big, small] = A.n >= B.n ? [A, B] : [B, A];
      const ang = Math.abs(A.d[0] * B.d[1] - A.d[1] * B.d[0]);
      const off = Math.abs((small.p[0] - big.p[0]) * big.d[1] - (small.p[1] - big.p[1]) * big.d[0]);
      // los tramos cortos estiman peor su dirección: más margen angular
      const maxN = Math.max(...lines.map((q) => q.n));
      const shortness = 1 - Math.min(1, small.n / (0.3 * maxN));
      const angTol = (5 + 12 * shortness) * DEG;
      if (ang < Math.sin(angTol) && off < Math.max(1.5, tol) + 2 * shortness) {
        const merged: L = { p: big.p, d: big.d, n: big.n + small.n };
        if (k === lines.length - 1) { lines.splice(k, 1, merged); lines.shift(); }
        else lines.splice(k, 2, merged);
        changed = true;
        break;
      }
    }
  }
  if (lines.length < 3 || lines.length > 16) return null;
  const verts: Vec[] = [];
  for (let k = 0; k < lines.length; k++) {
    const A = lines[k], B = lines[(k + 1) % lines.length];
    const x = intersectLines(A.p, A.d, B.p, B.d);
    if (!x) return null;
    verts.push(x);
  }
  // los vértices no deben alejarse demasiado del contorno
  for (const v of verts) {
    let md = Infinity;
    for (const p of pts) md = Math.min(md, dist(v, p));
    if (md > size * 0.6) return null;
  }
  return verts;
}

function snapLine(l: { p: Vec; d: Vec }): { p: Vec; d: Vec } {
  let a = Math.atan2(l.d[1], l.d[0]) / DEG;
  for (const t of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    if (Math.abs(a - t) < 2.5) { a = t; break; }
  }
  return { p: l.p, d: [Math.cos(a * DEG), Math.sin(a * DEG)] };
}

/** Clasifica un polígono y lo regulariza si es casi regular (o estrella). */
function classifyPolygon(v: Vec[]): { kind: ShapeKind; shape: Shape; regularized: Vec[] | null } {
  const n = v.length;
  const c: Vec = [v.reduce((s, p) => s + p[0], 0) / n, v.reduce((s, p) => s + p[1], 0) / n];
  const radii = v.map((p) => dist(p, c));
  const sides = v.map((p, i) => dist(p, v[(i + 1) % n]));
  const cv = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m; };
  // ángulos interiores
  const ang = v.map((p, i) => {
    const a = sub(v[(i - 1 + n) % n], p), b = sub(v[(i + 1) % n], p);
    return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))))) / DEG;
  });
  if (n === 4 && ang.every((a) => Math.abs(a - 90) < 6)) {
    // rectángulo (posiblemente rotado)
    const e = sub(v[1], v[0]);
    let rot = Math.atan2(e[1], e[0]) / DEG;
    let w = (sides[0] + sides[2]) / 2, h = (sides[1] + sides[3]) / 2;
    while (rot > 45) { rot -= 90; [w, h] = [h, w]; }
    while (rot <= -45) { rot += 90; [w, h] = [h, w]; }
    if (Math.abs(rot) < 2) rot = 0;
    const square = Math.abs(w - h) / Math.max(w, h) < 0.03;
    if (square) w = h = (w + h) / 2;
    return { kind: square ? 'square' : 'rect', shape: { type: 'rect', cx: c[0], cy: c[1], w, h, rx: 0, rotation: rot }, regularized: null };
  }
  const phase = (pts: Vec[], step: number) => {
    // fase media de los vértices respecto a una rejilla angular regular
    let sx = 0, sy = 0;
    pts.forEach((p, i) => {
      const a = Math.atan2(p[1] - c[1], p[0] - c[0]) - i * step;
      sx += Math.cos(a); sy += Math.sin(a);
    });
    return Math.atan2(sy, sx);
  };
  const orient = polygonArea(v) >= 0 ? 1 : -1;
  if (n >= 3 && cv(radii) < 0.05 && cv(sides) < 0.06) {
    const step = (orient * 2 * Math.PI) / n;
    const R = radii.reduce((a, b) => a + b, 0) / n;
    const ph = snapPhase(phase(v, step), n);
    const reg: Vec[] = v.map((_, i) => [c[0] + R * Math.cos(ph + i * step), c[1] + R * Math.sin(ph + i * step)]);
    return { kind: 'regular-polygon', shape: { type: 'polygon', points: reg }, regularized: reg };
  }
  if (n >= 8 && n % 2 === 0) {
    const even = radii.filter((_, i) => i % 2 === 0), odd = radii.filter((_, i) => i % 2 === 1);
    const me = even.reduce((a, b) => a + b, 0) / even.length, mo = odd.reduce((a, b) => a + b, 0) / odd.length;
    if (cv(even) < 0.07 && cv(odd) < 0.07 && Math.min(me, mo) / Math.max(me, mo) < 0.85) {
      const step = (orient * Math.PI) / (n / 2);
      const k = n / 2;
      // fase a partir de las puntas exteriores
      const outerFirst = me > mo ? 0 : 1;
      const tips = v.filter((_, i) => i % 2 === outerFirst);
      const ph = snapPhase(phase(tips, 2 * step), k);
      const Ro = Math.max(me, mo), Ri = Math.min(me, mo);
      const reg: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i - outerFirst + n) % n;
        const r = j % 2 === 0 ? Ro : Ri;
        const a = ph + j * step;
        reg[i] = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
      }
      return { kind: 'star', shape: { type: 'polygon', points: reg }, regularized: reg };
    }
  }
  return { kind: n === 3 ? 'triangle' : 'polygon', shape: { type: 'polygon', points: v }, regularized: null };
}

/** Ajusta la fase a una orientación canónica (vértice arriba o lado plano arriba) si está cerca. */
function snapPhase(ph: number, n: number) {
  const step = (2 * Math.PI) / n;
  for (const base of [-Math.PI / 2, -Math.PI / 2 + step / 2]) {
    const k = Math.round((ph - base) / step);
    const cand = base + k * step;
    if (Math.abs(cand - ph) < 3 * DEG) return cand;
  }
  return ph;
}

// ───────────────────────── Reconocimiento ─────────────────────────

/** Comprueba una forma completada: debe cubrir la región y extenderse solo bajo capas superiores. */
function validCompletion(s: Shape, inp: FitInput): boolean {
  if (!inp.coverOk) return false;
  const [x0, y0, x1, y1] = shapeBounds(s);
  const w = x1 - x0, h = y1 - y0;
  const step = Math.max(1, Math.sqrt((w * h) / 4000));
  let inside = 0, bad = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (!shapeContains(s, [x, y])) continue;
      inside++;
      if (inp.coverOk(x, y) === 0) bad++;
    }
  }
  return inside > 0 && bad / inside < 0.04;
}

/**
 * Reconoce la primitiva más simple que describe el contorno dentro de la tolerancia.
 * Usa solo los puntos de borde visibles; si hay oclusión intenta completar la figura.
 */
export function recognize(inp: FitInput): FitResult | null {
  const r = recognizeImpl(inp);
  if (r) return r;
  // sin compleción posible: la figura visible tal cual también puede ser una primitiva
  if (inp.visible.some((v) => !v)) return recognizeImpl({ ...inp, visible: ones(inp.pts.length), allowCompletion: false });
  return null;
}

function recognizeImpl(inp: FitInput): FitResult | null {
  const { pts, visible, area, tol } = inp;
  const n = pts.length;
  if (n < 12 || area < 20) return null;
  let visN = 0;
  for (let i = 0; i < n; i++) visN += visible[i];
  const occluded = visN < n * 0.97;
  if (occluded && (!inp.allowCompletion || visN < n * 0.35)) return null;
  const vpts = occluded ? pts.filter((_, i) => visible[i]) : pts;
  const size = Math.sqrt(area);
  const meanTol = Math.max(0.45, 0.4 * tol) + 0.004 * size;
  const p95Tol = meanTol * 2.6;
  const ok = (e: Err) => e.mean < meanTol && e.p95 < p95Tol;

  const accept = (kind: ShapeKind, shape: Shape, e: Err): FitResult | null => {
    if (!ok(e)) return null;
    const sa = shapeArea(shape);
    const reconstructed = occluded && sa > area * 1.03;
    if (occluded && !validCompletion(shape, inp)) return null;
    if (!occluded && Math.abs(sa - area) > area * 0.06 + 2 * size) return null;
    return { kind, shape, error: e.mean, reconstructed };
  };

  // Círculo
  const c = fitCircle(vpts);
  if (c && c.r < size * 4) {
    const s: Shape = { type: 'circle', ...c };
    const r = accept('circle', s, fitError(s, pts, occluded ? visible : ones(n)));
    if (r) return r;
  }
  // Elipse
  const el = fitEllipse(vpts);
  if (el && el.rx < size * 4) {
    if (Math.abs(el.rotation) < 2) el.rotation = 0;
    if (Math.abs(Math.abs(el.rotation) - 90) < 2) { el.rotation = 0; [el.rx, el.ry] = [el.ry, el.rx]; }
    const r = accept('ellipse', el, fitError(el, pts, occluded ? visible : ones(n)));
    if (r) return r;
  }
  // Rectángulo (posiblemente redondeado), solo sin oclusión
  if (!occluded) {
    const rc = minAreaRect(pts);
    if (rc) {
      if (Math.abs(rc.rotation) < 2) rc.rotation = 0;
      const deficit = rc.w * rc.h - area;
      const rr = deficit > 0 ? Math.sqrt(deficit / (4 - Math.PI)) : 0;
      const sq = Math.abs(rc.w - rc.h) / Math.max(rc.w, rc.h) < 0.03;
      if (sq) rc.w = rc.h = (rc.w + rc.h) / 2;
      for (const rx of rr > 1.2 ? [rr, 0] : [0]) {
        const s: Shape = { ...rc, rx: Math.min(rx, rc.w / 2, rc.h / 2) };
        const r = accept(sq ? 'square' : 'rect', s, fitError(s, pts, ones(n)));
        if (r) return r;
      }
    }
  }
  // Polígono por rectas
  const poly = fitPolygon(pts, occluded ? visible : ones(n), tol, size);
  if (poly) {
    const cls = classifyPolygon(poly);
    const vis = occluded ? visible : ones(n);
    const r = accept(cls.kind, cls.shape, fitError(cls.shape, pts, vis));
    if (r) return r;
    if (cls.regularized) {
      const raw: Shape = { type: 'polygon', points: poly };
      const r2 = accept(poly.length === 3 ? 'triangle' : 'polygon', raw, fitError(raw, pts, vis));
      if (r2) return r2;
    }
  }
  return null;
}

function ones(n: number) { return new Uint8Array(n).fill(1); }

// utilidades 3x3
function mul3(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function tr3(a: ArrayLike<number>): number[] { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
function inv3(m: ArrayLike<number>): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = Array.from(m);
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
/** Vectores propios reales de una matriz 3x3 general. */
function eig3(m: number[]): number[][] {
  const [a, b, c, d, e, f, g, h, i] = m;
  // polinomio característico: -λ³ + tr λ² - c2 λ + det
  const tr = a + e + i;
  const c2 = a * e - b * d + a * i - c * g + e * i - f * h;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const roots = cubicRoots(1, -tr, c2, -det);
  const out: number[][] = [];
  for (const l of roots) {
    const r0 = [a - l, b, c], r1 = [d, e - l, f], r2 = [g, h, i - l];
    const cands = [cr(r0, r1), cr(r0, r2), cr(r1, r2)];
    let best = cands[0], bn = 0;
    for (const v of cands) { const nn = Math.hypot(...v); if (nn > bn) { bn = nn; best = v; } }
    if (bn > 1e-14) out.push(best.map((x) => x / bn));
  }
  return out;
}
function cr(u: number[], v: number[]) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }
function cubicRoots(a: number, b: number, c: number, d: number): number[] {
  b /= a; c /= a; d /= a;
  const q = (3 * c - b * b) / 9, r = (9 * b * c - 27 * d - 2 * b * b * b) / 54;
  const disc = q * q * q + r * r;
  const off = -b / 3;
  if (disc > 0) {
    const s = Math.cbrt(r + Math.sqrt(disc)), t = Math.cbrt(r - Math.sqrt(disc));
    return [off + s + t];
  }
  const th = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(-q * q * q || 1e-30))));
  const m = 2 * Math.sqrt(-q);
  return [off + m * Math.cos(th / 3), off + m * Math.cos((th + 2 * Math.PI) / 3), off + m * Math.cos((th + 4 * Math.PI) / 3)];
}
