import type { RGB } from './image.ts';
import { cropWrap } from './image.ts';

/**
 * 无缝化：先把周期取整，再在左右/上下边界各做一条羽化带，
 * 让 x=0 与 x=W-1 的值互相靠拢。羽化带宽默认 6%，
 * 视觉上几乎不动图案，但接缝的像素跳变会被压到内部噪声的量级。
 */
export function makeSeamless(
  rgb: RGB,
  px: number,
  py: number,
  feather = 0.06,
  ox = 0,
  oy = 0,
): { out: RGB; removed: number; seamRatio: number } {
  const w = Math.max(6, Math.round(px));
  const h = Math.max(6, Math.round(py));
  // 从纹样区取单元：真实照片的左上角常是天空或墙边，不从这里裁就会拿到一片白。
  const unit = cropWrap(rgb, ox, oy, w, h);
  const out = new Uint8ClampedArray(unit.d);
  const bx = Math.max(1, Math.round(w * feather));
  const by = Math.max(1, Math.round(h * feather));

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // 左右
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < bx; i++) {
      const t = 1 - i / bx; // 边界处 1，向内 0
      const li = (y * w + i) * 4;
      const ri = (y * w + (w - 1 - i)) * 4;
      for (let c = 0; c < 3; c++) {
        const a = unit.d[li + c]!;
        const b = unit.d[ri + c]!;
        const m = (a + b) / 2;
        out[li + c] = lerp(a, m, t);
        out[ri + c] = lerp(b, m, t);
      }
    }
  }
  // 上下（基于已处理左右的副本，避免两次修改互相吃掉）
  const mid = new Uint8ClampedArray(out);
  for (let x = 0; x < w; x++) {
    for (let i = 0; i < by; i++) {
      const t = 1 - i / by;
      const ti = (i * w + x) * 4;
      const bi = ((h - 1 - i) * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = mid[ti + c]!;
        const b = mid[bi + c]!;
        const m = (a + b) / 2;
        out[ti + c] = lerp(a, m, t);
        out[bi + c] = lerp(b, m, t);
      }
    }
  }

  // 量一下接缝还剩多少：接缝处的差 vs 内部相邻列差的中位数
  const seamDiff = colDiff(out, w, h, 0, w - 1);
  const inner: number[] = [];
  for (let i = Math.floor(w * 0.25); i < Math.floor(w * 0.75); i++) {
    inner.push(colDiff(out, w, h, i, i + 1));
  }
  inner.sort((a, b) => a - b);
  const med = inner[inner.length >> 1] ?? 0;
  const seamRatio = med > 0 ? seamDiff / med : 0;
  const removed = med > 0 ? Math.max(0, 1 - seamRatio) : 1;

  return { out: { w, h, d: out }, removed: Math.min(1, removed), seamRatio };
}

function colDiff(d: Uint8ClampedArray, w: number, h: number, x1: number, x2: number): number {
  let s = 0;
  for (let y = 0; y < h; y++) {
    const a = (y * w + x1) * 4;
    const b = (y * w + x2) * 4;
    s += Math.abs(d[a]! - d[b]!) + Math.abs(d[a + 1]! - d[b + 1]!) + Math.abs(d[a + 2]! - d[b + 2]!);
  }
  return s / (h * 3);
}

export function rowDiff(d: Uint8ClampedArray, w: number, y1: number, y2: number): number {
  let s = 0;
  for (let x = 0; x < w; x++) {
    const a = (y1 * w + x) * 4;
    const b = (y2 * w + x) * 4;
    s += Math.abs(d[a]! - d[b]!) + Math.abs(d[a + 1]! - d[b + 1]!) + Math.abs(d[a + 2]! - d[b + 2]!);
  }
  return s / (w * 3);
}
