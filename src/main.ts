import { detectPeriod, type PeriodResult } from './core/period.ts';
import { detectSymmetry, type SymmetryResult } from './core/symmetry.ts';
import { makeSeamless } from './core/seamless.ts';
import { vectorize, type VectorResult } from './core/vectorize.ts';
import { PALETTES, recolor, type Palette } from './core/palette.ts';
import { tileH, tileV, type RGB } from './core/image.ts';

/* ── 构件库 ──────────────────────────────────────────────── */

interface Sample {
  id: string;
  name: string;
  note: string;
  url: string;
}

const files = import.meta.glob<string>('../assets/samples/*.{png,jpg}', { eager: true, query: '?url', import: 'default' });

const SAMPLES: Sample[] = Object.entries(files)
  .map(([p, url]) => {
    const base = p.split('/').pop()!.replace(/\.(png|jpg)$/, '');
    const [id, ...rest] = base.split('--');
    return {
      id: id!,
      name: rest.length ? rest.join('--') : base,
      note: '',
      url,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

/* ── 状态 ───────────────────────────────────────────────── */

interface Job {
  sample: Sample;
  src: HTMLCanvasElement;
  rgb: RGB;
  period: PeriodResult;
  sym: SymmetryResult;
  unit: RGB;
  seamRatio: number;
  origin: { x: number; y: number };
  vector: VectorResult;
  palette: Palette | null;
  recolored: RGB | null;
}

type View = 'source' | 'grid' | 'unit' | 'tile' | 'poster';

const state: {
  job: Job | null;
  view: View;
  showGrid: boolean;
  showAxis: boolean;
  busy: boolean;
} = { job: null, view: 'source', showGrid: true, showAxis: true, busy: false };

/* ── DOM ────────────────────────────────────────────────── */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('#' + id);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;
const cards = $('cards');
const empty = $('empty');
const scanning = $('scanning');
const stamp = $('stamp');
const hint = $('hint');

/* ── 图像工具 ───────────────────────────────────────────── */

const MAX_EDGE = 900;

function toCanvas(img: HTMLImageElement | ImageBitmap): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function readRGB(c: HTMLCanvasElement): RGB {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const d = g.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, d: d.data };
}

function centerCrop(rgb: RGB, ratio: number): RGB {
  const w = Math.max(16, Math.round(rgb.w * ratio));
  const h = Math.max(16, Math.round(rgb.h * ratio));
  const x0 = Math.round((rgb.w - w) / 2);
  const y0 = Math.round((rgb.h - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * rgb.w + x0) * 4;
    out.set(rgb.d.subarray(s, s + w * 4), y * w * 4);
  }
  return { w, h, d: out };
}

function rgbToCanvas(rgb: RGB): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = rgb.w;
  c.height = rgb.h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(rgb.w, rgb.h);
  img.data.set(rgb.d);
  g.putImageData(img, 0, 0);
  return c;
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ── 画布 ───────────────────────────────────────────────── */

function sizeCanvas(): void {
  const wrap = canvas.parentElement!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, wrap.clientWidth - 32);
  const h = Math.max(280, wrap.clientHeight - 32);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

function fit(iw: number, ih: number, cw: number, ch: number, pad = 0.94): { s: number; dx: number; dy: number; dw: number; dh: number } {
  const s = Math.min((cw * pad) / iw, (ch * pad) / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { s, dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

function paintPaper(w: number, h: number): void {
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e6e0d3';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function render(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintPaper(cw, ch);
  const job = state.job;
  if (!job) return;

  if (state.view === 'source' || state.view === 'grid') {
    const f = fit(job.rgb.w, job.rgb.h, cw, ch);
    const c = rgbToCanvas(job.rgb);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, f.dx, f.dy, f.dw, f.dh);
    if (state.view === 'grid' && state.showGrid) drawGrid(job, f);
    if (state.view === 'grid' && state.showAxis) drawAxes(job, f);
    drawScaleBar(job, f, cw, ch);
    return;
  }

  if (state.view === 'unit') {
    const src = job.recolored ?? job.unit;
    const f = fit(src.w, src.h, cw, ch, 0.8);
    const c = rgbToCanvas(src);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, f.dx, f.dy, f.dw, f.dh);
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = '#0f9b93';
    ctx.lineWidth = 1;
    ctx.strokeRect(f.dx + 0.5, f.dy + 0.5, f.dw - 1, f.dh - 1);
    label(`单元 ${src.w} × ${src.h} px`, f.dx, f.dy - 8, cw);
    return;
  }

  if (state.view === 'tile') {
    const src = job.recolored ?? job.unit;
    const tiled = tileV(tileH(src, 3), 3);
    const f = fit(tiled.w, tiled.h, cw, ch, 0.86);
    const c = rgbToCanvas(tiled);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, f.dx, f.dy, f.dw, f.dh);
    ctx.imageSmoothingEnabled = true;
    label('3 × 3 平铺 · 接缝已压平', f.dx, f.dy - 8, cw);
    return;
  }

  // poster：分色
  const q = job.vector.quantized;
  const f = fit(q.w, q.h, cw, ch, 0.74);
  const c = rgbToCanvas(q);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, f.dx, f.dy, f.dw, f.dh);
  ctx.imageSmoothingEnabled = true;
  ctx.strokeStyle = '#d5cec0';
  ctx.strokeRect(f.dx + 0.5, f.dy + 0.5, f.dw - 1, f.dh - 1);
  // 色卡
  const sw = 26;
  let x = f.dx;
  const y = f.dy + f.dh + 12;
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'middle';
  for (const hex of job.vector.colors) {
    ctx.fillStyle = hex;
    ctx.fillRect(x, y, sw, 12);
    ctx.strokeStyle = 'rgba(27,26,23,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, 11);
    ctx.fillStyle = '#5d574e';
    ctx.fillText(hex.toUpperCase(), x + sw + 5, y + 6.5);
    x += sw + 62;
    if (x > f.dx + f.dw - 60) break;
  }
}

function label(text: string, x: number, y: number, cw: number): void {
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.fillStyle = '#8c857a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, Math.max(8, x), Math.max(12, y));
  ctx.textAlign = 'left';
  void cw;
}

function drawGrid(job: Job, f: { s: number; dx: number; dy: number; dw: number; dh: number }): void {
  const { px, py } = job.period;
  const stepX = px * f.s;
  const stepY = py * f.s;
  if (stepX < 8 || stepY < 8) return;
  const oxs = f.dx + ((((job.origin.x % px) + px) % px) * f.s);
  const oys = f.dy + ((((job.origin.y % py) + py) % py) * f.s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.dx, f.dy, f.dw, f.dh);
  ctx.clip();

  // 网格：先铺一层淡青光晕，再压一条深线。只画 1px 细线在混凝土上根本看不见。
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? 'rgba(15,155,147,.14)' : 'rgba(8,116,110,.72)';
    ctx.lineWidth = pass === 0 ? 5 : 1.4;
    for (let x = oxs; x < f.dx + f.dw; x += stepX) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, f.dy);
      ctx.lineTo(Math.round(x) + 0.5, f.dy + f.dh);
      ctx.stroke();
    }
    for (let y = oys; y < f.dy + f.dh; y += stepY) {
      ctx.beginPath();
      ctx.moveTo(f.dx, Math.round(y) + 0.5);
      ctx.lineTo(f.dx + f.dw, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  // 取样单元：四角 L 形标记 + 淡青底，像检验台上的取景框。
  // 位置用 origin 本身（图像中心那个单元），不是取模后的第一条网格线。
  const x0 = f.dx + job.origin.x * f.s;
  const y0 = f.dy + job.origin.y * f.s;
  const x1 = oxs + stepX;
  const y1 = oys + stepY;
  ctx.fillStyle = 'rgba(15,155,147,.07)';
  ctx.fillRect(x0, y0, stepX, stepY);
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.lineWidth = 4.6;
  const L = Math.min(20, stepX * 0.32, stepY * 0.32);
  const drawCorners = () => {
  const corners: Array<[number, number, number, number]> = [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * L);
    ctx.stroke();
  }
  };
  drawCorners(); // 白色描边打底，深色构件上也看得见
  ctx.strokeStyle = '#067a73';
  ctx.lineWidth = 2.4;
  drawCorners();
  ctx.restore();
}

