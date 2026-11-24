import { traceContours, type Contour } from './contour';
import { detectCorners, fitClosed, fitOpen, mapLoop, refineCorner, smoothClosed, smoothOpen } from './curve';
import { quantize } from './quantize';
import { cleanupLabels, components, growInto, maskHoles, regionMask, regionStats, type Components, type LocalMask, type RegionStats } from './regions';
import { detectInk, distanceTransform, skeletonPaths, thin, type Ink } from './lineart';
import { recognize } from './shapes';
import { detectGlobalSymmetry, detectSymmetry, mirrorLoop, mirrorShape, reflectPoint, symmetrizeHalf } from './symmetry';
import type { BezierLoop, BezierPath, Layer, Progress, RasterImage, Shape, ShapeKind, SymmetryAxis, Vec, VectorizeParams, VectorizeResult } from './types';
import { convexHull, dist, inPolygon, segDist } from './vec';
import { KIND_NAMES } from './names';

type OnProgress = (p: Progress) => void;


/** Reduce la imagen por promedio de área. */
function downscale(img: RasterImage, maxSide: number): { img: RasterImage; s: number } {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s >= 1) return { img, s: 1 };
  const W = Math.max(1, Math.round(img.width * s)), H = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(W * H * 4);
  const fx = img.width / W, fy = img.height / H;
  for (let y = 0; y < H; y++) {
    const sy0 = Math.floor(y * fy), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < W; x++) {
      const sx0 = Math.floor(x * fx), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const p = (yy * img.width + xx) * 4;
        const al = img.data[p + 3];
        r += img.data[p] * al; g += img.data[p + 1] * al; b += img.data[p + 2] * al; a += al; n++;
      }
      const o = (y * W + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { img: { width: W, height: H, data: out }, s: W / img.width };
}

interface Node {
  c: number;
  parent: number; // -1 = raíz
  children: number[];
  filledArea: number;
  realHoles: Set<number>; // ids de hueco locales
  rank: number;
}

