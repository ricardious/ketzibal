import { useEffect, useRef, useState } from 'react';

import { code, FIGURES, nodes, PIXELS, shape, svgMarkup, VIEW } from './quetzal';
import { PixelImage } from './PixelImage';

const MARKUP = svgMarkup();

/** Demostración del hero: el quetzal en píxeles a la izquierda, en figuras a la derecha, y su SVG, todo enlazado. */
export function HeroDemo() {
  const [split, setSplit] = useState(0.96);
  const [active, setActive] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);


  // Un único barrido de presentación del divisor; se detiene en cuanto la persona interactúa.
  useEffect(() => {
    if (touched) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setSplit(0.5); return; }
    let raf = 0, t0 = 0;
    const from = 0.96, to = 0.5, dur = 1500, delay = 500;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const k = Math.min(1, Math.max(0, (t - t0 - delay) / dur));
      setSplit(from + (to - from) * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [touched]);

  // Mantener visible la línea de código de la figura activa, sin mover la página.
  useEffect(() => {
    const box = pre.current, line = box?.querySelector<HTMLElement>(`[data-fig="${active}"]`);
    if (!box || !line) return;
    const top = line.offsetTop - box.offsetTop, bottom = top + line.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top: top - 8, behavior: 'smooth' });
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: bottom - box.clientHeight + 8, behavior: 'smooth' });
  }, [active]);

  const dragTo = (clientX: number) => {
    const r = stage.current!.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  const enter = (id: string) => { setActive(id); setTouched(true); };

  const fig = FIGURES.find((f) => f.id === active) ?? null;
  const pct = `${split * 100}%`;

  return (
    <figure className="demo" aria-label="Demostración: el quetzal de Ketzvia, de imagen pixelada a figuras SVG">
      <div className="demo__stage" ref={stage}>
        <PixelImage markup={MARKUP} size={PIXELS} className="demo__pixels" style={{ clipPath: `inset(0 calc(100% - ${pct}) 0 0)` }} />
        <svg className="demo__vector" viewBox={VIEW} style={{ clipPath: `inset(0 0 0 ${pct})` }} onPointerLeave={() => setActive(null)}>
          <title>Quetzal reconstruido en 11 figuras</title>
          {FIGURES.map((f) => (
            <g key={f.id} className="demo__fig" data-dim={!!active && active !== f.id} onPointerEnter={() => enter(f.id)}>
              {shape(f, { fill: f.fill, stroke: f.fill, strokeWidth: 0.25, strokeLinejoin: 'round' })}
            </g>
          ))}
          {fig && (
            <g className="demo__sel" pointerEvents="none">
              {shape(fig, { className: fig.hidden ? 'demo__ghost' : 'demo__outline' })}
              {nodes(fig).map(([x, y], i) => <rect key={i} x={x - 1} y={y - 1} width="2" height="2" rx="0.4" />)}
            </g>
          )}
        </svg>
        <span className="demo__tag demo__tag--l" style={{ opacity: split > 0.2 ? 1 : 0 }}>PNG de {PIXELS}×{PIXELS} px</span>
        <span className="demo__tag demo__tag--r" style={{ opacity: split < 0.8 ? 1 : 0 }}>SVG de {FIGURES.length} capas</span>
        <div className="demo__handle" style={{ left: pct }} role="slider" tabIndex={0}
          aria-label="Comparar imagen original y vectorizada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)}
          onPointerDown={(e) => { setTouched(true); e.currentTarget.setPointerCapture(e.pointerId); dragTo(e.clientX); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(e.clientX); }}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowLeft' ? -0.04 : e.key === 'ArrowRight' ? 0.04 : 0;
            if (d) { e.preventDefault(); setTouched(true); setSplit((v) => Math.max(0, Math.min(1, v + d))); }
          }}>
          <span aria-hidden><svg viewBox="0 0 24 24"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg></span>
        </div>
      </div>

      <div className="demo__code" onPointerLeave={() => setActive(null)}>
        <div className="demo__caption" aria-live="polite">
          {fig ? <><b>{fig.name}</b> <span>{fig.detail}</span></> : <span>Pasa el cursor por una pieza del quetzal o por una línea del código.</span>}
        </div>
        <pre ref={pre}><code>
          <span className="demo__line demo__line--muted">{`<svg viewBox="${VIEW}">`}</span>
          {FIGURES.map((f) => (
            <span key={f.id} data-fig={f.id} className="demo__line" data-on={active === f.id} tabIndex={0}
              onPointerEnter={() => enter(f.id)} onFocus={() => enter(f.id)} onBlur={() => setActive(null)}>
              {'  '}{code(f)}
            </span>
          ))}
          <span className="demo__line demo__line--muted">{'</svg>'}</span>
        </code></pre>
      </div>
    </figure>
  );
}
