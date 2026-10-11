import { ok } from './_harness.mjs';
import { fitIntoCanvas, replaceFrameAt, canReplaceFrame } from '../src/shared/framereplace.js';

// ---------- fitIntoCanvas：新图必须被放进原帧画布（否则动画会抖）----------
{
  const f = fitIntoCanvas(800, 600, 128, 128);
  ok('大图被缩到画布内', f.w <= 128 && f.h <= 128, JSON.stringify(f));
  ok('保持宽高比', Math.abs(f.w / f.h - 800 / 600) < 0.05, `${f.w}/${f.h}`);
  ok('居中放置（水平留白对称）', Math.abs(f.x - (128 - f.w) / 2) <= 1, `x=${f.x} w=${f.w}`);
  ok('居中放置（垂直留白对称）', Math.abs(f.y - (128 - f.h) / 2) <= 1, `y=${f.y} h=${f.h}`);
  ok('标记已缩放', f.scaled === true);
}
{
  const f = fitIntoCanvas(128, 128, 128, 128);
  ok('同尺寸不缩放', f.scaled === false && f.w === 128 && f.h === 128);
  ok('同尺寸不留边', f.x === 0 && f.y === 0);
}
{
  // 小图允许放大到刚好填满（避免"换了一张很小的图后宠物缩水"）
  const f = fitIntoCanvas(32, 32, 128, 128);
  ok('小图被放大填满画布', f.w === 128 && f.h === 128, JSON.stringify(f));
}
{
  const f = fitIntoCanvas(1000, 100, 128, 128);
  ok('极扁图按宽适配', f.w === 128, JSON.stringify(f));
  ok('极扁图不越界', f.h <= 128 && f.x >= 0 && f.y >= 0, JSON.stringify(f));
  ok('极扁图垂直居中', Math.abs(f.y - (128 - f.h) / 2) <= 1, JSON.stringify(f));
}
ok('竖图按高适配', (() => { const f = fitIntoCanvas(100, 1000, 128, 128); return f.h === 128 && f.w <= 128; })(), JSON.stringify(fitIntoCanvas(100, 1000, 128, 128)));
ok('0 尺寸输入不产生 0 输出', (() => { const f = fitIntoCanvas(0, 0, 128, 128); return f.w >= 1 && f.h >= 1; })());
ok('非法输入安全', (() => { const f = fitIntoCanvas(null, null, null, null); return f.w >= 1 && f.h >= 1; })());

// ---------- replaceFrameAt ----------
{
  const src = ['a', 'b', 'c', 'd'];
  const r = replaceFrameAt(src, 2, 'X');
  ok('替换指定下标', r.frames.join(',') === 'a,b,X,d', r.frames.join(','));
  ok('报告已替换', r.replaced === true);
  ok('当前帧停在被替换那帧上（用户立刻看到结果）', r.activeIdx === 2, 'idx=' + r.activeIdx);
  ok('不改原数组（纯函数）', src.join(',') === 'a,b,c,d');
}
ok('替换首帧', replaceFrameAt(['a', 'b'], 0, 'X').frames.join(',') === 'X,b');
ok('替换末帧', replaceFrameAt(['a', 'b'], 1, 'X').frames.join(',') === 'X'.replace('X', 'a,X'), replaceFrameAt(['a', 'b'], 1, 'X').frames.join(','));
ok('下标越界被夹住（不崩、不产生空洞）', replaceFrameAt(['a', 'b'], 99, 'X').frames.join(',') === 'a,X');
ok('负下标被夹住', replaceFrameAt(['a', 'b'], -5, 'X').frames.join(',') === 'X,b');
ok('空数组安全', replaceFrameAt([], 0, 'X').frames.length === 0 && replaceFrameAt([], 0, 'X').replaced === false);
ok('新帧为空时不动（返回原内容）', (() => { const r = replaceFrameAt(['a', 'b'], 1, null); return r.frames.join(',') === 'a,b' && r.replaced === false; })());
ok('null 数组安全', replaceFrameAt(null, 0, 'X').frames.length === 0);
{
  // 只动一帧：其它帧的**引用**必须不变（否则改一帧会牵连别处）
  const a = { n: 'a' }, b = { n: 'b' }, c = { n: 'c' };
  const r = replaceFrameAt([a, b, c], 1, { n: 'X' });
  ok('其它帧引用保持不变', r.frames[0] === a && r.frames[2] === c);
  ok('被替换的位置是新对象', r.frames[1].n === 'X');
}

// ---------- canReplaceFrame（拖上去没反应时必须给原因）----------
ok('正常情况可替换', canReplaceFrame(['a', 'b'], 0, {}).ok === true);
ok('没有帧时不可替换并说明原因', (() => { const c = canReplaceFrame([], 0, {}); return c.ok === false && c.reason.includes('还没有帧'); })());
ok('下标越界时说明原因', (() => { const c = canReplaceFrame(['a'], 5, {}); return c.ok === false && c.reason.includes('不存在'); })());
ok('没拿到新图时说明原因', (() => { const c = canReplaceFrame(['a'], 0, null); return c.ok === false && c.reason.includes('没有拿到'); })());
ok('null 数组安全', canReplaceFrame(null, 0, {}).ok === false);
