// 合成「已知周期」的工业构件图，作为 verify 的真值来源。
// 真值是这里写死的数字，算法只准测出它，不准反过来定义它。
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './png.mjs';

const OUT = path.resolve('assets/synth');
fs.mkdirSync(OUT, { recursive: true });

const W = 480;
const H = 360;

function canvas(bg) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}

function px(d, x, y, c, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  d[i] = d[i] * (1 - a) + c[0] * a;
  d[i + 1] = d[i + 1] * (1 - a) + c[1] * a;
  d[i + 2] = d[i + 2] * (1 - a) + c[2] * a;
  d[i + 3] = 255;
}

function rect(d, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(d, x, y, c);
}

function circle(d, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) px(d, x, y, c);
    }
}

// 一点颗粒，让图不像纯矢量
function grain(d, amt = 6) {
  let s = 12345;
  for (let i = 0; i < W * H; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) % (amt * 2)) - amt;
    d[i * 4] = Math.max(0, Math.min(255, d[i * 4] + n));
    d[i * 4 + 1] = Math.max(0, Math.min(255, d[i * 4 + 1] + n));
    d[i * 4 + 2] = Math.max(0, Math.min(255, d[i * 4 + 2] + n));
  }
}

const cases = [];

// ① 混凝土花格窗：48×48 回字纹（pmm：双向镜像）
{
  const P = 48;
  const d = canvas([176, 172, 163]);
  for (let y = 0; y < H; y += P) {
    for (let x = 0; x < W; x += P) {
      const m = 9;
      rect(d, x + m, y + m, P - 2 * m, P - 2 * m, [70, 66, 60]);
      rect(d, x + 2 * m, y + 2 * m, P - 4 * m, P - 4 * m, [176, 172, 163]);
      rect(d, x + 3 * m, y + 3 * m, P - 6 * m, P - 6 * m, [104, 99, 91]);
    }
  }
  grain(d, 5);
  cases.push({ id: 'lattice-48', file: 'lattice-48.png', data: d, truth: { px: P, py: P, group: 'p4m' }, note: '混凝土花格窗，回字纹' });
}

// ② 错缝砖墙：64×32（pg：镜像 + 半砖平移）
{
  const PX = 64;
  const PY = 32;
  const d = canvas([150, 140, 130]);
  for (let row = 0; row * PY < H; row++) {
    const off = row % 2 ? PX / 2 : 0;
    for (let x = -PX; x < W + PX; x += PX) {
      rect(d, x + off + 2, row * PY + 2, PX - 4, PY - 4, [122, 96, 82]);
      rect(d, x + off + 4, row * PY + 4, PX - 8, 3, [146, 118, 100]);
    }
  }
  grain(d, 7);
  cases.push({ id: 'brick-64x32', file: 'brick-64x32.png', data: d, truth: { px: PX, py: PY * 2, group: 'pg' }, note: '错缝砖墙（垂直要两行才重复）' });
}

// ③ 铸铁栏杆：24 宽 × 60 高（pm：垂直镜像不成立，水平成立）
{
  const PX = 24;
  const PY = 60;
  const d = canvas([210, 208, 202]);
  for (let x = 0; x < W; x += PX) rect(d, x + 9, 0, 6, H, [48, 46, 44]);
  for (let y = 0; y < H; y += PY) {
    rect(d, 0, y + 4, W, 4, [58, 56, 52]);
    for (let x = 0; x < W; x += PX) circle(d, x + PX / 2, y + PY / 2, 7, [70, 68, 64]);
  }
  grain(d, 5);
  cases.push({ id: 'railing-24x60', file: 'railing-24x60.png', data: d, truth: { px: PX, py: PY, group: 'pm' }, note: '铸铁栏杆' });
}

// ④ 通风百叶：40×20，单向强周期，无镜像
{
  const PX = 40;
  const PY = 20;
  const d = canvas([96, 98, 100]);
  for (let y = 0; y < H; y += PY) {
    for (let x = 0; x < W; x += PX) {
      rect(d, x + 2, y + 5, PX - 4, 8, [150, 152, 154]);
      rect(d, x + 2, y + 13, PX - 4, 2, [52, 54, 56]);
    }
  }
  grain(d, 6);
  cases.push({ id: 'louver-40x20', file: 'louver-40x20.png', data: d, truth: { px: PX, py: PY, group: 'pm' }, note: '通风百叶' });
}

// ⑤ 纯噪声：测不出周期（降级路径）
{
  const d = canvas([128, 128, 128]);
  let s = 99;
  for (let i = 0; i < W * H; i++) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const v = 60 + ((s >> 7) % 140);
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
  }
  cases.push({ id: 'noise', file: 'noise.png', data: d, truth: { px: null, py: null, group: 'p1' }, note: '无周期（对照）' });
}

// ⑥ 搪瓷招牌：字号固定但无重复
{
  const d = canvas([31, 78, 121]);
  rect(d, 8, 8, W - 16, H - 16, [244, 241, 232]);
  rect(d, 16, 16, W - 32, H - 32, [31, 78, 121]);
  rect(d, 60, 150, W - 120, 26, [244, 241, 232]);
  rect(d, 100, 200, W - 200, 14, [244, 241, 232]);
  grain(d, 8);
  cases.push({ id: 'enamel-sign', file: 'enamel-sign.png', data: d, truth: { px: null, py: null, group: 'p1' }, note: '搪瓷招牌（无重复）' });
}

for (const c of cases) {
  fs.writeFileSync(path.join(OUT, c.file), encodePNG(W, H, c.data));
}
fs.writeFileSync(
  path.join(OUT, 'truth.json'),
  JSON.stringify(
    cases.map((c) => ({ id: c.id, file: c.file, note: c.note, w: W, h: H, truth: c.truth })),
    null,
    2,
  ),
);
console.log(`synth: ${cases.length} 张 → ${OUT}`);
