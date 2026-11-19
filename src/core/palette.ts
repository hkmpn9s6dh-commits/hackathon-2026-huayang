import type { RGB } from './image.ts';

export interface Palette {
  id: string;
  name: string;
  /** 这一套是从哪来的（工业现场的实物） */
  note: string;
  /** [暗, 中, 亮] */
  colors: [string, string, string];
}

/** 六套工业色板：都取自可考的工业现场材料，不编来源。 */
export const PALETTES: Palette[] = [
  { id: 'xiu', name: '锈红', note: '户外钢构的氧化层', colors: ['#4A1F16', '#8C3A2B', '#C8815F'] },
  { id: 'zhu', name: '铸铁灰', note: '机床床身与井盖', colors: ['#2E3134', '#5A5F63', '#A8ACAF'] },
  { id: 'tang', name: '搪瓷蓝', note: '老厂房的搪瓷指示牌', colors: ['#12314D', '#1F4E79', '#7FA6C4'] },
  { id: 'shui', name: '水磨石米', note: '车间地坪的水磨石', colors: ['#6B6257', '#A99C89', '#E2D8C6'] },
  { id: 'jing', name: '警示黄', note: '安全线与行车吊钩', colors: ['#6B4A05', '#C08A12', '#EFCB6A'] },
  { id: 'tong', name: '铜绿', note: '屋架与雨落管的铜锈', colors: ['#22423A', '#4E7C6A', '#9DBFAE'] },
];

function srgbToLin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLin(r);
  const G = srgbToLin(g);
  const B = srgbToLin(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return [linToSrgb(R), linToSrgb(G), linToSrgb(B)];
}

export function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function rgbToHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export interface RecolorResult {
  out: RGB;
  /** 结构保真度：只比 L 通道，1 = 明暗关系完全保留 */
  structure: number;
  colors: string[];
}

/**
 * 换色：把每个像素的明度 L 映射到色板的「暗—中—亮」三档梯度上，
 * a/b 只保留一小部分（15%），所以结构（明暗关系）几乎不变，色相全换。
 */
export function recolor(rgb: RGB, palette: Palette, chromaKeep = 0.15): RecolorResult {
  const stops = palette.colors.map((h) => {
    const [r, g, b] = hexToRgb(h);
    return rgbToLab(r, g, b);
  }) as [number, number, number][];
  const Ls = stops.map((s) => s[0]);
  const Lmin = Math.min(...Ls);
  const Lmax = Math.max(...Ls);

  const n = rgb.w * rgb.h;
  const out = new Uint8ClampedArray(rgb.d.length);
  let lerr = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb.d[i * 4]!;
    const g = rgb.d[i * 4 + 1]!;
    const b = rgb.d[i * 4 + 2]!;
    const [L, a, bb] = rgbToLab(r, g, b);
    // 源图 L 归一 → 目标梯度位置
    const t = Math.max(0, Math.min(1, (L - 12) / 78));
    // 三点梯度插值
    const pos = t * (stops.length - 1);
    const i0 = Math.min(stops.length - 1, Math.floor(pos));
    const i1 = Math.min(stops.length - 1, i0 + 1);
    const f = pos - i0;
    const tL = stops[i0]![0] + (stops[i1]![0] - stops[i0]![0]) * f;
    const ta = stops[i0]![1] + (stops[i1]![1] - stops[i0]![1]) * f;
    const tb = stops[i0]![2] + (stops[i1]![2] - stops[i0]![2]) * f;
    // 明度以原图为主（82%），只让色板拉 18%，否则结构会被色板的明度范围压平
    const blendedL = Math.max(0, Math.min(100, L * 0.82 + Math.max(Lmin, Math.min(Lmax, tL)) * 0.18));
    const [nr, ng, nb] = labToRgb(
      blendedL,
      // 色相由色板主导（85%），源图的色偏只做微调（15%）：
      // 否则灰色构件换「搪瓷蓝」只会淡到看不出来，等于没换。
      ta * (1 - chromaKeep) + a * chromaKeep,
      tb * (1 - chromaKeep) + bb * chromaKeep,
    );
    out[i * 4] = nr;
    out[i * 4 + 1] = ng;
    out[i * 4 + 2] = nb;
    out[i * 4 + 3] = 255;
    const nL = rgbToLab(nr, ng, nb)[0];
    lerr += Math.abs(nL - L);
  }

  return {
    out: { w: rgb.w, h: rgb.h, d: out },
    structure: Math.max(0, 1 - lerr / n / 100),
    colors: palette.colors,
  };
}
