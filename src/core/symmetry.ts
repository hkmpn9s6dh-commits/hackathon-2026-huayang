import type { RGB } from './image.ts';
import { cropWrap } from './image.ts';

export interface SymmetryResult {
  mirrorX: boolean;
  mirrorY: boolean;
  rot180: boolean;
  rot90: boolean;
  /** 滑移反射：镜像后再平移半个周期 */
  glideX: boolean;
  glideY: boolean;
  /** 工程近似判定的 wallpaper group（p1 / pm / pg / pmm / p2 / p4 …） */
  group: string;
  /** 每项得分 0..1 */
  scores: Record<string, number>;
  /** 单元尺寸 */
  unitW: number;
  unitH: number;
}

const PASS = 0.86;

function diff(a: RGB, b: RGB): number {
  let s = 0;
  const n = a.w * a.h;
  for (let i = 0; i < n; i++) {
    s += Math.abs(a.d[i * 4]! - b.d[i * 4]!);
    s += Math.abs(a.d[i * 4 + 1]! - b.d[i * 4 + 1]!);
    s += Math.abs(a.d[i * 4 + 2]! - b.d[i * 4 + 2]!);
  }
  return s / (n * 3 * 255);
}

/** 允许 ±shift 的平移搜索，消掉「裁剪起点不在对称轴上」的偏差。 */
function bestOf(unit: RGB, maker: (dx: number, dy: number) => RGB | null, shift = 2): number {
  let best = 0;
  for (let dy = -shift; dy <= shift; dy++) {
    for (let dx = -shift; dx <= shift; dx++) {
      const t = maker(dx, dy);
      if (!t) return 0;
      const s = 1 - diff(unit, t);
      if (s > best) best = s;
    }
  }
  return best;
}

function flipH(u: RGB, dx: number, dy: number): RGB {
  const out = new Uint8ClampedArray(u.w * u.h * 4);
  for (let y = 0; y < u.h; y++) {
    for (let x = 0; x < u.w; x++) {
      const sx = ((u.w - 1 - x + dx) % u.w + u.w) % u.w;
      const sy = ((y + dy) % u.h + u.h) % u.h;
      const s = (sy * u.w + sx) * 4;
      const t = (y * u.w + x) * 4;
      out[t] = u.d[s]!;
      out[t + 1] = u.d[s + 1]!;
      out[t + 2] = u.d[s + 2]!;
      out[t + 3] = 255;
    }
  }
  return { w: u.w, h: u.h, d: out };
}

function flipV(u: RGB, dx: number, dy: number): RGB {
  const out = new Uint8ClampedArray(u.w * u.h * 4);
  for (let y = 0; y < u.h; y++) {
    for (let x = 0; x < u.w; x++) {
      const sx = ((x + dx) % u.w + u.w) % u.w;
      const sy = ((u.h - 1 - y + dy) % u.h + u.h) % u.h;
      const s = (sy * u.w + sx) * 4;
      const t = (y * u.w + x) * 4;
      out[t] = u.d[s]!;
      out[t + 1] = u.d[s + 1]!;
      out[t + 2] = u.d[s + 2]!;
      out[t + 3] = 255;
    }
  }
  return { w: u.w, h: u.h, d: out };
}

function rot(u: RGB, quarter: number, dx: number, dy: number): RGB | null {
  // 旋转只在方形单元上有定义；非方形直接返回 null（得分记 0，不能返回自身冒充 1.0）
  if (u.w !== u.h) return null;
  const n = u.w;
  const out = new Uint8ClampedArray(u.d.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sx = x;
      let sy = y;
      for (let k = 0; k < quarter; k++) {
        const nx = n - 1 - sy;
        const ny = sx;
        sx = nx;
        sy = ny;
      }
      sx = ((sx + dx) % n + n) % n;
      sy = ((sy + dy) % n + n) % n;
      const s = (sy * n + sx) * 4;
      const t = (y * n + x) * 4;
      out[t] = u.d[s]!;
      out[t + 1] = u.d[s + 1]!;
      out[t + 2] = u.d[s + 2]!;
      out[t + 3] = 255;
    }
  }
  return { w: n, h: n, d: out };
}

function glide(u: RGB, horizontal: boolean, dx: number, dy: number): RGB {
  const base = horizontal ? flipV(u, 0, 0) : flipH(u, 0, 0);
  const out = new Uint8ClampedArray(u.d.length);
  const shift = horizontal ? Math.round(u.w / 2) : Math.round(u.h / 2);
  for (let y = 0; y < u.h; y++) {
    for (let x = 0; x < u.w; x++) {
      const sx = horizontal ? ((x + shift + dx) % u.w + u.w) % u.w : ((x + dx) % u.w + u.w) % u.w;
      const sy = horizontal ? ((y + dy) % u.h + u.h) % u.h : ((y + shift + dy) % u.h + u.h) % u.h;
      const s = (sy * u.w + sx) * 4;
      const t = (y * u.w + x) * 4;
      out[t] = base.d[s]!;
      out[t + 1] = base.d[s + 1]!;
      out[t + 2] = base.d[s + 2]!;
      out[t + 3] = 255;
    }
  }
  return { w: u.w, h: u.h, d: out };
}

export function detectSymmetry(rgb: RGB, px: number, py: number): SymmetryResult {
  const uw = Math.max(6, Math.round(px));
  const uh = Math.max(6, Math.round(py));
  const unit = cropWrap(rgb, 0, 0, uw, uh);

  const scores: Record<string, number> = {
    mirrorX: bestOf(unit, (dx, dy) => flipH(unit, dx, dy)),
    mirrorY: bestOf(unit, (dx, dy) => flipV(unit, dx, dy)),
    rot180: bestOf(unit, (dx, dy) => rot(unit, 2, dx, dy), 1),
    rot90: bestOf(unit, (dx, dy) => rot(unit, 1, dx, dy), 1),
    glideX: bestOf(unit, (dx, dy) => glide(unit, true, dx, dy)),
    glideY: bestOf(unit, (dx, dy) => glide(unit, false, dx, dy)),
  };

  const mirrorX = scores.mirrorX! >= PASS;
  const mirrorY = scores.mirrorY! >= PASS;
  const rot180 = scores.rot180! >= PASS;
  const rot90 = scores.rot90! >= PASS;
  const glideX = !mirrorX && scores.glideX! >= PASS;
  const glideY = !mirrorY && scores.glideY! >= PASS;

  let group = 'p1';
  if (rot90 && mirrorX) group = 'p4m';
  else if (rot90) group = 'p4';
  else if (mirrorX && mirrorY) group = 'pmm';
  else if (mirrorX || mirrorY) group = 'pm';
  else if (rot180) group = 'p2';
  else if (glideX || glideY) group = 'pg';
  else if (scores.mirrorX! >= 0.74 || scores.mirrorY! >= 0.74) group = 'p1（近对称）';

  return { mirrorX, mirrorY, rot180, rot90, glideX, glideY, group, scores, unitW: uw, unitH: uh };
}