function drawAxes(job: Job, f: { s: number; dx: number; dy: number; dw: number; dh: number }): void {
  const stepX = job.period.px * f.s;
  const stepY = job.period.py * f.s;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(140,58,43,.95)';
  const oxs = f.dx + ((((job.origin.x % job.period.px) + job.period.px) % job.period.px) * f.s);
  const oys = f.dy + ((((job.origin.y % job.period.py) + job.period.py) % job.period.py) * f.s);
  if (job.sym.mirrorX) {
    for (let x = oxs + stepX / 2; x < f.dx + f.dw; x += stepX) {
      ctx.beginPath();
      ctx.moveTo(x, f.dy);
      ctx.lineTo(x, f.dy + f.dh);
      ctx.stroke();
    }
  }
  if (job.sym.mirrorY) {
    for (let y = oys + stepY / 2; y < f.dy + f.dh; y += stepY) {
      ctx.beginPath();
      ctx.moveTo(f.dx, y);
      ctx.lineTo(f.dx + f.dw, y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(140,58,43,.9)';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  const marks: string[] = [];
  if (job.sym.mirrorX) marks.push('镜像 X');
  if (job.sym.mirrorY) marks.push('镜像 Y');
  if (job.sym.rot180) marks.push('180°');
  if (job.sym.rot90) marks.push('90°');
  if (marks.length) ctx.fillText(marks.join(' · '), f.dx + 8, f.dy + f.dh - 8);
  ctx.restore();
}

function drawScaleBar(job: Job, f: { s: number; dx: number; dy: number; dw: number; dh: number }, cw: number, ch: number): void {
  const barPx = Math.round(job.period.px);
  const len = barPx * f.s;
  if (len < 20 || len > f.dw) return;
  const x = f.dx + 10;
  const y = Math.min(f.dy + f.dh + 22, ch - 12);
  ctx.save();
  ctx.strokeStyle = '#1b1a17';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + len, y - 4);
  ctx.lineTo(x + len, y + 4);
  ctx.stroke();
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.fillStyle = '#5d574e';
  ctx.fillText(`1 个周期 = ${barPx} px`, x + len + 8, y + 3.5);
  void cw;
  ctx.restore();
}

/* ── 业务 ───────────────────────────────────────────────── */

function setStamp(text: string, done: boolean): void {
  stamp.textContent = text;
  stamp.classList.toggle('done', done);
}

function setView(v: View): void {
  state.view = v;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.views button')) {
    b.setAttribute('aria-selected', String(b.dataset.view === v));
  }
  render();
}

async function loadSample(s: Sample): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  scanning.hidden = false;
  empty.hidden = true;
  setStamp('检测中', false);
  hint.textContent = '青色线是量出来的周期，红色虚线是对称轴。';
  for (const c of document.querySelectorAll<HTMLElement>('.card')) {
    c.setAttribute('aria-current', String(c.dataset.id === s.id));
  }

  await new Promise((r) => setTimeout(r, 60));

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('图片载入失败：' + s.url));
      img.src = s.url;
    });

    const src = toCanvas(img);
    const rgb = readRGB(src);
    // 只量中心 64%：真实照片的边缘常有柱子、台阶、天光，那不是纹样
    const period = detectPeriod(centerCrop(rgb, 0.64));
    const sym = detectSymmetry(rgb, period.px, period.py);
    // 单元从图像中心取：纹样通常在中段，边缘是柱子、台阶和天光
    const ox = Math.round(rgb.w / 2 - period.px / 2);
    const oy = Math.round(rgb.h / 2 - period.py / 2);
    const { out, seamRatio } = makeSeamless(rgb, period.px, period.py, 0.06, ox, oy);
    const vector = vectorize(out, 5);

    state.job = { sample: s, src, rgb, period, sym, unit: out, seamRatio, origin: { x: ox, y: oy }, vector, palette: null, recolored: null };
    $('specNo').textContent = s.id.startsWith('No') ? s.id.replace('-', '. ') : 'No. ' + s.id;
    $('specName').textContent = s.name;
    updateReadout();
    renderPalettes();
    // 载入后直接停在「周期」视图：让量出来的东西第一眼就看见，这是这件工具的记忆点
    setView('grid');
    setStamp('已检', true);
    for (const id of ['rPx', 'rPy', 'rConf', 'rGroup', 'rSeam', 'rColors']) {
      const el = $(id);
      el.classList.remove('fresh');
      void el.offsetWidth;
      el.classList.add('fresh');
    }
  } catch (e) {
    empty.hidden = false;
    setStamp('失败', false);
    hint.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    state.busy = false;
    scanning.hidden = true;
  }
}

