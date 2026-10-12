// 「角色工坊」：用参数当场画出一只**原创**小人（不依赖任何 AI 生图 / 外部素材）。
//
// 为什么做这个：
//   1) 用户的原话是「人人都可以上传自己的桌宠」——但很多人压根没有素材、
//      也不会画画。让他们从「一堆滑块」捏出一只宠物，门槛最低。
//   2) AI 生图方案要么拖几百 MB 模型 + CPU 出图几分钟（质量还不稳），
//      要么要用户自带 API Key + 联网花钱。参数化绘制是唯一
//      「零依赖、秒出、永久免费、绝对无版权风险」的路线。
//
// 分工：本模块只产出**绘制指令**（纯数据，可单测），
//       canvas 渲染在 maker 侧的 renderer 里做（见 charstudio 的用法）。
//
// 关键设计：
//   - 所有数值都 clamp 到合法区间：用户拖动滑块/导入配置时不能画出畸形角色。
//   - 眼睛/嘴/腮红/耳朵/尾巴都是**独立开关**，方便以后加更多部位而不破坏旧配置。
//   - 提供 preset 概念（预设）：新手不用从零调。

export const BODY_SHAPES = ['round', 'egg', 'square', 'bean'];
export const EAR_TYPES = ['none', 'cat', 'rabbit', 'round', 'horn'];
export const EYE_TYPES = ['dot', 'round', 'sleepy', 'sparkle'];
export const MOUTH_TYPES = ['smile', 'open', 'cat', 'flat'];
/** 可选舞蹈 id（定义在下面的 DANCES；这里先声明是为了 normalizeCharacter 能用） */
export const DANCE_IDS = ['none', 'bounce', 'wave', 'twist', 'party'];

/** 预设配色（都是纯色，避免渐变的复杂度） */
export const PALETTES = [
  { id: 'sky', name: '小蓝', body: '#7cc3f5', belly: '#dff0ff', accent: '#4a8fd0' },
  { id: 'peach', name: '蜜桃', body: '#ffb0a0', belly: '#ffe6df', accent: '#e0755f' },
  { id: 'mint', name: '薄荷', body: '#8ee0b8', belly: '#e2fff0', accent: '#39a97a' },
  { id: 'lemon', name: '柠檬', body: '#ffdc72', belly: '#fff6d6', accent: '#d9a92a' },
  { id: 'grape', name: '葡萄', body: '#b79df0', belly: '#eee6ff', accent: '#7d63c9' },
  { id: 'snow', name: '雪团', body: '#f2f4fa', belly: '#ffffff', accent: '#c4ccdd' },
  { id: 'coal', name: '煤球', body: '#59616f', belly: '#7d8593', accent: '#3a404b' },
  { id: 'orange', name: '橘猫', body: '#ffa85c', belly: '#ffe3c4', accent: '#d97b25' },
];

function clamp(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return n < lo ? lo : n > hi ? hi : n;
}
function pick(list, v, d) { return list.includes(v) ? v : d; }

export const DEFAULT_CHARACTER = Object.freeze({
  name: '我的小人',
  bodyShape: 'round',
  earType: 'cat',
  eyeType: 'round',
  mouthType: 'smile',
  paletteId: 'sky',
  size: 0.7,        // 体型 0..1（相对画布）
  eyeGap: 0.5,      // 双眼间距 0..1
  eyeSize: 0.5,     // 眼睛大小 0..1
  blush: true,      // 腮红
  tail: true,       // 尾巴
  arms: true,       // 手臂
  legs: true,       // 脚
  dance: 'none',    // 舞蹈（none = 只有原来的呼吸浮动）
});

/**
 * 校验 / 归一化一份角色配置。
 * 用户可能从文件导入半截配置，或者滑块给出 NaN —— 这里兜住所有情况。
 */
