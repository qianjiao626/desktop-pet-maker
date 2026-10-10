// 微动作库：基于「识别到的身体结构」做小幅拟真动作（纯逻辑，可单测）。
//
// 为什么是「微动作」而不是「跳舞」（实测后的结论，见 HANDOFF 的教训）：
//   一张静态人物图没有背面、没有关节内侧的像素。想做「手臂从垂到举」这种
//   大动作，中间那段像素**本来就不存在**，无论部件切分还是网格形变都只能
//   拉成面条（两种方案都实测失败过）。
//   而在桌宠的真实使用场景里，宠物本来就是「待机时自然微动」——
//   呼吸起伏、轻轻摇摆、点头、被点一下抖一下，这些幅度小、只需形变就能做好，
//   而且因为**按真实身体结构在动**，比纯程序化的整图缩放更有说服力。
//
// 所有幅度都用「相对量」，且刻意控制在 ±0.12 弧度（≈7°）以内。

const TAU = Math.PI * 2;

function sin01(t, shift = 0) { return Math.sin((t + shift) * TAU); }
function cos01(t, shift = 0) { return Math.cos((t + shift) * TAU); }

/**
 * 微动作定义。pose(t) 返回角度增量（弧度），会被 blendAngles 叠加到源图姿势上。
 */
export const MICRO_MOTIONS = [
  {
    id: 'breathe',
    name: '呼吸',
    emoji: '🫧',
    desc: '身体轻微起伏，肩膀随之抬起落下',
    pose(t) {
      const s = sin01(t, 0);
      return {
        spine: s * 0.018,
        neck: -s * 0.02,
        leftUpperArm: s * 0.035, rightUpperArm: -s * 0.035,
        leftForeArm: s * 0.02, rightForeArm: -s * 0.02,
        leftThigh: -s * 0.01, rightThigh: -s * 0.01,
        bobY: -Math.abs(s) * 0.012,
      };
    },
  },
  {
    id: 'sway',
    name: '轻摇',
    emoji: '🍃',
    desc: '左右微微摇摆，像站着轻轻晃',
    pose(t) {
      const s = sin01(t, 0);
      const c = cos01(t, 0);
      return {
        spine: s * 0.075,
        neck: s * 0.04,
        leftUpperArm: s * 0.05, rightUpperArm: s * 0.05,
        leftForeArm: c * 0.03, rightForeArm: -c * 0.03,
        leftThigh: s * 0.03, rightThigh: s * 0.03,
        bobY: -Math.abs(c) * 0.008,
      };
    },
  },
  {
    id: 'nod',
    name: '点头',
    emoji: '🙂',
    desc: '头部上下点动，像在应声',
    pose(t) {
      const s = sin01(t, 0);
      return {
        neck: s * 0.10,
        spine: s * 0.02,
        leftUpperArm: s * 0.015, rightUpperArm: s * 0.015,
        bobY: s * 0.008,
      };
    },
  },
  {
    id: 'peek',
    name: '张望',
    emoji: '👀',
    desc: '左右转头张望，身体跟着偏一点',
    pose(t) {
      const s = sin01(t, 0);
      const c = cos01(t, 0);
      return {
        neck: s * 0.09,
        spine: s * 0.035,
        leftUpperArm: c * 0.02, rightUpperArm: -c * 0.02,
        bobY: -Math.abs(s) * 0.006,
      };
    },
  },
  {
    id: 'stretch',
    name: '伸懒腰',
    emoji: '🙆',
    desc: '慢慢往上舒展，再放松下来',
    pose(t) {
      // 用 |sin| 做出「起来-放下」的单个循环，比纯正弦更像一次伸展
      const s = Math.sin(t * Math.PI);            // 0 -> 1 -> 0
      return {
        spine: -s * 0.075,
        neck: -s * 0.05,
        leftUpperArm: -s * 0.10, rightUpperArm: s * 0.10,
        leftForeArm: -s * 0.05, rightForeArm: s * 0.05,
        leftThigh: -s * 0.02, rightThigh: -s * 0.02,
        bobY: -s * 0.02,
      };
    },
  },
  {
    id: 'wiggle',
    name: '抖一下',
    emoji: '✨',
    desc: '被点到时快速抖两下（短促，适合点击反馈）',
    pose(t) {
      // 2 倍频 + 快速衰减，做出"抖两下就停"的手感
      const decay = Math.max(0, 1 - t * 1.15);
      const s = Math.sin(t * TAU * 2) * decay;
      return {
        spine: s * 0.055,
        neck: s * 0.06,
        leftUpperArm: s * 0.05, rightUpperArm: s * 0.05,
        leftThigh: -s * 0.02, rightThigh: -s * 0.02,
        bobY: -Math.abs(s) * 0.012,
      };
    },
  },
];

