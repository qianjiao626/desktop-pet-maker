// 骨架驱动的微动作（纯逻辑，可单测）。
//
// 前提（必须明确，不能含糊）：**只适用于「标准立绘」** ——
// 正面、四肢张开、互不重叠。原因是这类动作需要把肢体当作独立部件来转，
// 而四肢一旦在画面上重叠，它们就不存在各自的像素（上一轮实测：大动作必然穿帮）。
//
// 为什么不做"跳舞"：
//   三条渲染路线（部件切分 / 网格形变 / 相对姿势形变）全部实测失败，
//   根因是**信息缺失**——静态图没有背面、没有关节内侧。
//   微动作（±7°以内）不需要补全像素，因此可靠。
//
// 本模块只产出「每个肢体绕哪个关节转多少度」，渲染由渲染层完成。

import { kp, SCORE_MIN } from './pose.js';

/** 微动作幅度上限（弧度）。超过就不再是"微"动作，必须被测试拦住。 */
export const MAX_AMPLITUDE = 0.13;

/**
 * 关节链：远端关节的旋转必须叠加近端，否则小臂会脱离大臂。
 * 每项 = [部件名, 近端关节关键点, 远端关节关键点, 父部件]
 */
export const LIMB_CHAIN = [
  ['leftUpperArm', 'leftShoulder', 'leftElbow', 'torso'],
  ['leftForeArm', 'leftElbow', 'leftWrist', 'leftUpperArm'],
  ['rightUpperArm', 'rightShoulder', 'rightElbow', 'torso'],
  ['rightForeArm', 'rightElbow', 'rightWrist', 'rightUpperArm'],
  ['leftThigh', 'leftHip', 'leftKnee', 'torso'],
  ['leftShin', 'leftKnee', 'leftAnkle', 'leftThigh'],
  ['rightThigh', 'rightHip', 'rightKnee', 'torso'],
  ['rightShin', 'rightKnee', 'rightAnkle', 'rightThigh'],
];

/** 部位中文名（界面提示用） */
export const LIMB_LABELS = {
  torso: '躯干', leftUpperArm: '左上臂', leftForeArm: '左小臂',
  rightUpperArm: '右上臂', rightForeArm: '右小臂',
  leftThigh: '左大腿', leftShin: '左小腿',
  rightThigh: '右大腿', rightShin: '右小腿',
};

/**
 * 微动作定义。返回角度增量（弧度），字段名 = 部件名。
 * 所有数值都必须 <= MAX_AMPLITUDE。
 */
export const MOTIONS = [
  {
    id: 'idle',
    name: '呼吸',
    emoji: '🫧',
    desc: '身体轻轻起伏，肩膀跟着抬起落下',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      return {
        torso: s * 0.018,
        leftUpperArm: s * 0.035, rightUpperArm: -s * 0.035,
        leftForeArm: s * 0.018, rightForeArm: -s * 0.018,
        leftThigh: -s * 0.008, rightThigh: -s * 0.008,
      };
    },
  },
  {
    id: 'sway',
    name: '轻摇',
    emoji: '🍃',
    desc: '左右微微摇摆，像站着轻轻晃',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        torso: s * 0.075,
        leftUpperArm: s * 0.05, rightUpperArm: s * 0.05,
        leftForeArm: c * 0.025, rightForeArm: -c * 0.025,
        leftThigh: s * 0.028, rightThigh: s * 0.028,
      };
    },
  },
  {
    id: 'nod',
    name: '点头',
    emoji: '🙂',
    desc: '头部上下点动，像在应声',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      return {
        torso: s * 0.02,
        leftUpperArm: s * 0.014, rightUpperArm: s * 0.014,
      };
    },
  },
  {
    id: 'wave',
    name: '挥手',
    emoji: '👋',
    desc: '右手轻轻摆动（幅度刻意压小，关节处才不会露馅）',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      return {
        rightUpperArm: -0.09 + s * 0.03,
        rightForeArm: s * 0.06,
        torso: s * 0.02,
        leftUpperArm: -s * 0.015,
      };
    },
  },
  {
    id: 'kick',
    name: '踏步',
    emoji: '🦶',
    desc: '左右腿交替轻抬，像在原地踏步',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        leftThigh: Math.max(0, s) * 0.10,
        rightThigh: Math.max(0, -s) * 0.10,
        leftShin: -Math.max(0, s) * 0.06,
        rightShin: -Math.max(0, -s) * 0.06,
        torso: c * 0.02,
      };
    },
  },
  {
    id: 'stretch',
    name: '伸懒腰',
    emoji: '🙆',
    desc: '慢慢舒展再放松，一个循环做一次',
    pose(t) {
      const s = Math.sin(t * Math.PI);      // 0 -> 1 -> 0
      return {
        torso: -s * 0.075,
        leftUpperArm: -s * 0.10, rightUpperArm: s * 0.10,
        leftForeArm: -s * 0.04, rightForeArm: s * 0.04,
      };
    },
  },
];

