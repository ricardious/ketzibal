import { Focus, Columns2, Image as ImageIcon, ImageUp, Layers2, Maximize, Minus, Plus, Scan, Shapes, Sparkles, SplitSquareHorizontal, Spline } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shapeArea } from '../engine/shapes';
import { KIND_NAMES, nodeCount, shapeToD, type Layer, type Shape, type SymmetryAxis, type Vec } from '../engine';
import { DrawingTools } from './DrawingTools';
import { Button, IconButton } from './components/Button';
import { Slider } from './components/Slider';
import { Tabs } from './components/Tabs';
import { moveNode, type CurveNode } from './lib/edit-node';
import { ACCEPTED } from './lib/image';
import { loadSample, zoomBy } from './lib/actions';
import { MOD } from './lib/shortcuts';
import { useStore, type ViewMode } from './store';

const MODES = [
  { value: 'original' as ViewMode, label: 'Original', icon: <ImageIcon />, hint: '1' },
  { value: 'vector' as ViewMode, label: 'Vectorizado', icon: <Shapes />, hint: '2' },
  { value: 'split' as ViewMode, label: 'Comparar', icon: <Columns2 />, hint: '3' },
  { value: 'overlay' as ViewMode, label: 'Superponer', icon: <Layers2 />, hint: '4' },
];

export function layerD(l: Layer) {
  return [l.shape, ...l.holes].map((s) => shapeToD(s, 2)).join('');
}

