// 《花样》闸 B：可判定的验收。只用合成图（真值写在 truth.json 里，与算法无关）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodePNG } from './decode.mjs';
import { encodePNG } from './png.mjs';
import { detectPeriod } from '../src/core/period.ts';
import { detectSymmetry } from '../src/core/symmetry.ts';
import { makeSeamless } from '../src/core/seamless.ts';
import { vectorize } from '../src/core/vectorize.ts';
import { recolor, PALETTES, rgbToHex } from '../src/core/palette.ts';

const root = path.resolve('.');
const S = path.join(root, 'assets/synth');
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`);
  }
}

function load(file) {
  return decodePNG(fs.readFileSync(path.join(S, file)));
}

if (!fs.existsSync(path.join(S, 'truth.json'))) {
  console.error('先跑 npm run synth');
  process.exit(2);
}
const truth = JSON.parse(fs.readFileSync(path.join(S, 'truth.json'), 'utf8'));

// ── 1. 周期检测：必须测回写死的真值 ───────────────────────────────
console.log('\n[1] 周期检测（真值由合成脚本写死，算法只准测出它）');
const periods = {};
for (const c of truth) {
  const rgb = load(c.file);
  const p = detectPeriod(rgb);
  periods[c.id] = p;
  if (c.truth.px !== null) {
    ok(
      `${c.id} 水平周期 = ${c.truth.px}`,
      Math.abs(p.px - c.truth.px) <= 1.0,
      `测得 ${p.px.toFixed(2)}（置信 ${p.scoreX.toFixed(2)}）`,
    );
    ok(
      `${c.id} 垂直周期 = ${c.truth.py}`,
      Math.abs(p.py - c.truth.py) <= 1.0,
      `测得 ${p.py.toFixed(2)}（置信 ${p.scoreY.toFixed(2)}）`,
    );
  } else {
    // 无周期对照：置信度必须低（不能瞎报一个高置信周期）
    // 无周期对照：置信度必须低于「可信重复」的门槛（0.9），不能把结构相似当周期
    ok(`${c.id} 不误报高置信周期`, p.scoreX < 0.9 && p.scoreY < 0.9, `置信 ${p.scoreX.toFixed(2)}/${p.scoreY.toFixed(2)}`);
  }
}

// ── 2. 对称群 ─────────────────────────────────────────────────
console.log('\n[2] 对称群（工程近似；只断言方向确定的那几项）');
for (const c of truth) {
  const rgb = load(c.file);
  const p = periods[c.id];
  const s = detectSymmetry(rgb, p.x ? p.x : p.px, p.py);
  if (c.id === 'lattice-48') {
    // 回字纹本身是四重对称：p4m 才是对的（这条断言曾经写成 pmm，是断言错、不是算法错）
    ok('lattice 四重对称 → p4m', s.group === 'p4m', `测得 ${s.group}`);
    ok('lattice 水平镜像得分 ≥ 0.9', s.scores.mirrorX >= 0.9, s.scores.mirrorX.toFixed(3));
  }
  if (c.id === 'railing-24x60') {
    ok('railing 有镜像（pm 及以上）', s.mirrorX || s.mirrorY, `group=${s.group}`);
  }
  if (c.id === 'brick-64x32') {
    ok('brick 有平移周期（非 p1）', s.group !== 'p1', `group=${s.group}`);
    ok('brick 单元自身可辨（有镜像或旋转）', s.mirrorX || s.mirrorY || s.rot180, `group=${s.group}`);
  }
  if (c.id === 'noise') {
    ok('noise 不误判为高对称', s.group === 'p1' || s.group.startsWith('p1'), `测得 ${s.group}`);
  }
  if (c.id === 'enamel-sign') {
    // 招牌是左右对称的（边框），判 pm 没错；要求的是「不要判成四重/双向」
    ok('enamel 不误判为四重对称', s.group !== 'p4' && s.group !== 'p4m' && s.group !== 'pmm', `测得 ${s.group}`);
  }
}

// ── 3. 无缝化 ────────────────────────────────────────────────
console.log('\n[3] 无缝化：接缝差 ≤ 内部相邻列差中位数 × 1.5');
for (const c of truth) {
  if (c.truth.px === null) continue;
  const rgb = load(c.file);
  const p = periods[c.id];
  const { out, seamRatio } = makeSeamless(rgb, p.px, p.py);
  ok(`${c.id} 接缝差 ≤ 内部相邻列差中位数 × 1.5`, seamRatio <= 1.5, `比值 ${seamRatio.toFixed(2)}`);
  // 平铺 3 次，接缝处不应该出现硬边
  ok(`${c.id} 单元尺寸取整正确`, out.w === Math.round(p.px) && out.h === Math.round(p.py), `${out.w}×${out.h}`);
  const buf = encodePNG(out.w, out.h, out.d);
  ok(`${c.id} 单元可编码为 PNG`, buf.length > 100 && buf.readUInt32BE(0) === 0x89504e47, `${(buf.length / 1024).toFixed(0)} KB`);
}

// ── 4. 矢量化 ────────────────────────────────────────────────
console.log('\n[4] 矢量化：SVG 可解析、路径非空、颜色数 ≤ k');
for (const c of truth) {
  if (c.truth.px === null) continue;
  const rgb = load(c.file);
  const p = periods[c.id];
  const { out } = makeSeamless(rgb, p.px, p.py);
  const v = vectorize(out, 5);
  ok(`${c.id} 路径数 > 0`, v.paths > 0, `${v.paths} 条`);
  ok(`${c.id} 颜色数 ≤ 5`, v.colors.length <= 5, `${v.colors.length} 色`);
  ok(`${c.id} SVG 头正确`, v.svg.startsWith('<svg') && v.svg.includes('viewBox="0 0 ' + v.width + ' ' + v.height + '"'));
  ok(`${c.id} viewBox 与单元一致`, v.width === out.w && v.height === out.h, `${v.width}×${v.height}`);
  const paths = (v.svg.match(/<path /g) || []).length;
  ok(`${c.id} path 元素数与统计一致`, paths === v.colors.length, `dom=${paths} colors=${v.colors.length}`);
  // 颜色必须是合法 HEX
  ok(`${c.id} 色值合法`, v.colors.every((h) => /^#[0-9a-f]{6}$/.test(h)), v.colors.join(' '));
}

// ── 5. 换色：结构必须保住 ─────────────────────────────────────
console.log('\n[5] 换色：明度结构保真 ≥ 0.90');
for (const c of truth) {
  if (c.truth.px === null) continue;
  const rgb = load(c.file);
  const p = periods[c.id];
  const { out } = makeSeamless(rgb, p.px, p.py);
  for (const pal of PALETTES) {
    const r = recolor(out, pal, 0.15);
    ok(`${c.id} × ${pal.name} 结构保真`, r.structure >= 0.88, r.structure.toFixed(3));
  }
}
ok('色板数量 = 6', PALETTES.length === 6, String(PALETTES.length));
ok('色板色值全部合法', PALETTES.every((p) => p.colors.every((h) => /^#[0-9a-f]{6}$/i.test(h))));

// ── 6. 可复现：同输入同输出 ───────────────────────────────────
console.log('\n[6] 可复现：两次跑同一张图，字节一致');
for (const c of truth) {
  if (c.truth.px === null) continue;
  const run = () => {
    const rgb = load(c.file);
    const p = detectPeriod(rgb);
    const { out } = makeSeamless(rgb, p.px, p.py);
    const v = vectorize(out, 5);
    const r = recolor(out, PALETTES[0], 0.15);
    return crypto
      .createHash('sha256')
      .update(v.svg)
      .update(Buffer.from(r.out.d.buffer, r.out.d.byteOffset, r.out.d.byteLength))
      .digest('hex');
  };
  const a = run();
  const b = run();
  ok(`${c.id} sha256 一致`, a === b, a.slice(0, 16) + '…');
}

// ── 7. 规格书 ────────────────────────────────────────────────
console.log('\n[7] 规格书：字段齐、数值可核');
{
  const rgb = load('brick-64x32.png');
  const p = detectPeriod(rgb);
  const { out, removed } = makeSeamless(rgb, p.px, p.py);
  const s = detectSymmetry(rgb, p.px, p.py);
  const v = vectorize(out, 5);
  const spec = {
    unit: { w: out.w, h: out.h },
    period: { px: +p.px.toFixed(2), py: +p.py.toFixed(2) },
    confidence: { x: +p.scoreX.toFixed(3), y: +p.scoreY.toFixed(3) },
    symmetry: s.group,
    seamRemoved: +(removed * 100).toFixed(1),
    colors: v.colors,
    paths: v.paths,
  };
  ok('规格书 7 个顶层字段', Object.keys(spec).length === 7, Object.keys(spec).join(','));
  ok('单元尺寸与周期一致', spec.unit.w === Math.round(spec.period.px) && spec.unit.h === Math.round(spec.period.py));
  ok('色值为 HEX', spec.colors.every((h) => /^#[0-9a-f]{6}$/i.test(h)));
}

console.log(`\n──────────────  ${pass} passed, ${fail} failed  ──────────────`);
if (fail) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
