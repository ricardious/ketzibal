import { Circle, Pencil, RectangleHorizontal, Scissors, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fitClosed, smoothClosed } from '../engine/curve';
import { shapeToD, type Layer, type Shape, type Vec } from '../engine';
import { polygonArea } from '../engine/vec';
import { drawFigure, figureNames, type FigureType } from './lib/figures';
import { Button, IconButton } from './components/Button';
import { useStore } from './store';

type Tool = FigureType | 'free' | 'cut' | '';
export function DrawingTools({ selected, scale, tx, ty }: { selected: Layer | null; scale: number; tx: number; ty: number }) {
  const [tool, setTool] = useState<Tool>('');
  const [points, setPoints] = useState<Vec[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const gesture = useRef<Vec[] | null>(null);
  const multiple = useStore(s => s.additionalIds.length > 0);
  const reset = (next: Tool = '') => { gesture.current = null; setPoints([]); setMessage(''); setTool(next); };
  useEffect(() => {
    if (!tool) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); reset(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [tool]);

  const at = (e: React.PointerEvent<SVGSVGElement>): Vec => {
    const box = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - box.left - tx) / scale, (e.clientY - box.top - ty) / scale];
  };
  const finish = async (end: Vec) => {
    const path = gesture.current;
    if (!path) return;
    gesture.current = null;
    setPoints([]);
    const start = path[0];
    if (tool === 'free' ? path.length < 3 : Math.hypot(end[0] - start[0], end[1] - start[1]) * scale < 3) return;
    const { applyDrawing } = useStore.getState();
    if (tool === 'cut' && selected) {
      setBusy(true);
      try {
        const { splitLayer } = await import('../engine/split');
        const pieces = splitLayer(selected, start, end);
        if (!pieces) { setMessage('El corte debe dejar parte de la pieza a cada lado.'); return; }
        applyDrawing(pieces, selected);
      } catch { setMessage('No se pudo dividir esta geometría. Prueba otra dirección de corte.'); return; }
      finally { setBusy(false); }
    } else if (tool === 'free') {
      const area = Math.abs(polygonArea(path));
      if (area * scale * scale < 4) { setMessage('Dibuja un contorno que encierre una superficie.'); return; }
      const loop = fitClosed(smoothClosed(path, 1), [], Math.max(0.25, 0.7 / scale));
      const shape: Shape = { type: 'path', loop };
      const layer = drawFigure('rect', start, end);
      applyDrawing([{ ...layer, kind: 'path', name: 'Forma libre', shape, freeform: shape, area }]);
    } else if (tool && tool !== 'cut') applyDrawing([drawFigure(tool, start, end)]);
    reset();
  };
  const first = points[0], last = points[points.length - 1];
  const preview = points.length < 2 || !tool ? '' : tool === 'free' || tool === 'cut'
    ? 'M' + points.map(p => p.join(' ')).join('L') + (tool === 'free' ? 'Z' : '')
    : shapeToD(drawFigure(tool, first, last).shape);

  return <>
    {tool && <svg className="drawing-surface" aria-label="Área de dibujo"
      onPointerDown={e => {
        e.stopPropagation();
        if (e.button !== 0 || !e.isPrimary || busy) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = [at(e)]; setPoints(gesture.current); setMessage('');
      }}
      onPointerMove={e => {
        if (!gesture.current || !e.isPrimary) return;
        const p = at(e);
        if (tool === 'free') {
          const prev = gesture.current[gesture.current.length - 1];
          if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) * scale < 1) return;
          gesture.current.push(p);
        } else gesture.current = [gesture.current[0], p];
        setPoints([...gesture.current]);
      }}
      onPointerUp={e => { if (e.isPrimary) void finish(at(e)); }}
      onPointerCancel={() => { gesture.current = null; setPoints([]); }}>
      <path d={preview} transform={`translate(${tx} ${ty}) scale(${scale})`} vectorEffect="non-scaling-stroke"
        fill={tool === 'cut' || tool === 'line' ? 'none' : 'var(--primary)'} fillOpacity=".15"
        stroke="var(--primary)" strokeWidth="2" strokeDasharray={tool === 'cut' ? '6 4' : undefined} />
    </svg>}
    <div className="drawing-tools" onPointerDown={e => e.stopPropagation()}>
      <div className="drawing-tools__row" role="toolbar" aria-label="Crear y dividir figuras">
        <IconButton size="sm" label="Dibujar círculo" disabled={busy} pressed={tool === 'circle'} onClick={() => reset(tool === 'circle' ? '' : 'circle')}><Circle /></IconButton>
        <IconButton size="sm" label="Dibujar rectángulo" disabled={busy} pressed={tool === 'rect'} onClick={() => reset(tool === 'rect' ? '' : 'rect')}><RectangleHorizontal /></IconButton>
        <IconButton size="sm" label="Dibujar forma libre" disabled={busy} pressed={tool === 'free'} onClick={() => reset(tool === 'free' ? '' : 'free')}><Pencil /></IconButton>
        <select className="input" aria-label="Dibujar figura" disabled={busy} value={tool === 'cut' ? '' : tool}
          onChange={e => reset(e.target.value as Tool)}>
          <option value="">Dibujar figura…</option>
          {Object.entries(figureNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
          <option value="free">Forma libre</option>
        </select>
        <Button size="sm" icon={<Scissors />} disabled={busy || !selected || selected.kind === 'background' || multiple}
          aria-pressed={tool === 'cut'} onClick={() => reset(tool === 'cut' ? '' : 'cut')}>Dividir</Button>
        {tool && <IconButton size="sm" label="Cancelar herramienta" disabled={busy} onClick={() => reset()}><X /></IconButton>}
      </div>
      {tool && <div className="drawing-tools__hint" role="status">{message || (tool === 'cut'
        ? 'Arrastra una recta para separar la pieza seleccionada en dos capas.'
        : tool === 'free' ? 'Dibuja el contorno y suelta para cerrarlo.' : 'Arrastra en el lienzo para dar posición y tamaño a la figura.')}</div>}
    </div>
  </>;
}
