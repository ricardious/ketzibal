import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { IconButton } from './components/Button';
import { SHORTCUT_GROUPS } from './lib/shortcuts';
import { useStore } from './store';

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => useStore.getState().set({ shortcutsOpen: false });
  return (
    <dialog ref={ref} className="shortcuts" aria-labelledby="sc-title" onClose={close}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="shortcuts__head">
        <h2 id="sc-title" className="t-headline-md">Atajos de teclado</h2>
        <IconButton label="Cerrar" onClick={close}><X /></IconButton>
      </div>
      <div className="shortcuts__grid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="section__title">{g.title}</h3>
            <dl>
              {g.items.map(([keys, what]) => (
                <div key={what} className="shortcuts__row">
                  <dt>{what}</dt>
                  <dd>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
