/** Conversión sRGB ↔ OKLab y utilidades de color. */

const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklab(r: number, g: number, b: number, out: Float32Array | number[], o = 0) {
  const lr = lin[r], lg = lin[g], lb = lin[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function toSrgb(x: number) {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function labDist(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) {
  const d0 = a[ai] - b[bi], d1 = a[ai + 1] - b[bi + 1], d2 = a[ai + 2] - b[bi + 2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}
