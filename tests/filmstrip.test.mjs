import { ok } from './_harness.mjs';
import { visibleWindow, thumbSize, dropTarget, insertIndexAt, stripLabel, THUMB_MAX_EDGE } from '../src/shared/filmstrip.js';

// ---------- visibleWindow：帧多时只渲染可视部分 ----------
ok('没有帧时窗口为空', (() => { const w = visibleWindow(0, 0, 6); return w.indices.length === 0 && w.start === 0 && w.end === 0; })());
ok('帧数少于窗口大小时全显示', (() => { const w = visibleWindow(3, 1, 6); return w.indices.join(',') === '0,1,2'; })());
ok('帧数等于窗口大小也全显示', visibleWindow(6, 3, 6).indices.join(',') === '0,1,2,3,4,5');
{
  const w = visibleWindow(20, 5, 6);
  ok('当前帧在可视范围内', w.indices.includes(5), w.indices.join(','));
  ok('窗口大小固定', w.indices.length === 6, 'n=' + w.indices.length);
  ok('窗口连续', w.indices.every((v, i) => i === 0 || v === w.indices[i - 1] + 1));
}
{
  // 当前帧在最开头 -> 窗口要贴左，不能留空
  const w = visibleWindow(20, 0, 6);
  ok('当前帧在开头时贴左（无空白）', w.start === 0 && w.indices[0] === 0, w.start + '');
}
{
  const w = visibleWindow(20, 19, 6);
  ok('当前帧在末尾时贴右（无空白）', w.end === 20 && w.indices[w.indices.length - 1] === 19, JSON.stringify(w));
}
{
  // 所有下标的当前帧都必须落在窗口内（扫一遍，防边界错）
  let bad = 0;
  for (let a = 0; a < 20; a++) { const w = visibleWindow(20, a, 6); if (!w.indices.includes(a)) bad++; }
  ok('任意当前帧都落在窗口内', bad === 0, 'bad=' + bad);
}
ok('viewCount 为 1 也能用', visibleWindow(10, 4, 1).indices.join(',') === '4');
ok('越界的 activeIdx 被夹住', visibleWindow(10, 999, 4).indices.includes(9));
ok('负数 activeIdx 被夹住', visibleWindow(10, -5, 4).indices.includes(0));
ok('非法输入安全', visibleWindow(null, null, null).indices.length === 0);

// ---------- thumbSize：缩略图不能按原图渲染 ----------
ok('大图缩到最长边上限', (() => { const s = thumbSize(1600, 900); return Math.max(s.w, s.h) === THUMB_MAX_EDGE; })(), JSON.stringify(thumbSize(1600, 900)));
ok('小图不放大（避免糊）', (() => { const s = thumbSize(40, 40); return s.w === 40 && s.h === 40; })());
ok('保持宽高比', (() => { const s = thumbSize(1600, 900); return Math.abs(s.w / s.h - 1600 / 900) < 0.05; })(), JSON.stringify(thumbSize(1600, 900)));
ok('竖图也按最长边缩', (() => { const s = thumbSize(300, 1200); return s.h === THUMB_MAX_EDGE; })(), JSON.stringify(thumbSize(300, 1200)));
ok('极端扁图不会得到 0 尺寸', (() => { const s = thumbSize(1000, 1); return s.w >= 1 && s.h >= 1; })());
ok('0 尺寸输入安全', (() => { const s = thumbSize(0, 0); return s.w >= 1 && s.h >= 1; })());
ok('可自定义上限', thumbSize(200, 200, 20).w === 20);

// ---------- dropTarget：拖动排序的下标换算（最容易错）----------
ok('插到最前', dropTarget(2, 0, 5) === 0);
ok('插到最后', dropTarget(2, 5, 5) === 4);
ok('插到自己位置上（前）= 不动', dropTarget(2, 2, 5) === null);
ok('插到自己后面（后）= 不动', dropTarget(2, 3, 5) === null);
{
  // 关键：落在自己之后时，目标下标要减 1（因为自己先被抽走）
  const t = dropTarget(1, 4, 5);
  ok('落在自己之后时下标左移一位', t === 3, 'to=' + t);
}
ok('落在自己之前时不减', dropTarget(3, 0, 5) === 0);
ok('单帧不产生拖动', dropTarget(0, 1, 1) === null);
ok('无帧不产生拖动', dropTarget(0, 0, 0) === null);
ok('越界 from 被夹住', dropTarget(99, 0, 5) === 0);
ok('越界 insertAt 被夹住', dropTarget(0, 99, 5) === 4);
ok('非法输入安全', dropTarget(null, null, 5) === null);

// ---------- insertIndexAt：鼠标位置 -> 插入点 ----------
{
  const rects = [{ left: 0, right: 100 }, { left: 100, right: 200 }, { left: 200, right: 300 }];
  ok('最左边 -> 插到 0', insertIndexAt(-10, rects) === 0);
  ok('第一个格子左半 -> 0', insertIndexAt(20, rects) === 0);
  ok('第一个格子右半 -> 1', insertIndexAt(80, rects) === 1);
  ok('中间 -> 2', insertIndexAt(150, rects) === 2);
  ok('最右边之后 -> n', insertIndexAt(999, rects) === 3);
}
ok('空 rects 返回 0', insertIndexAt(50, []) === 0 && insertIndexAt(50, null) === 0);
ok('rects 含 null 也不崩', insertIndexAt(50, [null, { left: 0, right: 100 }]) >= 0);

// ---------- stripLabel ----------
ok('标题显示当前位置', stripLabel(0, 5) === '帧 1/5', stripLabel(0, 5));
ok('标题末帧正确', stripLabel(4, 5) === '帧 5/5');
ok('无帧时给出提示', stripLabel(0, 0) === '还没有帧');
ok('越界下标被夹住', stripLabel(99, 5) === '帧 5/5' && stripLabel(-3, 5) === '帧 1/5');
