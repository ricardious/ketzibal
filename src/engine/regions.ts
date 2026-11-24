import { labDist, rgbToOklab } from './color';

/** Componentes conexas (4-conectividad) sobre un mapa de etiquetas. */
export interface Components {
  comp: Int32Array;
  count: number;
  /** Etiqueta de paleta de cada componente (-1 = transparente). */
  label: Int32Array;
}

export function components(labels: Int32Array, W: number, H: number): Components {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  const compLabel: number[] = [];
  const stack = new Int32Array(N);
  let count = 0;
  for (let i = 0; i < N; i++) {
    if (comp[i] !== -1) continue;
    const l = labels[i];
    let sp = 0;
    stack[sp++] = i;
    comp[i] = count;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % W;
      if (x > 0 && comp[p - 1] === -1 && labels[p - 1] === l) { comp[p - 1] = count; stack[sp++] = p - 1; }
      if (x < W - 1 && comp[p + 1] === -1 && labels[p + 1] === l) { comp[p + 1] = count; stack[sp++] = p + 1; }
      if (p >= W && comp[p - W] === -1 && labels[p - W] === l) { comp[p - W] = count; stack[sp++] = p - W; }
      if (p < N - W && comp[p + W] === -1 && labels[p + W] === l) { comp[p + W] = count; stack[sp++] = p + W; }
    }
    compLabel.push(l);
    count++;
  }
  return { comp, count, label: Int32Array.from(compLabel) };
}

export interface RegionStats {
  area: Int32Array;
  perimeter: Int32Array;
  x0: Int32Array; y0: Int32Array; x1: Int32Array; y1: Int32Array;
  /** Aristas compartidas: adj[a].get(b) = número de aristas de píxel entre a y b. */
  adj: Map<number, number>[];
  /** Aristas sobre el borde de la imagen. */
  border: Int32Array;
}

export function regionStats(cc: Components, W: number, H: number): RegionStats {
  const n = cc.count;
  const area = new Int32Array(n), perimeter = new Int32Array(n), border = new Int32Array(n);
  const x0 = new Int32Array(n).fill(W), y0 = new Int32Array(n).fill(H);
  const x1 = new Int32Array(n).fill(-1), y1 = new Int32Array(n).fill(-1);
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const { comp } = cc;
  const link = (a: number, b: number) => {
    perimeter[a]++; perimeter[b]++;
    adj[a].set(b, (adj[a].get(b) ?? 0) + 1);
    adj[b].set(a, (adj[b].get(a) ?? 0) + 1);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, c = comp[i];
      area[c]++;
      if (x < x0[c]) x0[c] = x;
      if (x > x1[c]) x1[c] = x;
      if (y < y0[c]) y0[c] = y;
      if (y > y1[c]) y1[c] = y;
      if (x === 0 || x === W - 1) { border[c]++; perimeter[c]++; }
      if (y === 0 || y === H - 1) { border[c]++; perimeter[c]++; }
      if (x < W - 1 && comp[i + 1] !== c) link(c, comp[i + 1]);
      if (y < H - 1 && comp[i + W] !== c) link(c, comp[i + W]);
    }
  }
  return { area, perimeter, x0, y0, x1, y1, adj, border };
}

/**
 * Elimina ruido: regiones menores que `minArea` y franjas finas de antialiasing
 * (regiones de ~1–2 px de ancho cuyo color es intermedio entre sus vecinas).
 * Los píxeles eliminados se reparten entre las regiones vecinas creciendo desde el borde.
 */
export function cleanupLabels(labels: Int32Array, lab: Float32Array, W: number, H: number, minArea: number, rgba?: Uint8ClampedArray) {
  for (let pass = 0; pass < 3; pass++) {
    const cc = components(labels, W, H);
    const st = regionStats(cc, W, H);
    // color medio real de cada región (más fiable que el de la paleta para franjas de borde)
    let mean: Float32Array | null = null;
    if (rgba) {
      const acc = new Float64Array(cc.count * 3);
      for (let i = 0; i < W * H; i++) {
        const c = cc.comp[i] * 3, p = i * 4;
        acc[c] += rgba[p]; acc[c + 1] += rgba[p + 1]; acc[c + 2] += rgba[p + 2];
      }
      mean = new Float32Array(cc.count * 3);
      for (let c = 0; c < cc.count; c++) {
        const a = st.area[c];
        rgbToOklab(Math.round(acc[c * 3] / a), Math.round(acc[c * 3 + 1] / a), Math.round(acc[c * 3 + 2] / a), mean, c * 3);
      }
    }
    const remove = new Uint8Array(cc.count);
    let any = false;
    for (let c = 0; c < cc.count; c++) {
      const a = st.area[c];
      if (a < minArea) { remove[c] = 1; any = true; continue; }
      if (cc.label[c] < 0 || a / st.perimeter[c] >= 1.0) continue;
      // Franja fina: ¿su color está entre los de sus dos vecinas principales?
      const nb = [...st.adj[c].entries()]
        .filter(([o]) => cc.label[o] !== cc.label[c] && cc.label[o] >= 0)
        .sort((p, q) => q[1] - p[1]);
      if (nb.length < 2) continue;
      const la = cc.label[nb[0][0]] * 3, lb = cc.label[nb[1][0]] * 3;
      if (la === lb) continue;
      const cs = mean ?? lab, lc = mean ? c * 3 : cc.label[c] * 3;
      const dab = labDist(lab, la, lab, lb);
      if (labDist(lab, la, cs, lc) + labDist(cs, lc, lab, lb) < dab * 1.2) { remove[c] = 1; any = true; }
    }
    if (!any) return;
    // Crecimiento multi-fuente desde los píxeles conservados.
    const dead = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (remove[cc.comp[i]]) dead[i] = 1;
    if (!growInto(labels, dead, W, H, lab, true)) return;
  }
}

