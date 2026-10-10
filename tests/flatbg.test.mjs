import { ok } from './_harness.mjs';
import { looksLikeFlatBackground } from '../src/shared/imageops.js';

function makeImg(w, h, bgFn, fgFn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = (fgFn && fgFn(x, y)) ? [255, 140, 60, 255] : bgFn(x, y);
    d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=c[3];
  }
  return d;
}
const W = 160, H = 160;
const blob = (x, y) => Math.hypot(x - W/2, y - H/2) < 45;

// ---------- 应该自动抠图（平坦 / 渐变背景） ----------
const should = [
  ['纯白', (x,y)=>[255,255,255,255]],
  ['纯灰', (x,y)=>[200,200,200,255]],
  ['纯黑', (x,y)=>[10,10,12,255]],
  ['浅色渐变（墙面/天空）', (x,y)=>[240-Math.round(x/W*30),242-Math.round(y/H*30),248-Math.round(y/H*20),255]],
  ['明显渐变（光照不均）', (x,y)=>[250-Math.round(x/W*90),250-Math.round(y/H*80),250-Math.round((x+y)/(W+H)*90),255]],
  ['深色渐变', (x,y)=>[20+Math.round(x/W*40),22+Math.round(y/H*40),30+Math.round(x/W*30),255]],
];
for (const [name, bg] of should) {
  const r = looksLikeFlatBackground(makeImg(W,H,bg,blob), W, H);
  ok('应抠图：' + name, r.ok === true, `${r.reason} ${JSON.stringify(r.stats)}`);
}

// ---------- 不应自动抠图（杂乱 / 已透明） ----------
const shouldNot = [
  // 桌面+墙的"硬分界"：左右两条边会跨越分界产生强跳变 -> 不应自动抠
  ['上下两段（硬分界）', (x,y)=> y<H*0.5?[235,235,238,255]:[180,170,160,255]],
  ['噪点杂乱背景', (x,y)=>[100+((x*7+y*13)%150),110+((x*11+y*5)%140),120+((x*3+y*17)%130),255]],
  ['高对比条纹', (x,y)=> ((x>>3)+(y>>3))%2 ? [40,40,40,255] : [240,240,240,255]],
];
for (const [name, bg] of shouldNot) {
  const r = looksLikeFlatBackground(makeImg(W,H,bg,blob), W, H);
  ok('不应抠图：' + name, r.ok === false, `${r.reason} ${JSON.stringify(r.stats)}`);
}
// 全透明 = 已经抠好，不能重复抠
{
  const d = new Uint8ClampedArray(W*H*4);   // 全透明
  const r = looksLikeFlatBackground(d, W, H);
  ok('不应抠图：全透明图（已抠好）', r.ok === false, r.reason);
}

// ---------- 容错 ----------
ok('无数据安全', looksLikeFlatBackground(null, 10, 10).ok === false);
ok('尺寸为 0 安全', looksLikeFlatBackground(new Uint8ClampedArray(16), 0, 0).ok === false);
ok('极小图不崩且能给出结论', (() => {
  const d = new Uint8ClampedArray(4*4*4).fill(255);
  const r = looksLikeFlatBackground(d, 4, 4);
  return typeof r.ok === 'boolean' && typeof r.reason === 'string';
})());
ok('样本不足时必须拒绝（宁可不动，也不要误抠）', (() => {
  // 1x1：四条边去重后只有 1 个采样点，远低于 8 的下限
  const d = new Uint8ClampedArray(1*1*4).fill(255);
  const r = looksLikeFlatBackground(d, 1, 1);
  return r.ok === false && r.reason === 'too-few-samples';
})());
ok('2x2 纯色小图判为可抠（采样恰好达标，行为合理）', (() => {
  const d = new Uint8ClampedArray(2*2*4).fill(255);
  return looksLikeFlatBackground(d, 2, 2).ok === true;
})());

// ---------- 关键回归：浅色渐变必须能过（这是本轮修的缺陷） ----------
{
  const bg = (x,y)=>[240-Math.round(x/W*30),242-Math.round(y/H*30),248-Math.round(y/H*20),255];
  const r = looksLikeFlatBackground(makeImg(W,H,bg,blob), W, H);
  ok('回归：浅色渐变不再被误判为复杂背景', r.ok === true, 'adjAvg=' + r.stats.adjAvg);
  ok('回归：浅色渐变的相邻差很小', r.stats.adjAvg < 10, 'adjAvg=' + r.stats.adjAvg);
}

// ---------- 按边分组：跨边相接不能污染判定（这是实现里踩过的坑） ----------
{
  // 上边纯白、下边纯黑（跨边差极大），但每条边内部都是纯色 -> 仍应判定为可抠
  const bg = (x,y)=> y < H/2 ? [255,255,255,255] : [0,0,0,255];
  const r = looksLikeFlatBackground(makeImg(W,H,bg,blob), W, H);
  // 注意：这个用例的左右两条边跨越了白/黑强分界，边内跳变极大（实测 765）。
// 这种"硬边两段背景"本来就不该被当作平坦背景（否则会把主体也一起归入背景）。
// 之前我把断言写反了 —— 实现是对的，测试错了。
ok('硬边两段背景应被拒绝（边内有强跳变）', r.ok === false, `adjAvg=${r.stats.adjAvg} adjMax=${r.stats.adjMax}`);
}