export const DEFAULT_MOTION = 'breathe';

export function findMotion(id) { return MICRO_MOTIONS.find((m) => m.id === id) || null; }

/** 微动作的幅度上限（弧度）。超过这个值就不该叫"微动作"了，必须由测试拦住。 */
export const MAX_MICRO_AMPLITUDE = 0.13;

/** 补齐字段用的零姿态 */
export function zeroPose() {
  return {
    spine: 0, neck: 0,
    leftUpperArm: 0, leftForeArm: 0, rightUpperArm: 0, rightForeArm: 0,
    leftThigh: 0, leftShin: 0, rightThigh: 0, rightShin: 0,
    bobY: 0,
  };
}

/**
 * 生成微动作序列（逐帧角度增量），字段已补齐。
 * @param {string} id
 * @param {object} opt { frames }
 */
export function microSequence(id, opt = {}) {
  const m = findMotion(id) || findMotion(DEFAULT_MOTION);
  const frames = Math.max(4, Math.min(48, Math.round(opt.frames || 12)));
  const loop = isLooping(m.id);
  const out = [];
  for (let i = 0; i < frames; i++) {
    // 相位选择决定循环是否平滑（这里踩过坑）：
    //   - 用 i/frames（不含 1）：采样点均匀铺在 [0,1)，末帧接首帧刚好是一个完整周期，
    //     循环播放**无跳变**。适合循环动作。
    //   - 用 i/(frames-1)（含 1）：首尾都是同一相位 0，会在循环处**停顿一拍**。
    //   - 一次性动作（抖一下）要让幅度收尾归零，用含 1 的写法。
    const t = frames <= 1 ? 0 : (loop ? i / frames : i / (frames - 1));
    out.push({ ...zeroPose(), ...(m.pose(t) || {}) });
  }
  return out;
}

/** 是不是循环型动作（抖动是一次性的，不该循环） */
export function isLooping(id) {
  return id !== 'wiggle';
}

/**
 * 幅度检查：任何一帧的任何角度都不能超过 MAX_MICRO_AMPLITUDE。
 * 这条断言的作用是防止以后有人往微动作库里塞大动作 ——
 * 大动作在这个素材条件下必然穿帮（拉成面条），必须被测试拦住。
 */
export function amplitudeCheck(seq) {
  const keys = Object.keys(zeroPose()).filter((k) => k !== 'bobY');
  let worst = 0, field = null;
  for (const p of seq) {
    for (const k of keys) {
      const v = Math.abs(p[k] || 0);
      if (v > worst) { worst = v; field = k; }
    }
  }
  return { ok: worst <= MAX_MICRO_AMPLITUDE, worst, field };
}

/**
 * 循环平滑性检查。
 *
 * 判据是「末帧 -> 首帧」这一跳有多大，而不是「末帧 vs 首帧」的静态差：
 * 循环播放时末帧播完立刻回到首帧，两者相减才是观众看到的跳变。
 * 对用 i/frames 采样的循环动作，末帧相位是 (N-1)/N，它到首帧相位 0 的
 * 距离恰好是一个采样步长，所以相邻帧的差值就是这一跳 —— 直接复用
 * 「相邻帧最大差」即可，无需特殊处理。
 */
export function microLoopClosure(seq, tol = 0.02) {
  if (!Array.isArray(seq) || seq.length < 2) return { ok: false, worst: Infinity, field: null };
  const keys = Object.keys(zeroPose());
  let worst = 0, field = null;
  // 相邻帧差（含 末帧 -> 首帧 这一跳）
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i], b = seq[(i + 1) % seq.length];
    for (const k of keys) {
      const d = Math.abs((a[k] || 0) - (b[k] || 0));
      if (d > worst) { worst = d; field = k; }
    }
  }
  return { ok: worst <= tol, worst, field };
}
