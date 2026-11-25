import { ArrowDownToLine, ArrowUpToLine, CopyPlus, Eye, EyeOff, Focus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MOD } from './lib/shortcuts';
import { useStore } from './store';

interface Item { label: string; icon: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; run: () => void }

/** Menú contextual de una capa (clic derecho en el lienzo o en la lista). */
export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const layer = useStore((s) => s.layers.find((l) => l.id === s.menu?.id) ?? null);
  const index = useStore((s) => s.layers.findIndex((l) => l.id === s.menu?.id));
  const count = useStore((s) => s.layers.length);
  const isolatedId = useStore((s) => s.isolatedId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<[number, number]>([0, 0]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos([Math.min(menu.x, innerWidth - r.width - 8), Math.min(menu.y, innerHeight - r.height - 8)]);
    ref.current.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) useStore.getState().set({ menu: null }); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [menu]);

  if (!menu || !layer) return null;
  const st = useStore.getState();
  const isBg = layer.kind === 'background';
  const items: (Item | null)[] = [
    { label: isolatedId === layer.id ? 'Salir del aislamiento' : 'Editar nodos', icon: <Focus />, hint: 'Doble clic', disabled: isBg, run: () => st.isolate(isolatedId === layer.id ? null : layer.id) },
    { label: 'Duplicar', icon: <CopyPlus />, hint: `${MOD} D`, disabled: isBg, run: () => st.duplicateLayer(layer.id) },
    { label: layer.visible ? 'Ocultar' : 'Mostrar', icon: layer.visible ? <EyeOff /> : <Eye />, hint: 'H', run: () => st.updateLayer(layer.id, { visible: !layer.visible }) },
    null,
    { label: 'Traer al frente', icon: <ArrowUpToLine />, hint: ']', disabled: index === count - 1, run: () => st.moveLayer(layer.id, count - 1) },
    { label: 'Enviar al fondo', icon: <ArrowDownToLine />, hint: '[', disabled: index === 0, run: () => st.moveLayer(layer.id, 0) },
    null,
    { label: 'Eliminar', icon: <Trash2 />, hint: 'Supr', danger: true, run: () => st.deleteLayer(layer.id) },
  ];

  const onKey = (e: React.KeyboardEvent) => {
    const all = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      st.set({ menu: null });
    }
  };

  return (
    <div ref={ref} className="menu" role="menu" aria-label={`Acciones de ${layer.name}`} style={{ left: pos[0], top: pos[1] }} onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="menu__title">{layer.name}</div>
      {items.map((it, i) => it === null ? <hr key={i} /> : (
        <button key={it.label} type="button" role="menuitem" className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`} disabled={it.disabled}
          onClick={() => { st.set({ menu: null }); it.run(); }}>
          {it.icon}<span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
