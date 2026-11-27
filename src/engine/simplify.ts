import { reflectPoint, mirrorLoop } from './symmetry';
import { bez, bezD1 } from './curve';
import type { BezierPath, CubicSeg, Layer, Shape, SymmetryAxis, Vec } from './types';
import { dist, dot, lerp, segDist, sub } from './vec';

function controls(start: Vec, s: CubicSeg): Vec[] {
  return s.line ? [start, lerp(start, s.p, 1/3), lerp(start, s.p, 2/3), s.p] : [start, s.c1, s.c2, s.p];
}

// Exact cubic restricted to [a,b], expressed on [0,1].
function interval(c: Vec[], a: number, b: number) {
  const p = bez(c,a), q = bez(c,b), v = bezD1(c,a), w = bezD1(c,b);
  const k = (b-a)/3;
  return [p, [p[0]+k*v[0], p[1]+k*v[1]], [q[0]-k*w[0], q[1]-k*w[1]], q] as Vec[];
}

// Ajuste por mínimos cuadrados con extremos fijos y parametrización monótona.
function fitSpan(curves: Vec[][], limit: number, axis?: SymmetryAxis): CubicSeg | null {
  const start = curves[0][0], end = curves[curves.length - 1][3];
  // Una recta basta si todos los controles caben en su banda de tolerancia.
  const direction = sub(end, start);
  if (curves.every(c => c.every((p,i) => segDist(p,start,end) <= limit &&
    (i === 0 || dot(sub(p,c[i-1]),direction) >= 0)))) {
    return { p: end, c1: lerp(start,end,1/3), c2: lerp(start,end,2/3), line: true };
  }
  const samples = [start], steps = 12;
  for (const curve of curves) {
    for (let i = 1; i <= steps; i++) samples.push(bez(curve, i / steps));
  }
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) lengths.push(lengths[i-1] + dist(samples[i-1], samples[i]));
  const total = lengths[lengths.length-1];
  if (!total || dist(start, end) < limit) return null;
  const ts = lengths.map(d => d / total);
  for (let pass = 0; pass < 8; pass++) {
    let aa = 0, ab = 0, bb = 0;
    const ax: Vec = [0,0], bx: Vec = [0,0];
    for (let i = 1; i < samples.length-1; i++) {
      const t = ts[i], u = 1-t, a = 3*u*u*t, b = 3*u*t*t;
      aa += a*a; ab += a*b; bb += b*b;
      for (let k = 0; k < 2; k++) {
        const target = samples[i][k] - u**3*start[k] - t**3*end[k];
        ax[k] += a*target; bx[k] += b*target;
      }
    }
    const det = aa*bb-ab*ab;
    if (det < 1e-12) return null;
    const c1: Vec = [0,0], c2: Vec = [0,0];
    for (let k = 0; k < 2; k++) {
      c1[k] = (bb*ax[k]-ab*bx[k])/det;
      c2[k] = (aa*bx[k]-ab*ax[k])/det;
    }
    if (axis) {
      const control = lerp(c1,reflectPoint(c2,axis),0.5);
      const mirrored = reflectPoint(control,axis);
      c1[0]=control[0]; c1[1]=control[1]; c2[0]=mirrored[0]; c2[1]=mirrored[1];
    }
    const curve = [start,c1,c2,end];
    for (let i = 1; i < samples.length-1; i++) {
      const t = ts[i], d = bezD1(curve,t);
      ts[i] = Math.max(ts[i-1], Math.min(ts[i+1], t-dot(sub(bez(curve,t),samples[i]),d)/Math.max(1e-12,dot(d,d))));
    }
    // La diferencia de dos cúbicas queda dentro de la envolvente de sus controles.
    let ok = true;
    for (let i = 0; ok && i < samples.length-1; i++) {
      const j = i % steps;
      const source = interval(curves[Math.floor(i/steps)],j/steps,(j+1)/steps);
      const fitted = interval(curve,ts[i],ts[i+1]);
      ok = source.every((p,k) => dist(p,fitted[k]) <= limit);
    }
    if (ok) return { p: end, c1, c2 };
  }
  return null;
}

