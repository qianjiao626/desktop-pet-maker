import { ok } from './_harness.mjs';
import { transformFrame, synthesizeMotion, MOTIONS, MOTION_NAMES, safePadding, motionCanvasSize } from '../src/shared/motion.js';
import { fitFrameLimit } from '../src/shared/budget.js';

function blank(w, h) { return new Uint8ClampedArray(w * h * 4); }
function disc(d, w, h, cx, cy, r, rgba) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.hypot(x - cx, y - cy);
    if (dist > r + 1) continue;
    const k = (y * w + x) * 4;
    const a = dist <= r ? 1 : (r + 1 - dist);   // 1px 软边
    d[k] = rgba[0]; d[k + 1] = rgba[1]; d[k + 2] = rgba[2];
    d[k + 3] = Math.round(rgba[3] * a);
  }
}
function alphaCount(d) { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++; return n; }
// 非透明像素的平均亮度（用于检测黑边）
function meanLumaOfOpaque(d) {
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  }
  return n ? s / n : 0;
}

// ---- 1. 恒等变换应基本保留图像 ----
{
  const W = 40, H = 40;
  const src = blank(W, H); disc(src, W, H, 20, 20, 12, [255, 0, 0, 255]);
  const r = transformFrame(src, W, H, W, H, { scaleX: 1, scaleY: 1, anchor: 'center' });
  ok('尺寸正确', r.width === W && r.height === H);
  const a0 = alphaCount(src), a1 = alphaCount(r.data);
  ok('恒等变换保留绝大多数像素', Math.abs(a1 - a0) / a0 < 0.05, `${a1} vs ${a0}`);
}

// ---- 2. 预乘 alpha：缩放后不应出现黑边 ----
{
  const W = 60, H = 60;
  const src = blank(W, H); disc(src, W, H, 30, 30, 20, [255, 40, 40, 255]);
  const lumaSrc = meanLumaOfOpaque(src);
  // 放大 1.4x（插值最强，最容易暴露光晕）
  const up = transformFrame(src, W, H, 140, 140, { scaleX: 1.4, scaleY: 1.4, anchor: 'center' });
  const lumaUp = meanLumaOfOpaque(up.data);
  ok('放大后无黑边(亮度不下降)', lumaUp >= lumaSrc - 6, `${lumaUp.toFixed(1)} vs ${lumaSrc.toFixed(1)}`);
  // 缩小 0.6x
  const dn = transformFrame(src, W, H, 60, 60, { scaleX: 0.6, scaleY: 0.6, anchor: 'center' });
  const lumaDn = meanLumaOfOpaque(dn.data);
  ok('缩小后无黑边', lumaDn >= lumaSrc - 6, `${lumaDn.toFixed(1)} vs ${lumaSrc.toFixed(1)}`);
  // 边缘像素应仍是红色系（R 明显大于 B），而非被黑污染
  let reddishEdge = 0, edgeSeen = 0;
  for (let i = 0; i < up.data.length; i += 4) {
    const a = up.data[i + 3];
    if (a > 60 && a < 220) {   // 半透明边缘带
      edgeSeen++;
      if (up.data[i] > up.data[i + 2] + 60) reddishEdge++;
    }
  }
  ok('半透明边缘保持原色相(未偏黑/蓝)', edgeSeen > 0 && reddishEdge / edgeSeen > 0.95,
    `${reddishEdge}/${edgeSeen}`);
}

// ---- 3. 旋转不应裁掉内容（在足够大的画布上）----
{
  const W = 50, H = 50;
  const src = blank(W, H); disc(src, W, H, 25, 25, 18, [0, 200, 80, 255]);
  const pad = safePadding(W, H, 'rock', 0.05);
  const r = transformFrame(src, W, H, W + pad * 2, H + pad * 2, { rotateDeg: 9, anchor: 'center' });
  const a = alphaCount(r.data);
  const a0 = alphaCount(src);
  ok('旋转后内容未被大量裁切', a > a0 * 0.9, `${a} vs ${a0}`);
}

