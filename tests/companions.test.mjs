import { ok } from './_harness.mjs';
import {
  NEAR_RATIO, nearestNeighbor, reactToNeighbor, yieldDirection, gazeAt, closePairs,
} from '../src/shared/companions.js';

const P = (id, x, y, w = 100, h = 100) => ({ id, x, y, w, h });

// ---------- nearestNeighbor ----------
{
  const self = P('me', 0, 0);
  ok('没有别的宠物返回 null', nearestNeighbor(self, []) === null);
  ok('null 也不炸', nearestNeighbor(self, null) === null);
  const n = nearestNeighbor(self, [P('a', 500, 500), P('b', 120, 0), P('c', 700, 0)]);
  ok('挑出最近的那只', n && n.pet.id === 'b', n && n.pet.id);
  ok('给出了距离', n && n.dist > 0, n && String(n.dist));
  ok('不把自己算进去', nearestNeighbor(self, [self, P('x', 10, 0)]).pet.id === 'x');
}
{
  // 用中心点而不是左上角：尺寸不同的宠物才可比
  const self = P('me', 0, 0, 100, 100);             // 中心 (50,50)
  const n = nearestNeighbor(self, [P('big', 0, 0, 400, 100)]);   // 中心 (200,50)
  ok('用中心点算距离', n && Math.abs(n.dx - 150) < 1, n && String(n.dx));
}
{
  const self = P('me', 0, 0);
  // 阈值是 avgW * 1.1 = 110：dx=200 属于"分开两格"，不算靠近；dx=60 才算。
  const n = nearestNeighbor(self, [P('a', 60, 0)]);
  ok('横向靠近时 near=true', n.near === true, JSON.stringify(n && { dx: n.dx, near: n.near }));
  const n2 = nearestNeighbor(self, [P('a', 200, 0)]);
  ok('横向隔开一格时 near=false', n2.near === false, JSON.stringify(n2 && { dx: n2.dx, near: n2.near }));
  const far = nearestNeighbor(self, [P('a', 2000, 0)]);
  ok('横向很远时 near=false', far.near === false, JSON.stringify({ dx: far.dx, near: far.near }));
  const above = nearestNeighbor(self, [P('a', 0, 2000)]);
  ok('纵向很远时 near=false', above.near === false, JSON.stringify({ dy: above.dy, near: above.near }));
}
{
  ok('坏数据被跳过（不崩）', nearestNeighbor(P('me', 0, 0), [null, {}, { id: '' }, 5]) === null);
  ok('缺失尺寸不崩', nearestNeighbor(P('me', 0, 0), [{ id: 'a', x: 10, y: 10 }]) !== null);
}