export function vectorize(src: RasterImage, params: VectorizeParams, onProgress: OnProgress = () => {}): VectorizeResult {
  const t0 = performance.now();
  onProgress({ stage: 'Preparando imagen', value: 0.02 });
  const { img, s: scale } = downscale(src, params.maxSide);
  const W = img.width, H = img.height;

  onProgress({ stage: 'Cuantizando paleta', value: 0.1 });
  const q = quantize(img, params.colors);
  onProgress({ stage: 'Limpiando regiones', value: 0.3 });
  cleanupLabels(q.labels, q.lab, W, H, Math.max(2, params.minArea), img.data);

  // Dibujo lineal: la tinta se retira del mapa de etiquetas y los rellenos crecen hasta su línea media.
  let ink: Ink | null = null;
  if (params.lineArt) {
    const cc0 = components(q.labels, W, H);
    ink = detectInk(cc0, regionStats(cc0, W, H), q.lab, W, H);
    if (ink) {
      growInto(q.labels, ink.mask.slice(), W, H, q.lab, false);
      cleanupLabels(q.labels, q.lab, W, H, Math.max(2, params.minArea));
    }
  }
  const cc = components(q.labels, W, H);
  const st = regionStats(cc, W, H);

  onProgress({ stage: 'Detección por capas', value: 0.45 });
  const hasTransparency = cc.label.some((l) => l < 0);
  // Fondo: la región opaca con más borde de imagen.
  let bg = -1;
  if (!hasTransparency) {
    let bb = -1;
    for (let c = 0; c < cc.count; c++) if (st.border[c] > bb) { bb = st.border[c]; bg = c; }
  }

  // Árbol de contención: para cada región, sus huecos y lo que contienen.
  const nodes: Node[] = Array.from({ length: cc.count }, (_, c) => ({ c, parent: -1, children: [], filledArea: st.area[c], realHoles: new Set(), rank: -1 }));
  const holeContents: Map<number, Map<number, number>>[] = Array.from({ length: cc.count }, () => new Map()); // c → hole → (comp → área)
  const enclosers: number[][] = Array.from({ length: cc.count }, () => []);
  for (let c = 0; c < cc.count; c++) {
    if (c === bg || cc.label[c] < 0) continue;
    const m = regionMask(cc, st, c, W);
    const { hole, count } = maskHoles(m);
    if (count === 0) continue;
    const contents = holeContents[c];
    for (let p = 0; p < hole.length; p++) {
      const h = hole[p];
      if (!h) continue;
      nodes[c].filledArea++;
      const x = m.ox + (p % m.w), y = m.oy + Math.floor(p / m.w);
      const o = cc.comp[y * W + x];
      let mm = contents.get(h);
      if (!mm) contents.set(h, (mm = new Map()));
      mm.set(o, (mm.get(o) ?? 0) + 1);
    }
    for (const mm of contents.values()) for (const o of mm.keys()) enclosers[o].push(c);
  }
  for (let c = 0; c < cc.count; c++) {
    if (c === bg) continue;
    let best = -1;
    for (const e of enclosers[c]) if (best < 0 || nodes[e].filledArea < nodes[best].filledArea) best = e;
    nodes[c].parent = best >= 0 ? best : bg;
  }

  // Siluetas: si una figura está delimitada por tinta, su unión completa es la capa base.
  const virt: { mask: LocalMask; label: number; area: number }[] = [];
  const total = () => cc.count + virt.length;
  const labelOf = (c: number) => (c < cc.count ? cc.label[c] : virt[c - cc.count].label);
  const areaOf = (c: number) => (c < cc.count ? st.area[c] : virt[c - cc.count].area);
  const pendingAbsorb: number[] = [];
  if (ink) {
    const fg = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) fg[i] = cc.comp[i] !== bg && q.labels[i] >= 0 ? 1 : 0;
    const figs = components(fg, W, H);
    const fst = regionStats(figs, W, H);
    for (let f = 0; f < figs.count; f++) {
      if (figs.label[f] !== 1 || fst.area[f] < W * H * 0.002) continue;
      const regionArea = new Map<number, number>();
      let edge = 0, inked = 0;
      for (let y = fst.y0[f]; y <= fst.y1[f]; y++) for (let x = fst.x0[f]; x <= fst.x1[f]; x++) {
        const i = y * W + x;
        if (figs.comp[i] !== f) continue;
        regionArea.set(cc.comp[i], (regionArea.get(cc.comp[i]) ?? 0) + 1);
        const border = x === 0 || y === 0 || x === W - 1 || y === H - 1 || figs.comp[i - 1] !== f || figs.comp[i + 1] !== f || figs.comp[i - W] !== f || figs.comp[i + W] !== f;
        if (border) { edge++; if (ink.mask[i]) inked++; }
      }
      if (regionArea.size < 2 || inked < edge * 0.5) continue;
      // color dominante de la figura
      const byLabel = new Map<number, number>();
      for (const [c, a] of regionArea) byLabel.set(cc.label[c], (byLabel.get(cc.label[c]) ?? 0) + a);
      const silLabel = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const mask = regionMask(figs, fst, f, W);
      const v = cc.count + virt.length;
      virt.push({ mask, label: silLabel, area: fst.area[f] });
      nodes.push({ c: v, parent: bg, children: [], filledArea: fst.area[f], realHoles: new Set(), rank: -1 });
      enclosers.push([]);
      const contents = new Map<number, Map<number, number>>();
      const { hole, count } = maskHoles(mask);
      for (let p = 0; p < hole.length && count; p++) {
        if (!hole[p]) continue;
        nodes[v].filledArea++;
        const o = cc.comp[(mask.oy + Math.floor(p / mask.w)) * W + mask.ox + (p % mask.w)];
        let mm = contents.get(hole[p]);
        if (!mm) contents.set(hole[p], (mm = new Map()));
        mm.set(o, (mm.get(o) ?? 0) + 1);
      }
      holeContents.push(contents);
      for (const [c] of regionArea) {
        if (nodes[c].parent !== bg && nodes[c].parent >= 0) continue;
        nodes[c].parent = v;
        if (cc.label[c] === silLabel) pendingAbsorb.push(c);
      }
    }
  }
  // Huecos reales: el contenido tiene el color de lo que hay debajo de la figura.
  // Se evalúa de afuera hacia adentro para no encadenar absorciones.
  const absorbed = new Uint8Array(total());
  for (const c of pendingAbsorb) absorbed[c] = 1;
  const liveParent = (c: number) => {
    let p = nodes[c].parent;
    while (p >= 0 && absorbed[p]) p = nodes[p].parent;
    return p;
  };
  const depthOf = (c: number) => { let d = 0; for (let p = nodes[c].parent; p >= 0; p = nodes[p].parent) d++; return d; };
  const byDepth = [...Array(total()).keys()].map((c) => [c, depthOf(c)]).sort((x, y) => x[1] - y[1]).map((x) => x[0]);
  for (const c of byDepth) {
    if (absorbed[c] || labelOf(c) < 0) continue;
    const P = liveParent(c);
    const under = P >= 0 ? labelOf(P) : -1;
    for (const [h, mm] of holeContents[c]) {
      let tot = 0, same = 0;
      const direct: number[] = [];
      for (const [o, a] of mm) {
        tot += a;
        if (liveParent(o) === c) direct.push(o);
        if (cc.label[o] === under) same += a;
      }
      if (same > tot * 0.5) {
        nodes[c].realHoles.add(h);
        for (const o of direct) if (cc.label[o] === under) absorbed[o] = 1;
      }
    }
  }
  // Re-asignar hijos de regiones absorbidas a la figura del hueco.
  for (let c = 0; c < total(); c++) nodes[c].parent = liveParent(c);
  const isLayer = (c: number) => !absorbed[c] && labelOf(c) >= 0;
  for (let c = 0; c < total(); c++) if (isLayer(c) && c !== bg && nodes[c].parent >= 0) nodes[nodes[c].parent].children.push(c);
  const roots: number[] = [];
  for (let c = 0; c < total(); c++) if (isLayer(c) && (c === bg || nodes[c].parent < 0)) roots.push(c);

  // Orden Z entre hermanas: la que muestra un borde cóncavo hacia la otra queda debajo.
  const bndCache = new Map<number, { b: Int32Array; hull: Vec[] }>();
  const bndOf = (c: number) => {
    let v = bndCache.get(c);
    if (!v) { const b = boundaryList(cc, st, c, W, H); v = { b, hull: hullFromBoundary(b) }; bndCache.set(c, v); }
    return v;
  };
  const orderSiblings = (sib: number[]) => {
    if (sib.length < 2) return sib;
    const set = new Set(sib);
    const above = new Map<number, Set<number>>(); // a → regiones que van encima de a
    const indeg = new Map<number, number>(sib.map((c) => [c, 0]));
    for (const a of sib) {
      if (a >= cc.count) continue;
      for (const [b] of st.adj[a]) {
        if (b <= a || !set.has(b)) continue;
        const A = bndOf(a), B = bndOf(b);
        const da = concavity(A.b, b, A.hull), db = concavity(B.b, a, B.hull);
        let lower = -1, upper = -1;
        if (da > db + 0.15) { lower = a; upper = b; }
        else if (db > da + 0.15) { lower = b; upper = a; }
        if (lower < 0) continue;
        if (!above.has(lower)) above.set(lower, new Set());
        if (!above.get(lower)!.has(upper)) { above.get(lower)!.add(upper); indeg.set(upper, indeg.get(upper)! + 1); }
      }
    }
    const out: number[] = [];
    const left = new Set(sib);
    while (left.size) {
      let pick = -1;
      for (const c of left) if (indeg.get(c) === 0 && (pick < 0 || nodes[c].filledArea > nodes[pick].filledArea)) pick = c;
      if (pick < 0) for (const c of left) if (pick < 0 || nodes[c].filledArea > nodes[pick].filledArea) pick = c; // ciclo
      left.delete(pick);
      out.push(pick);
      for (const u of above.get(pick) ?? []) indeg.set(u, indeg.get(u)! - 1);
    }
    return out;
  };
  const order: number[] = [];
  const visit = (c: number) => {
    nodes[c].rank = order.length;
    order.push(c);
    for (const k of orderSiblings(nodes[c].children)) visit(k);
  };
  const rootOrder = bg >= 0 ? [bg, ...orderSiblings(roots.filter((r) => r !== bg))] : orderSiblings(roots);
  for (const r of rootOrder) visit(r);
  // los hijos del fondo se ordenan como hermanas de nivel superior
  const rank = new Int32Array(total()).fill(-1);
  for (const c of order) rank[c] = nodes[c].rank;

  // Eje de simetría global de la composición
  const globalAxis = params.symmetry ? detectGlobalSymmetry(q.labels, W, H) : null;

  onProgress({ stage: 'Reconstruyendo figuras', value: 0.55 });
  const layers: Layer[] = [];
  const idOf = (c: number) => `capa-${nodes[c].rank + 1}`;
  const counters: Partial<Record<ShapeKind, number>> = {};
  const strokedRecords: { c: number; pts: Vec[]; outside: Int32Array; rank: number; width: number }[] = [];
  const sigma = 0.6 + (params.smoothing / 100) * 3.4;
  const tol = Math.max(0.25, params.tolerance);

  for (let oi = 0; oi < order.length; oi++) {
    const c = order[oi];
    if (oi % 8 === 0) onProgress({ stage: 'Reconstruyendo figuras', value: 0.55 + 0.43 * (oi / order.length) });
    const fill = q.hex[labelOf(c)];
    let layer: Omit<Layer, 'id' | 'name'>;
    if (c === bg) {
      const shape: Shape = { type: 'rect', cx: W / 2, cy: H / 2, w: W, h: H, rx: 0, rotation: 0 };
      layer = base('background', shape, shape, fill, -1, 0, areaOf(c));
    } else {
      const res = buildLayer(c);
      if (!res) continue;
      layer = res;
    }
    const n = (counters[layer.kind] = (counters[layer.kind] ?? 0) + 1);
    layers.push({ ...layer, id: idOf(c), name: layer.kind === 'background' ? 'Fondo' : `${KIND_NAMES[layer.kind]} ${n}` });
  }

  function base(kind: ShapeKind, shape: Shape, freeform: Shape, fill: string, parent: number, depth: number, area: number): Omit<Layer, 'id' | 'name'> {
    return {
      kind, shape, freeform, fill, stroke: null, opacity: 1, visible: true, holes: [], dx: 0, dy: 0,
      parentId: parent >= 0 ? idOf(parent) : null, depth, area, reconstructed: false, symmetry: null, fitError: 0,
    };
  }

  function buildLayer(c: number): Omit<Layer, 'id' | 'name'> | null {
    const m = filledMask(c);
    const conts = traceContours(m, W, H);
    const outer = conts.filter((k) => k.area > 0).sort((a, b) => b.area - a.area)[0];
    if (!outer || outer.pts.length < 4) return null;
    const myRank = rank[c];
    const visible = new Uint8Array(outer.pts.length);
    let occludedN = 0;
    for (let i = 0; i < outer.pts.length; i++) {
      const o = outer.outside[i];
      const v = o >= 0 && !(rank[cc.comp[o]] > myRank);
      visible[i] = v ? 1 : 0;
      if (!v) occludedN++;
    }
    const occluded = occludedN > 0;
    // ¿el borde es tinta? → la capa lleva contorno con grosor
    let stroke: Layer['stroke'] = null;
    if (ink) {
      let k = 0;
      for (let i = 0; i < outer.pts.length; i++) { const o = outer.outside[i]; if (o >= 0 && ink.mask[o]) k++; }
      if (k >= outer.pts.length * 0.8) stroke = { color: q.hex[ink.label], width: ink.width };
      if (stroke) strokedRecords.push({ c, pts: outer.pts, outside: outer.outside, rank: myRank, width: ink.width });
    }
    let depth = 0;
    for (let p = nodes[c].parent; p >= 0; p = nodes[p].parent) depth++;

    // eje de simetría propio (o global si coincide)
    let axis: SymmetryAxis | null = null;
    if (params.symmetry && !occluded) {
      axis = detectSymmetry(m);
      if (axis && globalAxis && Math.abs(axis.angle - globalAxis.angle) < 2) {
        const off = Math.abs(globalAxis.angle === 90 ? axis.p[0] - globalAxis.p[0] : axis.p[1] - globalAxis.p[1]);
        if (off < 1.5) axis = { ...globalAxis, score: axis.score };
      }
    }

    const light = smoothClosed(outer.pts, 1.0);
    let half: Vec[] | null = null;
    let basePts = light;
    if (axis) {
      half = symmetrizeHalf(light, axis);
      if (half) basePts = mirrorClosedPts(half, axis);
      else axis = null;
    }

    const coverOk = (x: number, y: number): 0 | 1 | 2 => {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 2;
      const o = cc.comp[yi * W + xi];
      if (o === c || isInside(m, xi, yi)) return 1;
      return rank[o] > myRank ? 2 : 0;
    };

    // Trazado libre (con extensión bajo capas superiores para evitar rendijas)
    let freeform: Shape;
    if (axis && half) {
      freeform = { type: 'path', loop: halfToLoop(half, axis) };
    } else {
      const src = occluded ? outerOf(traceContours(underpaint(m, myRank), W, H)) ?? outer : outer;
      freeform = { type: 'path', loop: contourToLoop(src.pts) };
    }

    let kind: ShapeKind = 'path';
    let shape: Shape = freeform;
    let recognized: Shape | undefined;
    let reconstructed = false;
    let fitError = 0;
    if (params.detectShapes) {
      const rec = recognize({
        pts: basePts, visible: axis ? new Uint8Array(basePts.length).fill(1) : visible,
        area: outer.area, tol, allowCompletion: params.reconstructHidden, coverOk,
      });
      if (rec) {
        kind = rec.kind;
        shape = recognized = rec.shape;
        reconstructed = rec.reconstructed;
        fitError = rec.error;
        if (axis) shape = recognized = snapToAxis(rec.shape, axis);
      }
    }

    // Huecos reales
    const holes: Shape[] = [];
    for (const h of conts.filter((k) => k.area < 0 && -k.area >= 4)) {
      const pts = smoothClosed(h.pts, 1.0);
      let hs: Shape | null = null;
      if (params.detectShapes) {
        const r = recognize({ pts, visible: new Uint8Array(pts.length).fill(1), area: -h.area, tol, allowCompletion: false });
        if (r) hs = r.shape;
      }
      holes.push(hs ?? { type: 'path', loop: contourToLoop(h.pts) });
    }

    if (c >= cc.count && kind === 'path') kind = 'silhouette';
    const l = base(kind, shape, freeform, q.hex[labelOf(c)], nodes[c].parent, depth, areaOf(c));
    return { ...l, stroke, holes, recognized, reconstructed, symmetry: axis, fitError };
  }

  function contourToLoop(raw: Vec[]): BezierLoop {
    const light = smoothClosed(raw, 1.0);
    const corners = detectCorners(light);
    const span = Math.max(3, Math.min(8, Math.round(light.length / 30)));
    const p = light.map((v) => [v[0], v[1]] as Vec);
    for (const i of corners) p[i] = refineCorner(light, i, span);
    // suavizado por tramos entre esquinas (las esquinas quedan fijas)
    let smooth: Vec[];
    if (corners.length === 0) smooth = smoothClosed(raw, sigma);
    else {
      smooth = p.slice();
      for (let k = 0; k < corners.length; k++) {
        const a = corners[k], b = corners[(k + 1) % corners.length];
        const run: number[] = [];
        for (let i = a; ; i = (i + 1) % p.length) { run.push(i); if (i === b && run.length > 1) break; }
        const sm = smoothOpen(run.map((i) => p[i]), sigma);
        run.forEach((i, j) => { if (j > 0 && j < run.length - 1) smooth[i] = sm[j]; });
      }
    }
    return fitClosed(smooth, corners, tol);
  }

  function halfToLoop(half: Vec[], axis: SymmetryAxis): BezierLoop {
    const sm = smoothOpen(half, sigma);
    const corners = detectCorners(mirrorClosedPts(sm, axis)).filter((i) => i > 0 && i < sm.length - 1);
    const a = (axis.angle * Math.PI) / 180;
    const nrm: Vec = [-Math.sin(a), Math.cos(a)];
    // en el eje, la tangente es perpendicular al eje salvo que sea una punta
    const tanAt = (i: number, towards: number): Vec | undefined => {
      const d = sub2(sm[towards], sm[i]);
      const along = Math.abs(d[0] * Math.cos(a) + d[1] * Math.sin(a)) / (Math.hypot(...d) || 1);
      if (along > 0.6) return undefined; // punta: tangente libre
      const sgn = d[0] * nrm[0] + d[1] * nrm[1] >= 0 ? 1 : -1;
      return [nrm[0] * sgn, nrm[1] * sgn];
    };
    const cuts = [0, ...corners, sm.length - 1];
    const segs = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const run = sm.slice(cuts[k], cuts[k + 1] + 1);
      const t1 = k === 0 ? tanAt(0, Math.min(3, sm.length - 1)) : undefined;
      const t2 = k === cuts.length - 2 ? tanAt(sm.length - 1, Math.max(0, sm.length - 4)) : undefined;
      segs.push(...fitOpen(run, tol, t1, t2));
    }
    return mirrorLoop(sm[0], segs, axis);
  }

  function filledMask(c: number): LocalMask {
    const m = c < cc.count ? regionMask(cc, st, c, W) : { ...virt[c - cc.count].mask, data: virt[c - cc.count].mask.data.slice() };
    if (!nodes[c].filledArea || nodes[c].filledArea === areaOf(c)) return m;
    const { hole } = maskHoles(m);
    for (let p = 0; p < hole.length; p++) if (hole[p] && !nodes[c].realHoles.has(hole[p])) m.data[p] = 1;
    return m;
  }

  /** Extiende la máscara 2 px sobre las capas superiores vecinas. */
  function underpaint(m: LocalMask, myRank: number): LocalMask {
    const R = 2;
    const w = m.w + 2 * R, h = m.h + 2 * R, ox = m.ox - R, oy = m.oy - R;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) data[(y + R) * w + x + R] = 1;
    const grown = data.slice();
    for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
      if (data[y * w + x]) continue;
      const gx = ox + x, gy = oy + y;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
      if (!(rank[cc.comp[gy * W + gx]] > myRank)) continue;
      let near = false;
      for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R && !near; dx++) if (dx * dx + dy * dy <= R * R && data[(y + dy) * w + x + dx]) near = true;
      if (near) grown[y * w + x] = 1;
    }
    return { ox, oy, w, h, data: grown };
  }

  if (ink) {
    onProgress({ stage: 'Reconstruyendo figuras', value: 0.97 });
    const built = new Set(layers.map((l) => l.id));
    const stroked = new Uint8Array(total());
    for (const r of strokedRecords) if (built.has(idOf(r.c))) stroked[r.c] = 1;
    layers.push(...freeStrokes(ink, strokedRecords.filter((r) => stroked[r.c]), stroked));
  }

  /**
   * Trazos libres: el esqueleto de la tinta que no coincide con el contorno de una capa con trazo
   * (bigotes, boca, líneas interiores) se ajusta como trazados abiertos con grosor.
   */
  function freeStrokes(ink: Ink, recs: typeof strokedRecords, stroked: Uint8Array): Layer[] {
    const covered = new Uint8Array(W * H);
    for (const r of recs) {
      const rad = Math.max(1.5, r.width * 0.65);
      for (let i = 0; i < r.pts.length; i++) {
        const o = r.outside[i];
        const [mx, my] = r.pts[i];
        // píxel interior (reflejo del exterior respecto al punto medio de la arista)
        const ox = o >= 0 ? (o % W) + 0.5 : mx, oy = o >= 0 ? Math.floor(o / W) + 0.5 : my;
        const ix = Math.floor(2 * mx - ox), iy = Math.floor(2 * my - oy);
        if (ix >= 0 && iy >= 0 && ix < W && iy < H) {
          const ic = cc.comp[iy * W + ix];
          // una capa superior sin trazo tapa media línea: allí se mantiene el trazo libre
          if (rank[ic] > r.rank && !stroked[ic]) continue;
        }
        const R = Math.ceil(rad);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const x = Math.floor(mx + dx), y = Math.floor(my + dy);
          if (x >= 0 && y >= 0 && x < W && y < H) covered[y * W + x] = 1;
        }
      }
    }
    const skel = thin(ink.mask, W, H);
    const dt = distanceTransform(ink.mask, W, H);
    const minLen = Math.max(3, ink.width * 0.8);
    const runs: { pts: Vec[]; idx: number[] }[] = [];
    for (const path of skeletonPaths(skel, W, H, ink.width * 1.5)) {
      let cur: Vec[] = [];
      const flush = () => { if (cur.length >= minLen) runs.push({ pts: cur, idx: cur.map((p) => Math.floor(p[1]) * W + Math.floor(p[0])) }); cur = []; };
      for (const p of path) {
        if (covered[Math.floor(p[1]) * W + Math.floor(p[0])]) flush();
        else cur.push(p);
      }
      flush();
    }
    // agrupar tramos que se tocan en un mismo trazo
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ends = runs.map((r) => [r.pts[0], r.pts[r.pts.length - 1]]);
    for (let a = 0; a < runs.length; a++) for (let b = a + 1; b < runs.length; b++) {
      if (ends[a].some((p) => ends[b].some((q) => Math.abs(p[0] - q[0]) <= 2 && Math.abs(p[1] - q[1]) <= 2))) parent[find(a)] = find(b);
    }
    const groups = new Map<number, number[]>();
    runs.forEach((_, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(i); });
    const out: Layer[] = [];
    let n = 0;
    const ssig = Math.max(1, sigma * 0.8, ink.width * 0.35);
    for (const idxs of groups.values()) {
      const paths: BezierPath[] = [];
      const widths: number[] = [];
      let len = 0;
      for (const i of idxs) {
        const r = runs[i];
        const closed = r.pts.length > 8 && Math.abs(r.pts[0][0] - r.pts[r.pts.length - 1][0]) <= 1.5 && Math.abs(r.pts[0][1] - r.pts[r.pts.length - 1][1]) <= 1.5;
        if (closed) {
          const ring = r.pts.slice(0, -1);
          const loop = fitClosed(smoothClosed(ring, ssig), [], tol);
          paths.push({ ...loop, closed: true });
        } else {
          const sm = smoothOpen(r.pts, ssig);
          paths.push({ start: sm[0], segs: fitOpen(sm, tol) });
        }
        for (const k of r.idx) widths.push(2 * dt[k] - 0.5);
        len += r.pts.length;
      }
      widths.sort((a, b) => a - b);
      const width = Math.max(1, widths[Math.floor(widths.length / 2)] ?? ink.width);
      const shape: Shape = { type: 'strokes', paths };
      n++;
      out.push({
        id: `trazo-${n}`, name: `Trazo ${n}`, kind: 'stroke', shape, freeform: shape, fill: 'none',
        stroke: { color: q.hex[ink.label], width }, opacity: 1, visible: true, holes: [], dx: 0, dy: 0,
        parentId: null, depth: 0, area: len * width, reconstructed: false, symmetry: null, fitError: 0,
      });
    }
    return out;
  }

  // Simetría global: figuras gemelas a ambos lados del eje se reflejan exactamente.
  if (globalAxis) mirrorTwins(layers, globalAxis);

  // Escalar a coordenadas de la imagen original
  const inv = 1 / scale;
  const out = scale === 1 ? layers : layers.map((l) => scaleLayer(l, inv));
  const ga = globalAxis && { ...globalAxis, p: [globalAxis.p[0] * inv, globalAxis.p[1] * inv] as Vec };
  onProgress({ stage: 'Listo', value: 1 });
  return {
    width: src.width, height: src.height, layers: out, palette: q.hex, globalAxis: ga,
    stats: { regions: cc.count, ms: Math.round(performance.now() - t0), workScale: scale },
  };
}