export const DEFAULT_MOTION = 'idle';

export function findMotion(id) { return MOTIONS.find((m) => m.id === id) || null; }

/** 零姿态 */
export function zeroPose() {
  const z = { torso: 0 };
  for (const [name] of LIMB_CHAIN) z[name] = 0;
  return z;
}

/**
 * 生成微动作序列（逐帧角度增量，字段已补齐）。
 * 相位用 i/frames（不含 1），保证循环时末帧接首帧无跳变。
 */
export function motionSequence(id, opt = {}) {
  const m = findMotion(id) || findMotion(DEFAULT_MOTION);
  const frames = Math.max(4, Math.min(48, Math.round(opt.frames || 12)));
  const out = [];
  for (let i = 0; i < frames; i++) {
    const t = frames <= 1 ? 0 : i / frames;
    out.push({ ...zeroPose(), ...(m.pose(t) || {}) });
  }
  return out;
}

/**
 * 幅度检查：任何一帧任何部件都不许超过 MAX_AMPLITUDE。
 * 这条断言的作用是**防止以后有人往这里塞大动作** ——
 * 大动作在静态素材上必然穿帮（上一轮实测三轮失败），必须被测试拦住。
 */
export function amplitudeCheck(seq) {
  let worst = 0, field = null;
  const keys = Object.keys(zeroPose());
  for (const p of seq || []) {
    for (const k of keys) {
      const v = Math.abs(p[k] || 0);
      if (v > worst) { worst = v; field = k; }
    }
  }
  return { ok: worst <= MAX_AMPLITUDE, worst, field };
}

/** 循环平滑性：看相邻帧（含末帧->首帧）的最大跳变 */
export function loopClosure(seq, tol = 0.06) {
  if (!Array.isArray(seq) || seq.length < 2) return { ok: false, worst: Infinity, field: null };
  const keys = Object.keys(zeroPose());
  let worst = 0, field = null;
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i], b = seq[(i + 1) % seq.length];
    for (const k of keys) {
      const d = Math.abs((a[k] || 0) - (b[k] || 0));
      if (d > worst) { worst = d; field = k; }
    }
  }
  return { ok: worst <= tol, worst, field };
}

/**
 * 判定这份素材能否驱动微动作。
 * 这是"闸门"：不合格就明确告诉用户，不要生成一个注定难看的结果。
 * @returns {{ok, reason, available:Array, missing:Array}}
 */
