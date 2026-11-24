import { describe, expect, it } from 'vitest';
import { traceContours } from './contour';
import { fitCircle, fitEllipse, recognize } from './shapes';
import type { Vec } from './types';

function maskFrom(W: number, H: number, f: (x: number, y: number) => boolean) {
  const w = W + 2, h = H + 2, data = new Uint8Array(w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f(x + 0.5, y + 0.5)) data[(y + 1) * w + x + 1] = 1;
  return { ox: -1, oy: -1, w, h, data };
}

describe('contornos y ajustes', () => {
  it('traza un píxel como contorno exterior de 4 aristas', () => {
    const c = traceContours(maskFrom(3, 3, (x, y) => x > 1 && x < 2 && y > 1 && y < 2), 3, 3);
    expect(c).toHaveLength(1);
    expect(c[0].pts).toHaveLength(4);
    expect(c[0].area).toBeGreaterThan(0);
  });

  it('detecta un hueco con área negativa', () => {
    const c = traceContours(maskFrom(10, 10, (x, y) => !(x > 4 && x < 6 && y > 4 && y < 6)), 10, 10);
    expect(c.map((k) => Math.sign(k.area)).sort()).toEqual([-1, 1]);
  });

  it('ajusta círculo y elipse con precisión subpíxel', () => {
    const circ = traceContours(maskFrom(100, 100, (x, y) => (x - 50) ** 2 + (y - 48) ** 2 < 30 ** 2), 100, 100)[0];
    const c = fitCircle(circ.pts)!;
    expect(Math.abs(c.cx - 50)).toBeLessThan(0.2);
    expect(Math.abs(c.cy - 48)).toBeLessThan(0.2);
    expect(Math.abs(c.r - 30)).toBeLessThan(0.3);
    const rot = (25 * Math.PI) / 180;
    const ell = traceContours(maskFrom(120, 120, (x, y) => {
      const u = (x - 60) * Math.cos(rot) + (y - 60) * Math.sin(rot), v = -(x - 60) * Math.sin(rot) + (y - 60) * Math.cos(rot);
      return (u / 45) ** 2 + (v / 20) ** 2 < 1;
    }), 120, 120)[0];
    const e = fitEllipse(ell.pts)!;
    expect(Math.abs(e.rx - 45)).toBeLessThan(0.5);
    expect(Math.abs(e.ry - 20)).toBeLessThan(0.5);
    expect(Math.abs(e.rotation - 25)).toBeLessThan(1);
  });

  it('reconoce rectángulo, triángulo y estrella', () => {
    const rect = traceContours(maskFrom(80, 60, (x, y) => x > 10 && x < 70 && y > 15 && y < 45), 80, 60)[0];
    const r = recognize({ pts: rect.pts, visible: new Uint8Array(rect.pts.length).fill(1), area: rect.area, tol: 1, allowCompletion: false });
    expect(r?.kind).toBe('rect');
    const tri: Vec[] = [[30, 10], [90, 80], [10, 70]];
    const t = traceContours(maskFrom(100, 100, (x, y) => inside(tri, x, y)), 100, 100)[0];
    expect(recognize({ pts: t.pts, visible: new Uint8Array(t.pts.length).fill(1), area: t.area, tol: 1, allowCompletion: false })?.kind).toBe('triangle');
    const star: Vec[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 22 : 50;
      star.push([60 + rr * Math.cos(a), 60 + rr * Math.sin(a)]);
    }
    const s = traceContours(maskFrom(120, 120, (x, y) => inside(star, x, y)), 120, 120)[0];
    expect(recognize({ pts: s.pts, visible: new Uint8Array(s.pts.length).fill(1), area: s.area, tol: 1, allowCompletion: false })?.kind).toBe('star');
  });
});

function inside(poly: Vec[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
