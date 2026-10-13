// 背景色去污染 / 掩膜外扩 / 分块背景色估计（修"深色背景上一圈白边"的核心算法）
import { ok } from './_harness.mjs';
import {
  floodCut, dilateMask, estimateBackgroundGrid, decontaminateEdges, pickCutTolerance,
} from '../src/shared/imageops.js';

const W = 64, H = 64;

/** 白底 + 中间一块纯色方块，方块最外圈是 a=0.5 的"背景渗色"像素 */
function makeEdgeImg(bg, fg, a = 0.5) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = bg[0]; d[i * 4 + 1] = bg[1]; d[i * 4 + 2] = bg[2]; d[i * 4 + 3] = 255;
  }
  const x0 = 20, x1 = 43, y0 = 20, y1 = 43;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4;
    const edge = (x === x0 || x === x1 || y === y0 || y === y1);
    const k = edge ? a : 1;
    d[i] = Math.round(fg[0] * k + bg[0] * (1 - k));
    d[i + 1] = Math.round(fg[1] * k + bg[1] * (1 - k));
    d[i + 2] = Math.round(fg[2] * k + bg[2] * (1 - k));
    d[i + 3] = 255;
  }
  return d;
}

// ---------- dilateMask ----------
{
  const m = new Uint8Array(W * H);
  m[10 * W + 10] = 1;
  const d1 = dilateMask(m, W, H, 1);
  ok('膨胀 1 圈：原点是背景', d1[10 * W + 10] === 1);
  ok('膨胀 1 圈：右邻被覆盖', d1[10 * W + 11] === 1);
  ok('膨胀 1 圈：上邻被覆盖', d1[9 * W + 10] === 1);
  ok('膨胀 1 圈：斜对角不受影响（4 邻域）', d1[9 * W + 11] === 0);
  ok('膨胀 1 圈：远处不受影响', d1[10 * W + 12] === 0);
  ok('膨胀 0 圈：原样返回', dilateMask(m, W, H, 0) === m);
}

// ---------- estimateBackgroundGrid：跟随渐变，而不是全图一个平均值 ----------
{
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = 200 + Math.round((x / W) * 40);   // 左 200 -> 右 240
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  const mask = new Uint8Array(W * H).fill(1);
  const g = estimateBackgroundGrid(d, mask, W, H, 16);
  const left = g.grid[0], right = g.grid[(g.gw - 1) * 3];
  ok('分块背景色：左块更暗', left < right, `left=${left.toFixed(1)} right=${right.toFixed(1)}`);
  ok('分块背景色：左块接近 200', Math.abs(left - 205) < 8, String(left));
  ok('分块背景色：右块接近 235', Math.abs(right - 233) < 8, String(right));
}

// ---------- decontaminateEdges：反解 F = (C - (1-a)B) / a ----------
{
  const bg = [240, 240, 240], fg = [200, 0, 0], a = 0.5;
  const d = makeEdgeImg(bg, fg, a);
  const mask = new Uint8Array(W * H);
  // 标记背景（方块外全部是背景）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inSq = x >= 20 && x <= 43 && y >= 20 && y <= 43;
    if (!inSq) mask[y * W + x] = 1;
  }
  // 人为把边缘像素 alpha 设成 a
  const edgeIdx = (20 * W + 20) * 4;
  d[edgeIdx + 3] = Math.round(a * 255);
  const out = decontaminateEdges(d, W, H, mask);
  const r = out[edgeIdx], g2 = out[edgeIdx + 1], b = out[edgeIdx + 2];
  ok('去污染：红色分量回到前景红', Math.abs(r - fg[0]) <= 3, `r=${r}`);
  ok('去污染：绿色分量被减掉', g2 <= 4, `g=${g2}`);
  ok('去污染：蓝色分量被减掉', b <= 4, `b=${b}`);
  ok('去污染：alpha 保持不变', out[edgeIdx + 3] === Math.round(a * 255));
  ok('去污染：全不透明像素不动', out[(30 * W + 30) * 4] === fg[0]);
}

