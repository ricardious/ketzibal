import type { LocalMask } from './regions';
import type { Vec } from './types';

export interface Contour {
  /** Puntos medios de cada arista de píxel del borde (coordenadas globales). */
  pts: Vec[];
  /** Índice global del píxel exterior adyacente a cada arista (-1 si está fuera de la imagen). */
  outside: Int32Array;
  /** Área con signo: > 0 contorno exterior, < 0 hueco. */
  area: number;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Seguimiento de bordes por aristas de píxel (crack following).
 * El primer plano queda a la derecha del sentido de avance; en los puntos de
 * silla se gira hacia el píxel actual, lo que equivale a 4-conectividad.
 */
export function traceContours(m: LocalMask, W: number, H: number): Contour[] {
  const { w, h, data, ox, oy } = m;
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? data[y * w + x] : 0);
  const visitedTop = new Uint8Array(w * h);
  const out: Contour[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x] || get(x, y - 1) || visitedTop[y * w + x]) continue;
      const pts: Vec[] = [];
      const outside: number[] = [];
      let vx = x, vy = y, dir = 0;
      let guard = 4 * (w + 1) * (h + 1);
      do {
        // píxel exterior (a la izquierda del avance)
        let px: number, py: number;
        switch (dir) {
          case 0: px = vx; py = vy - 1; visitedTop[vy * w + vx] = 1; break;
          case 1: px = vx; py = vy; break;
          case 2: px = vx - 1; py = vy; break;
          default: px = vx - 1; py = vy - 1;
        }
        pts.push([ox + vx + DX[dir] * 0.5, oy + vy + DY[dir] * 0.5]);
        const gx = ox + px, gy = oy + py;
        outside.push(gx >= 0 && gy >= 0 && gx < W && gy < H ? gy * W + gx : -1);
        vx += DX[dir];
        vy += DY[dir];
        let ar: number, al: number;
        switch (dir) {
          case 0: ar = get(vx, vy); al = get(vx, vy - 1); break;
          case 1: ar = get(vx - 1, vy); al = get(vx, vy); break;
          case 2: ar = get(vx - 1, vy - 1); al = get(vx - 1, vy); break;
          default: ar = get(vx, vy - 1); al = get(vx - 1, vy - 1);
        }
        if (!ar) dir = (dir + 1) & 3;
        else if (al) dir = (dir + 3) & 3;
      } while (!(vx === x && vy === y && dir === 0) && --guard > 0);
      out.push({ pts, outside: Int32Array.from(outside), area: signedArea(pts) });
    }
  }
  return out;
}

export function signedArea(p: Vec[]) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i], r = p[(i + 1) % n];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}
