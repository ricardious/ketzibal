import type { BezierLoop, Layer, Shape, Vec } from './types';

const DEG = Math.PI / 180;

/** Formatea un número con la precisión indicada, sin ceros sobrantes. */
export function num(v: number, decimals = 2): string {
  const f = 10 ** decimals;
  let s = (Math.round(v * f) / f).toString();
  if (s === '-0') s = '0';
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

function pt(p: Vec, d: number) { return `${num(p[0], d)} ${num(p[1], d)}`; }

export function loopToD(loop: BezierLoop, d = 2): string {
  let s = `M${pt(loop.start, d)}`;
  let prev = loop.start;
  for (const g of loop.segs) {
    if (g.line) s += `L${pt(g.p, d)}`;
    else s += `C${pt(g.c1, d)} ${pt(g.c2, d)} ${pt(g.p, d)}`;
    prev = g.p;
  }
  void prev;
  return s + 'Z';
}

/** Trazado `d` equivalente a cualquier forma (para combinarla con huecos). */
export function shapeToD(s: Shape, d = 2): string {
  switch (s.type) {
    case 'circle':
      return `M${num(s.cx - s.r, d)} ${num(s.cy, d)}a${num(s.r, d)} ${num(s.r, d)} 0 1 0 ${num(2 * s.r, d)} 0a${num(s.r, d)} ${num(s.r, d)} 0 1 0 ${num(-2 * s.r, d)} 0Z`;
    case 'ellipse': {
      const a = s.rotation * DEG, ux = Math.cos(a) * s.rx, uy = Math.sin(a) * s.rx;
      return `M${num(s.cx - ux, d)} ${num(s.cy - uy, d)}a${num(s.rx, d)} ${num(s.ry, d)} ${num(s.rotation, d)} 1 0 ${num(2 * ux, d)} ${num(2 * uy, d)}a${num(s.rx, d)} ${num(s.ry, d)} ${num(s.rotation, d)} 1 0 ${num(-2 * ux, d)} ${num(-2 * uy, d)}Z`;
    }
    case 'rect': {
      const r = Math.min(s.rx, s.w / 2, s.h / 2);
      const hw = s.w / 2, hh = s.h / 2;
      const a = s.rotation * DEG, c = Math.cos(a), sn = Math.sin(a);
      const T = (x: number, y: number): Vec => [s.cx + x * c - y * sn, s.cy + x * sn + y * c];
      if (r <= 0) return 'M' + [T(-hw, -hh), T(hw, -hh), T(hw, hh), T(-hw, hh)].map((p) => pt(p, d)).join('L') + 'Z';
      const arc = (p: Vec) => `A${num(r, d)} ${num(r, d)} 0 0 1 ${pt(p, d)}`;
      return `M${pt(T(-hw + r, -hh), d)}L${pt(T(hw - r, -hh), d)}${arc(T(hw, -hh + r))}L${pt(T(hw, hh - r), d)}${arc(T(hw - r, hh))}L${pt(T(-hw + r, hh), d)}${arc(T(-hw, hh - r))}L${pt(T(-hw, -hh + r), d)}${arc(T(-hw + r, -hh))}Z`;
    }
    case 'polygon':
      return 'M' + s.points.map((p) => pt(p, d)).join('L') + 'Z';
    case 'path':
      return loopToD(s.loop, d);
  }
}

/** Elemento SVG mínimo para una forma sin huecos. */
export function shapeElement(s: Shape, attrs: string, d = 2): string {
  switch (s.type) {
    case 'circle':
      return `<circle cx="${num(s.cx, d)}" cy="${num(s.cy, d)}" r="${num(s.r, d)}"${attrs}/>`;
    case 'ellipse': {
      const tf = s.rotation ? ` transform="rotate(${num(s.rotation, d)} ${num(s.cx, d)} ${num(s.cy, d)})"` : '';
      return `<ellipse cx="${num(s.cx, d)}" cy="${num(s.cy, d)}" rx="${num(s.rx, d)}" ry="${num(s.ry, d)}"${tf}${attrs}/>`;
    }
    case 'rect': {
      const tf = s.rotation ? ` transform="rotate(${num(s.rotation, d)} ${num(s.cx, d)} ${num(s.cy, d)})"` : '';
      const r = Math.min(s.rx, s.w / 2, s.h / 2);
      const rx = r > 0.05 ? ` rx="${num(r, d)}"` : '';
      return `<rect x="${num(s.cx - s.w / 2, d)}" y="${num(s.cy - s.h / 2, d)}" width="${num(s.w, d)}" height="${num(s.h, d)}"${rx}${tf}${attrs}/>`;
    }
    case 'polygon':
      return `<polygon points="${s.points.map((p) => `${num(p[0], d)},${num(p[1], d)}`).join(' ')}"${attrs}/>`;
    case 'path':
      return `<path d="${loopToD(s.loop, d)}"${attrs}/>`;
  }
}

export function layerElement(l: Layer, d = 2, withId = true): string {
  const id = withId ? ` id="${l.id}"` : '';
  const op = l.opacity < 1 ? ` opacity="${num(l.opacity, 2)}"` : '';
  const tf = l.dx || l.dy ? ` transform="translate(${num(l.dx, d)} ${num(l.dy, d)})"` : '';
  const attrs = `${id} fill="${shortHex(l.fill)}"${op}${tf}`;
  if (l.holes.length === 0) return shapeElement(l.shape, attrs, d);
  const dd = [l.shape, ...l.holes].map((s) => shapeToD(s, d)).join('');
  return `<path d="${dd}" fill-rule="evenodd"${attrs}/>`;
}

function shortHex(h: string) {
  const s = h.toLowerCase();
  return /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/.test(s) ? `#${s[1]}${s[3]}${s[5]}` : s;
}

export interface SvgOptions {
  decimals?: number;
  /** Incluir capas ocultas (con display="none"). */
  includeHidden?: boolean;
  /** Atributos id legibles por capa. */
  ids?: boolean;
}

/** SVG limpio y editable: una capa por elemento, en orden de pintado (de afuera hacia adentro). */
export function toSvg(width: number, height: number, layers: Layer[], opt: SvgOptions = {}): string {
  const d = opt.decimals ?? 2;
  const body = layers
    .filter((l) => l.visible || opt.includeHidden)
    .map((l) => {
      const el = layerElement(l, d, opt.ids ?? true);
      return l.visible ? el : el.replace('/>', ' display="none"/>');
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width, 0)} ${num(height, 0)}" width="${num(width, 0)}" height="${num(height, 0)}">\n${body.map((b) => '  ' + b).join('\n')}\n</svg>\n`;
}

/** Número de nodos de una forma (para el inspector). */
export function nodeCount(s: Shape): number {
  switch (s.type) {
    case 'circle': case 'ellipse': return 4;
    case 'rect': return s.rx > 0.05 ? 8 : 4;
    case 'polygon': return s.points.length;
    case 'path': return s.loop.segs.length;
  }
}