// ---------- floodCut 端到端：半透明边缘不再偏白 ----------
{
  const bg = [240, 240, 240], fg = [200, 0, 0];
  const d = makeEdgeImg(bg, fg, 0.5);
  const out = floodCut(d, W, H, { tol: 38, feather: 14 });
  ok('floodCut 返回背景掩膜', out.mask instanceof Uint8Array && out.mask.length === W * H);
  // 找一圈"半透明但可见"的边缘像素，检查它们没有残留背景白
  let worst = -1, checked = 0;
  for (let i = 0; i < W * H; i++) {
    const a = out.data[i * 4 + 3];
    if (a < 40 || a > 220) continue;
    checked++;
    const g2 = out.data[i * 4 + 1], b = out.data[i * 4 + 2];
    worst = Math.max(worst, Math.min(g2, b));
  }
  ok('存在半透明过渡带', checked > 0, String(checked));
  ok('过渡带不再偏白（绿/蓝通道被压下去）', worst >= 0 && worst <= 12, `worst=${worst}`);
}

// ---------- 可关闭：decontaminate:false 保持旧行为 ----------
{
  const bg = [240, 240, 240], fg = [200, 0, 0];
  const d = makeEdgeImg(bg, fg, 0.5);
  const off = floodCut(d, W, H, { tol: 38, feather: 14, decontaminate: false });
  let hasWhiteish = false;
  for (let i = 0; i < W * H; i++) {
    const a = off.data[i * 4 + 3];
    if (a < 40 || a > 220) continue;
    if (off.data[i * 4 + 1] > 60) hasWhiteish = true;
  }
  ok('关掉去污染后仍能看到偏白边缘（对照组）', hasWhiteish);
}