export function normalizeCharacter(input) {
  const o = (input && typeof input === 'object') ? input : {};
  const d = DEFAULT_CHARACTER;
  let name = String(o.name == null ? d.name : o.name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) name = d.name;
  const cps = Array.from(name);
  if (cps.length > 40) name = cps.slice(0, 40).join('');
  const paletteId = PALETTES.some((p) => p.id === o.paletteId) ? o.paletteId : d.paletteId;
  return {
    name,
    bodyShape: pick(BODY_SHAPES, o.bodyShape, d.bodyShape),
    earType: pick(EAR_TYPES, o.earType, d.earType),
    eyeType: pick(EYE_TYPES, o.eyeType, d.eyeType),
    mouthType: pick(MOUTH_TYPES, o.mouthType, d.mouthType),
    paletteId,
    size: clamp(o.size, 0.35, 1, d.size),
    eyeGap: clamp(o.eyeGap, 0.2, 1, d.eyeGap),
    eyeSize: clamp(o.eyeSize, 0.2, 1, d.eyeSize),
    blush: o.blush === undefined ? d.blush : !!o.blush,
    tail: o.tail === undefined ? d.tail : !!o.tail,
    arms: o.arms === undefined ? d.arms : !!o.arms,
    legs: o.legs === undefined ? d.legs : !!o.legs,
    // 白名单式归一化：新字段必须在这里放行，否则存盘/载入会静默丢掉它
    dance: pick(DANCE_IDS, o.dance, d.dance),
  };
}

/** 取调色板（永远返回一个有效对象） */
export function paletteOf(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

/**
 * 跳舞动作库（纯数据，可单测）。
 *
 * ★ 为什么「照片跳舞」做不了、而这里能行 —— 这是本功能成立的唯一理由：
 *   静态照片没有背面、没有关节内侧、没有被遮挡的肢体像素，任何"搬运像素"
 *   都补不出来（见 HANDOFF 已知坑第 23 条，三条路线实测全败）。
 *   但**程序化绘制的小人**是例外：像素是我们自己画的，所以
 *   「肩膀内侧长什么样、抬手后腋下是什么颜色」我们**知道**，直接重画即可，
 *   不存在信息缺失。所以「操控他跳舞」在这里是真能兑现的。
 *
 * 每个动作返回**归一化时间 t∈[0,1) 下的姿态**（弧度/比例），
 * 渲染层照着画；t=0 与 t→1 必须接得上，才能无缝循环。
 */
export const DANCES = [
  {
    id: 'none', name: '不跳', emoji: '🚫', desc: '保持原来的轻微呼吸浮动',
  },
  {
    id: 'bounce', name: '蹦蹦', emoji: '🦘',
    desc: '左右手轮流举起，身体跟着上下弹跳',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        offsetY: -Math.abs(s) * 0.055,          // 只往上弹，脚不会陷进地里
        rotate: s * 0.10,
        scaleX: 1 + c * 0.035,
        scaleY: 1 - c * 0.035,
        // 0~1 = 抬起程度（渲染时乘上"安全上限"，所以任何体型都不会伸出画布）
        raiseL: 0.55 + s * 0.45, raiseR: 0.55 - s * 0.45,
        legOutL: Math.max(0, s) * 0.35, legOutR: Math.max(0, -s) * 0.35,
      };
    },
  },
  {
    id: 'wave', name: '招手', emoji: '👋',
    desc: '左手举高左右摆，像在跟你打招呼',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const s2 = Math.sin(t * Math.PI * 4);
      return {
        offsetY: s * 0.012,
        rotate: s * 0.05,
        raiseL: 0.80 + s2 * 0.20,   // 举高 + 左右摆
        raiseR: 0.15 - s * 0.15,
        legOutL: 0, legOutR: 0,
      };
    },
  },
  {
    id: 'twist', name: '扭扭', emoji: '🌀',
    desc: '身体左右扭动，双手在两侧张开，像在摇摆',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        offsetY: c * 0.018,
        rotate: s * 0.22,
        scaleX: 1 - Math.abs(s) * 0.05,
        raiseL: 0.45 + s * 0.35, raiseR: 0.45 - s * 0.35,
        legOutL: Math.max(0, s) * 0.40, legOutR: Math.max(0, -s) * 0.40,
      };
    },
  },
  {
    id: 'party', name: '狂欢', emoji: '🎉',
    desc: '双手一起举高挥动，跳得最起劲',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const s2 = Math.sin(t * Math.PI * 4);
      return {
        offsetY: -Math.abs(s) * 0.07,
        rotate: s2 * 0.14,
        scaleX: 1 + s2 * 0.05,
        scaleY: 1 - s2 * 0.05,
        raiseL: 0.90 + s2 * 0.10, raiseR: 0.90 - s2 * 0.10,
        legOutL: Math.max(0, s) * 0.45, legOutR: Math.max(0, -s) * 0.45,
      };
    },
  },
];

