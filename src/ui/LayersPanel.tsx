import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { KIND_NAMES, nodeCount, type Layer } from '../engine';
import { IconButton } from './components/Button';
import { List, ListItem } from './components/List';
import { useStore } from './store';

export function LayersPanel() {
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const open = useStore((s) => s.panel === 'layers');
  const { select, updateLayer, moveLayer } = useStore.getState();
  const [drag, setDrag] = useState<{ id: string; over: string | null; before: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // de arriba (último en pintarse) hacia abajo
  const rows = [...layers].reverse();

  const onKey = (e: React.KeyboardEvent, l: Layer) => {
    const i = layers.findIndex((x) => x.id === l.id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveLayer(l.id, i + (e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const r = rows.findIndex((x) => x.id === l.id) + (e.key === 'ArrowDown' ? 1 : -1);
      const t = rows[Math.max(0, Math.min(rows.length - 1, r))];
      select(t.id);
      (document.querySelector(`[data-layer="${t.id}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setRenaming(l.id);
    }
  };

  const drop = () => {
    if (!drag?.over || drag.over === drag.id) return setDrag(null);
    const target = layers.findIndex((x) => x.id === drag.over);
    const from = layers.findIndex((x) => x.id === drag.id);
    // en la lista invertida "antes" significa encima → índice mayor
    let to = drag.before ? target + 1 : target;
    if (from < to) to--;
    moveLayer(drag.id, to);
    setDrag(null);
  };

  return (
    <aside className="panel panel--layers" data-open={open} aria-label="Capas">
      <div className="panel__head">
        <h2 className="panel__title">Capas</h2>
        {layers.length > 0 && <span className="count">{layers.length}</span>}
      </div>
      <div className="panel__body">
        {layers.length === 0 ? (
          <p className="panel__empty">Importa una imagen para detectar sus figuras. Cada figura se convierte en una capa vectorial independiente, ordenada de afuera hacia adentro.</p>
        ) : (
          <List role="listbox" aria-label="Capas de la imagen">
            {rows.map((l) => {
              const cls = ['layer-row', drag?.over === l.id && drag.id !== l.id ? (drag.before ? 'drop-before' : 'drop-after') : ''].join(' ');
              return (
                <ListItem
                  key={l.id}
                  data-layer={l.id}
                  className={cls}
                  data-hidden={!l.visible}
                  role="option"
                  tabIndex={l.id === selectedId || (!selectedId && l === rows[0]) ? 0 : -1}
                  interactive
                  selected={l.id === selectedId}
                  style={{ paddingLeft: 12 + Math.min(l.depth, 6) * 12 }}
                  draggable={renaming !== l.id}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ id: l.id, over: null, before: true }); }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDrag({ ...drag, over: l.id, before: e.clientY < r.top + r.height / 2 });
                  }}
                  onDrop={(e) => { e.preventDefault(); drop(); }}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => select(l.id)}
                  onDoubleClick={() => setRenaming(l.id)}
                  onKeyDown={(e) => onKey(e, l)}
                  leading={<span className="swatch" style={{ background: l.fill }} />}
                  primary={
                    renaming === l.id ? (
                      <input
                        className="rename"
                        defaultValue={l.name}
                        autoFocus
                        aria-label="Nombre de la capa"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== l.name) updateLayer(l.id, { name: v });
                          setRenaming(null);
                        }}
                      />
                    ) : (
                      <>
                        <span className="layer-name">{l.name}</span>
                        {l.reconstructed && <span className="badge" title="Completada bajo otras capas">Reconstruida</span>}
                        {l.symmetry && (l.symmetry.global || ['path', 'polygon', 'triangle'].includes(l.kind)) && <span className="badge badge--tertiary" title={l.symmetry.global ? 'Simetría global' : 'Simetría propia'}>Simetría</span>}
                      </>
                    )
                  }
                  secondary={
                    <>
                      {KIND_NAMES[l.kind]} · <span className="t-mono-sm">{nodeCount(l.shape) + l.holes.reduce((a, h) => a + nodeCount(h), 0)}</span> nodos
                    </>
                  }
                  trailing={
                    <IconButton size="sm" label={l.visible ? 'Ocultar capa' : 'Mostrar capa'} onClick={() => updateLayer(l.id, { visible: !l.visible })}>
                      {l.visible ? <Eye /> : <EyeOff />}
                    </IconButton>
                  }
                />
              );
            })}
          </List>
        )}
      </div>
    </aside>
  );
}