function updateReadout(): void {
  const j = state.job;
  if (!j) return;
  $('rPx').textContent = j.period.px.toFixed(1) + ' px';
  $('rPy').textContent = j.period.py.toFixed(1) + ' px';
  $('rConf').textContent = `${(j.period.scoreX * 100).toFixed(0)} / ${(j.period.scoreY * 100).toFixed(0)}`;
  $('rGroup').textContent = j.sym.group;
  $('rSeam').textContent = '残差 ' + j.seamRatio.toFixed(2) + '×';
  $('rColors').textContent = j.vector.colors.length + ' 色';
}

function renderPalettes(): void {
  const box = $('palettes');
  box.innerHTML = '';
  const add = (p: Palette | null, label: string, sub: string, colors: string[]) => {
    const b = document.createElement('button');
    b.className = 'pal';
    b.setAttribute('aria-pressed', String(state.job?.palette?.id === (p?.id ?? null)));
    b.innerHTML =
      `<span class="swatch">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` +
      `<span class="label">${label}<small>${sub}</small></span>`;
    b.onclick = () => {
      if (!state.job) return;
      state.job.palette = p;
      state.job.recolored = p ? recolor(state.job.unit, p).out : null;
      renderPalettes();
      if (state.view !== 'grid' && state.view !== 'source') render();
      else setView('unit');
      $('foot').textContent = p ? `色板「${p.name}」：${p.note}。明度结构保留 82%。` : '全部在本地算完，不上传任何图片。';
    };
    box.appendChild(b);
  };
  if (state.job) {
    add(null, '原色', '不换色', state.job.vector.colors.slice(0, 3));
  }
  for (const p of PALETTES) add(p, p.name, p.note, p.colors);
}

