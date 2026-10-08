import { ok } from './_harness.mjs';
import { alignFrames, centroidOf, trimBounds } from '../src/shared/imageops.js';

function blank(w, h) { return new Uint8ClampedArray(w * h * 4); }
function rect(d, w, x0, y0, x1, y1, rgba) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3];
  }
}
// 找出非透明区域的边界盒
function bbox(d, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

// ---- centroidOf ----
{
  const d = blank(20, 20);
  rect(d, 20, 5, 5, 9, 9, [255, 0, 0, 255]);   // 5x5 方块，质心 (7,7)
  const c = centroidOf(d, 20, 20);
  ok('质心 X 正确', Math.abs(c.x - 7) < 1e-6, c.x);
  ok('质心 Y 正确', Math.abs(c.y - 7) < 1e-6, c.y);
  ok('质心像素数正确', c.n === 25, c.n);
}
{
  const c = centroidOf(blank(4, 4), 4, 4);
  ok('空图质心回退到中心', c.x === 2 && c.y === 2 && c.n === 0);
}

// ---- alignFrames: bottom 模式，脚底应对齐 ----
{
  const W = 40, H = 40;
  // 帧1：方块靠左上；帧2：同样大小的方块靠右下但「底部」位置不同
  const f1 = blank(W, H); rect(f1, W, 5, 5, 14, 14, [255, 0, 0, 255]);
  const f2 = blank(W, H); rect(f2, W, 20, 25, 29, 34, [0, 0, 255, 255]);
  const r = alignFrames([
    { data: f1, width: W, height: H, name: 'a', durationMs: 100 },
    { data: f2, width: W, height: H, name: 'b', durationMs: 120 },
  ], { mode: 'bottom' });

  ok('输出帧数不变', r.frames.length === 2);
  ok('画布为最大主体尺寸', r.canvas.width === 10 && r.canvas.height === 10, JSON.stringify(r.canvas));
  ok('保留了 durationMs', r.frames[1].durationMs === 120);
  ok('保留了 name', r.frames[0].name === 'a');

  const b1 = bbox(r.frames[0].data, r.canvas.width, r.canvas.height);
  const b2 = bbox(r.frames[1].data, r.canvas.width, r.canvas.height);
  ok('帧1 铺满画布', b1.minX === 0 && b1.maxX === 9 && b1.minY === 0 && b1.maxY === 9, JSON.stringify(b1));
  ok('帧2 铺满画布', b2.minX === 0 && b2.maxX === 9 && b2.minY === 0 && b2.maxY === 9, JSON.stringify(b2));
  // 关键：两帧的「底部」都落在画布底边（抖动消除）
  ok('两帧底边对齐(消除抖动)', b1.maxY === b2.maxY, `${b1.maxY} vs ${b2.maxY}`);
  // 水平中心也应对齐
  ok('两帧水平中心对齐', (b1.minX + b1.maxX) === (b2.minX + b2.maxX), `${b1.minX + b1.maxX} vs ${b2.minX + b2.maxX}`);
}

// ---- alignFrames: 不同尺寸主体也应统一到同一画布 ----
{
  const W = 60, H = 60;
  const small = blank(W, H); rect(small, W, 10, 10, 19, 19, [0, 255, 0, 255]);  // 10x10
  const big = blank(W, H); rect(big, W, 5, 5, 44, 44, [0, 0, 255, 255]);        // 40x40
  const r = alignFrames([
    { data: small, width: W, height: H },
    { data: big, width: W, height: H },
  ], { mode: 'bottom' });
  ok('画布取最大主体', r.canvas.width === 40 && r.canvas.height === 40, JSON.stringify(r.canvas));
  ok('所有帧尺寸统一', r.frames.every((f) => f.width === 40 && f.height === 40));
  const bs = bbox(r.frames[0].data, 40, 40);
  const bb = bbox(r.frames[1].data, 40, 40);
  ok('小主体底边对齐画布底', bs.maxY === 39, bs.maxY);
  ok('大主体铺满', bb.minY === 0 && bb.maxY === 39, JSON.stringify(bb));
}

// ---- alignFrames: center 模式 ----
{
  const W = 40, H = 40;
  const a = blank(W, H); rect(a, W, 2, 2, 11, 11, [255, 255, 0, 255]);
  const b = blank(W, H); rect(b, W, 26, 26, 35, 35, [255, 0, 255, 255]);
  const r = alignFrames([{ data: a, width: W, height: H }, { data: b, width: W, height: H }], { mode: 'center' });
  const ba = bbox(r.frames[0].data, r.canvas.width, r.canvas.height);
  const bb = bbox(r.frames[1].data, r.canvas.width, r.canvas.height);
  ok('center 模式两帧完全重合', JSON.stringify(ba) === JSON.stringify(bb), JSON.stringify(ba) + ' vs ' + JSON.stringify(bb));
}

// ---- 边界：空输入 / 单帧 / 全透明 ----
ok('空输入安全', alignFrames([]).frames.length === 0);
ok('null 输入安全', alignFrames(null).frames.length === 0);
{
  const W = 10, H = 10;
  const d = blank(W, H); rect(d, W, 3, 3, 6, 6, [1, 2, 3, 255]);
  const r = alignFrames([{ data: d, width: W, height: H }]);
  ok('单帧照常处理', r.frames.length === 1 && r.canvas.width === 4 && r.canvas.height === 4, JSON.stringify(r.canvas));
}
{
  const W = 10, H = 10;
  const e1 = blank(W, H);
  const e2 = blank(W, H); rect(e2, W, 2, 2, 5, 5, [9, 9, 9, 255]);
  const r = alignFrames([{ data: e1, width: W, height: H }, { data: e2, width: W, height: H }]);
  ok('含全透明帧不崩溃', r.frames.length === 2 && r.canvas.width >= 4);
}
ok('trimBounds 与 align 协同', (() => {
  const W = 20, H = 20;
  const d = blank(W, H); rect(d, W, 4, 6, 9, 11, [1, 1, 1, 255]);
  const b = trimBounds(d, W, H, { pad: 0 });
  return b.x === 4 && b.y === 6 && b.w === 6 && b.h === 6;
})());