function simplifyPath(path: BezierPath, limit: number, closed: boolean): BezierPath {
  const n = path.segs.length;
  const curves = path.segs.map((seg,i) => controls(i ? path.segs[i-1].p : path.start, seg));
  const cost = new Array<number>(n+1).fill(Infinity);
  const next = new Array<number>(n);
  const best = [...path.segs];
  cost[n] = 0;
  for (let i = n-1; i >= 0; i--) {
    cost[i] = 1 + cost[i+1];
    next[i] = i+1;
    for (let j = i+2; j <= Math.min(n,i+32); j++) {
      const before = curves[j-2], after = curves[j-1];
      const a = sub(before[3],before[2]), b = sub(after[1],after[0]);
      if (dot(a,b) < 0.8*Math.hypot(...a)*Math.hypot(...b)) break;
      if (1 + cost[j] >= cost[i]) continue;
      const seg = fitSpan(curves.slice(i,j), limit);
      if (seg) { best[i] = seg; next[i] = j; cost[i] = 1 + cost[j]; }
    }
  }
  if (cost[0] >= n || (closed && cost[0] < 3)) return path;
  const segs = [];
  for (let i = 0; i < n; i = next[i]) segs.push(best[i]);
  return { ...path, segs };
}

/** Mide el giro a igual distancia de arco a ambos lados, aun en puntas redondeadas. */
function cornerSpans(loop: BezierPath) {
  const curves = loop.segs.map((s,i) => controls(i ? loop.segs[i-1].p : loop.start,s));
  if (!curves.length) return [];
  const end = curves[curves.length-1][3];
  if (dist(end,loop.start) > 1e-8) curves.push(controls(end,{line:true,p:loop.start,c1:end,c2:loop.start}));
  const samples: { arc:number; index:number; t:number; p:Vec }[] = [];
  let length = 0, prev = loop.start;
  for (const [index,c] of curves.entries()) {
    const count = Math.min(128,Math.max(4,Math.ceil((dist(c[0],c[1])+dist(c[1],c[2])+dist(c[2],c[3]))/2)));
    for (let j=0;j<count;j++) {
      const t=j/count, p=bez(c,t);
      length += dist(prev,p);
      samples.push({arc:length,index,t,p});
      prev=p;
    }
  }
  length += dist(prev,loop.start);
  if (length < 8) return [];
  const window = length*0.035;
  function at(arc:number) {
    arc=(arc+length)%length;
    let lo=0, hi=samples.length;
    while(lo+1<hi) {
      const mid=(lo+hi)>>1;
      if(samples[mid].arc<=arc) lo=mid; else hi=mid;
    }
    const a=samples[lo], b=samples[hi%samples.length];
    return lerp(a.p,b.p,(arc-a.arc)/Math.max(1e-10,(hi===samples.length?length:b.arc)-a.arc));
  }
  const peaks=samples.map((s,i)=>{
    const a=sub(s.p,at(s.arc-window)), b=sub(at(s.arc+window),s.p);
    return {i, cosine:dot(a,b)/Math.max(1e-12,Math.hypot(...a)*Math.hypot(...b))};
  }).filter(v=>v.cosine<Math.cos(Math.PI/4)).sort((a,b)=>a.cosine-b.cosine);
  const corners: typeof samples=[];
  for(const peak of peaks) {
    const s=samples[peak.i];
    if(corners.every(c=>{ const d=Math.abs(c.arc-s.arc); return Math.min(d,length-d)>window*1.5; })) corners.push(s);
  }
  if(corners.length<2) return [];
  corners.sort((a,b)=>a.arc-b.arc);
  return corners.map((a,i)=>{
    const b=corners[(i+1)%corners.length], result:Vec[][]=[];
    const last=b.index+(i===corners.length-1?curves.length:0);
    for(let k=a.index;k<=last;k++){
      const t0=k===a.index?a.t:0, t1=k===last?b.t:1;
      if(t1>t0) result.push(interval(curves[k%curves.length],t0,t1));
    }
    return result;
  });
}

