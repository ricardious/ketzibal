import { DEFAULT_PARAMS, type Layer, type Shape, type SymmetryAxis, type VectorizeParams } from '../../engine';
import { ACCEPTED, loadImageFile, type SourceImage } from './image';

interface DocumentData {
  layers: Layer[];
  params: VectorizeParams;
  palette: string[];
  globalAxis: SymmetryAxis | null;
}

export const projectExtension = '.ketzibal';
export const fileFilter = [...ACCEPTED, projectExtension].join(',');
export const isProject = (file: File) => file.name.toLowerCase().endsWith(projectExtension);

export async function serializeProject(source: SourceImage, doc: DocumentData) {
  const image = await (await fetch(source.url)).blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(image);
  });
  return JSON.stringify({ format: 'ketzibal', version: 1, name: source.name, image: data, ...doc });
}

const vec = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
function validLoop(p: Extract<Shape, { type: 'path' }>['loop']) {
  return p && vec(p.start) && Array.isArray(p.segs) && p.segs.every(s => s && vec(s.p) && vec(s.c1) && vec(s.c2));
}
function validShape(s: Shape) {
  if (!s) return false;
  switch (s.type) {
    case 'circle': return [s.cx, s.cy, s.r].every(Number.isFinite);
    case 'ellipse': return [s.cx, s.cy, s.rx, s.ry, s.rotation].every(Number.isFinite);
    case 'rect': return [s.cx, s.cy, s.w, s.h, s.rx, s.rotation].every(Number.isFinite);
    case 'polygon': return Array.isArray(s.points) && s.points.length >= 3 && s.points.every(vec);
    case 'path': return validLoop(s.loop);
    case 'strokes': return Array.isArray(s.paths) && s.paths.every(validLoop);
    default: return false;
  }
}

export async function readProject(file: File) {
  const d = JSON.parse(await file.text());
  if (d?.format !== 'ketzibal' || d.version !== 1 || typeof d.name !== 'string' ||
    typeof d.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(d.image) ||
    !Array.isArray(d.layers) || !d.layers.every((l: Layer) => l && typeof l.id === 'string' &&
      typeof l.name === 'string' && typeof l.fill === 'string' && validShape(l.shape) && validShape(l.freeform) &&
      (!l.recognized || validShape(l.recognized)) && Array.isArray(l.holes) && l.holes.every(validShape) &&
      [l.dx, l.dy, l.opacity, l.area, l.fitError].every(Number.isFinite) && (!l.symmetry || vec(l.symmetry.p))) ||
    !Array.isArray(d.palette) || !d.palette.every((c: unknown) => typeof c === 'string') ||
    !Object.entries(DEFAULT_PARAMS).every(([k, v]) => typeof d.params?.[k] === typeof v) ||
    (d.globalAxis && !vec(d.globalAxis.p))) throw new Error('Archivo de proyecto no válido.');
  const image = await (await fetch(d.image)).blob();
  const source = await loadImageFile(new File([image], d.name, { type: image.type }));
  const { layers, params, palette, globalAxis }: DocumentData = d;
  return { source, layers, params, palette, globalAxis };
}
