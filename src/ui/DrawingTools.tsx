import { MousePointer2, Pencil, PenTool, Scissors } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fitClosed, smoothClosed } from '../engine/curve';
import { shapeToD, type Layer, type Shape, type Vec } from '../engine';
import { polygonArea } from '../engine/vec';
import { FIGURE_ICONS } from './lib/figure-icons';
import { drawFigure, type FigureType } from './lib/figures';
import { PenSurface } from './PenSurface';
import { IconButton } from './components/Button';
import { useStore } from './store';

type Tool = FigureType | 'free' | 'cut' | 'pen' | '';

const TOOLS: { tool: Tool; label: string; key?: string; icon: ReactNode }[] = [
  { tool: '', label: 'Seleccionar y mover', key: 'V', icon: <MousePointer2 /> },
  { tool: 'circle', label: 'Círculo', key: 'C', icon: FIGURE_ICONS.circle },
  { tool: 'ellipse', label: 'Elipse', icon: FIGURE_ICONS.ellipse },
  { tool: 'rect', label: 'Rectángulo', key: 'R', icon: FIGURE_ICONS.rect },
  { tool: 'triangle', label: 'Triángulo', key: 'T', icon: FIGURE_ICONS.triangle },
  { tool: 'semicircle', label: 'Semicírculo', icon: FIGURE_ICONS.semicircle },
  { tool: 'line', label: 'Línea', key: 'L', icon: FIGURE_ICONS.line },
  { tool: 'pen', label: 'Pluma Bézier', key: 'B', icon: <PenTool /> },
  { tool: 'free', label: 'Forma libre', key: 'P', icon: <Pencil /> },
];

const HINTS: Record<string, string> = {
  pen: 'Clic para esquinas, arrastra para curvas. Clic en el primer nodo para cerrar o Enter para terminar abierto. Mayús ajusta a 45°.',
  cut: 'Arrastra una recta a través de la pieza seleccionada. Mayús fija el ángulo en pasos de 45°.',
  free: 'Dibuja el contorno sin soltar; al soltar se cierra y se suaviza.',
  line: 'Arrastra para trazar la línea. Mayús fija el ángulo en pasos de 45°.',
  shape: 'Arrastra para dar posición y tamaño. Mayús: proporciones iguales · Alt: desde el centro.',
};

/** Ajusta el gesto según los modificadores: Mayús iguala proporciones (o fija el ángulo), Alt dibuja desde el centro. */
function constrain(tool: Tool, a: Vec, b: Vec, shift: boolean, alt: boolean): [Vec, Vec] {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (shift) {
    if (tool === 'line' || tool === 'cut') {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
      dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m;
    }
  }
  const end: Vec = [a[0] + dx, a[1] + dy];
  return alt && tool !== 'cut' ? [[a[0] - dx, a[1] - dy], end] : [a, end];
}