// ---- 4. synthesizeMotion 基本属性 ----
{
  const W = 64, H = 64;
  const src = blank(W, H); disc(src, W, H, 32, 32, 22, [255, 120, 40, 255]);
  for (const m of MOTION_NAMES) {
    const res = synthesizeMotion(src, W, H, { motion: m, frames: 8, amplitude: 0.05 });
    ok(`synthesize(${m}): 帧数=8`, res.frames.length === 8);
    ok(`synthesize(${m}): 尺寸统一`, res.frames.every((f) => f.width === res.canvas.width && f.height === res.canvas.height));
    ok(`synthesize(${m}): 有内容`, res.frames.every((f) => alphaCount(f.data) > 50));
  }
}

// ---- 5. 运动确实使画面变化 ----
{
  const W = 64, H = 64;
  const src = blank(W, H); disc(src, W, H, 32, 32, 20, [255, 120, 40, 255]);
  for (const m of ['breathe', 'float', 'bounce', 'rock']) {
    const res = synthesizeMotion(src, W, H, { motion: m, frames: 8, amplitude: 0.08 });
    const sigs = res.frames.map((f) => {
      let s = 0;
      for (let i = 3; i < f.data.length; i += 4) s = (s * 31 + f.data[i]) >>> 0;
      return s;
    });
    ok(`${m}: 各帧画面不同`, new Set(sigs).size >= 3, 'distinct=' + new Set(sigs).size);
  }
}

// ---- 6. 循环连续性：首末帧差异应明显小于随机两帧差异 ----
{
  const W = 64, H = 64;
  const src = blank(W, H); disc(src, W, H, 32, 32, 20, [255, 120, 40, 255]);
  const res = synthesizeMotion(src, W, H, { motion: 'breathe', frames: 12, amplitude: 0.08 });
  // 无缝判据：相邻帧差应大致均匀，环绕步长(末->首)不得显著大于典型步长
  const diff = (a, b) => { let s = 0; for (let i = 3; i < a.length; i += 4) s += Math.abs(a[i] - b[i]); return s; };
  const steps = [];
  for (let i = 0; i < res.frames.length; i++) {
    steps.push(diff(res.frames[i].data, res.frames[(i + 1) % res.frames.length].data));
  }
  const wrap = steps[steps.length - 1];
  const inner = steps.slice(0, -1);
  const maxInner = Math.max(...inner);
  ok('环绕步长不超过最大内部步长', wrap <= maxInner * 1.2,
    `wrap=${wrap} maxInner=${maxInner}`);
  ok('所有相邻步长均非零(帧在变化)', steps.every((v) => v > 0), Math.min(...steps));
}

// ---- 7. 内容不被画布边缘裁切 ----
{
  const W = 64, H = 64;
  const src = blank(W, H); disc(src, W, H, 32, 32, 24, [255, 120, 40, 255]);
  const res = synthesizeMotion(src, W, H, { motion: 'float', frames: 10, amplitude: 0.09 });
  let clipped = 0;
  for (const f of res.frames) {
    const { width: w, height: h, data } = f;
    for (let x = 0; x < w; x++) { if (data[(0 * w + x) * 4 + 3] > 16 || data[((h - 1) * w + x) * 4 + 3] > 16) clipped++; }
    for (let y = 0; y < h; y++) { if (data[(y * w + 0) * 4 + 3] > 16 || data[(y * w + (w - 1)) * 4 + 3] > 16) clipped++; }
  }
  ok('画布边缘无裁切', clipped === 0, 'clippedPixels=' + clipped);
}

