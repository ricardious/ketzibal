import { expect, it } from 'vitest';
import { sampleLoop } from './curve';
import { segDist } from './vec';
import { simplifyLayer } from './simplify';
import type { Layer, Vec } from './types';

function base(points: Vec[]): Layer {
  return { id:'test', name:'test', kind:'path', fill:'#000000', stroke:null, opacity:1, visible:true,
    shape:{type:'path',loop:{start:points[0],segs:points.slice(1).map(p=>({p,c1:p,c2:p,line:true}))}},
    freeform:{type:'path',loop:{start:points[0],segs:points.slice(1).map(p=>({p,c1:p,c2:p,line:true}))}},
    holes:[],dx:0,dy:0,parentId:null,depth:0,area:1,reconstructed:false,symmetry:null,fitError:0 };
}

it('reduce nodos en lados rectos y conserva la punta y la curva de una figura simétrica',()=>{
  const p: Vec[] = [];
  const addLine=(a:Vec,b:Vec)=>{for(let i=0;i<30;i++){const t=i/30;p.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}};
  addLine([0,45],[50,5]); addLine([50,5],[100,45]);
  for(let i=0;i<30;i++){const t=i/30;p.push([100+10*Math.sin(Math.PI*t),45+5*t]);}
  addLine([110,50],[50,42]); addLine([50,42],[0,50]);
  const input=base(p), output=simplifyLayer(input,1), shape=output.shape;
  expect(shape.type).toBe('path');
  if(shape.type!=='path') return;
  expect(shape.loop.segs.length).toBeLessThan(12);
  expect(shape.loop.segs.some(s=>s.p[0]===50&&s.p[1]===5)).toBe(true);
  const outline = [...sampleLoop(shape.loop, 100), shape.loop.segs[shape.loop.segs.length-1].p, shape.loop.start];
  for (const point of p) {
    expect(Math.min(...outline.slice(1).map((end,i) => segDist(point,outline[i],end)))).toBeLessThanOrEqual(1);
  }
  expect(shape.loop.segs.every(s => [...s.p, ...s.c1, ...s.c2].every(Number.isFinite))).toBe(true);
});
