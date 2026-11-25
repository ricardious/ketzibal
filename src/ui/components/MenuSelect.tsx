import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuOption<T extends string> { value: T; label: string; icon?: ReactNode }

interface Props<T extends string> {
  label: string;
  icon?: ReactNode;
  options: MenuOption<T>[];
  onSelect: (v: T) => void;
  disabled?: boolean;
  className?: string;
}

/** Desplegable con los colores del tema (sustituye al <select> nativo, que el sistema dibuja a su manera). */
export function MenuSelect<T extends string>({ label, icon, options, onSelect, disabled, className = '' }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = () => {
    const r = btn.current!.getBoundingClientRect();
    const h = options.length * 36 + 10;
    const up = r.bottom + h + 8 > innerHeight && r.top - h - 8 > 0;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const reflow = () => setOpen(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open]);

  // la lista se monta cuando ya tiene posición; entonces recibe el foco del teclado
  useEffect(() => { if (open && pos) list.current?.focus({ preventScroll: true }); }, [open, pos]);

  const choose = (i: number) => {
    setOpen(false);
    btn.current?.focus();
    onSelect(options[i].value);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const n = options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a + n - 1) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key.length === 1) {
      // saltar a la primera opción que empieza por esa letra
      const k = e.key.toLowerCase();
      const i = options.findIndex((o, j) => j > active && o.label.toLowerCase().startsWith(k));
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (j >= 0) setActive(j);
    }
  };

  return (
    <>
      <button ref={btn} type="button" className={`mselect ${className}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => { setActive(0); setPos(null); setOpen((o) => !o); }}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setActive(e.key === 'ArrowUp' ? options.length - 1 : 0); setOpen(true); } }}>
        {icon}
        <span className="mselect__label">{label}</span>
        <ChevronDown className="mselect__chev" />
      </button>
      {open && pos && createPortal(
        <div ref={list} id={id} role="listbox" aria-label={label} tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          className="mselect__list" data-up={pos.up}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
          onKeyDown={onListKey}>
          {options.map((o, i) => (
            <div key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === active}
              className="mselect__option" data-active={i === active}
              onPointerEnter={() => setActive(i)} onClick={() => choose(i)}>
              {o.icon}<span>{o.label}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
