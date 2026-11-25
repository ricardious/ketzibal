import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Atajo de teclado que se muestra en el título. */
  hint?: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
  /** Ocultar el texto y dejar solo el icono (conserva el nombre accesible). */
  iconOnly?: boolean;
}

/** tabs-horizontal / tabs-with-icon */
export function Tabs<T extends string>({ items, value, onChange, label, block, iconOnly }: TabsProps<T>) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = items.length;
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
    onChange(next.value);
    const el = (e.currentTarget.parentElement?.children[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n] as HTMLElement) ?? null;
    el?.focus();
  };
  return (
    <div className={`tabs ${block ? 'tabs--block' : ''}`} role="tablist" aria-label={label}>
      {items.map((it, i) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={it.value === value}
          tabIndex={it.value === value ? 0 : -1}
          aria-label={iconOnly ? it.label : undefined}
          title={it.hint ? `${it.label} (${it.hint})` : iconOnly ? it.label : undefined}
          onClick={() => onChange(it.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {it.icon}
          {!iconOnly && it.label}
        </button>
      ))}
    </div>
  );
}