// ---- 8. 参数边界 ----
{
  const W = 32, H = 32;
  const src = blank(W, H); disc(src, W, H, 16, 16, 10, [10, 200, 100, 255]);
  ok('frames=1 被夹到最少 2', synthesizeMotion(src, W, H, { motion: 'breathe', frames: 1 }).frames.length === 2);
  ok('frames=999 被夹到 60', synthesizeMotion(src, W, H, { motion: 'breathe', frames: 999 }).frames.length === 60);
  ok('amplitude 负值被夹到 0', synthesizeMotion(src, W, H, { amplitude: -5 }).amplitude === 0);
  ok('amplitude 过大被夹到 0.5', synthesizeMotion(src, W, H, { amplitude: 99 }).amplitude === 0.5);
  let threw = false;
  try { synthesizeMotion(src, W, H, { motion: '不存在' }); } catch { threw = true; }
  ok('未知运动抛错', threw);
  ok('全部运动已导出', MOTION_NAMES.length === 6 && MOTION_NAMES.every((n) => typeof MOTIONS[n] === 'function'), MOTION_NAMES.join(','));
}

// ---- 9. safePadding 随振幅单调 ----
ok('safePadding 随振幅增大', safePadding(100, 100, 'rock', 0.1) > safePadding(100, 100, 'rock', 0.02));
ok('safePadding 非负', safePadding(64, 64, 'breathe', 0) >= 4);

// ---- 10. 动作可见性：默认参数下顶边必须有可测量的位移/形变 ----
// 回归：位移曾用固定像素常数，导致大幅面图上动作几乎不可见
{
  const W = 256, H = 256;
  const src = blank(W, H); disc(src, W, H, 128, 128, 90, [255, 130, 60, 255]);

  function topOf(d, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) return y;
    return -1;
  }
  function bboxOf(d, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  const cases = [
    { m: 'float', metric: 'topY', min: 8 },
    { m: 'bounce', metric: 'topY', min: 10 },
    { m: 'breathe', metric: 'height', min: 4 },
    { m: 'nod', metric: 'height', min: 4 },
    { m: 'rock', metric: 'centerX', min: 6 },
    { m: 'sway', metric: 'angleSpan', min: 1 },
  ];

  for (const c of cases) {
    const res = synthesizeMotion(src, W, H, { motion: c.m, frames: 12, amplitude: 0.04 });
    const vals = res.frames.map((f) => {
      const w = res.canvas.width, h = res.canvas.height;
      const b = bboxOf(f.data, w, h);
      if (c.metric === 'topY') return b.minY;
      if (c.metric === 'height') return b.h;
      if (c.metric === 'centerX') return (b.minX + b.maxX) / 2;
      return 0;
    });
    let span;
    if (c.metric === 'angleSpan') {
      // sway 用顶边横向偏移间接衡量
      const tops = res.frames.map((f) => {
        const w = res.canvas.width, h = res.canvas.height;
        const b = bboxOf(f.data, w, h);
        return b.minX;
      });
      span = Math.max(...tops) - Math.min(...tops);
    } else {
      span = Math.max(...vals) - Math.min(...vals);
    }
    ok(`默认幅度下 ${c.m} 动作可见 (span>=${c.min})`, span >= c.min,
      `span=${span.toFixed(1)} values=${[...new Set(vals.map((v) => Math.round(v)))].join(',')}`);
  }
}

// ---- 11. 振幅越大动作越大（单调性）----
{
  const W = 200, H = 200;
  const src = blank(W, H); disc(src, W, H, 100, 100, 70, [255, 130, 60, 255]);
  const topSpan = (amp) => {
    const res = synthesizeMotion(src, W, H, { motion: 'float', frames: 12, amplitude: amp });
    const tops = res.frames.map((f) => {
      const w = res.canvas.width, h = res.canvas.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f.data[(y * w + x) * 4 + 3] > 24) return y;
      return -1;
    });
    return Math.max(...tops) - Math.min(...tops);
  };
  const s1 = topSpan(0.02), s2 = topSpan(0.06), s3 = topSpan(0.12);
  ok('振幅单调增大动作', s3 > s2 && s2 > s1, `${s1} < ${s2} < ${s3}`);
}

