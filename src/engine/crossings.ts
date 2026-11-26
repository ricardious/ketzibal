import { bez } from './curve';
import type { Vec } from './types';
import { dist, dot, norm, scale, sub } from './vec';

interface Arm { id: number; index: number; point: Vec; outward: Vec; width: number }
interface Link { other: number; trim: number; bridge: Vec[] }

/** Un cruce X se adelgaza a un nodo de cuatro brazos o dos nodos T con un
 * puente corto. En una T se busca una única pareja con continuidad de tinta. */
export function resolveCrossings(runs: Vec[][], mask: Uint8Array, radius: Float32Array, W: number, width: number): Vec[][] {
  runs = runs.slice();
  const ends = runs.flatMap(r => [r[0], r[r.length - 1]]);
  const groups: number[][] = [];
  const nearby = new Map<number, number>();
  const node = ends.map((p, id) => {
    const x = Math.floor(p[0]), y = Math.floor(p[1]);
    let group: number | undefined;
    for (let dy = -1; dy <= 1 && group === undefined; dy++) for (let dx = -1; dx <= 1; dx++) {
      group = nearby.get((y + dy) * W + x + dx);
      if (group !== undefined) break;
    }
    if (group === undefined) { group = groups.length; groups.push([]); }
    groups[group].push(id);
    nearby.set(y * W + x, group);
    return group;
  });
  const stepInside = (r: Vec[], index: number, step: number, length: number) => {
    let d = 0;
    while (index + step >= 0 && index + step < r.length && d < length) {
      d += dist(r[index], r[index + step]); index += step;
    }
    return index;
  };
  const arm = (id: number): Arm | null => {
    const r = runs[id >> 1], step = id % 2 ? -1 : 1;
    const start = step === 1 ? 0 : r.length - 1;
    const index = stepInside(r, start, step, width * 1.45);
    if (Math.abs(index - start) > (r.length - 1) * 0.42) return null;
    const far = stepInside(r, index, step, width);
    const p = r[index], q = r[far];
    if (dist(p, q) < width * 0.5) return null;
    const widths: number[] = [];
    for (let k = Math.min(index, far); k <= Math.max(index, far); k++) {
      widths.push(2 * radius[Math.floor(r[k][1]) * W + Math.floor(r[k][0])] - 0.7);
    }
    widths.sort((a, b) => a - b);
    return { id, index, point: p, outward: norm(sub(q, p)), width: Math.max(1, widths[widths.length >> 1]) };
  };
  const connect = (a: Arm, b: Arm) => {
    const length = dist(a.point, b.point), chord = norm(sub(b.point, a.point));
    const aligned = Math.min(-dot(a.outward, chord), dot(b.outward, chord));
    const straight = -dot(a.outward, b.outward);
    const ratio = Math.min(a.width, b.width) / Math.max(a.width, b.width);
    if (aligned < 0.72 || straight < 0.62 || ratio < 0.58) return null;
    const c = [a.point, sub(a.point, scale(a.outward, length / 3)), sub(b.point, scale(b.outward, length / 3)), b.point];
    const bridge: Vec[] = [];
    for (let i = 1, n = Math.ceil(length); i < n; i++) {
      const p = bez(c, i / n), x = Math.floor(p[0]), y = Math.floor(p[1]);
      if (x < 0 || x >= W || !mask[y * W + x]) return null;
      bridge.push(p);
    }
    return { a, b, bridge, score: aligned + straight + ratio * 0.5 };
  };

  const links = new Map<number, Link>(), removed = new Set<number>();
  const attempt = (ids: number[], connector?: number) => {
    if (ids.length !== 4 || new Set(ids.map(id => id >> 1)).size !== 4 || ids.some(id => links.has(id) || removed.has(id >> 1))) return;
    const arms = ids.map(arm);
    if (arms.some(a => !a)) return;
    const [a, b, c, d] = arms as Arm[];
    const choices = [[a,b,c,d], [a,c,b,d], [a,d,b,c]].flatMap(([p,q,r,s]) => {
      const u = connect(p,q), v = connect(r,s);
      return u && v ? [{ pairs: [u,v], score: u.score + v.score }] : [];
    }).sort((x,y) => y.score - x.score);
    if (!choices.length || (choices.length > 1 && choices[0].score - choices[1].score < 0.2)) return;
    for (const { a, b, bridge } of choices[0].pairs) {
      links.set(a.id, { other: b.id, trim: a.index, bridge });
      links.set(b.id, { other: a.id, trim: b.index, bridge: [...bridge].reverse() });
    }
    if (connector !== undefined) removed.add(connector);
  };
  for (const ids of groups) if (ids.length === 4) attempt(ids);
  for (let i = 0; i < runs.length; i++) {
    const a = 2 * i, b = a + 1;
    if (node[a] === node[b] || runs[i].length > width * 2.4 + 2) continue;
    const left = groups[node[a]], right = groups[node[b]];
    if (left.length === 3 && right.length === 3) attempt([...left.filter(id => id !== a), ...right.filter(id => id !== b)], i);
  }
  // Dos puntas cortas paralelas y un borde que gira entre sus bases forman
  // un arco. Conservar el esqueleto observado en ambas uniones.
  for (let i = 0; i < runs.length; i++) {
    const first = 2*i, last = first+1;
    const sides = [first,last];
    if (removed.has(i) || node[first] === node[last]) continue;
    const tips: number[] = [];
    for (const end of sides) {
      const ids = groups[node[end]];
      if (ids.length !== 3 || ids.some(id => links.has(id) || removed.has(id >> 1))) break;
      const free = ids.filter(id => id !== end && groups[node[id ^ 1]].length === 1 &&
        dist(ends[id],ends[id ^ 1]) <= 3.5*width);
      if (free.length !== 1) break;
      tips.push(free[0]);
    }
    if (tips.length !== 2) continue;
    const chord = sub(ends[last],ends[first]), span = dist(ends[first],ends[last]);
    if (span < width || span > 6*width) continue;
    const directions = tips.map(id => norm(sub(ends[id ^ 1],ends[id])));
    if (dot(directions[0],directions[1]) < 0.8 || Math.abs(dot(norm(chord),directions[0])) > 0.65) continue;
    const normal = sub(directions[0],scale(norm(chord),dot(norm(chord),directions[0])));
    const depth = Math.max(...runs[i].map(p => -dot(sub(p,ends[first]),normal)));
    if (depth < width*0.45) continue;
    for (const [k,end] of sides.entries()) {
      const tip = tips[k];
      const trim = (id:number) => id % 2 ? runs[id >> 1].length-1 : 0;
      // El adelgazamiento puede terminar antes del centro de una punta redonda.
      // Prolongar solo dentro de la tinta y descontar el radio del remate SVG.
      const dir = directions[k], free = tip ^ 1, origin = ends[free];
      const at = (d:number): Vec => [origin[0]+dir[0]*d,origin[1]+dir[1]*d];
      const radiusAt = (p:Vec) => radius[Math.floor(p[1])*W+Math.floor(p[0])] ?? 0;
      const capRadius = Math.max(1,radiusAt(origin)-0.35);
      let reach = 0;
      while (reach < 3*width && radiusAt(at(reach)) > 0) reach += 0.5;
      const extension: Vec[] = [];
      if (reach < 3*width) {
        for (let d=1; d<=reach-capRadius-0.5; d++) extension.push(at(d));
      }
      if (extension.length) {
        const r = runs[tip >> 1];
        // Copiar el tramo para conservar los índices del esqueleto de entrada.
        runs[tip >> 1] = free % 2 ? [...r,...extension] : [...extension.reverse(),...r];
      }
      const u = runs[end >> 1], v = runs[tip >> 1];
      const su = end % 2 ? -1 : 1, sv = tip % 2 ? -1 : 1;
      const iu = stepInside(u,trim(end),su,Math.min(width,span*0.22));
      const iv = stepInside(v,trim(tip),sv,Math.min(width,dist(ends[tip],origin)*0.55));
      const p = u[iu], q = v[iv], chord = dist(p,q);
      const tangent = (r:Vec[], at:number, step:number) => norm(sub(r[stepInside(r,at,step,width*0.6)],r[at]));
      const c = [p,sub(p,scale(tangent(u,iu,su),chord/3)),sub(q,scale(tangent(v,iv,sv),chord/3)),q];
      const bridge:Vec[] = [];
      for (let j=1;j<Math.ceil(chord);j++) bridge.push(bez(c,j/Math.ceil(chord)));
      const smooth = bridge.length > 0 && bridge.every(sample => radiusAt(sample) >= capRadius*0.65);
      links.set(end,{other:tip,trim:smooth?iu:trim(end),bridge:smooth?bridge:[]});
      links.set(tip,{other:end,trim:smooth?iv:trim(tip),bridge:smooth?[...bridge].reverse():[]});
    }
  }
  for (const ids of groups) {
    if (ids.length !== 3 || ids.some(id => links.has(id) || removed.has(id >> 1))) continue;
    if (new Set(ids.map(id => id >> 1)).size !== 3) continue;
    const arms = ids.map(id => {
      const longArm = arm(id);
      if (longArm) return longArm;
      // En un remate corto, medir la dirección hasta la punta libre.
      if (groups[node[id ^ 1]].length !== 1) return null;
      const r = runs[id >> 1], start = id % 2 ? r.length-1 : 0;
      const tip = ends[id ^ 1], origin = ends[id];
      const length = dist(origin,tip);
      if (length < width*0.65) return null;
      const index = stepInside(r,start,id % 2 ? -1 : 1,length*0.65);
      const point = r[index];
      return { id, index, point, outward:norm(sub(tip,origin)),
        width:Math.max(1,2*radius[Math.floor(point[1])*W+Math.floor(point[0])]-0.7) };
    });
    if (arms.some(a => !a)) continue;
    const [a,b,c] = arms as Arm[];
    const choices = [connect(a,b), connect(a,c), connect(b,c)]
      .filter(candidate => candidate !== null)
      .sort((u,v) => v.score - u.score);
    const best = choices[0];
    if (!best || (choices[1] && best.score - choices[1].score < 0.25)) continue;
    const junction = ends[ids[0]];
    if (!best.bridge.some(p => dist(p, junction) <= Math.min(best.a.width,best.b.width)*0.5)) continue;
    links.set(best.a.id, {other:best.b.id, trim:best.a.index, bridge:best.bridge});
    links.set(best.b.id, {other:best.a.id, trim:best.b.index, bridge:[...best.bridge].reverse()});
  }
  const out: Vec[][] = [], visited = new Set(removed);
  const follow = (start: number) => {
    const pts: Vec[] = [];
    let id = start;
    while (!visited.has(id >> 1)) {
      const i = id >> 1;
      visited.add(i);
      const piece = runs[i].slice(links.get(2*i)?.trim ?? 0, (links.get(2*i+1)?.trim ?? runs[i].length - 1) + 1);
      if (id % 2) piece.reverse();
      for (const p of piece) pts.push(p);
      const link = links.get(id ^ 1);
      if (!link) break;
      for (const p of link.bridge) pts.push(p);
      id = link.other;
      if (id === start) pts.push(pts[0]);
    }
    if (pts.length) out.push(pts);
  };
  for (let id = 0; id < ends.length; id++) if (!links.has(id)) follow(id);
  for (let i = 0; i < runs.length; i++) follow(2*i);
  return out;
}
