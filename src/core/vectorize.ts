import type { RGB } from './image.ts';

export interface VectorResult {
  svg: string;
  colors: string[];
  paths: number;
  width: number;
  height: number;
  /** 量化后的色块图（用于并排对比） */
  quantized: RGB;
}

type P3 = [number, number, number];

function dist2(a: P3, b: P3): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** k-means（k 很小，直接暴力迭代；初始化用「最远点」而不是随机，保证可复现） */
function kmeans(pixels: P3[], k: number, iters = 12): { centers: P3[]; assign: Uint8Array } {
  const centers: P3[] = [];
  // 第一颗种子：最暗的像素（纹样的骨架通常是暗色）
  let seedIdx = 0;
  let minL = Infinity;
  for (let i = 0; i < pixels.length; i++) {
    const l = pixels[i]![0] * 0.299 + pixels[i]![1] * 0.587 + pixels[i]![2] * 0.114;
    if (l < minL) {
      minL = l;
      seedIdx = i;
    }
  }
  centers.push([...pixels[seedIdx]!] as P3);
  while (centers.length < k) {
    let far = 0;
    let farD = -1;
    for (let i = 0; i < pixels.length; i++) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist2(pixels[i]!, c));
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    centers.push([...pixels[far]!] as P3);
  }

  const assign = new Uint8Array(pixels.length);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(pixels[i]!, centers[c]!);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums: P3[] = centers.map(() => [0, 0, 0]);
    const counts = new Array(centers.length).fill(0);
    for (let i = 0; i < pixels.length; i++) {
      const a = assign[i]!;
      const s = sums[a]!;
      s[0] += pixels[i]![0];
      s[1] += pixels[i]![1];
      s[2] += pixels[i]![2];
      counts[a]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c]) {
        centers[c] = [sums[c]![0] / counts[c], sums[c]![1] / counts[c], sums[c]![2] / counts[c]];
      }
    }
    if (!moved) break;
  }
  return { centers, assign };
}

function hex(c: P3): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** 像素边界的轮廓追踪：每个前景像素贡献 4 条有向边，再串成闭合环。 */
function traceLoops(mask: Uint8Array, w: number, h: number): Array<Array<[number, number]>> {
  const key = (x: number, y: number) => `${x},${y}`;
  const out = new Map<string, Array<[number, number]>>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const arr = out.get(k);
    if (arr) arr.push([bx, by]);
    else out.set(k, [[bx, by]]);
  };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== 1) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const loops: Array<Array<[number, number]>> = [];
  const used = new Set<string>();
  for (const [startKey, arr] of out) {
    for (let ai = 0; ai < arr.length; ai++) {
      const edgeKey = `${startKey}>${ai}`;
      if (used.has(edgeKey)) continue;
      const loop: Array<[number, number]> = [];
      let curKey = startKey;
      let curIdx = ai;
      let guard = 0;
      while (guard++ < w * h * 4 + 16) {
        const k2 = `${curKey}>${curIdx}`;
        if (used.has(k2)) break;
        used.add(k2);
        const [sx, sy] = curKey.split(',').map(Number) as [number, number];
        loop.push([sx, sy]);
        const next = out.get(curKey)?.[curIdx];
        if (!next) break;
        const nk = key(next[0], next[1]);
        if (nk === startKey) break;
        const cands = out.get(nk);
        if (!cands) break;
        let found = -1;
        for (let j = 0; j < cands.length; j++) {
          if (!used.has(`${nk}>${j}`)) {
            found = j;
            break;
          }
        }
        if (found < 0) break;
        curKey = nk;
        curIdx = found;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Douglas–Peucker */
function rdp(pts: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let idx = -1;
  let maxD = -1;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const d = Math.abs(dy * (p[0] - first[0]) - dx * (p[1] - first[1])) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps || idx < 0) return [first, last];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

export function vectorize(rgb: RGB, k = 5, eps = 0.7): VectorResult {
  const { w, h, d } = rgb;
  const n = w * h;
  const px: P3[] = new Array(n);
  for (let i = 0; i < n; i++) px[i] = [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!];
  const { centers, assign } = kmeans(px, Math.min(k, Math.max(2, n)));

  // 按暗到亮排序，读起来更像版画的分色
  const order = centers.map((c, i) => ({ c, i })).sort((a, b) => {
    const la = a.c[0] * 0.299 + a.c[1] * 0.587 + a.c[2] * 0.114;
    const lb = b.c[0] * 0.299 + b.c[1] * 0.587 + b.c[2] * 0.114;
    return la - lb;
  });

  const q = new Uint8ClampedArray(d.length);
  for (let i = 0; i < n; i++) {
    const c = centers[assign[i]!]!;
    q[i * 4] = c[0];
    q[i * 4 + 1] = c[1];
    q[i * 4 + 2] = c[2];
    q[i * 4 + 3] = 255;
  }

  const parts: string[] = [];
  let pathCount = 0;
  const usedColors: string[] = [];
  for (const { c, i } of order) {
    const mask = new Uint8Array(n);
    let any = false;
    for (let p = 0; p < n; p++) {
      if (assign[p] === i) {
        mask[p] = 1;
        any = true;
      }
    }
    if (!any) continue;
    const loops = traceLoops(mask, w, h);
    if (!loops.length) continue;
    const sub: string[] = [];
    for (const loop of loops) {
      // 不能先把首点补到末尾再简化：首尾重合时 RDP 的基线退化，整圈会被压成 2 个点。
      const simp = rdp(loop, eps);
      if (simp.length < 3) continue;
      const seg =
        simp.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ') + ' Z';
      sub.push(seg);
      pathCount++;
    }
    if (!sub.length) continue;
    usedColors.push(hex(c));
    parts.push(`<path d="${sub.join(' ')} Z" fill="${hex(c)}" fill-rule="evenodd"/>`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `shape-rendering="geometricPrecision">` +
    `<title>花样 · 单元分色</title>` +
    parts.join('') +
    `</svg>`;

  return { svg, colors: usedColors, paths: pathCount, width: w, height: h, quantized: { w, h, d: q } };
}
