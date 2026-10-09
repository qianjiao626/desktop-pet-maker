// 交互特效动画（纯函数，可单测）
// 注意：Math.min/max 无法拦截 NaN，这里显式处理，避免非法进度传播到绘制层。
// 场景：摸头时从上伸下一只手；挨拳击时从侧面飞来一个拳头。
// 这里只计算「位置/透明度/缩放/旋转」等归一化参数，绘制在 pet.js 完成。

/** 把进度夹到 0..1；NaN/非有限值一律视为 0 */
function clamp01(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 缓动：先快后慢 */
function easeOutCubic(t) { return 1 - Math.pow(1 - clamp01(t), 3); }
/** 缓动：先慢后快 */
function easeInCubic(t) { return Math.pow(clamp01(t), 3); }
/** 回弹 */
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * 摸头的手：从宠物上方伸下 -> 轻按 -> 收回
 * @param progress 0..1 动画进度
 * @returns { y, alpha, scale, press, visible }
 *   y     —— 相对宠物高度的纵向偏移（负=在上方），0 表示"手掌贴住头顶"
 *   press —— 0..1 按压强度（用于让宠物轻微下沉）
 */
export function handState(progress) {
  const p = clamp01(progress);
  const APPROACH_END = 0.30;
  const PRESS_END = 0.58;

  let y, alpha, scale, press;

  if (p < APPROACH_END) {
    // 从上方约 -1.1 个身高处伸下
    const t = p / APPROACH_END;
    const e = easeOutCubic(t);
    y = -1.15 * (1 - e);
    alpha = Math.min(1, t * 2.2);
    scale = 0.85 + 0.15 * e;
    press = 0;
  } else if (p < PRESS_END) {
    // 停留并轻微下压（含一点抖动，像在揉）
    const t = (p - APPROACH_END) / (PRESS_END - APPROACH_END);
    y = 0.02 + Math.sin(t * Math.PI * 3) * 0.018;
    alpha = 1;
    scale = 1;
    press = 0.5 + 0.5 * Math.sin(t * Math.PI);
  } else {
    // 收回
    const t = (p - PRESS_END) / (1 - PRESS_END);
    const e = easeInCubic(t);
    y = -1.15 * e;
    alpha = 1 - Math.min(1, t * 1.6);
    scale = 1 - 0.12 * e;
    press = Math.max(0, 0.5 * (1 - t * 2));
  }

  return {
    y,
    alpha: Math.max(0, Math.min(1, alpha)),
    scale,
    press: Math.max(0, Math.min(1, press)),
    visible: alpha > 0.01,
  };
}

/**
 * 挨拳击的拳头：从侧面冲入 -> 顿挫 -> 弹回
 * @param progress 0..1
 * @param dir 1 表示拳头从右侧飞来（宠物向左飞），-1 从左侧飞来
 * @returns { x, y, alpha, scale, rot, impact }
 *   x     —— 相对宠物宽度的横向偏移（0 表示拳头贴住身体）
 *   impact—— 0..1 撞击强度（用于画面微震）
 */
export function fistState(progress, dir = 1) {
  const p = clamp01(progress);
  const d = dir >= 0 ? 1 : -1;
  const DASH_END = 0.22;
  const IMPACT_END = 0.36;

  let x, alpha, scale, rot, impact;

  if (p < DASH_END) {
    // 从画面外冲入
    const t = p / DASH_END;
    const e = easeOutCubic(t);
    x = d * 1.6 * (1 - e);
    alpha = Math.min(1, t * 3);
    scale = 0.7 + 0.3 * e;
    rot = -d * 18 * (1 - e);
    impact = 0;
  } else if (p < IMPACT_END) {
    // 顿挫：贴住并轻微抖动
    const t = (p - DASH_END) / (IMPACT_END - DASH_END);
    x = d * 0.02 * Math.sin(t * Math.PI * 5);
    alpha = 1;
    scale = 1.12 - 0.12 * t;
    rot = d * 4 * t;
    impact = 1;
  } else {
    // 弹回
    const t = (p - IMPACT_END) / (1 - IMPACT_END);
    const e = easeOutBack(t);
    x = d * 1.6 * e;
    alpha = 1 - Math.min(1, Math.max(0, (t - 0.35) * 2.2));
    scale = 1 - 0.25 * t;
    rot = d * 10 * t;
    impact = Math.max(0, 1 - t * 2.5);
  }

  return {
    x,
    y: 0,
    alpha: Math.max(0, Math.min(1, alpha)),
    scale,
    rot,
    impact: Math.max(0, Math.min(1, impact)),
    visible: alpha > 0.01,
  };
}

/**
 * 被摸头时宠物的「舒服」姿态（纯函数，可单测）
 * 表现：先轻轻缩一下 -> 微微下沉蹭一蹭 -> 左右慢慢摇摆 -> 回到原样
 * 目标：让它看起来是"被 rua 得很舒服"，而不是被弹了一下。
 * @param progress 0..1 动画进度
 * @returns { squash, sink, sway, tilt, bliss }
 *   squash —— 纵向挤压系数（>1 更扁一点点，像陷进去）
 *   sink   —— 下沉像素（正值向下）
 *   sway   —— 水平位移像素
 *   tilt   —— 倾斜角度（度）
 *   bliss  —— 0..1「享受」强度（用于眯眼 / 冒爱心）
 */
export function pettingPose(progress) {
  const p = clamp01(progress);
  const RISE = 0.18;    // 缩一下
  const SINK = 0.42;    // 下沉蹭
  const SWAY_END = 0.84; // 摇摆
  let squash, sink, sway, tilt, bliss;

  if (p < RISE) {
    const t = easeOutCubic(p / RISE);
    squash = 1 + 0.05 * t;
    sink = 2 * t;
    sway = 0;
    tilt = 0;
    bliss = t * 0.7;
  } else if (p < SINK) {
    const t = (p - RISE) / (SINK - RISE);
    squash = 1.05 + easeOutCubic(t) * 0.05;
    sink = 2 + 4 * easeOutCubic(t);
    sway = Math.sin(t * Math.PI) * 2;
    tilt = 0;
    bliss = 0.7 + 0.3 * easeOutCubic(t);
  } else if (p < SWAY_END) {
    const t = (p - SINK) / (SWAY_END - SINK);
    const wave = Math.sin(t * Math.PI * 2.4);
    squash = 1.10 - 0.04 * t;
    sink = 6 - 3 * t;
    sway = wave * 4.5 * (1 - t * 0.45);       // 左右蹭
    tilt = wave * 7 * (1 - t * 0.5);          // 跟着轻轻歪头
    bliss = 1;
  } else {
    const t = (p - SWAY_END) / (1 - SWAY_END);
    const e = easeOutCubic(t);
    squash = 1.06 - 0.06 * e;
    sink = 3 * (1 - e);
    sway = 0;
    tilt = 0;
    bliss = 1 - e;
  }

  // 夹取，避免 NaN 传播到绘制层
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    squash: n(squash, 1),
    sink: n(sink, 0),
    sway: n(sway, 0),
    tilt: n(tilt, 0),
    bliss: Math.max(0, Math.min(1, n(bliss, 0))),
  };
}

/** 摸头舒适姿态的建议时长（毫秒）：比手部动画略长，让"舒服感"留一会儿 */
export const PETTING_DURATION = 1500;

/** 摸头动画的建议时长（毫秒） */
export const HAND_DURATION = 1100;
/** 拳击动画的建议时长（毫秒） */
export const FIST_DURATION = 900;