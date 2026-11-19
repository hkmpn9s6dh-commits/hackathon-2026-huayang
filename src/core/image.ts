/** 图像基元：全部用无 DOM 依赖的纯数据，Node 与浏览器共用。 */

export interface Gray {
  w: number;
  h: number;
  /** 0..1，长度 w*h */
  d: Float32Array;
}

export interface RGB {
  w: number;
  h: number;
  /** RGBA，长度 w*h*4 */
  d: Uint8ClampedArray;
}

export function grayOf(rgb: RGB): Gray {
  const { w, h, d } = rgb;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4]! / 255;
    const gg = d[i * 4 + 1]! / 255;
    const b = d[i * 4 + 2]! / 255;
    g[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  return { w, h, d: g };
}

export function at(g: Gray, x: number, y: number): number {
  const xx = ((x % g.w) + g.w) % g.w;
  const yy = ((y % g.h) + g.h) % g.h;
  return g.d[yy * g.w + xx]!;
}

export function rgbAt(c: RGB, x: number, y: number): [number, number, number] {
  const xx = ((x % c.w) + c.w) % c.w;
  const yy = ((y % c.h) + c.h) % c.h;
  const i = (yy * c.w + xx) * 4;
  return [c.d[i]!, c.d[i + 1]!, c.d[i + 2]!];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 裁出一个矩形区域（越界则环绕取样）。 */
export function cropWrap(c: RGB, x0: number, y0: number, w: number, h: number): RGB {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(c, x0 + x, y0 + y);
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return { w, h, d: out };
}

/** 水平平铺 n 次 */
export function tileH(c: RGB, n: number): RGB {
  const out = new Uint8ClampedArray(c.w * n * c.h * 4);
  for (let y = 0; y < c.h; y++) {
    for (let k = 0; k < n; k++) {
      for (let x = 0; x < c.w; x++) {
        const s = (y * c.w + x) * 4;
        const t = (y * (c.w * n) + k * c.w + x) * 4;
        out[t] = c.d[s]!;
        out[t + 1] = c.d[s + 1]!;
        out[t + 2] = c.d[s + 2]!;
        out[t + 3] = 255;
      }
    }
  }
  return { w: c.w * n, h: c.h, d: out };
}

/** 垂直平铺 n 次 */
export function tileV(c: RGB, n: number): RGB {
  const out = new Uint8ClampedArray(c.w * c.h * n * 4);
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const s = ((y * c.w + x) * 4) | 0;
        const t = (((k * c.h + y) * c.w + x) * 4) | 0;
        out[t] = c.d[s]!;
        out[t + 1] = c.d[s + 1]!;
        out[t + 2] = c.d[s + 2]!;
        out[t + 3] = 255;
      }
    }
  }
  return { w: c.w, h: c.h * n, d: out };
}
