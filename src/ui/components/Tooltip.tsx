import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Sustituye los tooltips nativos (`title`) de toda la app por uno propio.
 * Mientras el puntero o el foco están sobre un elemento, su `title` se guarda en
 * `data-tip` para que el navegador no muestre el suyo, y se restaura al salir.
 * Un atajo al final entre paréntesis — «Exportar SVG (Ctrl+E)» — se dibuja como teclas.
 */
interface Tip { el: HTMLElement; text: string; keys: string[] }

const SHOW_DELAY = 450;
const WARM_WINDOW = 400; // al pasar de un botón a otro dentro de este margen, aparece al instante

function parse(title: string): Pick<Tip, 'text' | 'keys'> {
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(title);
  if (!m || m[2].length > 24) return { text: title, keys: [] };
  return { text: m[1], keys: m[2].split(/(?<=\S)\s*\+\s*(?=\S)/) };
}

function release(el: HTMLElement) {
  const t = el.getAttribute('data-tip');
  if (t !== null && !el.hasAttribute('title')) el.setAttribute('title', t);
  el.removeAttribute('data-tip');
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0, lastHide = 0;

    const hide = () => {
      window.clearTimeout(timer);
      if (current) release(current);
      if (current && tipShown) lastHide = performance.now();
      current = null; tipShown = false;
      setTip(null);
    };
    let tipShown = false;

    const enter = (el: HTMLElement, immediate: boolean) => {
      if (el === current) return;
      hide();
      const title = el.getAttribute('title');
      if (!title) return;
      el.setAttribute('data-tip', title);
      el.removeAttribute('title');
      current = el;
      const show = () => { tipShown = true; setTip({ el, ...parse(title) }); };
      if (immediate || performance.now() - lastHide < WARM_WINDOW) show();
      else timer = window.setTimeout(show, SHOW_DELAY);
    };

    const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]') ?? null;

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = target(e);
      if (el) enter(el, false);
      else if (current) hide();
    };
    const out = (e: PointerEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e);
      if (el && (e.target as HTMLElement).matches?.(':focus-visible')) enter(el, true);
    };
    const blur = (e: FocusEvent) => { if (current && e.target === current) hide(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Debajo del elemento; arriba si no cabe (p. ej. la barra inferior del lienzo). Sin salirse de la ventana.
  useLayoutEffect(() => {
    if (!tip || !box.current) { setPos(null); return; }
    const r = tip.el.getBoundingClientRect(), t = box.current.getBoundingClientRect();
    const gap = 8, margin = 8;
    const below = r.bottom + gap + t.height <= window.innerHeight - margin;
    const x = Math.min(window.innerWidth - margin - t.width, Math.max(margin, r.left + r.width / 2 - t.width / 2));
    setPos({ x, y: below ? r.bottom + gap : r.top - gap - t.height, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={box} className="tooltip" role="tooltip" data-show={!!pos} data-side={pos?.below ? 'bottom' : 'top'}
      style={{ transform: `translate(${pos?.x ?? -9999}px, ${pos?.y ?? -9999}px)` }}>
      <span>{tip.text}</span>
      {tip.keys.length > 0 && <span className="tooltip__keys">{tip.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>}
    </div>,
    document.body,
  );
}