/**
 * 算一条肢体的「安全抬起上限」：绕关节转到多大角度时，
 * 末端圆还**完全留在画布内**（不会伸出去被裁掉）。
 *
 * 为什么需要它：第一版直接把"举手 90°"写进动作库，结果手臂伸到画布外被裁掉
 * —— 渲染出来像断了半截（实测踩到）。肢体长度是随体型变化的，
 * 固定的角度不可能对所有体型都安全，所以这里按实际几何算出一个上限，
 * 动作库只写「抬起程度 0~1」，渲染时再乘上这个上限。
 *
 * @param limb { sx, sy, ex, ey, r } 关节 / 末端 / 末端半径
 * @param dir  +1 = 往左半边外侧抬，-1 = 往右半边外侧抬
 * @returns 最大安全角度（弧度，正值）
 */
export function maxSafeAngle(limb, dir, box = {}) {
  const W = Math.max(1, Number(box.width) || 256);
  const H = Math.max(1, Number(box.height) || 256);
  const sign = dir < 0 ? -1 : 1;
  const r = Math.max(0, Number(limb.r) || 0);
  // 从 0 开始逐步加大角度，一旦越界就退回上一个安全值。
  // 步长 0.02 rad（约 1.1°）足够细，肉眼看不出上限差这一点。
  let safe = 0;
  for (let a = 0; a <= 1.85; a += 0.02) {
    const p = rotatePoint(limb.sx, limb.sy, limb.ex, limb.ey, sign * a);
    if (p.x - r < 0 || p.x + r > W || p.y - r < 0 || p.y + r > H) break;
    safe = a;
  }
  return safe;
}

/**
 * 绕关节旋转一个点（纯几何，可单测）。
 * 渲染层和测试都走这一个实现 —— 免得"渲染的算法"和"测试的算法"各写一遍，
 * 测试通过但画面是错的（这正是最容易自欺的地方）。
 */
export function rotatePoint(sx, sy, ex, ey, angle) {
  const dx = Number(ex) - Number(sx), dy = Number(ey) - Number(sy);
  const a = Number(angle) || 0;
  const cos = Math.cos(a), sin = Math.sin(a);
  return { x: sx + dx * cos - dy * sin, y: sy + dx * sin + dy * cos };
}

/** 取动作定义（永远返回一个有效对象，未知 id 退回 none） */
export function danceOf(id) {
  return DANCES.find((d) => d.id === id) || DANCES[0];
}

/**
 * 把姿态解算成**渲染层要用的绝对几何**。
 * 单独抽出来是为了能单测「举手的角度确实在动、且幅度不会夸张到穿帮」。
 */
export function dancePose(id, t) {
  const d = danceOf(id);
  if (d.id === 'none' || typeof d.pose !== 'function') {
    return { offsetY: 0, rotate: 0, scaleX: 1, scaleY: 1, armL: 0, armR: 0, legL: 0, legR: 0 };
  }
  const p = d.pose(t) || {};
  const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
  // 兜底 clamp：就算以后动作库写错数值，也不会画出畸形角色
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // ★ 这里返回的是「抬起程度 0~1」，不是角度。
  //   真实角度 = 抬起程度 × 该肢体的安全上限（见 maxSafeAngle）——
  //   这样无论体型大小，举手都不会伸出画布被裁掉（实测踩过）。
  const frac = (v) => clamp(num(v, 0), 0, 1);
  return {
    offsetY: clamp(num(p.offsetY, 0), -0.12, 0.12),
    rotate: clamp(num(p.rotate, 0), -0.45, 0.45),
    scaleX: clamp(num(p.scaleX, 1), 0.85, 1.15),
    scaleY: clamp(num(p.scaleY, 1), 0.85, 1.15),
    // armL/armR/legL/legR 都是"抬起程度"，左右各自由渲染层决定方向
    armL: frac(p.raiseL), armR: frac(p.raiseR),
    legL: frac(p.legOutL), legR: frac(p.legOutR),
  };
}

