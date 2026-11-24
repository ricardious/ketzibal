import type { Components, RegionStats } from './regions';
import type { Vec } from './types';

/**
 * Detección de dibujo lineal ("tinta"): regiones oscuras y delgadas de grosor casi
 * constante. Se distinguen de figuras oscuras rellenas (ojos, sombreros) comparando
 * su radio inscrito con su grosor medio.
 */
export interface Ink {
  /** 1 = píxel de trazo. */
  mask: Uint8Array;
  /** Grosor del trazo en píxeles de trabajo. */
  width: number;
  /** Etiqueta de paleta de la tinta. */
  label: number;
}

/**
 * Transformada de distancia chaflán 3-4 (dentro de la máscara), en píxeles aproximados.
 * Con `comp`, la distancia se mide hasta el borde de la propia componente.
 */
export function distanceTransform(mask: Uint8Array, W: number, H: number, comp?: Int32Array): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  if (comp) {
    // los píxeles que lindan con otra componente son borde
    for (let i = 0; i < W * H; i++) {
      if (!mask[i]) continue;
      const x = i % W, c = comp[i];
      if ((x > 0 && comp[i - 1] !== c) || (x < W - 1 && comp[i + 1] !== c) || (i >= W && comp[i - W] !== c) || (i < W * H - W && comp[i + W] !== c)) d[i] = 3;
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); else v = Math.min(v, 3);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 3);
      if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
    } else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3); else v = Math.min(v, 3);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 3);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
    } else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

export function detectInk(cc: Components, st: RegionStats, lab: Float32Array, W: number, H: number): Ink | null {
  // candidatos: componentes de etiquetas oscuras
  const dark = (l: number) => l >= 0 && lab[l * 3] < 0.45;
  const cand = new Uint8Array(cc.count);
  let any = false;
  for (let c = 0; c < cc.count; c++) if (dark(cc.label[c]) && st.area[c] >= 30) { cand[c] = 1; any = true; }
  if (!any) return null;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (cand[cc.comp[i]]) m[i] = 1;
  const dt = distanceTransform(m, W, H, cc.comp);

  // por componente: grosor medio (2·área/perímetro) y radio inscrito alto (p98 de la distancia)
  const vals: number[][] = Array.from({ length: cc.count }, () => []);
  for (let i = 0; i < W * H; i++) if (m[i]) vals[cc.comp[i]].push(dt[i]);
  const maxW = Math.max(4, Math.min(W, H) * 0.04);
  const stroke = new Uint8Array(cc.count);
  const widths: { w: number; a: number; l: number }[] = [];
  for (let c = 0; c < cc.count; c++) {
    if (!cand[c]) continue;
    const v = vals[c].sort((a, b) => a - b);
    const p98 = v[Math.floor(v.length * 0.98)];
    const p50 = v[Math.floor(v.length * 0.5)];
    const w = (2 * st.area[c]) / st.perimeter[c];
    // en un trazo la distancia máxima ≈ la mitad del grosor; en un disco ≈ el grosor medio
    if (w <= maxW && p98 <= w * 0.85 + 1 && p98 < 3.2 * Math.max(1, p50)) {
      stroke[c] = 1;
      widths.push({ w: 2 * p98 - 0.5, a: st.area[c], l: cc.label[c] });
    }
  }
  if (widths.length === 0) return null;
  const total = widths.reduce((s, x) => s + x.a, 0);
  // la tinta debe ser una parte apreciable del dibujo
  if (total < W * H * 0.004) return null;
  widths.sort((a, b) => a.w - b.w);
  let acc = 0, width = widths[0].w;
  for (const x of widths) { acc += x.a; if (acc >= total / 2) { width = x.w; break; } }
  const byLabel = new Map<number, number>();
  for (const x of widths) byLabel.set(x.l, (byLabel.get(x.l) ?? 0) + x.a);
  const label = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (stroke[cc.comp[i]]) mask[i] = 1;
  // núcleos gruesos pegados a la tinta (zonas rellenas del color del trazo) no son trazo
  const d2 = distanceTransform(mask, W, H);
  const coreT = width * 0.75 + 1.5;
  const blob = new Uint8Array(W * H);
  let queue: number[] = [];
  for (let i = 0; i < W * H; i++) if (d2[i] > coreT) { blob[i] = 1; queue.push(i); }
  for (let r = 0; r < Math.ceil(width * 0.6) && queue.length; r++) {
    const next: number[] = [];
    for (const i of queue) {
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n >= 0 && n < W * H && mask[n] && !blob[n]) { blob[n] = 1; next.push(n); }
      }
    }
    queue = next;
  }
  for (let i = 0; i < W * H; i++) if (blob[i]) mask[i] = 0;
  return { mask, width: Math.max(1, width), label };
}