// ---------- reactToNeighbor ----------
{
  const self = P('me', 0, 0);
  const r = reactToNeighbor({ self, others: [P('a', 5000, 0)], now: 10000, lastReact: 0 });
  ok('离得远时没反应', r.none === true && r.reason === '离得还远', JSON.stringify(r));
  const r2 = reactToNeighbor({ self, others: [], now: 10000 });
  ok('没邻居时没反应', r2.none === true, JSON.stringify(r2));
}
{
  const self = P('me', 0, 0);
  const r = reactToNeighbor({ self, others: [P('a', 60, 0)], now: 10000, lastReact: 0, rng: () => 0 });
  ok('很近且有随机数命中时会有反应', r.none !== true, JSON.stringify(r));
  ok('反应带动作名', typeof r.action === 'string' && r.action.length > 0, r.action);
  ok('反应带对方 id', r.otherId === 'a', String(r.otherId));
  ok('反应带方向', Number.isFinite(r.dx), String(r.dx));
}
{
  // 冷却：刚反应过就不再反应
  const self = P('me', 0, 0);
  const r = reactToNeighbor({ self, others: [P('a', 10, 0)], now: 1000, lastReact: 900, cooldownMs: 8000, rng: () => 0 });
  ok('冷却期内不反应', r.none === true && r.reason === '冷却中', JSON.stringify(r));
  const r2 = reactToNeighbor({ self, others: [P('a', 10, 0)], now: 10000, lastReact: 900, cooldownMs: 8000, rng: () => 0 });
  ok('冷却结束会反应', r2.none !== true, JSON.stringify(r2));
  const r3 = reactToNeighbor({ self, others: [P('a', 10, 0)], now: 5000, lastReact: 0, cooldownMs: 8000, rng: () => 0 });
  ok('第一次（lastReact=0）不受冷却限制', r3.none !== true, JSON.stringify(r3));
}
{
  // 越近越容易反应：用同一个随机数，远处不反应、近处反应
  const self = P('me', 0, 0);
  const rng = () => 0.6;
  const far = reactToNeighbor({ self, others: [P('a', 105, 0)], now: 99999, lastReact: 0, rng });
  const close = reactToNeighbor({ self, others: [P('a', 5, 0)], now: 99999, lastReact: 0, rng });
  ok('同样随机数下，贴得近才会反应', close.none !== true && far.none === true,
    JSON.stringify({ far: far.reason || far.action, close: close.reason || close.action }));
}
{
  // 上下重叠 -> 倾向于 hop / greet
  const self = P('me', 0, 0);
  const r = reactToNeighbor({ self, others: [P('a', 5, 100)], now: 99999, lastReact: 0, rng: () => 0 });
  ok('上下相邻时给的是 hop 或 greet', r.action === 'hop' || r.action === 'greet', String(r.action));
}
{
  // 随机源越界/异常都要兜住
  // 注意：有反应时 r.none 是 undefined（不是 false），所以不能断言 typeof === 'boolean'。
  // 只要"没抛异常且返回带动作或带 none"就算通过。
  const nanR = reactToNeighbor({ self: P('me', 0, 0), others: [P('a', 1, 0)], now: 1e9, rng: () => NaN });
  ok('rng 返回 NaN 不崩且有合理结果', !!(nanR && (nanR.action || nanR.none)), JSON.stringify(nanR));
  const fnR = reactToNeighbor({ self: P('me', 0, 0), others: [P('a', 1, 0)], now: 1e9, rng: 7 });
  ok('rng 不是函数不崩且有合理结果', !!(fnR && (fnR.action || fnR.none)), JSON.stringify(fnR));
  ok('self 缺失不崩', reactToNeighbor({ others: [P('a', 1, 0)], now: 1e9 }).none === true);
}

// ---------- yieldDirection / gazeAt ----------
{
  const self = P('me', 0, 0);
  ok('对方在右边 -> 往左让', yieldDirection(self, P('a', 60, 0)) === -1, String(yieldDirection(self, P('a', 60, 0))));
  ok('对方在左边 -> 往右让', yieldDirection(self, P('a', -160, 0)) === 1, String(yieldDirection(self, P('a', -160, 0))));
  ok('对方很远 -> 不让', yieldDirection(self, P('a', 5000, 0)) === 0, String(yieldDirection(self, P('a', 5000, 0))));
  ok('没有对方 -> 不让', yieldDirection(self, null) === 0);
}
{
  const self = P('me', 0, 0);
  const g = gazeAt(self, P('a', 200, 0));
  ok('gaze 给出看向的方向', g.dx > 0 && Number.isFinite(g.reach), JSON.stringify(g));
  ok('gaze 的 reach 有上限（不无限远）', g.reach <= 260, String(g.reach));
  ok('没有对方时 gaze 为零', gazeAt(self, null).dx === 0 && gazeAt(self, null).reach === 0);
}

// ---------- closePairs ----------
{
  const pets = [P('a', 0, 0), P('b', 30, 0), P('c', 3000, 0)];
  const pairs = closePairs(pets, { maxDist: 120 });
  ok('找出挨得近的那一对', pairs.length === 1 && pairs[0].a === 'a' && pairs[0].b === 'b', JSON.stringify(pairs));
  ok('给了距离', pairs[0].dist > 0, String(pairs[0].dist));
  ok('远的不会成对', !pairs.some((p) => p.a === 'c' || p.b === 'c'), JSON.stringify(pairs));
  ok('空数组返回空', closePairs([]).length === 0);
  ok('非数组返回空', closePairs(null).length === 0);
  ok('坏数据被跳过', closePairs([null, {}, P('a', 0, 0)]).length === 0);
  ok('三只挤在一起时给出 3 对', closePairs([P('a', 0, 0), P('b', 10, 0), P('c', 20, 0)], { maxDist: 200 }).length === 3);
}
{
  // NEAR_RATIO 是个可调的常量，别被改成 0 之类的
  ok('NEAR_RATIO 是合理正数', NEAR_RATIO > 0.3 && NEAR_RATIO < 5, String(NEAR_RATIO));
}