/**
 * 把角色配置展开成**绘制指令**。
 *
 * 这里刻意不直接调 canvas：指令是纯数据，单测可以断言
 * 「身体多大、耳朵在哪、眼睛间距对不对」，而不需要真的渲染像素。
 * @param cfg 已归一化的角色
 * @param box { width, height } 输出画布尺寸
 */
export function characterPlan(cfg, box = {}) {
  const c = normalizeCharacter(cfg);
  const W = Math.max(16, Math.round(Number(box.width) || 256));
  const H = Math.max(16, Math.round(Number(box.height) || 256));
  const pal = paletteOf(c.paletteId);

  // 主体占据画布：size 决定"身体宽度占画布的百分比"
  // 尺寸要按"身体 + 四肢"的整体来定，而不是只看身体 ——
  // 否则脚会踩出画布下沿、举手会伸出左右（实测踩到：脚静止时就 y>256 了）。
  const bodyW = W * (0.38 + 0.40 * c.size);
  const bodyH = H * (0.34 + 0.34 * c.size);
  const cx = W / 2;
  const cy = H / 2 - H * 0.02;                 // 略往上，给脚和耳朵都留空间
  const body = { x: cx - bodyW / 2, y: cy - bodyH / 2, w: bodyW, h: bodyH, shape: c.bodyShape };

  // 耳朵贴在身体顶部
  const earW = bodyW * 0.30;
  const earH = bodyH * 0.30;
  const ears = [];
  if (c.earType !== 'none') {
    const dx = bodyW * 0.28;
    const topY = body.y + bodyH * 0.06;
    ears.push({ side: 'left', type: c.earType, x: cx - dx - earW / 2, y: topY - earH, w: earW, h: earH });
    ears.push({ side: 'right', type: c.earType, x: cx + dx - earW / 2, y: topY - earH, w: earW, h: earH });
  }

  // 眼睛：在身体上部，间距由 eyeGap 控制
  const eyeR = bodyW * (0.055 + 0.075 * c.eyeSize);
  const eyeY = body.y + bodyH * 0.36;
  const eyeDx = bodyW * (0.10 + 0.22 * c.eyeGap);
  const eyes = [
    { side: 'left', type: c.eyeType, cx: cx - eyeDx, cy: eyeY, r: eyeR },
    { side: 'right', type: c.eyeType, cx: cx + eyeDx, cy: eyeY, r: eyeR },
  ];

  // 嘴：眼睛下方
  const mouth = { type: c.mouthType, cx, cy: body.y + bodyH * 0.53, w: bodyW * 0.16, h: bodyH * 0.07 };

  // 腮红：眼睛外侧
  const blushR = bodyW * 0.085;
  const blushes = c.blush ? [
    { cx: cx - eyeDx - bodyW * 0.10, cy: mouth.cy - bodyH * 0.03, r: blushR },
    { cx: cx + eyeDx + bodyW * 0.10, cy: mouth.cy - bodyH * 0.03, r: blushR },
  ] : [];

  // 手脚：**带关节的短肢**（肩/髋 -> 末端圆手/圆脚），而不是孤零零的圆点。
  // 为什么必须是"关节 + 胶囊"：跳舞要绕肩/髋旋转，圆点转了还是圆点（看不出在动），
  // 而胶囊从关节画到末端 —— 旋转后**由我们重新画一遍**，所以不存在
  // "照片转过去露出没画过的内侧"那种信息缺失问题。
  // 关节贴在身体边缘、末端伸到身体外 —— 否则整条肢被身体挡住，
  // 旋转再大也"看不见在动"（第一版就是这样，渲染出来只有几个小疙瘩）。
  const handR = bodyW * 0.115;
  const armW = bodyW * 0.095;
  const hands = c.arms ? [
    { side: 'left', dir: 1, sx: body.x + bodyW * 0.16, sy: body.y + bodyH * 0.38,
      ex: body.x + bodyW * 0.02, ey: body.y + bodyH * 0.74, r: handR, w: armW },
    { side: 'right', dir: -1, sx: body.x + bodyW * 0.84, sy: body.y + bodyH * 0.38,
      ex: body.x + bodyW * 0.98, ey: body.y + bodyH * 0.74, r: handR, w: armW },
  ] : [];
  const footR = bodyW * 0.13;
  const legW = bodyW * 0.105;
  const feet = c.legs ? [
    { side: 'left', dir: 1, sx: cx - bodyW * 0.21, sy: body.y + bodyH * 0.84,
      ex: cx - bodyW * 0.23, ey: body.y + bodyH * 1.06, r: footR, w: legW },
    { side: 'right', dir: -1, sx: cx + bodyW * 0.21, sy: body.y + bodyH * 0.84,
      ex: cx + bodyW * 0.23, ey: body.y + bodyH * 1.06, r: footR, w: legW },
  ] : [];

  // 尾巴：身体右下角外侧
  const tail = c.tail ? {
    x1: body.x + bodyW * 0.92, y1: body.y + bodyH * 0.70,
    x2: body.x + bodyW * 1.24, y2: body.y + bodyH * 0.52,
    w: bodyW * 0.075,
  } : null;

  // 肚皮：身体内的浅色椭圆
  const belly = { x: cx, y: body.y + bodyH * 0.62, rx: bodyW * 0.30, ry: bodyH * 0.24 };

  // 每条肢体的"安全抬起上限"：动作库只给 0~1 的程度，真实角度 = 程度 × 上限，
  // 这样任何体型举手都不会伸出画布（实测踩过：写死 90° 会把手裁掉）。
  for (const h of hands) h.maxOut = maxSafeAngle(h, h.dir, { width: W, height: H });
  for (const ft of feet) ft.maxOut = maxSafeAngle(ft, ft.dir, { width: W, height: H });

  return { width: W, height: H, palette: pal, body, ears, eyes, mouth, blushes, hands, feet, tail, belly, cfg: c };
}