export function canAnimate(keypoints) {
  const has = (n) => { const k = kp(keypoints, n); return !!k && k.score >= SCORE_MIN; };
  const available = [];
  const missing = [];
  for (const [name, a, b] of LIMB_CHAIN) {
    if (has(a) && has(b)) available.push(name);
    else missing.push(name);
  }
  // 躯干是刚需：没有肩髋就确定不了身体朝向
  const core = has('leftShoulder') && has('rightShoulder') && has('leftHip') && has('rightHip');
  if (!core) {
    return { ok: false, reason: '没能确认躯干（肩、髋关键点不足），无法驱动动作', available, missing };
  }
  // 至少要有一侧手臂或一条腿可动，否则"动"也动不出东西
  const limbs = available.filter((x) => x !== 'torso');
  if (limbs.length < 2) {
    return { ok: false, reason: '可信的肢体太少（只有 ' + limbs.length + ' 段），做不出像样的动作', available, missing };
  }
  return { ok: true, reason: '有 ' + limbs.length + ' 段肢体可驱动', available, missing };
}

/**
 * 把角度增量应用到关键点上，算出每个关节的「旋转后位置」。
 * 用于渲染层做「绕关节旋转部件」。
 *
 * 关节链语义：远端部件绕自己的近端关节转，
 * 且**近端的旋转要先作用于远端关节的位置**（否则小臂会脱节）。
 *
 * @returns {object} 部件名 -> { pivot:{x,y}, angle:number, end:{x,y} }
 */
export function solveJoints(keypoints, pose) {
  const P = (n) => { const k = kp(keypoints, n); return k && k.score >= SCORE_MIN ? { x: k.x, y: k.y } : null; };
  const p = pose || {};
  const out = {};
  const rot = (pt, piv, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = pt.x - piv.x, dy = pt.y - piv.y;
    return { x: piv.x + dx * c - dy * s, y: piv.y + dx * s + dy * c };
  };
  // 累积旋转：每个部件记录"作用在自己身上的总角度"，供远端继承
  const carry = { torso: p.torso || 0 };
  for (const [name, aName, bName, parent] of LIMB_CHAIN) {
    const A = P(aName), B = P(bName);
    if (!A || !B) continue;
    const parentAng = carry[parent] || 0;
    // 近端关节先被父级旋转搬走
    const pivot = parentAng ? rot(A, A, parentAng) : { x: A.x, y: A.y };
    // 本部件自身角度 + 继承父级角度
    const self = p[name] || 0;
    const total = parentAng + self;
    carry[name] = total;
    out[name] = { pivot, angle: total, sourceA: A, sourceB: B, end: rot(B, A, total) };
  }
  return out;
}

/**
 * 计算带动画的包围盒（所有帧所有关节的极值），保证逐帧画布统一、不抖动。
 *
 * 注意（踩过的坑）：只算关节是**不够**的 —— 关节点只到肩/肘/腕/髋/膝/踝，
 * 头顶（鼻子以上）和脚都在关节之外，直接用会把头和脚裁掉。
 * 正确做法是再和 bodyBounds（含头脚外扩）取并集。
 *
 * @param jointsPerFrame solveJoints 的逐帧结果
 * @param extra 额外要并进来的范围（通常传 bodyBounds 的结果）
 */
export function motionBounds(jointsPerFrame, extra = null, pad = 0.04) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
  for (const joints of jointsPerFrame || []) {
    for (const k of Object.keys(joints || {})) {
      const j = joints[k];
      for (const pt of [j.pivot, j.end]) {
        if (!pt) continue;
        any = true;
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }
  // 把额外范围（通常是含头脚外扩的 bodyBounds）并进来
  if (extra && typeof extra.x === 'number' && extra.w > 0) {
    any = true;
    if (extra.x < minX) minX = extra.x;
    if (extra.y < minY) minY = extra.y;
    if (extra.x + extra.w > maxX) maxX = extra.x + extra.w;
    if (extra.y + extra.h > maxY) maxY = extra.y + extra.h;
  }
  if (!any) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  const w = Math.min(1, maxX + pad) - x, h = Math.min(1, maxY + pad) - y;
  return { x, y, w: Math.max(0.05, w), h: Math.max(0.05, h) };
}