// ---- 12. 大幅面不再被固定常数限制 ----
{
  const small = 64, large = 512;
  const mk = (n) => { const d = blank(n, n); disc(d, n, n, n / 2, n / 2, n * 0.35, [255, 130, 60, 255]); return d; };
  const spanOf = (n) => {
    const res = synthesizeMotion(mk(n), n, n, { motion: 'float', frames: 12, amplitude: 0.04 });
    const tops = res.frames.map((f) => {
      const w = res.canvas.width, h = res.canvas.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f.data[(y * w + x) * 4 + 3] > 24) return y;
      return -1;
    });
    return Math.max(...tops) - Math.min(...tops);
  };
  const ss = spanOf(small), sl = spanOf(large);
  ok('位移随图像尺寸缩放', sl > ss * 4, `small=${ss} large=${sl}`);
}

// ---- 13. motionCanvasSize 必须与 synthesizeMotion 实际输出一致 ----
// 回归：预算曾按源图尺寸估算，但生成帧画布会外扩，导致低估内存
{
  const W = 200, H = 160;
  const src = blank(W, H); disc(src, W, H, 100, 80, 60, [255, 130, 60, 255]);
  for (const m of MOTION_NAMES) {
    for (const amp of [0.02, 0.06, 0.12]) {
      const predicted = motionCanvasSize(W, H, m, amp);
      const actual = synthesizeMotion(src, W, H, { motion: m, frames: 4, amplitude: amp });
      if (predicted.width !== actual.canvas.width || predicted.height !== actual.canvas.height) {
        ok(`motionCanvasSize 与输出一致(${m}@${amp})`, false,
          `预测 ${predicted.width}x${predicted.height} 实际 ${actual.canvas.width}x${actual.canvas.height}`);
        continue;
      }
    }
  }
  ok('motionCanvasSize 与 synthesizeMotion 全部一致', true, MOTION_NAMES.length + ' 种运动 x 3 种振幅');
}

// ---- 14. 生成后画布不小于源图（外扩而非裁剪）----
{
  const W = 128, H = 128;
  for (const m of MOTION_NAMES) {
    const sz = motionCanvasSize(W, H, m, 0.06);
    if (sz.width < W || sz.height < H) {
      ok(`画布未缩小(${m})`, false, `${sz.width}x${sz.height}`);
      continue;
    }
  }
  ok('所有运动画布均不小于源图', true);
}

// ---- 15. 预算与实际内存占用一致 ----
{
  const W = 300, H = 300;
  const sz = motionCanvasSize(W, H, 'rock', 0.08);
  const fit = fitFrameLimit(sz.width, sz.height, 30);
  const res = synthesizeMotion(blank(W, H), W, H, { motion: 'rock', frames: fit.frames, amplitude: 0.08 });
  const actualBytes = res.frames.reduce((a, f) => a + f.data.length, 0);
  // 预算按 2 份(original+current)估算，实际只存 1 份 current，故实际应 <= 预算
  ok('实际占用不超过预算', actualBytes <= fit.bytes, `${(actualBytes / 1048576).toFixed(1)}MB <= ${(fit.bytes / 1048576).toFixed(1)}MB`);
}

// ---- 16. 大图 300 帧不再导致内存爆炸 ----
{
  const W = 1600, H = 1600;
  const sz = motionCanvasSize(W, H, 'float', 0.04);
  const fit = fitFrameLimit(sz.width, sz.height, 300);
  ok('大图 300 帧被限制到安全范围', fit.clamped && fit.bytes < 512 * 1024 * 1024,
    `frames=${fit.frames} bytes=${(fit.bytes / 1048576).toFixed(1)}MB`);
  ok('大图限制后仍 >= 1 帧', fit.frames >= 1, String(fit.frames));
}
