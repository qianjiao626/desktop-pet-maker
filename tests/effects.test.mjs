import { ok } from './_harness.mjs';
import { handState, fistState, HAND_DURATION, FIST_DURATION } from '../src/shared/effects.js';

// 取一系列进度点
const samples = (fn, n = 21, ...rest) => Array.from({ length: n }, (_, i) => fn(i / (n - 1), ...rest));

// ============ 摸头的手 ============
{
  const s0 = handState(0);
  ok('手: 起始在上方（y 为负）', s0.y < -0.8, String(s0.y));
  ok('手: 起始不可见（alpha 低）', s0.alpha < 0.5, String(s0.alpha));

  const sMid = handState(0.4);
  ok('手: 中段贴住头顶(y≈0)', Math.abs(sMid.y) < 0.06, String(sMid.y));
  ok('手: 中段完全可见', sMid.alpha > 0.95, String(sMid.alpha));
  ok('手: 中段有按压力度', sMid.press > 0.3, String(sMid.press));

  const s1 = handState(1);
  ok('手: 结束时已收回上方', s1.y < -0.8, String(s1.y));
  ok('手: 结束时淡出', s1.alpha < 0.1, String(s1.alpha));
}
{
  const all = samples((t) => handState(t));
  ok('手: alpha 始终在 0..1', all.every((s) => s.alpha >= 0 && s.alpha <= 1));
  ok('手: press 始终在 0..1', all.every((s) => s.press >= 0 && s.press <= 1));
  ok('手: scale 为正', all.every((s) => s.scale > 0));
  ok('手: y 有上限（不会跑到宠物下方）', all.every((s) => s.y < 0.12), Math.max(...all.map((s) => s.y)).toFixed(3));
  // 中段存在可见帧
  ok('手: 存在完全可见的帧', all.some((s) => s.alpha > 0.99));
  // 至少一次贴到头顶
  ok('手: 至少一次贴到头顶', all.some((s) => Math.abs(s.y) < 0.05));
}
ok('手: 越界进度被夹取', handState(-1).y === handState(0).y && handState(2).y === handState(1).y);
ok('手: NaN 进度不崩溃', Number.isFinite(handState(NaN).y));
ok('手: 时长为正', HAND_DURATION > 0);

// ============ 挨拳击的拳头 ============
{
  const s0 = fistState(0, 1);
  ok('拳: 起始在画面外(x 大)', Math.abs(s0.x) > 1.0, String(s0.x));
  ok('拳: 起始淡入中', s0.alpha < 0.5, String(s0.alpha));

  const sImpact = fistState(0.28, 1);
  ok('拳: 撞击时贴住身体(|x| 小)', Math.abs(sImpact.x) < 0.1, String(sImpact.x));
  ok('拳: 撞击时完全可见', sImpact.alpha > 0.9, String(sImpact.alpha));
  ok('拳: 撞击时 impact=1', sImpact.impact > 0.9, String(sImpact.impact));

  const s1 = fistState(1, 1);
  ok('拳: 结束已弹回', Math.abs(s1.x) > 0.8, String(s1.x));
  ok('拳: 结束淡出', s1.alpha < 0.15, String(s1.alpha));
}
{
  // 方向：dir=1 从右侧来（x>0 起步）；dir=-1 从左侧来（x<0）
  ok('拳: dir=1 从右侧', fistState(0, 1).x > 1);
  ok('拳: dir=-1 从左侧', fistState(0, -1).x < -1);
  ok('拳: dir 影响旋转方向', Math.sign(fistState(0.05, 1).rot) !== Math.sign(fistState(0.05, -1).rot));
}
{
  const all = samples((t) => fistState(t, 1));
  ok('拳: alpha 在 0..1', all.every((s) => s.alpha >= 0 && s.alpha <= 1));
  ok('拳: impact 在 0..1', all.every((s) => s.impact >= 0 && s.impact <= 1));
  ok('拳: scale 为正', all.every((s) => s.scale > 0));
  ok('拳: 存在撞击帧', all.some((s) => s.impact > 0.99));
}
ok('拳: 越界进度被夹取', fistState(-1, 1).x === fistState(0, 1).x);
ok('拳: NaN 进度不崩溃', Number.isFinite(fistState(NaN, 1).x));
ok('拳: 时长为正', FIST_DURATION > 0);

// ============ 两者互不依赖 ============
ok('手与拳时长不同（避免视觉同质）', HAND_DURATION !== FIST_DURATION);