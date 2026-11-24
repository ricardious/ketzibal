/** Tipos públicos del motor de vectorización. Sin dependencias del DOM. */

export type Vec = [number, number];

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel. */
  data: Uint8ClampedArray;
}

export interface VectorizeParams {
  /** Número máximo de colores de la paleta (2–24). */
  colors: number;
  /** Área mínima de una figura, en píxeles de la imagen de trabajo. */
  minArea: number;
  /** Suavizado del contorno, 0–100. */
  smoothing: number;
  /** Tolerancia de ajuste en píxeles (menor = más nodos, más fiel). */
  tolerance: number;
  /** Reconocer primitivas geométricas (círculo, rectángulo, polígono…). */
  detectShapes: boolean;
  /** Detectar y aplicar simetría por figura y global. */
  symmetry: boolean;
  /** Reconstruir figuras parcialmente ocultas. */
  reconstructHidden: boolean;
  /** Lado máximo de la imagen de trabajo. */
  maxSide: number;
  /** Detectar el dibujo lineal (contornos oscuros) y convertirlo en trazos con grosor. */
  lineArt: boolean;
}

export const DEFAULT_PARAMS: VectorizeParams = {
  colors: 8,
  minArea: 12,
  smoothing: 50,
  tolerance: 1,
  detectShapes: true,
  symmetry: true,
  reconstructHidden: true,
  maxSide: 1200,
  lineArt: true,
};

/** Segmento cúbico: puntos de control 1 y 2 y punto final. El inicio es el final del anterior. */
export interface CubicSeg {
  c1: Vec;
  c2: Vec;
  p: Vec;
  /** Verdadero si el segmento es recto (se exporta como L). */
  line?: boolean;
}

export interface BezierLoop {
  start: Vec;
  segs: CubicSeg[];
}

/** Trazado abierto (o cerrado sin relleno) para dibujo lineal. */
export interface BezierPath extends BezierLoop {
  closed?: boolean;
}

export interface StrokeStyle {
  color: string;
  width: number;
}

export type Shape =
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { type: 'rect'; cx: number; cy: number; w: number; h: number; rx: number; rotation: number }
  | { type: 'polygon'; points: Vec[] }
  | { type: 'path'; loop: BezierLoop }
  | { type: 'strokes'; paths: BezierPath[] };

export type ShapeKind =
  | 'background'
  | 'circle'
  | 'ellipse'
  | 'rect'
  | 'square'
  | 'triangle'
  | 'regular-polygon'
  | 'star'
  | 'polygon'
  | 'path'
  | 'silhouette'
  | 'stroke';

export interface SymmetryAxis {
  /** Punto del eje. */
  p: Vec;
  /** Ángulo del eje en grados (90 = vertical). */
  angle: number;
  /** IoU entre la figura y su reflejo, 0–1. */
  score: number;
  global?: boolean;
}

export interface Layer {
  id: string;
  name: string;
  kind: ShapeKind;
  /** Color de relleno; 'none' en capas de trazo. */
  fill: string;
  /** Contorno con grosor (dibujo lineal). */
  stroke: StrokeStyle | null;
  opacity: number;
  visible: boolean;
  /** Geometría exterior. */
  shape: Shape;
  /** Huecos reales (por donde se ve la capa inferior). */
  holes: Shape[];
  /** Trazado libre equivalente, para volver de la forma reconocida al contorno. */
  freeform: Shape;
  /** Forma reconocida originalmente (si existe), para restaurarla. */
  recognized?: Shape;
  /** Desplazamiento aplicado por el usuario. */
  dx: number;
  dy: number;
  parentId: string | null;
  depth: number;
  /** Área visible en píxeles de la imagen original. */
  area: number;
  /** La figura se completó bajo otras capas. */
  reconstructed: boolean;
  symmetry: SymmetryAxis | null;
  /** Error medio del ajuste en píxeles. */
  fitError: number;
}

export interface VectorizeResult {
  width: number;
  height: number;
  layers: Layer[];
  palette: string[];
  globalAxis: SymmetryAxis | null;
  stats: { regions: number; ms: number; workScale: number };
}

export type ProgressStage =
  | 'Preparando imagen'
  | 'Cuantizando paleta'
  | 'Limpiando regiones'
  | 'Detección por capas'
  | 'Reconstruyendo figuras'
  | 'Listo';

export interface Progress {
  stage: ProgressStage;
  /** Nuevos contornos en coordenadas del original. */
  contours?: string;
  /** 0–1 */
  value: number;
}
