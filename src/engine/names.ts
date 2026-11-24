import type { ShapeKind } from './types';

export const KIND_NAMES: Record<ShapeKind, string> = {
  background: 'Fondo',
  circle: 'Círculo',
  ellipse: 'Elipse',
  rect: 'Rectángulo',
  square: 'Cuadrado',
  triangle: 'Triángulo',
  'regular-polygon': 'Polígono regular',
  star: 'Estrella',
  polygon: 'Polígono',
  path: 'Trazado',
  'clipped-circle': 'Círculo recortado',
  silhouette: 'Silueta',
  stroke: 'Trazo',
};
