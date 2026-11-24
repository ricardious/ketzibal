import { Columns2, Image as ImageIcon, ImageUp, Layers2, Maximize, Minus, Plus, Scan, Shapes, Sparkles, SplitSquareHorizontal, Spline } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shapeToD, type Layer, type Shape, type SymmetryAxis, type Vec } from '../engine';
import { Button, IconButton } from './components/Button';
import { Slider } from './components/Slider';
import { Tabs } from './components/Tabs';
import { ACCEPTED } from './lib/image';
import { sampleFile } from './lib/sample';
import { useStore, type ViewMode } from './store';

const MODES = [
  { value: 'original' as ViewMode, label: 'Original', icon: <ImageIcon /> },
  { value: 'vector' as ViewMode, label: 'Vectorizado', icon: <Shapes /> },
  { value: 'split' as ViewMode, label: 'Comparar', icon: <Columns2 /> },
  { value: 'overlay' as ViewMode, label: 'Superponer', icon: <Layers2 /> },
];

export function layerD(l: Layer) {
  return [l.shape, ...l.holes].map((s) => shapeToD(s, 2)).join('');
}

export function Canvas() {
  const source = useStore((s) => s.source);
  const layers = useStore((s) => s.layers);
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const error = useStore((s) => s.error);
  const view = useStore((s) => s.view);
  const split = useStore((s) => s.split);
  const overlayOpacity = useStore((s) => s.overlayOpacity);
  const showOutlines = useStore((s) => s.showOutlines);
  const showAxes = useStore((s) => s.showAxes);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const selectedId = useStore((s) => s.selectedId);
  const isolatedId = useStore((s) => s.isolatedId);
  const globalAxis = useStore((s) => s.globalAxis);
  const { set, select, updateLayer, beginEdit, loadFile } = useStore.getState();

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [panning, setPanning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = source?.width ?? 1, ih = source?.height ?? 1;
  const fit = Math.min((size.w - 64) / iw, (size.h - 128) / ih);
  const s = Math.max(0.01, fit) * zoom;
  const tx = (size.w - iw * s) / 2 + pan[0];
  const ty = (size.h - ih * s) / 2 + pan[1] - 24;

  const toImage = (cx: number, cy: number): Vec => {
    const r = box.current!.getBoundingClientRect();
    return [(cx - r.left - tx) / s, (cy - r.top - ty) / s];
  };

  // Zoom con Ctrl/⌘ + rueda en torno al cursor; rueda sola desplaza.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!useStore.getState().source) return;
      e.preventDefault();
      const st = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const nz = clampZoom(st.zoom * Math.exp(-e.deltaY * 0.0025));
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        // mantener fijo el punto bajo el cursor
        const k = nz / st.zoom;
        const cx = size.w / 2 + st.pan[0], cy = size.h / 2 + st.pan[1] - 24;
        set({ zoom: nz, pan: [st.pan[0] + (mx - cx) * (1 - k), st.pan[1] + (my - cy) * (1 - k)] });
      } else {
        set({ pan: [st.pan[0] - e.deltaX, st.pan[1] - e.deltaY] });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size.w, size.h, set]);

  const visibleLayers = useMemo(
    () => layers.filter((l) => l.visible && (!isolatedId || l.id === isolatedId)),
    [layers, isolatedId],
  );
  const dMap = useMemo(() => new Map(layers.map((l) => [l.id, layerD(l)])), [layers]);
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!source) return;
    const target = (e.target as Element).closest('[data-id]') as SVGElement | null;
    const id = target?.getAttribute('data-id');
    const canPick = view !== 'original' && e.button === 0 && !e.shiftKey;
    if (id && canPick) {
      select(id);
      const l = useStore.getState().layers.find((x) => x.id === id);
      if (!l || l.kind === 'background') return startPan(e);
      const start = toImage(e.clientX, e.clientY);
      const d0: Vec = [l.dx, l.dy];
      let moved = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = toImage(ev.clientX, ev.clientY);
        const dx = p[0] - start[0], dy = p[1] - start[1];
        if (!moved && Math.hypot(dx, dy) * s < 3) return;
        if (!moved) { beginEdit(); moved = true; }
        updateLayer(id, { dx: round(d0[0] + dx), dy: round(d0[1] + dy) }, false);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (e.button === 0 && !id) select(null);
    startPan(e);
  };

  const startPan = (e: React.PointerEvent) => {
    const p0 = [e.clientX, e.clientY], pan0 = useStore.getState().pan;
    setPanning(true);
    const move = (ev: PointerEvent) => set({ pan: [pan0[0] + ev.clientX - p0[0], pan0[1] + ev.clientY - p0[1]] });
    const up = () => { setPanning(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onSplitDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const p = toImage(ev.clientX, ev.clientY);
      set({ split: Math.max(0, Math.min(1, p[0] / iw)) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const f = [...e.dataTransfer.files].find((x) => ACCEPTED.includes(x.type));
    if (f) void loadFile(f);
  };
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const showVector = view !== 'original';
  const showImage = view !== 'vector';
  const vectorClip = view === 'split' ? `inset(0 0 0 ${split * 100}%)` : undefined;
  const wire = showOutlines;

  return (
    <main
      ref={box}
      className="canvas"
      data-panning={panning}
      onPointerDown={onPointerDown}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDropOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropOver(false); }}
      onDrop={onDrop}
      aria-label="Lienzo"
    >
      {!source && (
        <div className="dropzone" data-over={dropOver}>
          <div className="dropzone__card">
            <img src={`${import.meta.env.BASE_URL}ketzvia-simbolo.svg`} alt="" />
            <h1 className="t-headline-lg">Vectorización por capas</h1>
            <p className="t-body-md">Convierte PNG, JPG o WebP en SVG reconstruyendo cada figura como una capa geométrica independiente.</p>
            <div className="dropzone__actions">
              <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
              <Button variant="primary" icon={<ImageUp />} onClick={() => fileInput.current?.click()}>Importar imagen</Button>
              <Button variant="outline" icon={<Sparkles />} onClick={() => void sampleFile().then(loadFile)}>Usar imagen de ejemplo</Button>
            </div>
            <span className="dropzone__hint">También puedes arrastrar o pegar una imagen. Todo el procesamiento ocurre en tu navegador.</span>
          </div>
        </div>
      )}

      {source && (
        <div className="stage" style={{ width: iw, height: ih, transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
          <div className="stage__frame" />
          {showImage && <img src={source.url} alt="Imagen original" draggable={false} style={{ imageRendering: s > 2 ? 'pixelated' : 'auto' }} />}
          {showVector && (
            <svg
              className={`vector ${wire ? 'wire' : ''}`}
              viewBox={`0 0 ${iw} ${ih}`}
              style={{ clipPath: vectorClip, opacity: view === 'overlay' ? overlayOpacity : 1 }}
              onPointerOver={(e) => setHover((e.target as Element).getAttribute('data-id'))}
              onPointerOut={() => setHover(null)}
            >
              {view !== 'split' && view !== 'overlay' && <rect width={iw} height={ih} fill="#fff" />}
              {visibleLayers.map((l) => (
                <path
                  key={l.id}
                  data-id={l.id}
                  d={dMap.get(l.id)}
                  fill={l.fill}
                  fillRule="evenodd"
                  opacity={l.opacity < 1 ? l.opacity : undefined}
                  transform={l.dx || l.dy ? `translate(${l.dx} ${l.dy})` : undefined}
                  vectorEffect={wire ? 'non-scaling-stroke' : undefined}
                />
              ))}
            </svg>
          )}
          <svg className="overlay-ui" viewBox={`0 0 ${iw} ${ih}`}>
            {showAxes && globalAxis && <AxisLine axis={globalAxis} w={iw} h={ih} global />}
            {hover && hover !== selectedId && showVector && (() => {
              const l = layers.find((x) => x.id === hover);
              return l && l.kind !== 'background' ? <path className="hover-outline" d={dMap.get(l.id)} transform={`translate(${l.dx} ${l.dy})`} /> : null;
            })()}
            {selected && selected.kind !== 'background' && (
              <g transform={`translate(${selected.dx} ${selected.dy})`}>
                <path className="sel-outline" d={dMap.get(selected.id)} />
                {showAxes && selected.symmetry && !selected.symmetry.global && <AxisLine axis={selected.symmetry} w={iw} h={ih} />}
                <Nodes shape={selected.shape} scale={s} />
              </g>
            )}
          </svg>
        </div>
      )}

      {source && view === 'split' && (
        <>
          <div className="split-handle" style={{ left: tx + split * iw * s, top: ty, height: ih * s }} onPointerDown={onSplitDown}
            role="slider" aria-label="Divisor de comparación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)} tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') set({ split: Math.max(0, split - 0.02) }); if (e.key === 'ArrowRight') set({ split: Math.min(1, split + 0.02) }); }}>
            <span><SplitSquareHorizontal /></span>
          </div>
          <span className="split-label" style={{ left: Math.max(12, tx + 12) }}>Original</span>
          <span className="split-label" style={{ right: Math.max(12, size.w - (tx + iw * s) + 12) }}>Vectorizado</span>
        </>
      )}

      {status === 'processing' && progress && (
        <div className="status-chip" role="status"><span className="dot" />{progress.stage}… <span className="t-mono-sm">{Math.round(progress.value * 100)}%</span></div>
      )}
      {status === 'loading' && <div className="status-chip" role="status"><span className="dot" />Leyendo imagen…</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {dropOver && source && <div className="drop-veil" />}

      {source && (
        <div className="toolbar" role="toolbar" aria-label="Herramientas del lienzo" onPointerDown={(e) => e.stopPropagation()}>
          <Tabs label="Modo de vista" items={MODES} value={view} onChange={(v) => set({ view: v })} iconOnly={size.w < 720} />
          {view === 'overlay' && (
            <Slider label="Opacidad del vector" value={Math.round(overlayOpacity * 100)} min={0} max={100} onChange={(v) => set({ overlayOpacity: v / 100 })} format={(v) => `${v}%`} />
          )}
          <span className="toolbar__sep hide-mobile" />
          <IconButton size="sm" label="Contornos" pressed={showOutlines} onClick={() => set({ showOutlines: !showOutlines })}><Spline /></IconButton>
          <IconButton size="sm" label="Ejes de simetría" pressed={showAxes} onClick={() => set({ showAxes: !showAxes })}><Scan /></IconButton>
          <span className="toolbar__sep" />
          <IconButton size="sm" className="hide-mobile" label="Alejar" onClick={() => set({ zoom: clampZoom(zoom / 1.25) })}><Minus /></IconButton>
          <button type="button" className="toolbar__zoom" title="Restablecer zoom al 100%" onClick={() => set({ zoom: 1 / Math.max(0.01, fit), pan: [0, 0] })}>{Math.round(s * 100)}%</button>
          <IconButton size="sm" className="hide-mobile" label="Acercar" onClick={() => set({ zoom: clampZoom(zoom * 1.25) })}><Plus /></IconButton>
          <IconButton size="sm" label="Ajustar a la vista" onClick={() => set({ zoom: 1, pan: [0, 0] })}><Maximize /></IconButton>
        </div>
      )}
    </main>
  );
}

function clampZoom(z: number) { return Math.max(0.1, Math.min(40, z)); }
function round(v: number) { return Math.round(v * 100) / 100; }

function AxisLine({ axis, w, h, global }: { axis: SymmetryAxis; w: number; h: number; global?: boolean }) {
  const a = (axis.angle * Math.PI) / 180, L = Math.hypot(w, h);
  const u = [Math.cos(a), Math.sin(a)];
  const ext = global ? L : L * 0.25;
  return <line className={`axis ${global ? 'axis--global' : ''}`} x1={axis.p[0] - u[0] * ext} y1={axis.p[1] - u[1] * ext} x2={axis.p[0] + u[0] * ext} y2={axis.p[1] + u[1] * ext} />;
}

/** Nodos de la forma seleccionada (y manejadores de Bézier). */
function Nodes({ shape, scale }: { shape: Shape; scale: number }) {
  const r = 3.5 / scale;
  const anchors: Vec[] = [];
  const handles: [Vec, Vec][] = [];
  switch (shape.type) {
    case 'circle': anchors.push([shape.cx + shape.r, shape.cy], [shape.cx, shape.cy + shape.r], [shape.cx - shape.r, shape.cy], [shape.cx, shape.cy - shape.r]); break;
    case 'ellipse': {
      const a = (shape.rotation * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      for (const [x, y] of [[shape.rx, 0], [0, shape.ry], [-shape.rx, 0], [0, -shape.ry]]) anchors.push([shape.cx + x * c - y * sn, shape.cy + x * sn + y * c]);
      break;
    }
    case 'rect': {
      const a = (shape.rotation * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = (x * shape.w) / 2, py = (y * shape.h) / 2;
        anchors.push([shape.cx + px * c - py * sn, shape.cy + px * sn + py * c]);
      }
      break;
    }
    case 'polygon': anchors.push(...shape.points); break;
    case 'path': {
      let prev = shape.loop.start;
      anchors.push(prev);
      for (const g of shape.loop.segs) {
        if (!g.line) handles.push([prev, g.c1], [g.p, g.c2]);
        anchors.push(g.p);
        prev = g.p;
      }
    }
  }
  return (
    <g>
      {handles.map(([a, b], i) => <line key={`l${i}`} className="ctrl-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />)}
      {handles.map(([, b], i) => <circle key={`h${i}`} className="node--ctrl" cx={b[0]} cy={b[1]} r={r * 0.6} />)}
      {anchors.map((p, i) => <rect key={i} className="node" x={p[0] - r} y={p[1] - r} width={2 * r} height={2 * r} rx={r * 0.3} />)}
    </g>
  );
}
