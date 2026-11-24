import { labDist, oklabToRgb, rgbToHex, rgbToOklab } from './color';
import type { RasterImage } from './types';

export interface Quantized {
  /** Índice de paleta por píxel; -1 = transparente. */
  labels: Int32Array;
  /** Colores en OKLab, 3 floats por entrada. */
  lab: Float32Array;
  hex: string[];
}

const ALPHA_CUTOFF = 128;
/** Distancia OKLab por debajo de la cual dos colores de la paleta se consideran el mismo. */
const MERGE_DIST = 0.035;

/**
 * Cuantización k-means++ en OKLab.
 * Se entrena solo con píxeles "planos" (sin gradiente local) para que los
 * píxeles de antialiasing en los bordes no generen colores intermedios.
 */
export function quantize(img: RasterImage, k: number, seed = 1): Quantized {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const opaque = (i: number) => data[i * 4 + 3] >= ALPHA_CUTOFF;

  // 1. Muestreo de píxeles planos.
  const flat: number[] = [];
  const all: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(N / 60000)));
  for (let y = 1; y < H - 1; y += step) {
    for (let x = 1; x < W - 1; x += step) {
      const i = y * W + x;
      if (!opaque(i)) continue;
      all.push(i);
      if (isFlat(data, i, W)) flat.push(i);
    }
  }
  if (all.length === 0) for (let i = 0; i < N; i++) if (opaque(i)) all.push(i);
  const sample = flat.length > Math.min(200, all.length * 0.1) ? flat : all;
  if (sample.length === 0) {
    return { labels: new Int32Array(N).fill(-1), lab: new Float32Array(0), hex: [] };
  }

  const S = sample.length;
  const pts = new Float32Array(S * 3);
  for (let s = 0; s < S; s++) {
    const p = sample[s] * 4;
    rgbToOklab(data[p], data[p + 1], data[p + 2], pts, s * 3);
  }

  // 2. k-means++ init.
  let rnd = seed >>> 0 || 1;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  k = Math.max(1, Math.min(k, S));
  const centers = new Float32Array(k * 3);
  const first = Math.floor(rand() * S);
  centers.set(pts.subarray(first * 3, first * 3 + 3), 0);
  const d2 = new Float32Array(S).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let s = 0; s < S; s++) {
      const d = labDist(pts, s * 3, centers, (c - 1) * 3);
      if (d * d < d2[s]) d2[s] = d * d;
      sum += d2[s];
    }
    let r = rand() * sum;
    let pick = S - 1;
    for (let s = 0; s < S; s++) {
      r -= d2[s];
      if (r <= 0) { pick = s; break; }
    }
    centers.set(pts.subarray(pick * 3, pick * 3 + 3), c * 3);
  }

  // 3. Lloyd.
  const assign = new Int32Array(S);
  const acc = new Float64Array(k * 4);
  for (let iter = 0; iter < 16; iter++) {
    acc.fill(0);
    let moved = 0;
    for (let s = 0; s < S; s++) {
      const best = nearest(pts, s * 3, centers, k);
      if (best !== assign[s]) moved++;
      assign[s] = best;
      acc[best * 4] += pts[s * 3];
      acc[best * 4 + 1] += pts[s * 3 + 1];
      acc[best * 4 + 2] += pts[s * 3 + 2];
      acc[best * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const n = acc[c * 4 + 3];
      if (n > 0) for (let j = 0; j < 3; j++) centers[c * 3 + j] = acc[c * 4 + j] / n;
    }
    if (iter > 2 && moved < S * 0.001) break;
  }

  // 4. Fusionar centros casi idénticos y descartar los vacíos.
  const counts = new Float64Array(k);
  for (let s = 0; s < S; s++) counts[assign[s]]++;
  const order = [...Array(k).keys()].sort((a, b) => counts[b] - counts[a]);
  const kept: number[] = [];
  for (const c of order) {
    if (counts[c] < S * 0.0005) continue;
    if (kept.some((q) => labDist(centers, q * 3, centers, c * 3) < MERGE_DIST)) continue;
    kept.push(c);
  }
  const K = kept.length;
  const lab = new Float32Array(K * 3);
  kept.forEach((c, i) => lab.set(centers.subarray(c * 3, c * 3 + 3), i * 3));

  // 5. Asignar todos los píxeles con una tabla de 18 bits (6 bits por canal) calculada bajo demanda.
  const labels = new Int32Array(N);
  const table = new Int16Array(1 << 18).fill(-1);
  const tmp = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    if (data[p + 3] < ALPHA_CUTOFF) { labels[i] = -1; continue; }
    const key = ((data[p] >> 2) << 12) | ((data[p + 1] >> 2) << 6) | (data[p + 2] >> 2);
    let l = table[key];
    if (l < 0) {
      rgbToOklab((data[p] & 0xfc) | 2, (data[p + 1] & 0xfc) | 2, (data[p + 2] & 0xfc) | 2, tmp);
      l = table[key] = nearest(tmp, 0, lab, K);
    }
    labels[i] = l;
  }

  // 6. Color final = media de los píxeles planos de cada grupo (sin contaminación de bordes).
  const fin = new Float64Array(K * 4);
  for (let s = 0; s < S; s++) {
    const l = labels[sample[s]];
    fin[l * 4] += pts[s * 3];
    fin[l * 4 + 1] += pts[s * 3 + 1];
    fin[l * 4 + 2] += pts[s * 3 + 2];
    fin[l * 4 + 3]++;
  }
  const hex: string[] = [];
  for (let c = 0; c < K; c++) {
    const n = fin[c * 4 + 3];
    if (n > 0) for (let j = 0; j < 3; j++) lab[c * 3 + j] = fin[c * 4 + j] / n;
    hex.push(rgbToHex(...oklabToRgb(lab[c * 3], lab[c * 3 + 1], lab[c * 3 + 2])));
  }
  return { labels, lab, hex };
}

function nearest(p: ArrayLike<number>, pi: number, centers: Float32Array, k: number) {
  let best = 0, bd = Infinity;
  for (let c = 0; c < k; c++) {
    const d0 = p[pi] - centers[c * 3], d1 = p[pi + 1] - centers[c * 3 + 1], d2 = p[pi + 2] - centers[c * 3 + 2];
    const d = d0 * d0 + d1 * d1 + d2 * d2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function isFlat(data: Uint8ClampedArray, i: number, W: number) {
  const p = i * 4;
  const r = data[p], g = data[p + 1], b = data[p + 2];
  for (const n of [i - 1, i + 1, i - W, i + W]) {
    const q = n * 4;
    if (Math.abs(data[q] - r) + Math.abs(data[q + 1] - g) + Math.abs(data[q + 2] - b) > 24) return false;
    if (data[q + 3] < ALPHA_CUTOFF) return false;
  }
  return true;
}
