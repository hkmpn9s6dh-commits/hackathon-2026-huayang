# 花样 Pattern Mill

**工业遗产构件的纹样工具链。** 一张老厂房构件的照片进去，一套能上机的纹样出来。

> 参赛：工业文化创新发展大赛 · 2026 人工智能未来设计赛 · OPC 创新创业方向 · **AI+软件**
> 提交形态：可访问 Demo + 代码仓库

## 它做什么

```
照片 → ①量周期 → ②判对称群 → ③取单元并压平接缝 → ④矢量分色 + 工业色板再生 → 产品
```

每一步都有数字，数字进规格书：周期多少像素、置信多少、对称群是什么、接缝残差几倍、
分了几色、几条路径。给版房和印花厂看的不该是效果图，是规格。

## 跑起来

```bash
npm install
npm run dev        # http://127.0.0.1:5183
```

构建与验收：

```bash
npm run build      # tsc --noEmit && vite build → dist/
npm run verify     # 86 条断言，只用 Node，不需要浏览器
```

浏览器 e2e（可选，需要 chromium）：

```bash
npm run build
npm run preview    # 另一个终端，http://127.0.0.1:4173
npm run e2e        # 26 条断言 + 截图到 proof/ui/
```

> e2e 找不到浏览器时，会退回 `%LOCALAPPDATA%/ms-playwright` 里已有的 chromium。
> 都没有就跑一次 `npx playwright install chromium`。

## 目录

```
src/core/          纯函数（无 DOM），Node 里可直接 import
  image.ts         Gray / RGB、环绕取样、平铺
  period.ts        归一化互相关测周期（含抛物线亚像素插值）
  symmetry.ts      对称群近似判定（镜像 / 旋转 / 滑移）
  seamless.ts      取整周期 + 6% 羽化 + 接缝比
  vectorize.ts     k-means 分色 + 像素边界追踪 + RDP + SVG
  palette.ts       LAB 转换、六套工业色板、换色
src/main.ts        渲染与交互（canvas 2D，无框架）
scripts/
  synth.mjs        合成「已知周期」的样板，真值写进 truth.json
  verify.mjs       闸 B：86 条断言
  e2e.mjs          闸 C：26 条浏览器断言
  png.mjs          PNG 编码（零依赖）
  decode.mjs       PNG 解码（零依赖）
assets/synth/      合成样板 + truth.json（真值来源）
assets/samples/    构件库（3 张真实照片 + 5 张合成样板）
docs/              尺子、技术路线、证据、交件说明
SPEC.md            闸 A：评分表原文、黄金路径、AC 清单
```

## 判据

**周期**：合成样板的真值写死在 `assets/synth/truth.json`，算法只准测出它，不准反过来定义它。
误差 ≤ 1 px。

**接缝**：不看「消除了百分之多少」（循环论证），看 **接缝差 ÷ 内部相邻列差中位数**，要求 ≤ 1.5。

**可复现**：同一张图跑两次，SVG 与位图的 sha256 必须一致。

**换色**：明度结构保真 ≥ 0.88（只许换墨，不许改明暗）。

`npm run verify` 的 86 条断言里，有 4 条在开发过程中抓到过真缺陷：
RDP 把闭合环压成 2 个点导致 SVG 空文件、RGBA 当 Gray 用导致周期全错、
非方形单元判旋转返回自身导致噪声图被判 p4、换色乘 0.15 导致灰色构件「换了跟没换一样」。

## 依赖

生产依赖 **0**。开发依赖：vite / typescript / playwright（仅 e2e）。
不发任何外部请求，图片不上传，断网可用。

## 许可

代码 MIT。构件照片与生成素材仅用于本次参赛演示。
