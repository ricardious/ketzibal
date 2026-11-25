/** El quetzal de Ketzvia descompuesto en sus figuras; lo usan la demo del hero y la explicación del proceso. */
export type P = [number, number];
export interface Figure {
  id: string;
  name: string;
  detail: string;
  fill: string;
  points?: P[];
  circle?: { cx: number; cy: number; r: number };
  /** Se dibuja el contorno completo, incluida la parte tapada por otras capas. */
  hidden?: boolean;
}

/** Las piezas del quetzal de Ketzvia, en el orden en que se pintan. */
export const FIGURES: Figure[] = [
  { id: 'cola-clara', name: 'Pluma de la cola', detail: 'Triángulo: tres vértices exactos, sin nodos de más.', fill: '#C084FC', points: [[48, 60], [58, 60], [14, 104]] },
  { id: 'cola-larga', name: 'Pluma larga de la cola', detail: 'Triángulo: tres vértices exactos, sin nodos de más.', fill: '#7E22CE', points: [[46, 58], [57, 63], [32, 110]] },
  { id: 'cuerpo', name: 'Cuerpo', detail: 'Pentágono completo, aunque el ala y el pecho tapen casi todo.', fill: '#7E22CE', points: [[54, 26], [70, 30], [74, 46], [58, 64], [42, 57]], hidden: true },
  { id: 'pecho', name: 'Pecho', detail: 'Triángulo apoyado sobre el cuerpo.', fill: '#F472B6', points: [[70, 30], [74, 46], [60, 42]] },
  { id: 'vientre', name: 'Vientre', detail: 'Triángulo que comparte dos vértices con el pecho.', fill: '#DB2777', points: [[60, 42], [74, 46], [58, 64]] },
  { id: 'ala', name: 'Ala', detail: 'Cuadrilátero completo bajo su cubierta.', fill: '#C084FC', points: [[54, 26], [60, 42], [58, 64], [40, 56]], hidden: true },
  { id: 'cubierta', name: 'Cubierta del ala', detail: 'Triángulo encima del ala, en su propia capa.', fill: '#D8B4FE', points: [[54, 26], [60, 42], [40, 56]] },
  { id: 'cabeza', name: 'Cabeza', detail: 'Pentágono completo bajo la cresta y el pico.', fill: '#A855F7', points: [[44, 6], [66, 12], [80, 22], [70, 30], [54, 26]], hidden: true },
  { id: 'cresta', name: 'Cresta', detail: 'Triángulo sobre la cabeza.', fill: '#7E22CE', points: [[44, 6], [66, 12], [56, 21]] },
  { id: 'pico', name: 'Pico', detail: 'Triángulo pequeño, igual de exacto que los grandes.', fill: '#F9A8D4', points: [[77, 20], [86, 25], [74, 27]] },
  { id: 'ojo', name: 'Ojo', detail: 'Círculo exacto: centro y radio en lugar de una ristra de nodos.', fill: '#3B0764', circle: { cx: 68, cy: 20, r: 2.1 } },
];

export const pts = (p: P[]) => p.map((q) => q.join(',')).join(' ');
export const code = (f: Figure) => f.circle
  ? `<circle cx="${f.circle.cx}" cy="${f.circle.cy}" r="${f.circle.r}" fill="${f.fill}"/>`
  : `<polygon points="${pts(f.points!)}" fill="${f.fill}"/>`;
export const nodes = (f: Figure): P[] => f.circle
  ? [[f.circle.cx + f.circle.r, f.circle.cy], [f.circle.cx, f.circle.cy + f.circle.r], [f.circle.cx - f.circle.r, f.circle.cy], [f.circle.cx, f.circle.cy - f.circle.r]]
  : f.points!;
export const shape = (f: Figure, props: React.SVGProps<SVGElement> = {}) => f.circle
  ? <circle cx={f.circle.cx} cy={f.circle.cy} r={f.circle.r} {...(props as React.SVGProps<SVGCircleElement>)} />
  : <polygon points={pts(f.points!)} {...(props as React.SVGProps<SVGPolygonElement>)} />;

// El ave ocupa x 14–86, y 6–110: un cuadro de 116 centrado en ella.
export const VIEW = '-8 0 116 116';
export const PIXELS = 36;

/** Colores distintos del quetzal: lo que encuentra el paso de paleta. */
export const PALETTE = [...new Set(FIGURES.map((f) => f.fill))];

export function svgMarkup() {
  const body = FIGURES.map((f) => code(f).replace('/>', ` stroke="${f.fill}" stroke-width="0.25" stroke-linejoin="round"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}" width="464" height="464">${body}</svg>`;
}

