import { ok } from './_harness.mjs';
import {
  createBehavior, pickNextState, enterState, tickBehavior, pat,
  isWalking, targetVelocityX, stateLabel, BEHAVIORS, BEHAVIOR_NAMES, hit, isReacting,
} from '../src/shared/behavior.js';

// 可复现的确定性随机源
function seq(vals) { let i = 0; return () => vals[i++ % vals.length]; }

// ---- 状态定义 ----
ok('包含 6 种状态（含挨拳击）', BEHAVIOR_NAMES.length === 6, BEHAVIOR_NAMES.join(','));
ok('含爬动状态', !!BEHAVIORS.walk && BEHAVIORS.walk.walk === true);
ok('含摸头状态', !!BEHAVIORS.pat);
ok('爬动时长下界 < 上界', BEHAVIORS.walk.minMs < BEHAVIORS.walk.maxMs);

// ---- pickNextState ----
{
  const b = createBehavior({ rng: () => 0.5 });
  const s = pickNextState(b);
  ok('返回合法状态', BEHAVIOR_NAMES.includes(s), s);
}
{
  // 权重集中到 walk 时，应大概率选 walk
  const b = createBehavior({ rng: () => 0.1, walkBias: 1, idleBias: 0, dozeBias: 0 });
  b.weights.lookAround = 0;
  ok('权重集中时选中对应状态', pickNextState(b) === 'walk', pickNextState(b));
}
{
  // 不允许打瞌睡时应排除 doze
  const b = createBehavior({ rng: () => 0.99, dozeBias: 10, idleBias: 0, walkBias: 0 });
  b.weights.lookAround = 0;
  const s = pickNextState(b, { allowDoze: false });
  ok('allowDoze=false 时排除 doze', s !== 'doze', s);
}
{
  // 不得连续两次同一状态
  const b = createBehavior({ rng: () => 0.5 });
  b.state = 'walk';
  b.lastState = 'idle';
  const s = pickNextState(b);
  ok('不重复上一状态', s !== 'idle', s);
}
{
  // 所有权重为 0 时兜底
  const b = createBehavior({ rng: () => 0.5, idleBias: 0, walkBias: 0, dozeBias: 0 });
  b.weights.lookAround = 0;
  ok('权重全 0 时兜底为 idle', pickNextState(b) === 'idle');
}

// ---- enterState / tickBehavior ----
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'walk');
  ok('进入 walk 后有剩余时间', b.remaining > 0, String(b.remaining));
  ok('walk 有方向', b.walkDir === 1 || b.walkDir === -1, String(b.walkDir));
  ok('walk 时 isWalking=true', isWalking(b) === true);
}
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  ok('idle 无方向', b.walkDir === 0);
  ok('idle 时 isWalking=false', isWalking(b) === false);
}
{
  // 推进到超时后应自动切换
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  const first = b.state;
  const switched = tickBehavior(b, b.remaining + 1);
  ok('超时后发生切换', switched === true);
  ok('切换后剩余时间 > 0', b.remaining > 0, String(b.remaining));
}
{
  // 未超时不切换
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  const before = b.state;
  ok('未超时不切换', tickBehavior(b, 10) === false);
  ok('状态保持不变', b.state === before);
}
ok('dt<=0 不推进', (() => {
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  const r = b.remaining;
  tickBehavior(b, 0);
  tickBehavior(b, -5);
  return b.remaining === r;
})());
ok('NaN dt 不破坏状态', (() => {
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  const r = b.remaining;
  tickBehavior(b, NaN);
  return b.remaining === r;
})());

// ---- pat（摸头）----
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'doze');
  ok('摸头前在打瞌睡', b.state === 'doze');
  pat(b);
  ok('摸头后立即进入 pat', b.state === 'pat', b.state);
  ok('摸头计数递增', b.patCount === 1, String(b.patCount));
  ok('pat 期间不移动', isWalking(b) === false);
  pat(b);
  ok('可连续摸头', b.patCount === 2);
}
{
  // 摸头期间推进时间不应立刻丢失 pat（时长约 0.7-0.95s）
  const b = createBehavior({ rng: () => 0.5 });
  pat(b);
  const dur = b.remaining;
  ok('pat 时长在预期区间', dur >= 700 && dur <= 950, String(dur));
  tickBehavior(b, 100);
  ok('pat 期间小步推进不切状态', b.state === 'pat', b.state);
}

// ---- targetVelocityX ----
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'walk');
  const v = targetVelocityX(b, 60);
  ok('爬动速度方向与 walkDir 一致', Math.sign(v) === b.walkDir && Math.abs(v) === 60, String(v));
}
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'idle');
  ok('发呆时速度为 0', targetVelocityX(b, 60) === 0);
}
{
  const b = createBehavior({ rng: () => 0.5 });
  pat(b);
  ok('摸头时速度为 0', targetVelocityX(b, 60) === 0);
}
ok('自定义速度生效', (() => {
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'walk');
  return Math.abs(targetVelocityX(b, 120)) === 120;
})());

// ---- stateLabel ----
{
  const b = createBehavior({ rng: () => 0.5 });
  ok('walk 标签为「爬动」', stateLabel({ state: 'walk' }) === '爬动');
  ok('pat 标签为「摸头」', stateLabel({ state: 'pat' }) === '摸头');
  ok('未知状态回退为原名', stateLabel({ state: 'zzz' }) === 'zzz');
}

