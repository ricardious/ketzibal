import { useRef, useState } from 'react';
import { FIGURES, nodes, PALETTE, PIXELS, shape, svgMarkup, VIEW } from './quetzal';
import { PixelImage } from './PixelImage';

const MARKUP = svgMarkup();

const STEPS = [
  {
    title: 'Reduce la paleta',
    text: 'Agrupa los colores en el espacio perceptual OKLab y descarta los tonos intermedios que dejan el antialiasing y la compresión JPEG.',
  },
  {
    title: 'Separa y ordena las capas',
    text: 'Cada mancha de color pasa a su propia capa. Si dos figuras se tocan, la que tiene el borde cóncavo hacia la otra queda debajo.',
  },
  {
    title: 'Reconoce cada forma',
    text: 'Prueba círculo, elipse, rectángulo, polígono y estrella, y se queda con la primera que encaja. Si ninguna encaja, usa curvas Bézier.',
  },
  {
    title: 'Completa lo que está tapado',
    text: 'Una figura cubierta se ajusta con su borde visible y se exporta entera. Si mueves la capa de arriba, no aparecen huecos.',
  },
];

const VERTICES = FIGURES.reduce((n, f) => n + (f.circle ? 0 : f.points!.length), 0);
const CIRCLES = FIGURES.filter((f) => f.circle).length;

/** Explicación del proceso con el quetzal: cada paso transforma la misma ilustración. */
export function HowItWorks() {
  const [step, setStep] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);


  const go = (i: number) => {
    const n = (i + STEPS.length) % STEPS.length;
    setStep(n);
    tabs.current[n]?.focus();
  };

  return (
    <div className="how" data-step={step}>
      <div className="how__steps" role="tablist" aria-label="Pasos del proceso" aria-orientation="vertical">
        {STEPS.map((s, i) => (
          <button key={s.title} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`how-tab-${i}`}
            aria-selected={step === i} aria-controls="how-panel" tabIndex={step === i ? 0 : -1}
            className="how__step" onClick={() => setStep(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
            }}>
            <span className="how__num" aria-hidden>{i + 1}</span>
            <span className="how__body">
              <span className="how__title">{s.title}</span>
              <span className="how__text">{s.text}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="how__panel" id="how-panel" role="tabpanel" aria-labelledby={`how-tab-${step}`}>
        <div className="how__visual" aria-hidden title="Siguiente paso" onClick={() => setStep((step + 1) % STEPS.length)}>
          <PixelImage markup={MARKUP} size={PIXELS} className="how__pixels" />
          <div className="how__stack">
            {FIGURES.map((f, i) => (
              <svg key={f.id} className="how__layer" viewBox={VIEW} data-hidden={!!f.hidden}
                style={{ '--i': i, '--n': FIGURES.length } as React.CSSProperties}>
                <rect className="how__sheet" x="-8" y="0" width="116" height="116" rx="3" />
                {shape(f, { fill: f.fill, stroke: f.fill, strokeWidth: 0.25, strokeLinejoin: 'round' })}
              </svg>
            ))}
          </div>
          <svg className="how__nodes" viewBox={VIEW}>
            {FIGURES.flatMap((f) => nodes(f).map(([x, y], j) => <rect key={`${f.id}${j}`} x={x - 0.9} y={y - 0.9} width="1.8" height="1.8" rx="0.4" />))}
          </svg>
          <svg className="how__ghosts" viewBox={VIEW}>
            {FIGURES.filter((f) => f.hidden).map((f) => <g key={f.id}>{shape(f, {})}</g>)}
          </svg>
        </div>

        <div className="how__aside" aria-live="polite">
          {step === 0 && (
            <>
              <p><b>{PALETTE.length} colores</b> en lugar de los cientos de tonos que deja el antialiasing en los bordes.</p>
              <ul className="how__swatches">
                {PALETTE.map((c) => <li key={c} style={{ background: c }} title={c} />)}
              </ul>
            </>
          )}
          {step === 1 && <p><b>{FIGURES.length} capas</b>, de la que se pinta primero (la cola) a la última (el ojo).</p>}
          {step === 2 && <p><b>{VERTICES} vértices y {CIRCLES} círculo</b>. Ni un nodo de más: cada pieza es una figura exacta.</p>}
          {step === 3 && <p><b>Cuerpo, ala y cabeza</b> quedan completos bajo las piezas que los cubren.</p>}
        </div>
      </div>
    </div>
  );
}