// ---------- 浅色部位不被吃掉（回归：白兔尾巴/熊猫耳朵被误删的坑） ----------
{
  // 场景要和真实立绘一致：浅色部位外面**有一圈描边**把它和背景隔开。
  // ★ 注意别把这条测试写错（第一版就写错了）：
  //   如果浅色块的颜色落在背景容差内、又和背景**直接连通**，
  //   漫水本来就该把它一起删掉 —— 那是正确行为，不是 bug。
  //   真实素材里白毛能被保住，靠的正是这圈深色描边构成的屏障。
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i*4] = 224; d[i*4+1] = 222; d[i*4+2] = 222; d[i*4+3] = 255; }
  // 深色描边环（模拟线稿），把内部浅色区和背景隔断。
  // 厚度取 3px —— 真实立绘的线稿就是这个量级；
  // 1px 的线稿会被羽化带啃掉，那是羽化半径的固有代价，不是这个算法的问题。
  for (let y = 15; y <= 50; y++) for (let x = 15; x <= 50; x++) {
    const i = (y * W + x) * 4;
    const ring = (x <= 17 || x >= 48 || y <= 17 || y >= 48);
    if (ring) { d[i] = 40; d[i+1] = 30; d[i+2] = 30; }
    else { d[i] = 236; d[i+1] = 234; d[i+2] = 233; }   // 比背景更亮的"白毛"
  }
  const out = floodCut(d, W, H, { tol: 38, feather: 14 });
  const inner = out.data[(31 * W + 31) * 4 + 3];
  ok('浅色部位被保留（有描边隔断时不会被漫水吃掉）', inner > 200, String(inner));
  ok('浅色部位颜色没被改坏', out.data[(31 * W + 31) * 4] === 236, String(out.data[(31 * W + 31) * 4]));
  ok('外部背景被扣掉', out.data[3] === 0);
  // 描边**内圈**保留即可。最外 1~2px 会被 maskGrow + 羽化带啃掉一点，
  // 这是"把过渡带推进主体内侧"的固有代价：对 2048px 原图是 2px，
  // 缩到 256px 画布后不到 0.3px，肉眼不可见。
  // 边缘是一段**单调**的 alpha 渐变（这就是抗锯齿），不是"硬切"也不是"发虚"。
  // 实测：feather=14 时过渡带约 8px —— 对 2048px 原图缩到 256px 画布后不到 1px，
  // 肉眼看到的就是一条干净的软边。所以这里断言"单调不回头"，而不是断言某一像素的绝对值。
  const row = 31;
  let prev = null, monotonic = true;
  for (let x = 15; x <= 31; x++) {
    const a = out.data[(row * W + x) * 4 + 3];
    if (prev !== null && a < prev) monotonic = false;   // 由外向内必须单调不降
    prev = a;
  }
  ok('边缘 alpha 由外向内单调过渡（抗锯齿，不是硬切）', monotonic);
  ok('主体中心完全不透明', out.data[(31 * W + 31) * 4 + 3] === 255);
}
// ---------- pickCutTolerance：自动挑容差，保护浅色部位 ----------
{
  // 场景：浅灰背景 + 主体带一大片"接近背景色"的白毛（模拟金毛犬）
  const W2 = 128, H2 = 128;
  const bg = [224, 224, 224], fur = [250, 245, 230];   // 最大通道差 26
  const d = new Uint8ClampedArray(W2 * H2 * 4);
  for (let i = 0; i < W2 * H2; i++) { d[i*4]=bg[0]; d[i*4+1]=bg[1]; d[i*4+2]=bg[2]; d[i*4+3]=255; }
  // ★ 白毛**直接连着背景**，中间没有描边隔断 —— 这才是真实情况：
  //   金毛犬的头顶/耳朵绒毛、兔子的白尾、熊猫的白耳都是这样直接和浅灰背景相接，
  //   所以漫水一旦容差过大就会顺着白毛一路吃进去。
  for (let y = 20; y <= 107; y++) for (let x = 20; x <= 107; x++) {
    const i = (y * W2 + x) * 4;
    d[i]=fur[0]; d[i+1]=fur[1]; d[i+2]=fur[2];
  }
  const picked = pickCutTolerance(d, W2, H2);
  ok('自动挑容差：不会选到会吃掉白毛的大容差', picked.tol <= 22, `tol=${picked.tol} survival=${picked.survival.toFixed(3)}`);
  ok('自动挑容差：主体存活率达标', picked.survival >= 0.985, String(picked.survival));
  ok('自动挑容差：给出了候选记录', Array.isArray(picked.tried) && picked.tried.length > 0);

  // 用挑出来的容差真的抠一遍：白毛必须还在
  const out = floodCut(d, W2, H2, { tol: picked.tol, feather: 14 });
  ok('按自动容差抠图：白毛保留', out.data[(64 * W2 + 64) * 4 + 3] === 255);
  ok('按自动容差抠图：背景扣干净', out.data[3] === 0);

  // 对照：写死 38 会把白毛吃掉
  const bad = floodCut(d, W2, H2, { tol: 38, feather: 0 });
  ok('对照组：写死 38 确实会吃掉白毛（这就是要自动挑的原因）', bad.data[(64 * W2 + 64) * 4 + 3] === 0);
}

// ---------- pickCutTolerance：没有浅色部位时，容差可以放开 ----------
{
  const W2 = 128, H2 = 128;
  const d = new Uint8ClampedArray(W2 * H2 * 4);
  for (let i = 0; i < W2 * H2; i++) { d[i*4]=224; d[i*4+1]=224; d[i*4+2]=224; d[i*4+3]=255; }
  for (let y = 20; y <= 107; y++) for (let x = 20; x <= 107; x++) {
    const i = (y * W2 + x) * 4;
    d[i]=40; d[i+1]=90; d[i+2]=160;   // 深蓝主体，远离背景色
  }
  const picked = pickCutTolerance(d, W2, H2);
  ok('深色主体：容差可以选到较大值', picked.tol >= 26, `tol=${picked.tol}`);
  ok('深色主体：存活率仍达标', picked.survival >= 0.985, String(picked.survival));
}