export function DrawingTools({ selected, scale, tx, ty }: { selected: Layer | null; scale: number; tx: number; ty: number }) {
  const [tool, setTool] = useState<Tool>('');
  const [points, setPoints] = useState<Vec[]>([]);
  const [mods, setMods] = useState({ shift: false, alt: false });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const gesture = useRef<Vec[] | null>(null);
  const multiple = useStore(s => s.additionalIds.length > 0);
  const canCut = !!selected && selected.kind !== 'background' && !multiple;
  const reset = (next: Tool = '') => { gesture.current = null; setPoints([]); setMessage(''); setTool(next); };

  // Atajos de herramienta y modificadores en vivo mientras se arrastra.
  useEffect(() => {
    const keys: Record<string, Tool> = { v: '', c: 'circle', r: 'rect', t: 'triangle', l: 'line', p: 'free', b: 'pen' };
    const down = (e: KeyboardEvent) => {
      setMods({ shift: e.shiftKey, alt: e.altKey });
      if (e.ctrlKey || e.metaKey || e.altKey || busy) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], .mselect__list, .menu')) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape' && tool) { e.preventDefault(); e.stopImmediatePropagation(); reset(); return; }
      if (k in keys && !e.shiftKey) { e.preventDefault(); reset(keys[k]); return; }
      if (k === 'k' && canCut) { e.preventDefault(); reset(tool === 'cut' ? '' : 'cut'); }
    };
    const up = (e: KeyboardEvent) => setMods({ shift: e.shiftKey, alt: e.altKey });
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [tool, busy, canCut]);

  const at = (e: React.PointerEvent<SVGSVGElement>): Vec => {
    const box = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - box.left - tx) / scale, (e.clientY - box.top - ty) / scale];
  };
  const finish = async (rawEnd: Vec, shift: boolean, alt: boolean) => {
    const path = gesture.current;
    if (!path) return;
    gesture.current = null;
    setPoints([]);
    const [start, end] = constrain(tool, path[0], rawEnd, shift, alt);
    if (tool === 'free' ? path.length < 3 : Math.hypot(end[0] - start[0], end[1] - start[1]) * scale < 3) return;
    const { applyDrawing, toast } = useStore.getState();
    if (tool === 'cut' && selected) {
      setBusy(true);
      try {
        const { splitLayer } = await import('../engine/split');
        const pieces = splitLayer(selected, start, end);
        if (!pieces) { setMessage('El corte debe atravesar la pieza y dejar una parte a cada lado.'); return; }
        applyDrawing(pieces, selected);
        toast(`«${selected.name}» dividida en ${pieces.length} capas`);
      } catch { setMessage('Esta geometría no se pudo dividir. Prueba otra dirección de corte.'); return; }
      finally { setBusy(false); }
    } else if (tool === 'free') {
      const area = Math.abs(polygonArea(path));
      if (area * scale * scale < 4) { setMessage('Dibuja un contorno que encierre una superficie.'); return; }
      const loop = fitClosed(smoothClosed(path, 1), [], Math.max(0.25, 0.7 / scale));
      const shape: Shape = { type: 'path', loop };
      const layer = drawFigure('rect', path[0], rawEnd);
      applyDrawing([{ ...layer, kind: 'path', name: 'Forma libre', shape, freeform: shape, area }]);
    } else if (tool && tool !== 'cut' && tool !== 'pen') applyDrawing([drawFigure(tool, start, end)]);
    reset();
  };

  const [first, last] = points.length >= 2 && tool !== 'free' ? constrain(tool, points[0], points[points.length - 1], mods.shift, mods.alt) : [points[0], points[points.length - 1]];
  const preview = points.length < 2 || !tool || tool === 'pen' ? '' : tool === 'free'
    ? 'M' + points.map(p => p.join(' ')).join('L') + 'Z'
    : tool === 'cut' ? `M${first.join(' ')}L${last.join(' ')}`
    : shapeToD(drawFigure(tool, first, last).shape);
  const size = points.length >= 2 && tool && tool !== 'free' && tool !== 'cut'
    ? `${Math.round(Math.abs(last[0] - first[0]))} × ${Math.round(Math.abs(last[1] - first[1]))}` : '';

  return <>
    {tool === 'pen' && <PenSurface scale={scale} tx={tx} ty={ty} done={() => reset()} />}
    {tool && tool !== 'pen' && <svg className="drawing-surface" data-tool={tool} aria-label="Área de dibujo"
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
        setMods({ shift: e.shiftKey, alt: e.altKey });
        setPoints([...gesture.current]);
      }}
      onPointerUp={e => { if (e.isPrimary) void finish(at(e), e.shiftKey, e.altKey); }}
      onPointerCancel={() => { gesture.current = null; setPoints([]); }}>
      <path d={preview} transform={`translate(${tx} ${ty}) scale(${scale})`} vectorEffect="non-scaling-stroke"
        fill={tool === 'cut' || tool === 'line' ? 'none' : 'var(--primary)'} fillOpacity=".15"
        stroke="var(--primary)" strokeWidth="2" strokeDasharray={tool === 'cut' ? '6 4' : undefined} />
      {size && <text className="drawing-size" x={tx + last[0] * scale + 10} y={ty + last[1] * scale + 22}>{size}</text>}
    </svg>}
    <div className="drawing-tools" onPointerDown={e => e.stopPropagation()}>
      <div className="drawing-tools__row" role="toolbar" aria-label="Herramientas de dibujo">
        {TOOLS.map((t) => (
          <IconButton key={t.label} size="sm" label={t.key ? `${t.label} (${t.key})` : t.label} disabled={busy}
            pressed={tool === t.tool} onClick={() => reset(t.tool === tool ? '' : t.tool)}>{t.icon}</IconButton>
        ))}
        <span className="toolbar__sep" />
        <IconButton size="sm" label={canCut ? 'Dividir la capa seleccionada (K)' : 'Dividir: selecciona primero una capa'} disabled={busy || !canCut}
          pressed={tool === 'cut'} onClick={() => reset(tool === 'cut' ? '' : 'cut')}><Scissors /></IconButton>
      </div>
      {tool && <div className="drawing-tools__hint" role="status" data-error={!!message}>
        {message || HINTS[tool] || HINTS.shape}
        <span className="drawing-tools__esc"><kbd>Esc</kbd> para salir</span>
      </div>}
    </div>
  </>;
}