// ───────────────────────── utilidades ─────────────────────────

function sub2(a: Vec, b: Vec): Vec { return [a[0] - b[0], a[1] - b[1]]; }

function mirrorClosedPts(half: Vec[], axis: SymmetryAxis): Vec[] {
  return [...half, ...half.slice(1, -1).reverse().map((p) => reflectPoint(p, axis))];
}

function outerOf(cs: Contour[]) { return cs.filter((k) => k.area > 0).sort((a, b) => b.area - a.area)[0]; }

function isInside(m: LocalMask, x: number, y: number) {
  const lx = x - m.ox, ly = y - m.oy;
  return lx >= 0 && ly >= 0 && lx < m.w && ly < m.h && m.data[ly * m.w + lx] === 1;
}

/** Píxeles de borde de una región: x, y y las 4 regiones vecinas (−1 fuera de la imagen). */
function boundaryList(cc: Components, st: RegionStats, c: number, W: number, H: number): Int32Array {
  const out: number[] = [];
  for (let y = st.y0[c]; y <= st.y1[c]; y++) for (let x = st.x0[c]; x <= st.x1[c]; x++) {
    const i = y * W + x;
    if (cc.comp[i] !== c) continue;
    const l = x > 0 ? cc.comp[i - 1] : -1, r = x < W - 1 ? cc.comp[i + 1] : -1;
    const u = y > 0 ? cc.comp[i - W] : -1, d = y < H - 1 ? cc.comp[i + W] : -1;
    if (l !== c || r !== c || u !== c || d !== c) out.push(x, y, l, r, u, d);
  }
  return Int32Array.from(out);
}