/**
 * 生成一批**动画帧**的角色参数。
 * 「造宠物」的产出应该本来就是动的 —— 只有一帧的宠物只能靠 idleAnim 呼吸。
 * 这里用简单的正弦上下浮动 + 轻微挤压，得到 8 帧无缝循环。
 */
export function characterFrames(cfg, count = 8) {
  const c = normalizeCharacter(cfg);
  const dance = c.dance;
  const n = Math.max(2, Math.min(48, Math.round(Number(count) || 8)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;                                // 0..1，不含 1 -> 首尾自然接上
    const bob = Math.sin(t * Math.PI * 2);          // -1..1 上下浮动
    const squash = Math.cos(t * Math.PI * 2);        // 1..-1 挤压
    // 舞蹈姿态叠加在基础浮动上；dance='none' 时姿态全为 0 -> 外观与旧版完全一致
    const p = dancePose(dance, t);
    out.push({
      index: i,
      // 跳舞时帧间隔短一点更跟拍；不跳时保持原来的 110ms
      durationMs: dance === 'none' ? 110 : 90,
      offsetY: bob * 0.03 + p.offsetY,   // 相对画布高度的比例
      scaleX: (1 + squash * 0.02) * p.scaleX,
      scaleY: (1 - squash * 0.02) * p.scaleY,
      rotate: p.rotate,
      armL: p.armL, armR: p.armR,
      legL: p.legL, legR: p.legR,
    });
  }
  return out;
}

/** 「随机一只」：给不想调参数、只想快速来一只的用户 */
export function randomCharacter(rng = Math.random) {
  const r = typeof rng === 'function' ? rng : Math.random;
  const at = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  return normalizeCharacter({
    name: '随机小人',
    bodyShape: at(BODY_SHAPES),
    earType: at(EAR_TYPES),
    eyeType: at(EYE_TYPES),
    mouthType: at(MOUTH_TYPES),
    paletteId: at(PALETTES).id,
    size: 0.55 + r() * 0.35,
    eyeGap: 0.4 + r() * 0.4,
    eyeSize: 0.35 + r() * 0.45,
    blush: r() > 0.3,
    tail: r() > 0.5,
    arms: true,
    legs: true,
    // 随机时多数不跳（不然每次都是"蹦迪现场"），偶尔来一个
    dance: r() > 0.55 ? at(DANCE_IDS.filter((x) => x !== 'none')) : 'none',
  });
}