function fitCorners(loop: BezierPath, limit:number, spans=cornerSpans(loop)): BezierPath | null {
  if(spans.length<3 || spans.length>=loop.segs.length) return null;
  const segs:CubicSeg[]=[];
  for(const span of spans) {
    const seg=fitSpan(span,limit);
    if(seg) segs.push(seg);
    else {
      const part: BezierPath = {start:span[0][0],segs:span.map(([,c1,c2,p])=>({c1,c2,p}))};
      segs.push(...simplifyPath(part,limit,false).segs);
    }
  }
  return segs.length < loop.segs.length ? {...loop,start:spans[0][0][0],segs} : null;
}

export function simplifyLayer(layer: Layer, tolerance: number, keepStrokeStart = false): Layer {
  const limit = Math.min(2, tolerance, layer.stroke ? layer.stroke.width / 5 : Infinity);
  const cornerLimit = Math.min(6, 3*tolerance, layer.stroke ? layer.stroke.width / 5 : Infinity);
  function simplifyLoop(loop: BezierPath, closed: boolean) {
    if (closed) {
      // En figuras pequeñas un píxel ya representa una parte apreciable del borde.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const {p: [x,y]} of loop.segs) {
        x0 = Math.min(x0,x); x1 = Math.max(x1,x);
        y0 = Math.min(y0,y); y1 = Math.max(y1,y);
      }
      const sizeLimit = Math.max(limit, Math.min(x1-x0,y1-y0)*0.02);
      const fitted = fitCorners(loop, Math.min(cornerLimit,sizeLimit));
      if (fitted) return fitted;
    }
    return simplifyPath(loop, limit, closed);
  }
  function simplify(s: Shape): Shape {
    if (s.type === 'path') {
      const axis = layer.symmetry, segs = s.loop.segs, mid = segs.length/2;
      if (axis && Number.isInteger(mid) && mid >= 1 && segs.slice(0,mid).every((a,i) => {
        const b = segs[segs.length-1-i];
        const start = i ? segs[i-1].p : s.loop.start;
        return dist(reflectPoint(start,axis),b.p)<1e-6 && dist(reflectPoint(a.c1,axis),b.c2)<1e-6 &&
          dist(reflectPoint(a.c2,axis),b.c1)<1e-6 && !!a.line===!!b.line;
      })) {
        // Ajustar el arco que cruza el eje sobre las curvas originales para
        // evitar una unión artificial en el centro y acumular errores de ajuste.
        const curves = segs.map((seg,i) => controls(i ? segs[i-1].p : s.loop.start,seg));
        let cut = 0;
        let cap: CubicSeg | null = null;
        for (let k=1; k<Math.min(mid,12); k++) {
          const candidate = fitSpan([...curves.slice(-k),...curves.slice(0,k)],cornerLimit,axis);
          if (candidate) { cut=k; cap=candidate; }
        }
        const start = cut ? segs[cut-1].p : s.loop.start;
        const half = simplifyPath({start,segs:segs.slice(cut,mid)},cornerLimit,false);
        if (!cap && half.segs.length === mid) return s;
        const mirrored = mirrorLoop(half.start,half.segs,axis);
        if (cap) {
          // mirrorLoop cierra sobre un inicio situado en el eje. Aquí el arco
          // simétrico se encarga del cierre entre dos anclas fuera del eje.
          mirrored.segs[mirrored.segs.length-1].p = reflectPoint(start,axis);
          mirrored.segs.push(cap);
        }
        return {...s,loop:mirrored};
      }
      const loop = simplifyLoop(s.loop, true);
      return loop === s.loop ? s : { ...s, loop };
    }
    if (s.type !== 'strokes') return s;
    const paths = s.paths.map(p => keepStrokeStart && p.closed ? simplifyPath(p, limit, true) : simplifyLoop(p, !!p.closed));
    return paths.every((p,i) => p === s.paths[i]) ? s : { ...s, paths };
  }
  const shape = simplify(layer.shape), holes = layer.holes.map(simplify);
  if (shape === layer.shape && holes.every((h,i) => h === layer.holes[i])) return layer;
  return { ...layer, shape, holes, freeform: layer.freeform === layer.shape || shape !== layer.shape ? shape : layer.freeform };
}