function hullFromBoundary(b: Int32Array): Vec[] {
  const pts: Vec[] = [];
  for (let k = 0; k < b.length; k += 6) { const x = b[k], y = b[k + 1]; pts.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]); }
  return convexHull(pts);
}

/** Fracción de la frontera a–b que queda hundida dentro del cierre convexo de a (a está tapada por b). */
function concavity(bnd: Int32Array, b: number, hull: Vec[]): number {
  let deep = 0, tot = 0;
  for (let k = 0; k < bnd.length; k += 6) {
    if (bnd[k + 2] !== b && bnd[k + 3] !== b && bnd[k + 4] !== b && bnd[k + 5] !== b) continue;
    tot++;
    const p: Vec = [bnd[k] + 0.5, bnd[k + 1] + 0.5];
    if (!inPolygon(p, hull)) continue;
    let md = Infinity;
    for (let j = 0; j < hull.length; j++) md = Math.min(md, segDist(p, hull[j], hull[(j + 1) % hull.length]));
    if (md > 1.5) deep++;
  }
  return tot ? deep / tot : 0;
}

/** Ajusta el centro de las primitivas al eje de simetría. */
function snapToAxis(s: Shape, axis: SymmetryAxis): Shape {
  if (s.type === 'circle' || s.type === 'ellipse' || s.type === 'rect') {
    const c: Vec = [s.cx, s.cy];
    const m = reflectPoint(c, axis);
    const mid: Vec = [(c[0] + m[0]) / 2, (c[1] + m[1]) / 2];
    return dist(c, mid) < 2 ? { ...s, cx: mid[0], cy: mid[1] } : s;
  }
  return s;
}

