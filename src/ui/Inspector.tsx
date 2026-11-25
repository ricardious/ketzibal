import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Focus, RotateCcw, Spline, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { KIND_NAMES, nodeCount, type Layer } from '../engine';
import { FigurePicker } from './components/FigurePicker';
import { Button } from './components/Button';
import { Slider } from './components/Slider';
import { Tabs } from './components/Tabs';
import { Toggle } from './components/Toggle';
import { copyColor } from './lib/actions';
import { useStore } from './store';

type Tab = 'params' | 'layer';

export function Inspector() {
  const selectedId = useStore((s) => s.selectedId);
  const open = useStore((s) => s.panel === 'inspector');
  const [tab, setTab] = useState<Tab>('params');
  const [lastSel, setLastSel] = useState<string | null>(null);
  // al seleccionar una capa, mostrar su pestaña
  if (selectedId !== lastSel) {
    setLastSel(selectedId);
    setTab(selectedId ? 'layer' : 'params');
  }
  return (
    <aside className="panel panel--inspector" data-open={open} aria-label="Inspector">
      <div className="panel__head">
        <Tabs
          label="Inspector"
          block
          items={[{ value: 'params', label: 'Parámetros' }, { value: 'layer', label: 'Capa' }]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="panel__body">{tab === 'params' ? <Params /> : <LayerInspector />}</div>
    </aside>
  );
}

function Params() {
  const p = useStore((s) => s.params);
  const source = useStore((s) => s.source);
  const layers = useStore((s) => s.layers);
  const palette = useStore((s) => s.palette);
  const stats = useStore((s) => s.stats);
  const accuracy = useStore((s) => s.accuracy);
  const { setParam, resetParams } = useStore.getState();
  const nodes = layers.reduce((a, l) => a + nodeCount(l.shape) + l.holes.reduce((b, h) => b + nodeCount(h), 0), 0);
  const prims = layers.filter((l) => l.kind !== 'path' && l.kind !== 'background').length;
  const disabled = !source;

  return (
    <>
      <section className="section" aria-labelledby="s-det">
        <h3 className="section__title" id="s-det">Detección por capas</h3>
        <Slider label="Colores máximos" value={p.colors} min={2} max={24} discrete disabled={disabled} onChange={(v) => setParam('colors', v)} />
        <Slider label="Detalle mínimo" value={p.minArea} min={2} max={400} disabled={disabled} format={(v) => `${v} px²`} onChange={(v) => setParam('minArea', v)} />
        <Slider label="Resolución de trabajo" value={p.maxSide} min={400} max={2400} step={100} disabled={disabled} format={(v) => `${v} px`} onChange={(v) => setParam('maxSide', v)} />
      </section>
      <section className="section" aria-labelledby="s-geo">
        <h3 className="section__title" id="s-geo">Corrección geométrica</h3>
        <Toggle label="Reconocer formas" description="Círculos, elipses, rectángulos, polígonos regulares y estrellas." checked={p.detectShapes} disabled={disabled} onChange={(v) => setParam('detectShapes', v)} />
        <Toggle label="Simetría" description="Detecta ejes por figura y de la composición, y los aplica." checked={p.symmetry} disabled={disabled} onChange={(v) => setParam('symmetry', v)} />
        <Toggle label="Detectar contornos" description="Separa las líneas oscuras por región y conserva su grosor." checked={p.lineArt} disabled={disabled} onChange={(v) => setParam('lineArt', v)} />
        <Toggle label="Reconstruir ocultas" description="Completa figuras tapadas por otras capas." checked={p.reconstructHidden} disabled={disabled || !p.detectShapes} onChange={(v) => setParam('reconstructHidden', v)} />
        <Slider label="Suavizado" value={p.smoothing} min={0} max={100} disabled={disabled} format={(v) => `${v}%`} onChange={(v) => setParam('smoothing', v)} />
        <Slider label="Tolerancia" value={p.tolerance} min={0.25} max={4} step={0.25} disabled={disabled} format={(v) => `${v.toFixed(2)} px`} onChange={(v) => setParam('tolerance', v)} />
        <Button variant="outline" size="sm" icon={<RotateCcw />} disabled={disabled} onClick={resetParams}>Restablecer parámetros</Button>
      </section>
      {layers.length > 0 && (
        <>
          <section className="section" aria-labelledby="s-res">
            <h3 className="section__title" id="s-res">Resultado</h3>
            <dl className="stats">
              <div className="stat"><dt>Precisión</dt><dd>{accuracy == null ? '—' : `${Math.round(accuracy * 100)}%`}</dd></div>
              <div className="stat"><dt>Capas</dt><dd>{layers.length}</dd></div>
              <div className="stat"><dt>Nodos</dt><dd>{nodes}</dd></div>
              <div className="stat"><dt>Primitivas</dt><dd>{prims}</dd></div>
            </dl>
            {stats && <span className="t-body-sm" style={{ color: 'var(--on-surface-variant)' }}>Procesado en <span className="t-mono-sm">{stats.ms} ms</span> · {stats.regions} regiones</span>}
          </section>
          <section className="section" aria-labelledby="s-pal">
            <h3 className="section__title" id="s-pal">Paleta</h3>
            <div className="palette">
              {palette.map((c) => (
                <button key={c} type="button" style={{ background: c }} title={c} aria-label={`Copiar ${c}`} onClick={() => void copyColor(c)} />
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function LayerInspector() {
  const layer = useStore((s) => s.layers.find((l) => l.id === s.selectedId) ?? null);
  const additionalIds = useStore(s => s.additionalIds);
  const canJoin = useStore(s => s.additionalIds.length > 0 && [s.selectedId, ...s.additionalIds].every(id => s.layers.some(l => l.id === id && l.shape.type === 'strokes')));
  const index = useStore((s) => s.layers.findIndex((l) => l.id === s.selectedId));
  const count = useStore((s) => s.layers.length);
  const isolatedId = useStore((s) => s.isolatedId);
  const { updateLayer, moveLayer, deleteLayer, isolate, beginEdit } = useStore.getState();
  if (!layer) return <p className="panel__empty">Selecciona una capa en la lista o en el lienzo para editarla.</p>;

  if (additionalIds.length) return <section className="section"><h3 className="section__title">{additionalIds.length + 1} capas seleccionadas</h3><Button disabled={!canJoin} onClick={useStore.getState().joinSelected}>Unir trazos</Button><p className="t-body-sm">{canJoin ? 'La unión sigue la tinta de la imagen original y conserva el estilo del primer trazo.' : 'Selecciona solo capas de trazo para unirlas.'}</p></section>;

  const isBg = layer.kind === 'background';
  const usingRecognized = layer.shape === layer.recognized || (layer.shape.type !== 'path' && layer.shape.type !== 'strokes');
  const nodes = nodeCount(layer.shape) + layer.holes.reduce((a, h) => a + nodeCount(h), 0);

  return (
    <>
      <section className="section">
        {!isBg && <Button size="sm" variant="outline" icon={<Focus />} onClick={() => isolate(isolatedId ? null : layer.id)}>{isolatedId ? 'Salir del aislamiento' : 'Editar en aislamiento'}</Button>}
        {!isBg && <FigurePicker action="replace" />}
        {isolatedId && <p className="t-body-sm">Arrastra un nodo para moverlo. En trazos, curvas y polígonos, selecciona un nodo cuadrado y pulsa Supr o Retroceso para borrarlo.</p>}
        {layer.kind === 'stroke' && !isolatedId && <p className="t-body-sm">Usa Mayús + clic para seleccionar otro trazo y unirlos.</p>}
        <div className="field">
          <label className="field__label" htmlFor="ly-name">Nombre</label>
          <input id="ly-name" key={layer.id + layer.name} className="input" defaultValue={layer.name}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== layer.name) updateLayer(layer.id, { name: v }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
        {layer.kind !== 'stroke' && <div className="field">
          <label className="field__label" htmlFor="ly-fill">Relleno</label>
          <div className="color-field">
            <input id="ly-fill" type="color" value={layer.fill.toLowerCase()} onFocus={beginEdit}
              onChange={(e) => updateLayer(layer.id, { fill: e.target.value.toUpperCase() }, false)} />
            <HexInput layer={layer} onCommit={(fill) => updateLayer(layer.id, { fill })} />
          </div>
        </div>}
        {!isBg && <StrokeFields layer={layer} />}
        <Slider label="Opacidad" value={Math.round(layer.opacity * 100)} min={0} max={100} format={(v) => `${v}%`}
          onChange={(v) => updateLayer(layer.id, { opacity: v / 100 })} />
        <Toggle label="Visible" checked={layer.visible} onChange={(v) => updateLayer(layer.id, { visible: v })} />
      </section>

      {!isBg && (
        <section className="section">
          <h3 className="section__title">Geometría</h3>
          <dl className="kv">
            <dt>Tipo</dt><dd>{KIND_NAMES[layer.kind]}</dd>
            <dt>Nodos</dt><dd>{nodes} nodos</dd>
            <dt>Huecos</dt><dd>{layer.holes.length}</dd>
            <dt>Área</dt><dd>{Math.round(layer.area).toLocaleString('es')} px²</dd>
            {layer.recognized && <><dt>Error de ajuste</dt><dd>{layer.fitError.toFixed(2)} px</dd></>}
            <dt>Simetría</dt><dd>{layer.symmetry ? `${axisName(layer.symmetry.angle)} · ${Math.round(layer.symmetry.score * 100)}%` : 'No detectada'}</dd>
            <dt>Reconstruida</dt><dd>{layer.reconstructed ? 'Sí' : 'No'}</dd>
          </dl>
          {layer.recognized && (
            <Toggle label="Forma reconocida" description={usingRecognized ? `Se exporta como ${KIND_NAMES[layer.kind].toLowerCase()} exacto.` : 'Se exporta el trazado libre del contorno.'}
              checked={usingRecognized}
              onChange={(v) => updateLayer(layer.id, { shape: v ? layer.recognized! : layer.freeform })} />
          )}
          {layer.shape !== layer.freeform && layer.shape.type !== 'path' && layer.shape.type !== 'strokes' && (
            <Button variant="outline" size="sm" icon={<Spline />} onClick={() => updateLayer(layer.id, { shape: layer.freeform })}>Convertir en trazado</Button>
          )}
          {!layer.recognized && layer.shape.type === 'path' && (
            <span className="t-body-sm" style={{ color: 'var(--on-surface-variant)' }}><Wand2 size={12} style={{ verticalAlign: -2 }} /> Sin primitiva equivalente: se conserva como trazado Bézier.</span>
          )}
          <div className="section__row">
            <NumField label="X" value={layer.dx} onCommit={(dx) => updateLayer(layer.id, { dx })} />
            <NumField label="Y" value={layer.dy} onCommit={(dy) => updateLayer(layer.id, { dy })} />
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section__title">Orden y acciones</h3>
        <div className="actions">
          <Button size="sm" icon={<ArrowUpToLine />} disabled={index === count - 1} onClick={() => moveLayer(layer.id, count - 1)}>Al frente</Button>
          <Button size="sm" icon={<ChevronUp />} disabled={index === count - 1} onClick={() => moveLayer(layer.id, index + 1)}>Subir</Button>
          <Button size="sm" icon={<ChevronDown />} disabled={index === 0} onClick={() => moveLayer(layer.id, index - 1)}>Bajar</Button>
          <Button size="sm" icon={<ArrowDownToLine />} disabled={index === 0} onClick={() => moveLayer(layer.id, 0)}>Al fondo</Button>
        </div>
        <div className="actions">
          <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => deleteLayer(layer.id)}>Eliminar</Button>
        </div>
      </section>
    </>
  );
}

function StrokeFields({ layer }: { layer: Layer }) {
  const { updateLayer, beginEdit } = useStore.getState();
  const palette = useStore((s) => s.palette);
  const st = layer.stroke;
  const darkest = palette.length ? palette.reduce((a, b) => (lum(a) < lum(b) ? a : b)) : '#000000';
  return (
    <>
      {layer.kind !== 'stroke' && (
        <Toggle label="Contorno" description={st ? 'La capa se dibuja con un trazo en su borde.' : 'Sin trazo en el borde.'} checked={!!st}
          onChange={(v) => updateLayer(layer.id, { stroke: v ? { color: darkest, width: 4 } : null })} />
      )}
      {st && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="ly-stroke">Color del trazo</label>
            <div className="color-field">
              <input id="ly-stroke" type="color" value={st.color.toLowerCase()} onFocus={beginEdit}
                onChange={(e) => updateLayer(layer.id, { stroke: { ...st, color: e.target.value.toUpperCase() } }, false)} />
              <input key={layer.id + st.color} className="input input--mono" defaultValue={st.color} aria-label="Color del trazo en hexadecimal" spellCheck={false}
                onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (/^#?[0-9A-F]{6}$/.test(v)) updateLayer(layer.id, { stroke: { ...st, color: v.startsWith('#') ? v : `#${v}` } }); else e.target.value = st.color; }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            </div>
          </div>
          <Slider label="Grosor del trazo" value={Math.round(st.width * 2) / 2} min={0.5} max={Math.max(40, Math.ceil(st.width * 2))} step={0.5}
            format={(v) => `${v.toFixed(1)} px`} onChange={(v) => updateLayer(layer.id, { stroke: { ...st, width: v } })} />
        </>
      )}
    </>
  );
}

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

function axisName(angle: number) {
  if (angle === 90) return 'Eje vertical';
  if (angle === 0) return 'Eje horizontal';
  return `Eje ${Math.round(angle)}°`;
}

function HexInput({ layer, onCommit }: { layer: Layer; onCommit: (v: string) => void }) {
  return (
    <input key={layer.id + layer.fill} className="input input--mono" defaultValue={layer.fill} aria-label="Color hexadecimal" spellCheck={false}
      onBlur={(e) => {
        const v = e.target.value.trim().toUpperCase();
        const ok = /^#?[0-9A-F]{6}$/.test(v);
        if (ok) onCommit(v.startsWith('#') ? v : `#${v}`);
        else e.target.value = layer.fill;
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function NumField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  return (
    <label className="input-affix">
      <span>{label}</span>
      <input key={value} className="input input--mono" type="number" step={0.5} defaultValue={value} aria-label={`Desplazamiento ${label}`}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}
