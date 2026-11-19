import type { Gray, RGB } from './image.ts';
import { grayOf } from './image.ts';

export interface PeriodResult {
  /** 水平周期（像素，可含小数） */
  px: number;
  py: number;
  /** 置信度 0..1：该位移处的归一化相关系数 */
  scoreX: number;
  scoreY: number;
  /** 位移 → 相关系数，用于画曲线（UI 上那条「检验灯」扫描线） */
  curveX: number[];
  curveY: number[];
  fromX: number;
  fromY: number;
}

interface AxisResult {
  period: number;
  score: number;
  curve: number[];
  from: number;
}

/**
 * 沿一个方向找基周期。
 *
 * 用归一化互相关（Pearson）而不是绝对差：绝对差在小位移时天然偏小，
 * 会把「相邻像素本来就相似」误判成周期。相关函数则在真正的周期处才接近 1。
 *
 * 选峰两步：
 *   ① 取全局最强的峰（最可靠的重复）
 *   ② 回到 1/1.5 倍以内，找第一个「接近最强峰（≥0.9×）」的峰 —— 那才是基周期，
 *      全局最强峰常落在周期的整数倍上。
 */
function scanAxis(g: Gray, horizontal: boolean, minP: number, maxP: number): AxisResult {
  const n = horizontal ? g.w : g.h;
  const span = horizontal ? g.h : g.w;
  const from = Math.max(4, Math.round(minP));
  const to = Math.min(Math.floor(n * 0.55), Math.round(maxP));
  const curve: number[] = [];
  const stride = span > 200 ? 2 : 1;

  for (let d = from; d <= to; d++) {
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    let cnt = 0;
    const overlap = n - d;
    for (let t = 0; t < overlap; t++) {
      for (let s = 0; s < span; s += stride) {
        const a = horizontal ? g.d[s * g.w + t]! : g.d[t * g.w + s]!;
        const b = horizontal ? g.d[s * g.w + t + d]! : g.d[(t + d) * g.w + s]!;
        sa += a;
        sb += b;
        saa += a * a;
        sbb += b * b;
        sab += a * b;
        cnt++;
      }
    }
    const ma = sa / cnt;
    const mb = sb / cnt;
    const va = saa / cnt - ma * ma;
    const vb = sbb / cnt - mb * mb;
    const cov = sab / cnt - ma * mb;
    const den = Math.sqrt(Math.max(va, 1e-9) * Math.max(vb, 1e-9));
    curve.push(Math.max(-1, Math.min(1, cov / den)));
  }

  // 局部极大
  const peaks: number[] = [];
  for (let i = 1; i < curve.length - 1; i++) {
    const v = curve[i]!;
    if (v >= curve[i - 1]! && v >= curve[i + 1]! && v > 0.25) peaks.push(i);
  }
  if (!peaks.length) {
    let gi = 0;
    for (let i = 0; i < curve.length; i++) if (curve[i]! > curve[gi]!) gi = i;
    peaks.push(gi);
  }

  let bestPeak = peaks[0]!;
  for (const p of peaks) if (curve[p]! > curve[bestPeak]!) bestPeak = p;
  const maxVal = curve[bestPeak]!;

  // 回到 1/1.5 倍以内找基周期
  let basePeak = bestPeak;
  const limit = Math.floor(bestPeak / 1.5);
  for (const p of peaks) {
    if (p >= from - from && p <= limit && curve[p]! >= maxVal * 0.9) {
      basePeak = p;
      break;
    }
  }

  // 抛物线插值
  let period = from + basePeak;
  if (basePeak > 0 && basePeak < curve.length - 1) {
    const y0 = curve[basePeak - 1]!;
    const y1 = curve[basePeak]!;
    const y2 = curve[basePeak + 1]!;
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) {
      const delta = (0.5 * (y0 - y2)) / denom;
      if (Math.abs(delta) <= 1) period = from + basePeak + delta;
    }
  }

  return { period, score: Math.max(0, Math.min(1, curve[basePeak]!)), curve, from };
}

export function detectPeriod(input: RGB | Gray, minP = 12, maxP = 260): PeriodResult {
  // 传进来的可能是 RGBA；先降到单通道，否则会拿 R 通道去和 G 通道比。
  const g: Gray = 'w' in input && input.d.length === input.w * input.h ? (input as Gray) : grayOf(input as RGB);
  const ax = scanAxis(g, true, minP, maxP);
  const ay = scanAxis(g, false, minP, maxP);
  return {
    px: ax.period,
    py: ay.period,
    scoreX: ax.score,
    scoreY: ay.score,
    curveX: ax.curve,
    curveY: ay.curve,
    fromX: ax.from,
    fromY: ay.from,
  };
}