// ---- 长时间运行不变量 ----
{
  const b = createBehavior({ rng: seq([0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4]) });
  enterState(b, 'idle');
  let bad = 0;
  for (let i = 0; i < 5000; i++) {
    tickBehavior(b, 100);   // 模拟 500 秒
    if (!BEHAVIOR_NAMES.includes(b.state)) bad++;
    if (!(b.remaining > 0)) bad++;
    if (b.state === 'walk' && b.walkDir === 0) bad++;
  }
  ok('长跑 500 秒状态始终合法', bad === 0, bad + ' 次异常');
}
{
  // 统计：应出现爬动（不能永远发呆）
  // 注意：必须用变化的随机源——常量 rng 会让选择稳定收敛到同一模式
  const b = createBehavior({ rng: seq([0.05, 0.55, 0.2, 0.85, 0.35, 0.65, 0.15, 0.95, 0.45, 0.75]) });
  enterState(b, 'idle');
  const seen = new Set();
  for (let i = 0; i < 3000; i++) { tickBehavior(b, 100); seen.add(b.state); }
  ok('长期运行会出现多种状态', seen.size >= 3, [...seen].join(','));
  ok('长期运行会出现爬动', seen.has('walk'), [...seen].join(','));
}

// ---- 边界避让：避免朝墙走的「原地踏步」----
{
  const b = createBehavior({ rng: () => 0.1 });
  enterState(b, 'walk', { leftEdge: true, rightEdge: false });
  ok('贴左墙时向右走', b.walkDir === 1, String(b.walkDir));
}
{
  const b = createBehavior({ rng: () => 0.9 });
  enterState(b, 'walk', { leftEdge: false, rightEdge: true });
  ok('贴右墙时向左走', b.walkDir === -1, String(b.walkDir));
}
{
  // 两侧都贴（窗口很宽时不可能，但需安全）
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'walk', { leftEdge: true, rightEdge: true });
  ok('两侧皆贴时仍有方向', b.walkDir === 1 || b.walkDir === -1, String(b.walkDir));
}
{
  // 无提示时保持随机
  const b = createBehavior({ rng: () => 0.2 });
  enterState(b, 'walk');
  ok('无提示时仍可随机', b.walkDir === -1 || b.walkDir === 1, String(b.walkDir));
}
{
  // tickBehavior 透传 edgeHint
  const b = createBehavior({ rng: () => 0.4 });
  enterState(b, 'idle');
  b.remaining = 1;
  tickBehavior(b, 100, { edgeHint: { leftEdge: true, rightEdge: false } });
  ok('tick 透传边界提示不报错', typeof b.state === 'string', b.state);
}

// ---- 挨拳击（hit）----
{
  const b = createBehavior({ rng: () => 0.5 });
  enterState(b, 'walk');
  const dir = hit(b, 1);   // 从右打来
  ok('挨拳击进入 hit 状态', b.state === 'hit', b.state);
  ok('从右打来则向左飞', dir === -1, String(dir));
  ok('受击计数递增', b.hitCount === 1, String(b.hitCount));
  ok('受击时不可行走', isWalking(b) === false);
  ok('受击时速度为 0', targetVelocityX(b, 60) === 0);
  ok('isReacting 为真', isReacting(b) === true);
}
{
  const b = createBehavior({ rng: () => 0.5 });
  const dir = hit(b, -1);   // 从左打来
  ok('从左打来则向右飞', dir === 1, String(dir));
}
{
  // fromDir=0 时随机方向
  const b = createBehavior({ rng: () => 0.2 });
  const dir = hit(b, 0);
  ok('未知来向时仍有方向', dir === 1 || dir === -1, String(dir));
}
{
  const b = createBehavior({ rng: () => 0.5 });
  hit(b, 1);
  const dur = b.remaining;
  ok('受击时长在预期区间', dur >= 520 && dur <= 620, String(dur));
  tickBehavior(b, 100);
  ok('受击期间小步推进不切状态', b.state === 'hit', b.state);
}
{
  // 受击应能打断摸头
  const b = createBehavior({ rng: () => 0.5 });
  pat(b);
  ok('先摸头', b.state === 'pat');
  hit(b, 1);
  ok('受击可打断摸头', b.state === 'hit', b.state);
}
{
  const b = createBehavior({ rng: () => 0.5 });
  pat(b); hit(b, 1); pat(b);
  ok('摸头/受击计数互不干扰', b.patCount === 2 && b.hitCount === 1, 'pat=' + b.patCount + ' hit=' + b.hitCount);
}
{
  // 受击后应能自然恢复
  const b = createBehavior({ rng: () => 0.5 });
  hit(b, 1);
  tickBehavior(b, 700);
  ok('受击后自动恢复', b.state !== 'hit', b.state);
}
{
  ok('BEHAVIORS 含 hit', !!BEHAVIORS.hit && BEHAVIORS.hit.label === '挨拳击');
  ok('isReacting 对 walk 为假', (() => { const x = createBehavior({ rng: () => 0.5 }); enterState(x, 'walk'); return isReacting(x) === false; })());
}
