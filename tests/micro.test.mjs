import { ok } from './_harness.mjs';
import {
  MICRO_MOTIONS, DEFAULT_MOTION, findMotion, zeroPose, microSequence,
  amplitudeCheck, microLoopClosure, isLooping, MAX_MICRO_AMPLITUDE,
} from '../src/shared/micro.js';

// ---------- 动作库结构 ----------
ok('微动作数 >= 4', MICRO_MOTIONS.length >= 4, 'n=' + MICRO_MOTIONS.length);
ok('每个都有 id/name/emoji/desc/pose', MICRO_MOTIONS.every((m) => m.id && m.name && m.emoji && m.desc && typeof m.pose === 'function'));
ok('id 不重复', new Set(MICRO_MOTIONS.map((m) => m.id)).size === MICRO_MOTIONS.length);
ok('findMotion 能取到', findMotion('breathe') !== null);
ok('未知 id 返回 null', findMotion('nope') === null);
ok('默认动作存在', findMotion(DEFAULT_MOTION) !== null, DEFAULT_MOTION);

// ---------- 核心约束：必须是「微」动作 ----------
// 这条最关键：大动作在这个素材条件下必然穿帮（拉成面条，实测失败过）。
// 如果有人往库里塞大动作，这个测试必须拦住。
ok('幅度上限很小（<= 0.13 弧度 ≈ 7.5°）', MAX_MICRO_AMPLITUDE <= 0.13, String(MAX_MICRO_AMPLITUDE));
for (const m of MICRO_MOTIONS) {
  const seq = microSequence(m.id, { frames: 12 });
  const ac = amplitudeCheck(seq);
  ok(`「${m.name}」幅度在微动作范围内`, ac.ok, `最大 ${(ac.worst * 180 / Math.PI).toFixed(1)}° (${ac.field})`);
  ok(`「${m.name}」确实有动作（不是静止）`, ac.worst > 0.005, 'worst=' + ac.worst.toFixed(4));
}

// ---------- zeroPose：字段必须与 boneAngles 对齐 ----------
{
  const z = zeroPose();
  ok('零姿态所有角度为 0', Object.values(z).every((v) => v === 0), JSON.stringify(z));
  for (const k of ['spine', 'neck', 'leftUpperArm', 'leftForeArm', 'rightUpperArm', 'rightForeArm', 'leftThigh', 'leftShin', 'rightThigh', 'rightShin']) {
    ok('零姿态含 ' + k, k in z);
  }
  ok('零姿态含 bobY', 'bobY' in z);
}

// ---------- microSequence ----------
{
  const seq = microSequence('breathe', { frames: 12 });
  ok('生成 12 帧', seq.length === 12, 'n=' + seq.length);
  const keys = Object.keys(zeroPose());
  ok('每帧字段补齐（缺字段会让渲染拿到 undefined）', seq.every((p) => keys.every((k) => typeof p[k] === 'number')));
  ok('所有值有限（NaN 会画出空白）', seq.every((p) => keys.every((k) => Number.isFinite(p[k]))));
}
ok('未知动作退回默认', microSequence('nope', { frames: 8 }).length === 8);
ok('帧数下限 4', microSequence('breathe', { frames: 1 }).length === 4);
ok('帧数上限 48', microSequence('breathe', { frames: 999 }).length === 48);
ok('无参数可用', microSequence().length >= 4);

// ---------- 循环平滑性（循环动作最容易翻车的地方）----------
for (const m of MICRO_MOTIONS) {
  const seq = microSequence(m.id, { frames: 12 });
  const lc = microLoopClosure(seq);
  const limit = isLooping(m.id) ? 0.06 : 0.12;
  ok(`「${m.name}」相邻帧无突兀跳变`, lc.ok || lc.worst <= limit, `最大跳变 ${(lc.worst * 180 / Math.PI).toFixed(2)}° (${lc.field})`);
}

// ---------- 循环 vs 一次性 ----------
{
  ok('呼吸是循环动作', isLooping('breathe') === true);
  ok('抖一下是一次性动作', isLooping('wiggle') === false);
  // 一次性动作应当收尾归零（否则播完停在半路）
  const w = microSequence('wiggle', { frames: 12 });
  const last = w[w.length - 1];
  const keys = Object.keys(zeroPose());
  const maxTail = Math.max(...keys.map((k) => Math.abs(last[k])));
  ok('抖一下末帧幅度很小（收尾归零）', maxTail < 0.02, '末帧最大=' + maxTail.toFixed(4));
}

// ---------- microLoopClosure 本身要能抓出不闭合 ----------
{
  const bad = [{ ...zeroPose(), spine: 0 }, { ...zeroPose(), spine: 0.5 }];
  const lc = microLoopClosure(bad);
  ok('能检出跳变', lc.ok === false);
  ok('报出跳变字段', lc.field === 'spine', String(lc.field));
  ok('报出跳变数值', Math.abs(lc.worst - 0.5) < 1e-9, String(lc.worst));
  ok('帧数不足时安全', microLoopClosure([zeroPose()]).ok === false && microLoopClosure([]).ok === false && microLoopClosure(null).ok === false);
  ok('容差可调', microLoopClosure([{ ...zeroPose(), spine: 0 }, { ...zeroPose(), spine: 0.5 }], 0.6).ok === true);
}

// ---------- amplitudeCheck 能抓出大动作 ----------
{
  const big = [{ ...zeroPose(), leftUpperArm: 2.0 }];
  const ac = amplitudeCheck(big);
  ok('能检出超限动作', ac.ok === false);
  ok('报出超限字段与数值', ac.field === 'leftUpperArm' && Math.abs(ac.worst - 2.0) < 1e-9);
  ok('恰好等于上限算通过（<= 语义）', amplitudeCheck([{ ...zeroPose(), spine: MAX_MICRO_AMPLITUDE }]).ok === true);
}

// ---------- 动作之间有区别（不能是同一个换名字）----------
{
  const sig = MICRO_MOTIONS.map((m) => JSON.stringify(microSequence(m.id, { frames: 8 })));
  ok('各动作序列互不相同', new Set(sig).size === MICRO_MOTIONS.length, 'unique=' + new Set(sig).size);
}

// ---------- 桌面场景该有的动作都在 ----------
{
  const ids = MICRO_MOTIONS.map((m) => m.id);
  for (const want of ['breathe', 'sway', 'nod']) {
    ok('含待机基本动作 ' + want, ids.includes(want), ids.join(','));
  }
}
