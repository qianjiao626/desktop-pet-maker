import { ok } from './_harness.mjs';
import {
  BEHAVIORS, createBehavior, enterState, hopPose, pickNextState, tickBehavior,
  targetVelocityX, isWalking, isReacting, stateLabel,
} from '../src/shared/behavior.js';

// ---------- hop 状态已注册 ----------
ok('BEHAVIORS 含 hop', !!BEHAVIORS.hop);
ok('hop 标签为「跳跃」', BEHAVIORS.hop.label === '跳跃');
ok('hop 不产生水平行走', BEHAVIORS.hop.walk === false);

// ---------- enterState 记录 duration（跳跃进度依赖它）----------
const b = createBehavior({ rng: () => 0.5 });
enterState(b, 'hop');
ok('进入 hop 后 state 正确', b.state === 'hop');
ok('duration 被记录且等于 remaining', b.duration === b.remaining, 'dur=' + b.duration + ' rem=' + b.remaining);
ok('hop 时长在 620~760ms', b.duration >= 620 && b.duration <= 760, 'dur=' + b.duration);
ok('hop 不走路（walkDir=0）', b.walkDir === 0);

// ---------- hopPose 三段曲线 ----------
const mk = (remaining, duration) => ({ state: 'hop', remaining, duration });
const total = 700;
ok('非 hop 状态返回 null', hopPose({ state: 'idle', remaining: 100, duration: 700 }) === null);
ok('duration 为 0 时返回 null（防除零）', hopPose({ state: 'hop', remaining: 0, duration: 0 }) === null);

const at = (t) => hopPose(mk(Math.round(total * (1 - t)), total));
const p0 = at(0), p10 = at(0.10), p45 = at(0.45), p72 = at(0.72), p86 = at(0.86), p100 = at(0.9999);
ok('起始抬升接近 0', p0.lift < 0.02, 'lift=' + p0.lift.toFixed(3));
ok('起跳瞬间拉伸系数为 1（尚未拉长）', Math.abs(p0.stretch - 1) < 1e-9, 'stretch=' + p0.stretch.toFixed(3));
ok('起跳过程会拉长（蓄力）', p10.stretch > 1.0, 'stretch=' + p10.stretch.toFixed(3));
ok('滞空中段明显抬高', p45.lift > 0.8, 'lift=' + p45.lift.toFixed(3));
ok('最高点不超过 1', Math.max(...[0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1].map(t => at(t).lift)) <= 1.0001);
ok('抬升全程非负', [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].every(t => at(t).lift >= 0));
ok('落地前抬升回到低位', p100.lift < 0.05, 'lift=' + p100.lift.toFixed(3));
ok('落地时纵向压扁', p86.squash < 1.0, 'squash=' + p86.squash.toFixed(3));
ok('压扁幅度合理（不夸张变形）', p86.squash > 0.8, 'squash=' + p86.squash.toFixed(3));
ok('滞空时不压扁', p45.squash === 1);
ok('滞空时略微拉长', p45.stretch >= 1.0);
ok('t 被夹在 0..1（remaining 越界也安全）', (() => {
  const a = hopPose({ state: 'hop', remaining: -100, duration: 700 });
  const c = hopPose({ state: 'hop', remaining: 99999, duration: 700 });
  return a.t === 1 && c.t === 0;
})(), '越界安全');

// 曲线连续性：相邻采样不应跳变
let maxJump = 0;
let prev = at(0);
for (let i = 1; i <= 50; i++) {
  const cur = at(i / 50);
  maxJump = Math.max(maxJump, Math.abs(cur.lift - prev.lift));
  prev = cur;
}
ok('抬升曲线连续（无突变）', maxJump < 0.12, 'maxΔ=' + maxJump.toFixed(3));

// ---------- 不破坏既有行为 ----------
ok('未注册状态仍安全', BEHAVIORS.nope === undefined);
ok('stateLabel 对 hop 返回「跳跃」', stateLabel({ state: 'hop' }) === '跳跃');
ok('stateLabel 对未知状态回退原名', stateLabel({ state: 'xyz' }) === 'xyz');
ok('hop 不算行走', isWalking({ state: 'hop', walkDir: 0 }) === false);
ok('hop 不算被打断态（可自然结束）', isReacting({ state: 'hop' }) === false);
ok('hop 的目标速度为 0', targetVelocityX({ state: 'hop', walkDir: 0 }, 60) === 0);

// ---------- 权重：hop 有机会被选中，且 doze 仍可被禁用 ----------
const rngLow = createBehavior({ rng: () => 0 });
ok('hop 在权重表里（默认权重 > 0）', rngLow.weights.hop > 0, 'w=' + rngLow.weights.hop);
let sawHop = false;
for (let i = 0; i < 400; i++) {
  const bb = createBehavior({ rng: () => i / 400 });
  bb.lastState = 'idle';
  if (pickNextState(bb, { allowDoze: false }) === 'hop') { sawHop = true; break; }
}
ok('随机挑选能选中 hop', sawHop);

// doze 禁用时不应挑到 doze（回归保护）
let sawDoze = false;
for (let i = 0; i < 200; i++) {
  const bb = createBehavior({ rng: () => i / 200 });
  bb.lastState = 'idle';
  if (pickNextState(bb, { allowDoze: false }) === 'doze') { sawDoze = true; break; }
}
ok('allowDoze=false 时不会挑到 doze', sawDoze === false);

// ---------- tick 能正常切出 hop ----------
const t = createBehavior({ rng: () => 0.3 });
enterState(t, 'hop');
const switched = tickBehavior(t, t.remaining + 10, { allowDoze: false });
ok('hop 结束后自动切换状态', switched === true && t.state !== 'hop', 'state=' + t.state);
