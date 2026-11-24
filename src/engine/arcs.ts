import { fitCircle } from './shapes';
import type { LocalMask } from './regions';
import type { BezierLoop, Vec } from './types';

type Circle = NonNullable<ReturnType<typeof fitCircle>>;

/** Ajusta dos discos a los arcos expuestos por encima y por debajo de
 * oclusiones laterales. Rechaza extrapolaciones sin apoyo en los extremos. */
export function fitClippedCircle(m: LocalMask, tolerance: number): BezierLoop | null {
  if (m.w < 36 || m.h < 16) return null;
  const top: Vec[] = [], bottom: Vec[] = [];
  for (let x = 1; x < m.w - 1; x++) {
    let a = 1, b = m.h - 2;
    while (a <= b && !m.data[a * m.w + x]) a++;
    while (b >= a && !m.data[b * m.w + x]) b--;
    if (a > b) continue;
    top.push([m.ox + x + 0.5, m.oy + a]);
    bottom.push([m.ox + x + 0.5, m.oy + b + 1]);
  }
  const n = top.length;
  const central = (points: Vec[], fraction: number) => points.slice(Math.floor(n * fraction), Math.ceil(n * (1 - fraction)));
  const upper = central(top, 0.32), lower = central(bottom, 0.02);
  const a = fitCircle(upper), b = fitCircle(lower);
  if (!a || !b || a.cy <= b.cy || Math.abs(a.cx - b.cx) > n * 0.08) return null;
  const err = Math.max(1.2, Math.min(3, tolerance * 1.5));
  const residual = (p: Vec, c: Circle) => Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r;
  const supported = (pts: Vec[], c: Circle) => pts.every(p => Math.abs(residual(p, c)) < err * 2);
  if (!supported(upper, a) || !supported(lower, b)) return null;
  if (a.cy <= upper[0][1] || b.cy >= lower[0][1] || a.r > n * 3 || b.r > n * 5) return null;
  // El recorte debe explicar ambos extremos y contener la región observada.
  if ([bottom[0], bottom[n - 1]].some(p => Math.abs(residual(p, a)) > n * 0.06)) return null;
  if (top.some(p => residual(p, a) > err * 3) || bottom.some(p => residual(p, b) > err * 3)) return null;
  const missing = top.filter(p => residual(p, a) < -err * 4).length;
  if (missing < n * 0.12 || missing > n * 0.8) return null;
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
  if (d >= a.r + b.r || d <= Math.abs(a.r - b.r)) return null;
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const cx = a.cx + along * dx / d, cy = a.cy + along * dy / d;
  const right: Vec = [cx - dy * h / d, cy + dx * h / d];
  const left: Vec = [cx + dy * h / d, cy - dx * h / d];
  const loop: BezierLoop = { start: left, segs: [] };
  const arc = (c: Circle, from: Vec, to: Vec) => {
    let angle = Math.atan2(from[1] - c.cy, from[0] - c.cx);
    const sweep = (Math.atan2(to[1] - c.cy, to[0] - c.cx) - angle + 2 * Math.PI) % (2 * Math.PI);
    const steps = Math.ceil(sweep / (Math.PI / 2)), delta = sweep / steps;
    const k = c.r * 4 / 3 * Math.tan(delta / 4);
    let start = from;
    for (let i = 1; i <= steps; i++) {
      const end = angle + delta;
      const p: Vec = i === steps ? to : [c.cx + c.r * Math.cos(end), c.cy + c.r * Math.sin(end)];
      loop.segs.push({ c1: [start[0] - k * Math.sin(angle), start[1] + k * Math.cos(angle)], c2: [p[0] + k * Math.sin(end), p[1] - k * Math.cos(end)], p });
      start = p;
      angle = end;
    }
  };
  arc(a, left, right);
  arc(b, right, left);
  return loop;
}
