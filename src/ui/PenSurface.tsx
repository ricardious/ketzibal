import { useRef, useState } from 'react';
import { loopToD } from '../engine/svg';
import { sampleLoop } from '../engine/curve';
import { dist, polygonArea } from '../engine/vec';
import type { BezierPath, Shape, Vec } from '../engine';
import { drawFigure } from './lib/figures';
import { useStore } from './store';

interface Anchor { p: Vec; tangent: Vec }
const corner = (p: Vec): Anchor => ({ p, tangent: [0, 0] });
function curve(anchors: Anchor[], closed: boolean): BezierPath {
  const ends = anchors.slice(1);
  if (closed) ends.push(anchors[0]);
  return { start: anchors[0].p, closed, segs: ends.map((next, i) => {
    const prev = anchors[i];
    return {
      c1: [prev.p[0] + prev.tangent[0], prev.p[1] + prev.tangent[1]],
      c2: [next.p[0] - next.tangent[0], next.p[1] - next.tangent[1]], p: next.p,
      line: prev.tangent.every(v => v === 0) && next.tangent.every(v => v === 0),
    };
  }) };
}

export function PenSurface({ scale, tx, ty, done }: { scale: number; tx: number; ty: number; done: () => void }) {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [active, setActive] = useState<Anchor | null>(null);
  const down = useRef<Vec>([0, 0]);
  const [hover, setHover] = useState<Vec | null>(null);
  const at = (e: React.PointerEvent<SVGSVGElement>): Vec => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left - tx) / scale, (e.clientY - r.top - ty) / scale];
  };
  const snap = (p: Vec, shift: boolean): Vec => {
    if (!shift || !anchors.length) return p;
    const last = anchors[anchors.length - 1].p, length = dist(last, p);
    const angle = Math.round(Math.atan2(p[1] - last[1], p[0] - last[0]) / (Math.PI / 4)) * Math.PI / 4;
    return [last[0] + length * Math.cos(angle), last[1] + length * Math.sin(angle)];
  };
  const dragged = (p: Vec, end: Vec): Anchor => dist(down.current, end) * scale < 3 ? corner(p)
    : { p, tangent: [end[0] - down.current[0], end[1] - down.current[1]] };
  const finish = (closed: boolean) => {
    if (anchors.length < (closed ? 3 : 2)) return;
    const path = curve(anchors, closed);
    const layer = drawFigure(closed ? 'rect' : 'line', path.start, anchors[anchors.length - 1].p);
    const shape: Shape = closed ? { type: 'path', loop: path } : { type: 'strokes', paths: [path] };
    const samples = [...sampleLoop(path), path.segs[path.segs.length - 1].p];
    const area = closed ? Math.abs(polygonArea(samples))
      : samples.slice(1).reduce((length, p, i) => length + dist(samples[i], p), 0) * layer.stroke!.width;
    useStore.getState().applyDrawing([{ ...layer, kind: closed ? 'path' : 'stroke', name: closed ? 'Figura de pluma' : 'Trazo de pluma', area, shape, freeform: shape }]);
    done();
  };
  const nearStart = (p: Vec) => anchors.length >= 3 && dist(p, anchors[0].p) * scale <= 8;
  const visible = active ? [...anchors, active] : anchors;
  const closing = !!hover && !active && nearStart(hover);
  const preview = !active && hover && anchors.length && !closing ? [...anchors, corner(hover)] : visible;
  return <svg className="drawing-surface" aria-label="Dibujo con pluma" tabIndex={-1}
    onKeyDown={e => {
      if (active) return;
      if (e.key === 'Enter' && anchors.length >= 2) {
        e.preventDefault(); e.stopPropagation(); finish(false);
      } else if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey)) {
        e.preventDefault(); e.stopPropagation(); setAnchors(old => old.slice(0, -1));
      }
    }}
    onPointerDown={e => {
      e.stopPropagation();
      if (!e.isPrimary || e.button !== 0) return;
      const raw = at(e);
      if (nearStart(raw)) { finish(true); return; }
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      down.current = raw;
      setActive(corner(snap(raw, e.shiftKey))); setHover(null);
    }}
    onPointerMove={e => {
      if (!e.isPrimary) return;
      if (active) setActive(dragged(active.p, at(e)));
      else setHover(snap(at(e), e.shiftKey));
    }}
    onPointerUp={e => {
      if (!e.isPrimary || !active) return;
      const anchor = dragged(active.p, at(e));
      setAnchors(old => [...old, anchor]); setActive(null); setHover(null);
    }}
    onPointerCancel={() => { setActive(null); setHover(null); }}
    onPointerLeave={() => setHover(null)}>
    <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
      {!!preview.length && <path d={loopToD(curve(preview, closing), 3, closing)} fill={closing ? 'var(--primary)' : 'none'} fillOpacity=".14" stroke="var(--primary)" strokeWidth={2 / scale} />}
      {visible.map(({ p, tangent: [x, y] }, i) => <g key={i}>
        {(x !== 0 || y !== 0) && <>
          <line x1={p[0]-x} y1={p[1]-y} x2={p[0]+x} y2={p[1]+y} className="ctrl-line" />
          {[-1, 1].map(sign => <circle key={sign} cx={p[0]+sign*x} cy={p[1]+sign*y} r={3 / scale} className="node--ctrl" />)}
        </>}
        <circle cx={p[0]} cy={p[1]} r={(i === 0 && closing ? 7 : 4) / scale} className="node" />
      </g>)}
    </g>
  </svg>;
}
