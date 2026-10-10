import { ok } from './_harness.mjs';
import {
  analyzeMask, scoreMask, pickBest, decideChoice,
  COVERAGE_MIN, COVERAGE_MAX, TIE_EPSILON,
} from '../src/shared/autoselect.js';

const W = 40, H = 40, N = W * H;
// 造掩膜的辅助函数
const mk = (fn) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = fn(i % W, (i / W) | 0); return a; };
const disc = (cx, cy, r) => mk((x, y) => Math.hypot(x - cx, y - cy) <= r ? 1 : 0);

// ---------- analyzeMask：连通块 / 覆盖率 / 贴边 ----------
{
  const solid = analyzeMask(disc(20, 20, 8), W, H);
  ok('实心圆：覆盖率合理', solid.coverage > 0.1 && solid.coverage < 0.2, 'cov=' + solid.coverage.toFixed(3));
  ok('实心圆：只有 1 个连通块', solid.components === 1, 'n=' + solid.components);
  ok('实心圆：最大块占满前景', Math.abs(solid.largestRatio - 1) < 1e-6);
  ok('实心圆：不贴边', solid.edgeRatio === 0, 'edge=' + solid.edgeRatio);
  ok('实心圆：不是空的', solid.empty === false);
  ok('实心圆：包围盒正确', solid.bbox.x === 12 && solid.bbox.y === 12 && solid.bbox.w === 17, JSON.stringify(solid.bbox));
}
ok('全空掩膜：empty 标记', analyzeMask(mk(() => 0), W, H).empty === true);
ok('全空掩膜：覆盖率 0', analyzeMask(mk(() => 0), W, H).coverage === 0);
ok('全覆盖掩膜：覆盖率为 1', Math.abs(analyzeMask(mk(() => 1), W, H).coverage - 1) < 1e-9);
ok('全覆盖掩膜：贴边率 1', Math.abs(analyzeMask(mk(() => 1), W, H).edgeRatio - 1) < 1e-9);
{
  // 两个分离的块 -> 2 个连通块
  const two = mk((x, y) => (Math.hypot(x - 10, y - 10) <= 3 || Math.hypot(x - 30, y - 30) <= 3) ? 1 : 0);
  const a = analyzeMask(two, W, H);
  ok('两块分离：连通块数=2', a.components === 2, 'n=' + a.components);
  ok('两块分离：最大块占比 < 1', a.largestRatio < 1 && a.largestRatio > 0.4, a.largestRatio.toFixed(3));
}
{
  // 撒胡椒面：前景很多小块
  const noise = mk((x, y) => ((x * 7 + y * 13) % 11 === 0) ? 1 : 0);
  const a = analyzeMask(noise, W, H);
  ok('碎片图：连通块数很多', a.components > 10, 'n=' + a.components);
  ok('碎片图：最大块占比很低', a.largestRatio < 0.5, a.largestRatio.toFixed(3));
}

// ---------- 大图不爆栈（迭代式实现，不能是递归）----------
{
  const BIG = 300, bn = BIG * BIG;
  const big = new Float32Array(bn);
  for (let i = 0; i < bn; i++) big[i] = 1;   // 整块，最坏情况一次压满栈
  let threw = null;
  try { analyzeMask(big, BIG, BIG); } catch (e) { threw = e; }
  ok('300x300 全前景不爆栈（迭代而非递归）', threw === null, threw ? String(threw.message) : 'ok');
}

// ---------- scoreMask：好图得分高于坏图 ----------
{
  const good = scoreMask(disc(20, 20, 9), W, H);
  const empty = scoreMask(mk(() => 0), W, H);
  const full = scoreMask(mk(() => 1), W, H);
  const noise = scoreMask(mk((x, y) => ((x * 7 + y * 13) % 11 === 0) ? 1 : 0), W, H);
  ok('好图得分 > 0.7', good.score > 0.7, good.score.toFixed(3));
  ok('空图得分为 0', empty.score === 0);
  ok('空图给出原因', empty.reasons.length > 0, empty.reasons.join('|'));
  ok('好图 > 全图（全覆盖贴边）', good.score > full.score, `${good.score.toFixed(3)} vs ${full.score.toFixed(3)}`);
  ok('好图 > 碎片图', good.score > noise.score, `${good.score.toFixed(3)} vs ${noise.score.toFixed(3)}`);
  ok('碎片图给出原因', noise.reasons.some((r) => r.includes('碎片')), noise.reasons.join('|'));
  ok('全图给出贴边原因', full.reasons.some((r) => r.includes('边缘') || r.includes('覆盖率')), full.reasons.join('|'));
  ok('分数被夹在 0..1', good.score >= 0 && good.score <= 1);
}
{
  const tooSmall = scoreMask(disc(20, 20, 1), W, H);   // 覆盖率极低
  ok('主体过小被扣分', tooSmall.score < 0.7, tooSmall.score.toFixed(3));
}

// ---------- pickBest / decideChoice ----------
{
  const cands = [
    { id: 'good', mask: disc(20, 20, 9), w: W, h: H },
    { id: 'noise', mask: mk((x, y) => ((x * 7 + y * 13) % 11 === 0) ? 1 : 0), w: W, h: H },
    { id: 'empty', mask: mk(() => 0), w: W, h: H },
  ];
  const { best, ranked } = pickBest(cands);
  ok('pickBest 选了最好的', best.id === 'good', best.id);
  ok('ranked 按分数降序', ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score);
  ok('ranked 带上了每项细节', ranked[0].coverage !== undefined && ranked[0].components !== undefined);
  ok('空输入安全', pickBest([]).best === null && pickBest(null).best === null);
  ok('跳过畸形候选', pickBest([null, { id: 'x' }, { id: 'good', mask: disc(20,20,9), w: W, h: H }]).ranked.length === 1);
}
{
  // decideChoice：明显更好时选最高分
  const ranked = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }];
  ok('明显更好时选最高分', decideChoice(ranked).id === 'a');
  ok('并说明被选中', decideChoice(ranked).improved === true);
}
{
  // 平手（差 <= TIE_EPSILON）时优先用户手选的那个
  const d = TIE_EPSILON / 2;
  const ranked = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.9 - d }];
  ok('平手时优先用户手选', decideChoice(ranked, 'b').id === 'b', decideChoice(ranked, 'b').id);
  ok('没有手选时用最高分', decideChoice(ranked, null).id === 'a');
  ok('手选不在候选里则忽略', decideChoice(ranked, 'zzz').id === 'a');
  ok('平手理由可读', decideChoice(ranked, 'b').reason.length > 0);
}
ok('decideChoice 空输入安全', decideChoice([]).id === null && decideChoice(null).id === null);

// ---------- 常量边界 ----------
ok('覆盖率下限 < 上限', COVERAGE_MIN < COVERAGE_MAX);
ok('容差为正', TIE_EPSILON > 0);