/** Une figuras gemelas respecto al eje global: la de la derecha pasa a ser el reflejo exacto de la izquierda. */
function mirrorTwins(layers: Layer[], axis: SymmetryAxis) {
  const center = (l: Layer): Vec => {
    const s = l.shape;
    if (s.type === 'circle' || s.type === 'ellipse' || s.type === 'rect') return [s.cx, s.cy];
    const pts = s.type === 'polygon' ? s.points : s.type === 'path' ? [s.loop.start, ...s.loop.segs.map((g) => g.p)] : s.paths.flatMap((p) => [p.start, ...p.segs.map((g) => g.p)]);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  };
  const side = (p: Vec) => (axis.angle === 90 ? p[0] - axis.p[0] : p[1] - axis.p[1]);
  const used = new Set<string>();
  for (const a of layers) {
    if (a.kind === 'background' || a.kind === 'stroke' || used.has(a.id)) continue;
    const ca = center(a);
    if (side(ca) >= -2) continue; // solo desde el lado negativo
    const target = reflectPoint(ca, axis);
    let best: Layer | null = null, bd = Infinity;
    for (const b of layers) {
      if (b === a || b.fill !== a.fill || b.kind === 'background' || b.kind === 'stroke' || used.has(b.id)) continue;
      if (Math.abs(b.area - a.area) > Math.max(a.area, b.area) * 0.1) continue;
      const d = dist(center(b), target);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || bd > Math.max(3, Math.sqrt(a.area) * 0.08)) continue;
    used.add(a.id); used.add(best.id);
    best.shape = mirrorShape(a.shape, axis);
    best.freeform = mirrorShape(a.freeform, axis);
    if (a.recognized) best.recognized = mirrorShape(a.recognized, axis);
    best.kind = a.kind;
    best.holes = a.holes.map((h) => mirrorShape(h, axis));
    best.symmetry = { ...axis };
    a.symmetry = a.symmetry ?? { ...axis };
  }
}

