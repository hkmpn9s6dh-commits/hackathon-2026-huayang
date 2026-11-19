// 闸 C：真浏览器里的 e2e。跑法：npm run build && npm run preview（另开一个终端）→ npm run e2e
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve('proof/ui');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fails.push(name + (detail ? ' — ' + detail : ''));
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`);
  }
}

// 本机的 chromium 版本未必和刚装的 playwright 对上（playwright 更新后会要新的 headless shell）。
// 找不到就退回到 ms-playwright 里已有的 chromium 可执行文件。
function findChromium() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

let browser;
try {
  browser = await chromium.launch();
} catch {
  const exe = findChromium();
  if (!exe) throw new Error('找不到 chromium，跑一次 npx playwright install chromium');
  browser = await chromium.launch({ executablePath: exe });
}
const page = await browser.newPage({ viewport: { width: 1460, height: 940 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n[1] 首屏');
ok('标题出现', (await page.title()).includes('花样'));
ok('8 个构件', (await page.locator('.card').count()) === 8, String(await page.locator('.card').count()));
await page.waitForFunction(() => document.querySelector('#stamp')?.textContent?.includes('已检'), null, { timeout: 20000 });
ok('默认已选中第一个并完成检测', (await page.locator('#stamp').innerText()).includes('已检'));
ok('首屏无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
};

await shot('01-first-load.png');

console.log('\n[2] 真实照片：混凝土花格窗');
await page.locator('.card[data-id="06"]').click();
await page.waitForFunction(() => document.querySelector('#stamp')?.textContent?.includes('已检'), null, {
  timeout: 20000,
});
ok('检测完成', true);
const readout = await page.evaluate(() => ({
  px: document.querySelector('#rPx')?.textContent ?? '',
  py: document.querySelector('#rPy')?.textContent ?? '',
  conf: document.querySelector('#rConf')?.textContent ?? '',
  group: document.querySelector('#rGroup')?.textContent ?? '',
  seam: document.querySelector('#rSeam')?.textContent ?? '',
  colors: document.querySelector('#rColors')?.textContent ?? '',
}));
console.log('    读数:', JSON.stringify(readout));
ok('周期 X 有数值', /^\d+(\.\d+)? px$/.test(readout.px), readout.px);
ok('周期 Y 有数值', /^\d+(\.\d+)? px$/.test(readout.py), readout.py);
ok('对称群非空', readout.group.length > 0, readout.group);
const seamNum = parseFloat((readout.seam.match(/-?\d+(\.\d+)?/) || ['NaN'])[0]);
ok('接缝残差 ≤ 1.5×', seamNum <= 1.5, readout.seam);
ok('分色 2–5 色', /^[2-5] 色$/.test(readout.colors), readout.colors);
await page.locator('.views button[data-view="grid"]').click();
await page.waitForTimeout(180);
await shot('02-photo-grid.png');

console.log('\n[3] 五个视图都能画出来（像素方差 > 0，不是白板）');
const views = ['source', 'grid', 'unit', 'tile', 'poster'];
for (const v of views) {
  await page.locator(`.views button[data-view="${v}"]`).click();
  await page.waitForTimeout(160);
  const stat = await page.evaluate(() => {
    const c = document.querySelector('#stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 40) {
      const v = d[i];
      sum += v;
      sum2 += v * v;
      n++;
    }
    const m = sum / n;
    return { mean: m, sd: Math.sqrt(sum2 / n - m * m) };
  });
  ok(`视图 ${v} 有内容`, stat.sd > 6, `sd=${stat.sd.toFixed(1)}`);
  await shot(`03-view-${v}.png`);
}

console.log('\n[4] 换色板：结构不变、颜色变');
await page.locator('.views button[data-view="unit"]').click();
await page.waitForTimeout(150);
// 用整幅画布的平均色判断「换色」：比取某一块像素稳，也不依赖布局坐标
const stat = () =>
  page.evaluate(() => {
    const c = document.querySelector('#stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 40) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
      n++;
    }
    return { r: r / n, g: gg / n, b: b / n };
  });
const before = await stat();
await page.locator('.pal').nth(3).click();
await page.waitForTimeout(250);
const after = await stat();
console.log('    平均色 before', JSON.stringify(before), 'after', JSON.stringify(after));
const bluenessBefore = before.b - before.r;
const bluenessAfter = after.b - after.r;
ok(
  '换色后画面偏蓝（搪瓷蓝）',
  bluenessAfter - bluenessBefore > 8,
  `Δ(B-R) ${(bluenessAfter - bluenessBefore).toFixed(1)}`,
);
ok('选中态落在被点的色板', (await page.locator('.pal').nth(3).getAttribute('aria-pressed')) === 'true');
await shot('04-palette.png');

console.log('\n[5] 导出');
for (const id of ['exSvg', 'exPng', 'exSpec']) {
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.locator('#' + id).click();
  try {
    const d = await dl;
    const p = path.join(OUT, d.suggestedFilename());
    await d.saveAs(p);
    const size = fs.statSync(p).size;
    ok(`${id} 下载成功`, size > 200, `${d.suggestedFilename()} ${(size / 1024).toFixed(0)} KB`);
    if (id === 'exSvg') {
      const svg = fs.readFileSync(p, 'utf8');
      ok('SVG 里有 path', (svg.match(/<path /g) || []).length > 0, String((svg.match(/<path /g) || []).length));
    }
    if (id === 'exSpec') {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      ok('规格书含周期与对称群', !!j.周期 && !!j.对称群, JSON.stringify(j.周期));
    }
  } catch {
    ok(`${id} 下载成功`, false, '超时');
  }
}

console.log('\n[6] 键盘可达与对比度');
const tabbable = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])'));
  return nodes.filter((n) => !n.hasAttribute('disabled')).length;
});
ok('可聚焦控件 ≥ 20', tabbable >= 20, String(tabbable));
const contrastOk = await page.evaluate(() => {
  const el = document.querySelector('.sheet dt');
  if (!el) return false;
  const c = getComputedStyle(el).color;
  return c === 'rgb(93, 87, 78)' || c === 'rgb(27, 26, 23)';
});
ok('检验单标签色为设计值', contrastOk);

console.log('\n[7] 窄屏');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('390 宽无横向溢出', overflow <= 1, `溢出 ${overflow}px`);
await shot('05-mobile.png');

console.log('\n[8] 控制台干净');
ok('全程无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

console.log(`\n──────────────   e2e ${pass} passed, ${fails.length} failed  ──────────────`);
if (fails.length) {
  for (const f of fails) console.log('  · ' + f);
  process.exit(1);
}