/** Adelgazamiento de Zhang–Suen. Devuelve el esqueleto de 1 px. */
export function thin(mask: Uint8Array, W: number, H: number): Uint8Array {
  const s = mask.slice();
  for (let x = 0; x < W; x++) { s[x] = 0; s[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { s[y * W] = 0; s[y * W + W - 1] = 0; }
  let pts: number[] = [];
  for (let i = 0; i < W * H; i++) if (s[i]) pts.push(i);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del: number[] = [];
      for (const i of pts) {
        if (!s[i]) continue;
        const p2 = s[i - W], p3 = s[i - W + 1], p4 = s[i + 1], p5 = s[i + W + 1];
        const p6 = s[i + W], p7 = s[i + W - 1], p8 = s[i - 1], p9 = s[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        del.push(i);
      }
      for (const i of del) s[i] = 0;
      if (del.length) changed = true;
    }
    pts = pts.filter((i) => s[i]);
  }
  return s;
}

const NB = (W: number) => [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1]; // N, NE, E, SE, S, SW, W, NW
const ORTHO = [0, 2, 4, 6];

/** Número de cruces (transiciones 0→1 alrededor del píxel). 1 = extremo, 2 = línea, ≥3 = unión. */
function crossing(s: Uint8Array, i: number, nb: number[]) {
  let c = 0;
  for (let k = 0; k < 8; k++) if (!s[i + nb[k]] && s[i + nb[(k + 1) % 8]]) c++;
  return c;
}

/**
 * Convierte el esqueleto en polilíneas entre extremos y uniones.
 * Se eliminan las ramas espurias más cortas que `minSpur`.
 */
export function skeletonPaths(s: Uint8Array, W: number, H: number, minSpur: number): Vec[][] {
  const nb = NB(W);
  const N = W * H;
  const kind = new Uint8Array(N); // 1 extremo, 2 línea, 3 unión
  for (let i = 0; i < N; i++) {
    if (!s[i]) continue;
    const c = crossing(s, i, nb);
    kind[i] = c <= 1 ? 1 : c === 2 ? 2 : 3;
  }
  const visited = new Uint8Array(N);
  const paths: { px: number[]; a: number; b: number }[] = [];
  const walk = (start: number, first: number) => {
    const px = [start, first];
    visited[first] = 1;
    let cur = first;
    while (kind[cur] === 2) {
      let next = -1;
      for (const k of [...ORTHO, 1, 3, 5, 7]) {
        const q = cur + nb[k];
        if (!s[q] || q === px[px.length - 2]) continue;
        if (kind[q] !== 2 && q !== start) { next = q; break; }
        if (!visited[q]) { next = q; break; }
      }
      if (next < 0) break;
      if (kind[next] === 2) visited[next] = 1;
      px.push(next);
      cur = next;
      if (cur === start) break;
    }
    paths.push({ px, a: kind[start], b: kind[cur] });
  };
  for (let i = 0; i < N; i++) {
    if (!s[i] || kind[i] === 2) continue;
    for (const k of [...ORTHO, 1, 3, 5, 7]) {
      const q = i + nb[k];
      if (!s[q]) continue;
      if (kind[q] === 2 && !visited[q]) walk(i, q);
      else if (kind[q] !== 2 && q > i) {
        // dos nodos contiguos: tramo de longitud 1 (se descarta salvo que sean extremos aislados)
        if (kind[i] === 1 && kind[q] === 1) paths.push({ px: [i, q], a: 1, b: 1 });
      }
    }
  }
  // lazos cerrados sin nodos
  for (let i = 0; i < N; i++) {
    if (!s[i] || kind[i] !== 2 || visited[i]) continue;
    visited[i] = 1;
    const px = [i];
    let cur = i, prev = -1;
    for (;;) {
      let next = -1;
      for (const k of [...ORTHO, 1, 3, 5, 7]) {
        const q = cur + nb[k];
        if (s[q] && q !== prev && (!visited[q] || (q === i && px.length > 3))) { next = q; break; }
      }
      if (next < 0 || next === i) { if (next === i) px.push(i); break; }
      visited[next] = 1;
      px.push(next);
      prev = cur;
      cur = next;
    }
    if (px.length > 4) paths.push({ px, a: 2, b: 2 });
  }
  const len = (p: number[]) => p.length;
  return paths
    .filter((p) => !((p.a === 1) !== (p.b === 1) && len(p.px) < minSpur)) // espolón: extremo → unión
    .filter((p) => len(p.px) >= 2)
    .map((p) => p.px.map((i) => [(i % W) + 0.5, Math.floor(i / W) + 0.5] as Vec));
}
