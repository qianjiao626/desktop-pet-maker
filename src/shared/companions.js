// 多宠物之间的「互相感知」（纯逻辑，可单测）。
//
// 背景：桌面上同时养好几只之后，它们却像互相不存在 —— 各自埋头走。
// 这一版让它们能"看见"彼此：靠近了会停下来看对方、让路、或者一起跳。
//
// 设计原则：
//   1) **纯函数**：给同样的位置/状态，算出同样的反应。方便单测，也方便主进程广播。
//   2) **不做全量物理**：一次只算"最近的一只"，O(n) 而不是 O(n²)。
//   3) 反应要**克制**：两只宠物频繁互相触发会让整个屏幕很吵。
//      所以有距离阈值 + 冷却 + 概率（不是每次都反应）。
//   4) 反应是**叠加**在现有行为上的（像 NPC 的"注意到了"），不接管状态机。

/** 横向距离小于这个值就算"靠近了"（像素，按窗口实际尺寸缩放） */
export const NEAR_RATIO = 1.1;

/**
 * 计算某只宠物眼中的"最近的邻居"。
 * @param self  { id, x, y, w, h }
 * @param others [{ id, x, y, w, h }]
 * @returns { pet, dx, dy, dist, near } 或 null（没有其它宠物）
 */
export function nearestNeighbor(self, others) {
  if (!self || !Array.isArray(others) || !others.length) return null;
  const sx = Number(self.x) || 0, sy = Number(self.y) || 0;
  const sw = Math.max(1, Number(self.w) || 1), sh = Math.max(1, Number(self.h) || 1);
  let best = null;
  for (const o of others) {
    if (!o || !o.id || o.id === self.id) continue;
    const ox = Number(o.x) || 0, oy = Number(o.y) || 0;
    // 用**中心点**距离：左上角在尺寸不同的宠物之间不可比
    const dx = (ox + (Number(o.w) || 0) / 2) - (sx + sw / 2);
    const dy = (oy + (Number(o.h) || 0) / 2) - (sy + sh / 2);
    const dist = Math.hypot(dx, dy);
    if (!best || dist < best.dist) {
      // "靠近"的判定：横向在 1.1 倍平均宽以内，纵向在 1.1 倍自身高以内。
      // 用平均宽而不是自身宽：尺寸差很大的两只（100px 与 400px）才可比。
      const avgW = (sw + (Number(o.w) || sw)) / 2;
      const avgH = (sh + (Number(o.h) || sh)) / 2;
      const near = Math.abs(dx) < avgW * NEAR_RATIO && Math.abs(dy) < avgH * NEAR_RATIO;
      best = { pet: o, dx, dy, dist, near };
    }
  }
  return best;
}

/**
 * 决定某只宠物对邻居的反应。
 * @param opt.self      自己的位置
 * @param opt.others    其它宠物
 * @param opt.now       当前时间戳（ms）
 * @param opt.lastReact 上次反应的时间戳
 * @param opt.cooldownMs 冷却（这段时间内不再对邻居起反应）
 * @param opt.rng       随机源（测试可注入）
 * @returns { none:true, reason } | { action, dx, dist, otherId }
 *   action: 'look'(转头看) | 'pause'(停下来让路) | 'hop'(一起蹦) | 'greet'(打招呼)
 */
export function reactToNeighbor(opt = {}) {
  const now = Number(opt.now) || 0;
  const last = Number(opt.lastReact) || 0;
  const cd = Number(opt.cooldownMs) || 8000;
  if (last && now - last < cd) return { none: true, reason: '冷却中' };

  const near = nearestNeighbor(opt.self, opt.others);
  if (!near) return { none: true, reason: '没有别的宠物' };
  if (!near.near) return { none: true, reason: '离得还远' };

  const rng = typeof opt.rng === 'function' ? opt.rng : Math.random;
  // 统一的随机取值：任何异常值（NaN / 越界 / 抛错）都退化成 0.5，绝不让它传出 NaN。
  const roll = () => {
    try {
      const v = Number(rng());
      if (!Number.isFinite(v)) return 0.5;
      return Math.abs(v) % 1;
    } catch (err) { return 0.5; }
  };
  const r = roll();

  // 越近越容易有反应：紧贴时 90%，临界距离时只有 35%。
  const sw = Math.max(1, Number(opt.self && opt.self.w) || 1);
  const closeRatio = Math.max(0, 1 - Math.abs(near.dx) / (sw * NEAR_RATIO));
  const chance = 0.35 + 0.55 * closeRatio;
  if (r > chance) return { none: true, reason: '这次没反应' };

  // 按相对位置选动作：左右邻居 -> 转头看 / 让路；上下重叠 -> 一起蹦
  let action = 'look';
  const r2 = roll();
  if (Math.abs(near.dy) > Math.abs(near.dx) * 0.6) action = r2 < 0.5 ? 'hop' : 'greet';
  else action = r2 < 0.55 ? 'look' : (r2 < 0.85 ? 'pause' : 'greet');

  return { action, dx: near.dx, dy: near.dy, dist: near.dist, otherId: near.pet.id };
}

/**
 * 让路的建议速度：想往哪边走（把路让给对方）。
 * 返回 -1 / 0 / 1（方向），0 = 不用让。
 */
export function yieldDirection(self, other) {
  const n = nearestNeighbor(self, other ? [other] : []);
  if (!n) return 0;
  // 让路只在"确实会撞上"的范围内才做（比"看见"的范围宽 2 倍），
  // 否则屏幕上离得很远的两只也会互相躲，看着很怪。
  const sw = Math.max(1, Number(self && self.w) || 1);
  const reach = sw * NEAR_RATIO * 2;
  if (Math.abs(n.dx) > reach) return 0;
  if (Math.abs(n.dx) < 1) return 0;            // 正对着，随便往一边
  return n.dx > 0 ? -1 : 1;                    // 对方在右边 -> 往左让
}

/** 把"看到邻居"折成一个看向的方向（给 lookAtPose 用） */
export function gazeAt(self, other) {
  const n = nearestNeighbor(self, other ? [other] : []);
  if (!n) return { dx: 0, dy: 0, reach: 0 };
  return { dx: n.dx, dy: n.dy, reach: Math.min(260, Math.max(0, n.dist)) };
}

/** 一群宠物里，找出所有"挨得特别近"的成对（用来做"挤在一起"的判定 / 调试） */
export function closePairs(pets, opt = {}) {
  const list = Array.isArray(pets) ? pets : [];
  const maxDist = Number(opt.maxDist) || 120;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a || !b || !a.id || !b.id || a.id === b.id) continue;
      const dx = ((Number(b.x) || 0) + (Number(b.w) || 0) / 2) - ((Number(a.x) || 0) + (Number(a.w) || 0) / 2);
      const dy = ((Number(b.y) || 0) + (Number(b.h) || 0) / 2) - ((Number(a.y) || 0) + Number(a.h) / 2);
      const dist = Math.hypot(dx, dy);
      if (dist <= maxDist) out.push({ a: a.id, b: b.id, dist });
    }
  }
  return out;
}
