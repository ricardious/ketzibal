import { shapeBounds, type Layer, type Shape, type ShapeKind, type Vec } from '../../engine';
import { shapeArea } from '../../engine/shapes';

export const figureNames = {
  circle: 'Círculo', ellipse: 'Elipse', rect: 'Rectángulo',
  triangle: 'Triángulo', semicircle: 'Semicírculo', line: 'Línea',
};
export type FigureType = keyof typeof figureNames;

export function makeFigure(type: FigureType, center: Vec, width: number, height: number, previous?: Layer): Layer {
  const [cx, cy] = center;
  const rx = Math.max(1, width / 2), ry = Math.max(1, height / 2);
  const color = previous?.fill && previous.fill !== 'none' ? previous.fill : previous?.stroke?.color ?? '#80512E';
  let kind: ShapeKind, shape: Shape;
  switch (type) {
    case 'circle':
      kind = type; shape = { type, cx, cy, r: Math.min(rx, ry) }; break;
    case 'ellipse':
      kind = type; shape = { type, cx, cy, rx, ry, rotation: 0 }; break;
    case 'rect':
      kind = type; shape = { type, cx, cy, w: 2 * rx, h: 2 * ry, rx: 0, rotation: 0 }; break;
    case 'triangle':
      kind = type; shape = { type: 'polygon', points: [[cx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]] }; break;
    case 'semicircle': {
      const r = Math.min(rx, 2 * ry), base = cy + r / 2, k = 0.55228475 * r;
      const left: Vec = [cx - r, base], right: Vec = [cx + r, base];
      kind = 'path'; shape = { type: 'path', loop: { start: left, segs: [
        { c1: [cx - r, base - k], c2: [cx - k, base - r], p: [cx, base - r] },
        { c1: [cx + k, base - r], c2: [cx + r, base - k], p: right },
        { c1: right, c2: left, p: left, line: true },
      ] } }; break;
    }
    case 'line': {
      const start: Vec = [cx - rx, cy], end: Vec = [cx + rx, cy];
      kind = 'stroke'; shape = { type: 'strokes', paths: [{ start, segs: [{ c1: start, c2: end, p: end, line: true }] }] }; break;
    }
  }
  const stroke = previous?.stroke ?? (type === 'line' ? { color, width: Math.max(1, Math.min(rx, ry) / 12) } : null);
  return {
    id: previous?.id ?? crypto.randomUUID(), name: figureNames[type],
    shape, kind, freeform: shape, fill: type === 'line' ? 'none' : color, stroke,
    area: type === 'line' ? 2 * rx * stroke!.width : type === 'semicircle' ? Math.PI * Math.min(rx, 2 * ry) ** 2 / 2 : shapeArea(shape),
    dx: previous?.dx ?? 0, dy: previous?.dy ?? 0, visible: previous?.visible ?? true,
    opacity: previous?.opacity ?? 1, parentId: previous?.parentId ?? null, depth: previous?.depth ?? 0,
    holes: [], symmetry: null, fitError: 0, reconstructed: false,
  };
}

export function replaceFigure(layer: Layer, type: FigureType): Layer {
  const [x0, y0, x1, y1] = shapeBounds(layer.shape);
  const width = x1 - x0, height = y1 - y0;
  // Una línea horizontal o vertical también necesita una segunda dimensión al sustituirla.
  return makeFigure(type, [(x0 + x1) / 2, (y0 + y1) / 2],
    width || height, height || width, layer);
}

export function drawFigure(type: FigureType, from: Vec, to: Vec): Layer {
  const width = Math.abs(to[0] - from[0]), height = Math.abs(to[1] - from[1]);
  const layer = makeFigure(type, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], width, height);
  if (type === 'line') {
    const shape: Shape = { type: 'strokes', paths: [{ start: from, segs: [{ c1: from, c2: to, p: to, line: true }] }] };
    layer.shape = layer.freeform = shape;
    layer.area = Math.hypot(width, height) * layer.stroke!.width;
  }
  return layer;
}