// 构件库卡片
function renderCards(): void {
  cards.innerHTML = '';
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.className = 'card';
    b.dataset.id = s.id;
    b.innerHTML =
      `<img src="${s.url}" alt="" loading="lazy" />` +
      `<span><b>${s.name}</b><i>${s.id}</i></span>`;
    b.onclick = () => void loadSample(s);
    cards.appendChild(b);
  }
  $('libCount').textContent = String(SAMPLES.length).padStart(2, '0');
}

// 上传
$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  await loadSample({ id: 'UP', name: f.name.replace(/\.[^.]+$/, ''), note: '自备构件', url });
  URL.revokeObjectURL(url);
});

// 拖进来
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvas.parentElement!.style.outline = '2px dashed #0f9b93';
});
document.addEventListener('dragleave', () => {
  canvas.parentElement!.style.outline = '';
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  canvas.parentElement!.style.outline = '';
  const f = e.dataTransfer?.files?.[0];
  if (!f || !f.type.startsWith('image/')) return;
  const url = URL.createObjectURL(f);
  await loadSample({ id: 'UP', name: f.name.replace(/\.[^.]+$/, ''), note: '自备构件', url });
  URL.revokeObjectURL(url);
});

// 视图与开关
for (const b of document.querySelectorAll<HTMLButtonElement>('.views button')) {
  b.onclick = () => setView(b.dataset.view as View);
}
$('toggleGrid').onclick = () => {
  state.showGrid = !state.showGrid;
  $('toggleGrid').setAttribute('aria-pressed', String(state.showGrid));
  render();
};
$('toggleAxis').onclick = () => {
  state.showAxis = !state.showAxis;
  $('toggleAxis').setAttribute('aria-pressed', String(state.showAxis));
  render();
};

// 导出
$('exSvg').onclick = () => {
  const j = state.job;
  if (!j) return;
  download(`huayang-${j.sample.id}-unit.svg`, new Blob([j.vector.svg], { type: 'image/svg+xml' }));
};
$('exPng').onclick = () => {
  const j = state.job;
  if (!j) return;
  const src = j.recolored ?? j.unit;
  const tiled = tileV(tileH(src, 4), 4);
  const c = rgbToCanvas(tiled);
  c.toBlob((b) => b && download(`huayang-${j.sample.id}-tile.png`, b), 'image/png');
};
$('exSpec').onclick = () => {
  const j = state.job;
  if (!j) return;
  const spec = {
    构件: { 编号: j.sample.id, 名称: j.sample.name, 尺寸: `${j.rgb.w}×${j.rgb.h}` },
    单元: { w: j.unit.w, h: j.unit.h },
    周期: { px: +j.period.px.toFixed(2), py: +j.period.py.toFixed(2) },
    置信: { x: +j.period.scoreX.toFixed(3), y: +j.period.scoreY.toFixed(3) },
    对称群: j.sym.group,
    对称: j.sym.scores,
    接缝比: +j.seamRatio.toFixed(3),
    色板: j.palette ? { 名称: j.palette.name, 色值: j.palette.colors } : { 名称: '原色', 色值: j.vector.colors },
    分色: j.vector.colors,
    路径数: j.vector.paths,
    生成: new Date().toISOString(),
  };
  download(
    `huayang-${j.sample.id}-spec.json`,
    new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }),
  );
};

// 尺寸
const ro = new ResizeObserver(() => {
  sizeCanvas();
  render();
});
ro.observe(canvas.parentElement!);
window.addEventListener('resize', () => {
  sizeCanvas();
  render();
});

/* ── 启动 ───────────────────────────────────────────────── */

sizeCanvas();
renderCards();
renderPalettes();
render();
if (SAMPLES.length) void loadSample(SAMPLES[0]!);
