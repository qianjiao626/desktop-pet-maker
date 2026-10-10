import { ok } from './_harness.mjs';
import {
  analyzeMask, scoreMask, pickBest, decideChoice, shouldStopEarly, orderBySpeed,
  GOOD_ENOUGH, TIE_EPSILON,
} from '../src/shared/autoselect.js';

const W = 40, H = 40, N = W * H;
const mk = (fn) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = fn(i % W, (i / W) | 0); return a; };
const disc = (r) => mk((x, y) => Math.hypot(x - 20, y - 20) <= r ? 1 : 0);

// ---------- 提前收手（性能关键路径）----------
// 背景：三模型全跑 ~2.4s/帧，20 张图就是 ~50s。够干净就该停。
ok('分数够高就停手', shouldStopEarly([{ id: 'a', score: 0.97 }], 1, 3).stop === true);
ok('停手时给出可读原因', shouldStopEarly([{ id: 'a', score: 0.97 }], 1, 3).reason.includes('干净'));
ok('分数不够就不停', shouldStopEarly([{ id: 'a', score: 0.5 }], 1, 3).stop === false);
ok('刚好等于阈值也停（>= 语义）', shouldStopEarly([{ id: 'a', score: GOOD_ENOUGH }], 1, 3).stop === true);
ok('差一点点就继续跑', shouldStopEarly([{ id: 'a', score: GOOD_ENOUGH - 0.001 }], 1, 3).stop === false);
ok('已经跑完全部时停手', shouldStopEarly([{ id: 'a', score: 0.1 }], 3, 3).stop === true);
ok('alwaysFull 时不提前收手', shouldStopEarly([{ id: 'a', score: 0.99 }], 1, 3, { alwaysFull: true }).stop === false);
ok('空输入安全（不停）', shouldStopEarly([], 0, 3).stop === false && shouldStopEarly(null, 0, 3).stop === false);
ok('可自定义阈值', shouldStopEarly([{ id: 'a', score: 0.7 }], 1, 3, { goodEnough: 0.6 }).stop === true);
ok('取最高分判断（不是随便一个）', shouldStopEarly([{ id: 'a', score: 0.99 }, { id: 'b', score: 0.1 }], 2, 3).stop === true);

// ---------- 按速度排序 ----------
{
  const size = (id) => ({ fast: 320, slow: 1024, mid: 512 })[id];
  const o = orderBySpeed(['slow', 'fast', 'mid'], size);
  ok('按输入尺寸从小到大排序（先快后慢）', o.join(',') === 'fast,mid,slow', o.join(','));
  // 关键不变量：不能改动调用方传入的数组（原地 sort 会污染候选列表）
  const src = ['slow', 'fast'];
  orderBySpeed(src, size);
  ok('orderBySpeed 不改原数组（纯函数）', src.join(',') === 'slow,fast', src.join(','));
}
ok('未知尺寸排在最后', orderBySpeed(['a', 'b'], (x) => x === 'a' ? 0 : 99999)[0] === 'a');
ok('无 sizeOf 也不崩', orderBySpeed(['a', 'b']).length === 2);
ok('orderBySpeed 空输入安全', orderBySpeed(null).length === 0);

// ---------- 提前收手与全跑的质量差距必须可接受（这是该优化的正当性依据）----------
// 用真实评分函数构造场景：silueta 已经很好，isnet 只领先一丁点。
{
  const good = scoreMask(disc(9), W, H);          // 代表 silueta（够干净）
  ok('代表性好图分数 >= GOOD_ENOUGH', good.score >= GOOD_ENOUGH, good.score.toFixed(3));
  const ranked = [{ id: 'silueta', score: good.score }, { id: 'isnet', score: Math.min(1, good.score + 0.004) }];
  const d = shouldStopEarly(ranked, 1, 2);
  ok('榜首够好即停手（哪怕另一个略高）', d.stop === true, d.reason);
  const gap = ranked[1].score - ranked[0].score;
  ok('此时质量差距在「分不出来」范围内（<= TIE_EPSILON）', gap <= TIE_EPSILON, gap.toFixed(4));
}

// ---------- 既有行为不能被破坏 ----------
{
  const cands = [{ id: 'good', mask: disc(9), w: W, h: H }, { id: 'empty', mask: mk(() => 0), w: W, h: H }];
  ok('pickBest 仍正常', pickBest(cands).best.id === 'good');
  ok('decideChoice 仍正常（明显更好）', decideChoice(pickBest(cands).ranked).id === 'good');
  ok('decideChoice 平手仍优先手选', decideChoice([{ id: 'a', score: 0.9 }, { id: 'b', score: 0.895 }], 'b').id === 'b');
}