function scaleShape(s: Shape, k: number): Shape {
  const f = (p: Vec): Vec => [p[0] * k, p[1] * k];
  switch (s.type) {
    case 'circle': return { ...s, cx: s.cx * k, cy: s.cy * k, r: s.r * k };
    case 'ellipse': return { ...s, cx: s.cx * k, cy: s.cy * k, rx: s.rx * k, ry: s.ry * k };
    case 'rect': return { ...s, cx: s.cx * k, cy: s.cy * k, w: s.w * k, h: s.h * k, rx: s.rx * k };
    case 'polygon': return { type: 'polygon', points: s.points.map(f) };
    case 'path': return { type: 'path', loop: mapLoop(s.loop, f) };
    case 'strokes': return { type: 'strokes', paths: s.paths.map((p) => ({ ...mapLoop(p, f), closed: p.closed })) };
  }
}

function scaleLayer(l: Layer, k: number): Layer {
  return {
    ...l,
    shape: scaleShape(l.shape, k),
    freeform: scaleShape(l.freeform, k),
    recognized: l.recognized && scaleShape(l.recognized, k),
    holes: l.holes.map((h) => scaleShape(h, k)),
    area: l.area * k * k,
    stroke: l.stroke && { ...l.stroke, width: l.stroke.width * k },
    fitError: l.fitError * k,
    symmetry: l.symmetry && { ...l.symmetry, p: [l.symmetry.p[0] * k, l.symmetry.p[1] * k] },
  };
}