/**
 * Reasigna los píxeles marcados en `dead` creciendo desde sus vecinos vivos, una capa por paso
 * (los frentes opuestos se encuentran en la línea media). Con `byColor`, cada píxel elige al
 * vecino de color más parecido al suyo. Devuelve false si no había ningún píxel vivo.
 */
export function growInto(labels: Int32Array, dead: Uint8Array, W: number, H: number, lab: Float32Array, byColor: boolean): boolean {
  const N = W * H;
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (dead[i] && hasLiveNeighbor(dead, i, W, H)) frontier.push(i);
  if (frontier.length === 0) return false;
  while (frontier.length) {
    const assigned: [number, number][] = [];
    for (const i of frontier) {
      if (!dead[i]) continue;
      const own = byColor && labels[i] >= 0 ? labels[i] * 3 : -1;
      let best = -2, bd = Infinity;
      const x = i % W;
      const cand = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const n of cand) {
        if (n < 0 || n >= N || dead[n]) continue;
        const l = labels[n];
        const d = own < 0 || l < 0 ? 1 : labDist(lab, own, lab, l * 3);
        if (d < bd) { bd = d; best = l; }
      }
      if (best !== -2) assigned.push([i, best]);
    }
    const next: number[] = [];
    for (const [i, l] of assigned) { labels[i] = l; dead[i] = 0; }
    for (const [i] of assigned) {
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        // dead = 2 marca "ya en cola" para no duplicar
        if (n >= 0 && n < N && dead[n] === 1) { dead[n] = 2; next.push(n); }
      }
    }
    for (const n of next) dead[n] = 1;
    frontier = next;
  }
  return true;
}

/**
 * Filtro de mayoría limitado a los píxeles de `area` (p. ej., la tinta retirada). Endereza las
 * fronteras que el crecimiento por BFS deja bajo la tinta sin mover los bordes visibles.
 */
export function majoritySmooth(labels: Int32Array, area: Uint8Array, W: number, H: number, nLabels: number, r: number, iters: number) {
  const K = nLabels + 1; // la última clase es "transparente" (-1)
  const W1 = W + 1;
  const ii = new Int32Array(K * W1 * (H + 1));
  const idx: number[] = [];
  for (let i = 0; i < W * H; i++) if (area[i]) idx.push(i);
  if (!idx.length) return;
  for (let it = 0; it < iters; it++) {
    ii.fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = labels[y * W + x];
        const k = l < 0 ? nLabels : l;
        for (let c = 0; c < K; c++) {
          const o = c * W1 * (H + 1);
          ii[o + (y + 1) * W1 + x + 1] = ii[o + y * W1 + x + 1] + ii[o + (y + 1) * W1 + x] - ii[o + y * W1 + x] + (c === k ? 1 : 0);
        }
      }
    }
    const next = labels.slice();
    let changed = 0;
    for (const i of idx) {
      const x = i % W, y = (i / W) | 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      let best = -1, bn = -1;
      for (let c = 0; c < K; c++) {
        const o = c * W1 * (H + 1);
        const n = ii[o + y1 * W1 + x1] - ii[o + y0 * W1 + x1] - ii[o + y1 * W1 + x0] + ii[o + y0 * W1 + x0];
        if (n > bn) { bn = n; best = c; }
      }
      const l = best === nLabels ? -1 : best;
      if (l !== labels[i]) { next[i] = l; changed++; }
    }
    labels.set(next);
    if (!changed) break;
  }
}

function hasLiveNeighbor(dead: Uint8Array, i: number, W: number, H: number) {
  const x = i % W, y = (i / W) | 0;
  return (x > 0 && !dead[i - 1]) || (x < W - 1 && !dead[i + 1]) || (y > 0 && !dead[i - W]) || (y < H - 1 && !dead[i + W]);
}

/** Máscara binaria local de una región, con 1 px de margen. */
export interface LocalMask {
  ox: number; oy: number; w: number; h: number;
  data: Uint8Array;
}

export function regionMask(cc: Components, st: RegionStats, c: number, W: number): LocalMask {
  const ox = st.x0[c] - 1, oy = st.y0[c] - 1;
  const w = st.x1[c] - st.x0[c] + 3, h = st.y1[c] - st.y0[c] + 3;
  const data = new Uint8Array(w * h);
  for (let y = st.y0[c]; y <= st.y1[c]; y++) {
    for (let x = st.x0[c]; x <= st.x1[c]; x++) {
      if (cc.comp[y * W + x] === c) data[(y - oy) * w + (x - ox)] = 1;
    }
  }
  return { ox, oy, w, h, data };
}

/**
 * Huecos de una máscara: componentes del complemento no alcanzables desde el marco.
 * Devuelve un id de hueco por píxel local (0 = no hueco) y el número de huecos.
 */
export function maskHoles(m: LocalMask): { hole: Int32Array; count: number } {
  const { w, h, data } = m;
  const hole = new Int32Array(w * h); // 0 sin visitar, -1 exterior, >0 hueco
  const stack: number[] = [];
  const flood = (start: number, id: number) => {
    stack.push(start);
    hole[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h || hole[q] !== 0 || data[q]) continue;
        hole[q] = id;
        stack.push(q);
      }
    }
  };
  flood(0, -1); // el margen garantiza que (0,0) es exterior
  let count = 0;
  for (let p = 0; p < w * h; p++) if (!data[p] && hole[p] === 0) flood(p, ++count);
  for (let p = 0; p < w * h; p++) if (hole[p] < 0) hole[p] = 0;
  return { hole, count };
}