export function Canvas() {
  const source = useStore((s) => s.source);
  const layers = useStore((s) => s.layers);
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const contours = useStore((s) => s.contours);
  const error = useStore((s) => s.error);
  const normalView = useStore((s) => s.view);
  const split = useStore((s) => s.split);
  const overlayOpacity = useStore((s) => s.overlayOpacity);
  const showOutlines = useStore((s) => s.showOutlines);
  const showAxes = useStore((s) => s.showAxes);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const selectedId = useStore((s) => s.selectedId);
  const isolatedId = useStore((s) => s.isolatedId);
  const view = isolatedId ? 'vector' : normalView;
  const additionalIds = useStore(s => s.additionalIds);
  const globalAxis = useStore((s) => s.globalAxis);
  const { set, select, isolate, updateLayer, beginEdit, loadFile } = useStore.getState();

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const hover = useStore((s) => s.hoverId);
  const setHover = (id: string | null) => { if (useStore.getState().hoverId !== id) set({ hoverId: id }); };
  const tip = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
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

  // Mantener Espacio para desplazar el lienzo con el puntero, como en otros editores.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, select, button, [role="option"], .mselect__list, .menu');
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e) && useStore.getState().source) { e.preventDefault(); if (!e.repeat) setSpaceHeld(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const visibleLayers = useMemo(
    () => layers.filter((l) => l.visible && (!isolatedId || l.id === isolatedId)),
    [layers, isolatedId],
  );
  const dMap = useMemo(() => new Map(layers.map((l) => [l.id, layerD(l)])), [layers]);
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!source) return;
    if (spaceHeld || e.button === 1) { e.preventDefault(); return startPan(e); }
    if (e.button === 2) return;
    const target = (e.target as Element).closest('[data-id]') as SVGElement | null;
    const id = target?.getAttribute('data-id');
    const canPick = view !== 'original' && e.button === 0;
    if (id && canPick) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { select(id, true); return; }
      select(id);
      const l = useStore.getState().layers.find((x) => x.id === id);
      if (!l || l.kind === 'background') return startPan(e);
      const start = toImage(e.clientX, e.clientY);
      const d0: Vec = [l.dx, l.dy];
      let moved = false;
      target!.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = toImage(ev.clientX, ev.clientY);
        let dx = p[0] - start[0], dy = p[1] - start[1];
        if (!moved && Math.hypot(dx, dy) * s < 3) return;
        if (!moved) { beginEdit(); moved = true; setHover(null); }
        // Mayús: restringir al eje dominante
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
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

  const dragNode = (e: React.PointerEvent<SVGElement>, node: CurveNode) => {
    if (!selected || !isolatedId || e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = toImage(e.clientX, e.clientY);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const now = toImage(ev.clientX, ev.clientY);
      const delta: Vec = [now[0] - start[0], now[1] - start[1]];
      if (!moved && Math.hypot(...delta) * s < 1) return;
      if (!moved) { beginEdit(); moved = true; }
      const shape = moveNode(selected.shape, node, delta);
      const primitive = shape.type !== 'path' && shape.type !== 'strokes';
      const kind = selected.kind === 'square' && shape.type === 'rect' && Math.abs(shape.w - shape.h) > 0.01 ? 'rect' : selected.kind;
      updateLayer(selected.id, {
        shape, kind,
        ...(selected.kind === 'clipped-circle' ? {} : { freeform: shape }),
        ...(primitive ? { recognized: undefined, area: shapeArea(shape), symmetry: null, reconstructed: false, fitError: 0 } : {}),
      }, false);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('lostpointercapture', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('lostpointercapture', end);
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

  const onContextMenu = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    if (!id || view === 'original') return;
    e.preventDefault();
    const st = useStore.getState();
    if (id !== st.selectedId && !st.additionalIds.includes(id)) select(id);
    set({ menu: { x: e.clientX, y: e.clientY, id } });
  };

  const onHoverMove = (e: React.PointerEvent) => {
    const el = tip.current;
    if (!el) return;
    const r = box.current!.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 18}px)`;
  };
  const hovered = hover && !panning ? layers.find((l) => l.id === hover) : null;

  const showVector = view !== 'original';
  const showImage = !!isolatedId || view !== 'vector';
  const vectorClip = view === 'split' ? `inset(0 0 0 ${split * 100}%)` : undefined;
  const wire = showOutlines;

  return (
    <main
      ref={box}
      className="canvas"
      data-panning={panning}
      data-space={spaceHeld}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => { if (source && !(e.target as Element).closest('[data-id], .toolbar, .drawing-tools, .split-handle')) useStore.getState().fit(); }}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDropOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropOver(false); }}
      onDrop={onDrop}
      aria-label="Lienzo"
    >
      {!source && (
        <div className="dropzone" data-over={dropOver}>
          <div className="dropzone__card">
            <div className="dropzone__glyph" aria-hidden><ImageUp /></div>
            <h1 className="t-headline-lg">{dropOver ? 'Suelta para vectorizar' : 'Trae una imagen'}</h1>
            <p className="t-body-md">PNG, JPG o WebP. Cada figura se convierte en una capa SVG que puedes mover, recolorear y editar.</p>
            <div className="dropzone__actions">
              <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
              <Button variant="primary" icon={<ImageUp />} onClick={() => fileInput.current?.click()}>Elegir archivo</Button>
              <Button variant="outline" icon={<Sparkles />} onClick={() => void loadSample()}>Probar con el ejemplo</Button>
            </div>
            <span className="dropzone__hint">Arrastra el archivo aquí o pégalo con <kbd>{MOD}</kbd> <kbd>V</kbd>. La imagen no sale de tu navegador.</span>
          </div>
        </div>
      )}

      {source && (
        <div className="stage" style={{ width: iw, height: ih, transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
          <div className="stage__frame" />
          {showImage && <img src={source.url} alt="Imagen original" draggable={false} style={{ opacity: isolatedId ? 0.4 : 1, imageRendering: s > 2 ? 'pixelated' : 'auto' }} />}
          {showVector && (
            <svg
              className={`vector ${wire ? 'wire' : ''}`}
              viewBox={`0 0 ${iw} ${ih}`}
              style={{ clipPath: vectorClip, opacity: view === 'overlay' ? overlayOpacity : 1 }}
              onDoubleClick={e => {
                const id = (e.target as Element).getAttribute('data-id');
                if (id) isolate(isolatedId === id ? null : id);
              }}
              onPointerOver={(e) => setHover((e.target as Element).getAttribute('data-id'))}
              onPointerOut={() => setHover(null)}
              onPointerMove={onHoverMove}
            >
              {!showImage && <rect width={iw} height={ih} fill="#fff" />}
              <defs>{!isolatedId && visibleLayers.filter(l => l.kind === 'clipped-circle').map(l => (
                <clipPath id={`visible-${l.id}`} key={l.id}><path clipRule="evenodd" d={[l.freeform, ...l.holes].map(s => shapeToD(s)).join('')} /></clipPath>
              ))}</defs>
              {visibleLayers.map((l) => (
                <path
                  key={l.id}
                  data-id={l.id}
                  clipPath={!isolatedId && l.kind === 'clipped-circle' ? `url(#visible-${l.id})` : undefined}
                  d={dMap.get(l.id)}
                  fill={l.fill}
                  fillRule="evenodd"
                  stroke={wire ? undefined : l.stroke?.color}
                  strokeWidth={wire ? undefined : l.stroke?.width}
                  strokeLinecap={l.stroke ? 'round' : undefined}
                  strokeLinejoin={l.stroke ? 'round' : undefined}
                  opacity={l.opacity < 1 ? l.opacity : undefined}
                  transform={l.dx || l.dy ? `translate(${l.dx} ${l.dy})` : undefined}
                  vectorEffect={wire ? 'non-scaling-stroke' : undefined}
                />
              ))}
              {status === 'processing' && contours && <path className="sel-outline" d={contours} pointerEvents="none" />}
            </svg>
          )}
          <svg className="overlay-ui" viewBox={`0 0 ${iw} ${ih}`}>
            {!isolatedId && showAxes && globalAxis && <AxisLine axis={globalAxis} w={iw} h={ih} global />}
            {!isolatedId && hover && hover !== selectedId && showVector && (() => {
              const l = layers.find((x) => x.id === hover);
              return l && l.kind !== 'background' ? <path className="hover-outline" d={dMap.get(l.id)} transform={`translate(${l.dx} ${l.dy})`} /> : null;
            })()}
            {layers.filter(l => additionalIds.includes(l.id)).map(l => <path key={l.id} className="sel-outline" d={dMap.get(l.id)} transform={`translate(${l.dx} ${l.dy})`} />)}
            {selected && selected.kind !== 'background' && (
              <g transform={`translate(${selected.dx} ${selected.dy})`}>
                <path className="sel-outline" d={dMap.get(selected.id)} />
                {showAxes && selected.symmetry && !selected.symmetry.global && <AxisLine axis={selected.symmetry} w={iw} h={ih} />}
                <Nodes shape={selected.shape} scale={s} onDrag={isolatedId ? dragNode : undefined} />
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
      {dropOver && source && <div className="drop-veil"><span>Suelta para reemplazar la imagen</span></div>}
      {source && view !== 'original' && (
        <div ref={tip} className="hover-tip" data-show={!!hovered && hovered.id !== selectedId && !isolatedId} aria-hidden>
          {hovered && <><b>{hovered.name}</b><span>{KIND_NAMES[hovered.kind]} · {nodeCount(hovered.shape) + hovered.holes.reduce((a, h) => a + nodeCount(h), 0)} nodos</span></>}
        </div>
      )}

      {source && status === 'done' && <DrawingTools key={source.url + (selectedId ?? '') + (isolatedId ?? '')} selected={selected} scale={s} tx={tx} ty={ty} />}

      {source && (
        <div className="toolbar" role="toolbar" aria-label="Herramientas del lienzo" onPointerDown={(e) => e.stopPropagation()}>
          {isolatedId ? <Button size="sm" icon={<Focus />} onClick={() => isolate(null)}>Salir del aislamiento</Button> : <Tabs label="Modo de vista" items={MODES} value={view} onChange={(v) => set({ view: v })} iconOnly={size.w < 720} />}
          {view === 'overlay' && (
            <Slider label="Opacidad del vector" value={Math.round(overlayOpacity * 100)} min={0} max={100} onChange={(v) => set({ overlayOpacity: v / 100 })} format={(v) => `${v}%`} />
          )}
          <span className="toolbar__sep hide-mobile" />
          <IconButton size="sm" label="Contornos (O)" pressed={showOutlines} onClick={() => set({ showOutlines: !showOutlines })}><Spline /></IconButton>
          <IconButton size="sm" label="Ejes de simetría (E)" pressed={showAxes} onClick={() => set({ showAxes: !showAxes })}><Scan /></IconButton>
          <span className="toolbar__sep" />
          <IconButton size="sm" className="hide-mobile" label="Alejar (−)" onClick={() => zoomBy(1 / 1.25)}><Minus /></IconButton>
          <button type="button" className="toolbar__zoom" title="Restablecer zoom al 100%" onClick={() => set({ zoom: 1 / Math.max(0.01, fit), pan: [0, 0] })}>{Math.round(s * 100)}%</button>
          <IconButton size="sm" className="hide-mobile" label="Acercar (+)" onClick={() => zoomBy(1.25)}><Plus /></IconButton>
          <IconButton size="sm" label="Ajustar a la vista (0)" onClick={() => useStore.getState().fit()}><Maximize /></IconButton>
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
function Nodes({ shape, scale, onDrag }: { shape: Shape; scale: number; onDrag?: (e: React.PointerEvent<SVGElement>, node: CurveNode) => void }) {
  const r = 3.5 / scale;
  const anchors: Vec[] = [];
  const handles: [Vec, Vec][] = [];
  const anchorNodes: CurveNode[] = [], handleNodes: CurveNode[] = [];
  const events = (node?: CurveNode) => onDrag && node ? {
    style: { pointerEvents: 'all' as const, cursor: 'grab' },
    onPointerDown: (e: React.PointerEvent<SVGElement>) => onDrag(e, node),
  } : {};
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
    case 'polygon':
      anchors.push(...shape.points);
      shape.points.forEach((_, segment) => anchorNodes.push({ loop: 0, segment, point: 'p' }));
      break;
    case 'path':
    case 'strokes': {
      for (const [index, loop] of (shape.type === 'path' ? [shape.loop] : shape.paths).entries()) {
        let prev = loop.start;
        anchors.push(prev);
        anchorNodes.push({ loop: index, segment: -1, point: 'start' });
        for (const [segment, g] of loop.segs.entries()) {
          if (!g.line) {
            handles.push([prev, g.c1], [g.p, g.c2]);
            handleNodes.push({ loop: index, segment, point: 'c1' }, { loop: index, segment, point: 'c2' });
          }
          anchorNodes.push({ loop: index, segment, point: 'p' });
          anchors.push(g.p);
          prev = g.p;
        }
      }
    }
  }
  if (shape.type === 'circle' || shape.type === 'ellipse' || shape.type === 'rect') {
    anchors.forEach((_, segment) => anchorNodes.push({ loop: 0, segment, point: 'p' }));
  }
  return (
    <g>
      {handles.map(([a, b], i) => <line key={`l${i}`} className="ctrl-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />)}
      {handles.map(([, b], i) => <circle {...events(handleNodes[i])} key={`h${i}`} className="node--ctrl" cx={b[0]} cy={b[1]} r={r * 0.6} />)}
      {anchors.map((p, i) => <rect {...events(anchorNodes[i])} key={i} className="node" x={p[0] - r} y={p[1] - r} width={2 * r} height={2 * r} rx={r * 0.3} />)}
    </g>
  );
}
