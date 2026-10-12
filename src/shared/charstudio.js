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
/** 形体：pet = 圆滚滚的小宠物；human = 有头有身子的小人 */
export const FIGURE_TYPES = ['pet', 'human'];
/** 可选舞蹈 id（定义在下面的 DANCES；这里先声明是为了 normalizeCharacter 能用） */
export const DANCE_IDS = ['none', 'bounce', 'wave', 'twist', 'step', 'nod', 'spin', 'greet', 'party'];

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
  figureType: 'pet',// 形体：pet 圆滚滚 / human 小人
});

/**
 * 归一化「身体比例」（占整身高度的比例）。
 * 从照片推出来的比例可能离谱（识别抖动），这里统一 clamp 到"人样"的范围 ——
 * 宁可不太像，也绝不能画成怪物。
 */
/**
 * 归一化「自定义配色」（来自"照照片捏小人"取到的主色）。
 * 只接受合法的 #rrggbb；任何一项不合法就整套作废（宁可回退到预设，也不要半套脏色）。
 */
export function normCustomPalette(input) {
  const o = (input && typeof input === 'object') ? input : null;
  if (!o) return null;
  const hex = (v) => {
    const t = String(v == null ? '' : v).trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(t) ? t : null;
  };
  const body = hex(o.body), belly = hex(o.belly), accent = hex(o.accent);
  if (!body || !belly || !accent) return null;
  return { body, belly, accent, source: String(o.source || 'custom').slice(0, 20) };
}

export function normProportions(input) {
  const o = (input && typeof input === 'object') ? input : {};
  const d = { head: 0.28, torso: 0.38, leg: 0.24, arm: 0.42 };
  const one = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return n < lo ? lo : n > hi ? hi : n;
  };
  return {
    head: one(o.head, 0.20, 0.46, d.head),
    torso: one(o.torso, 0.24, 0.55, d.torso),
    leg: one(o.leg, 0.12, 0.42, d.leg),
    arm: one(o.arm, 0.16, 0.55, d.arm),
  };
}

/** 归一化「基础姿势」（各肢体的抬起程度 0~1） */
export function normBasePose(input) {
  const o = (input && typeof input === 'object') ? input : {};
  const one = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  };
  return { armL: one(o.armL), armR: one(o.armR), legL: one(o.legL), legR: one(o.legR) };
}

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
    figureType: pick(FIGURE_TYPES, o.figureType, d.figureType),
    // 由「照照片捏小人」写入的比例与基础姿势（可选；不填就用默认比例）
    proportions: normProportions(o.proportions),
    basePose: normBasePose(o.basePose),
    customPalette: normCustomPalette(o.customPalette),
  };
}

/** 取调色板（永远返回一个有效对象） */
export function paletteOf(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

/**
 * 取"最终要用的调色板"：有自定义配色就用它，否则用预设。
 * 单独抽出来是因为调用点很多，规则必须只有一份。
 * @param cfg 角色配置（或已归一化的 cfg）
 */
export function effectivePalette(cfg) {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const custom = normCustomPalette(c.customPalette);
  if (custom) return { id: 'custom', name: '照片取色', body: custom.body, belly: custom.belly, accent: custom.accent };
  return paletteOf(c.paletteId);
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
    id: 'step', name: '侧步', emoji: '🚶',
    desc: '左右踏步，身体跟着横向摆动',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        // 左右踏步：横向位移是主角（这是 offsetX 通道存在的理由）
        offsetX: s * 0.06,
        offsetY: -Math.abs(c) * 0.03,
        rotate: -s * 0.12,
        // 迈出去的那条腿抬起来，另一条踩实
        legOutL: Math.max(0, s) * 0.55, legOutR: Math.max(0, -s) * 0.55,
        raiseL: 0.20 + Math.max(0, -s) * 0.30, raiseR: 0.20 + Math.max(0, s) * 0.30,
      };
    },
  },
  {
    id: 'nod', name: '点头', emoji: '🙂',
    desc: '头一点一点的，像在认真听你说话',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const s2 = Math.sin(t * Math.PI * 4);
      return {
        // 点头幅度：第一版给 0.22，渲染出来几乎看不出（和静止一样）。
        // 现在加大到 0.42 —— 仍然克制（不到 25 度），但肉眼能看清在点头。
        nod: s2 * 0.42,
        offsetY: s * 0.012,
        rotate: s2 * 0.02,
        raiseL: 0.12 + s * 0.10, raiseR: 0.12 - s * 0.10,
        legOutL: 0, legOutR: 0,
      };
    },
  },
  {
    id: 'spin', name: '转圈', emoji: '🌀',
    desc: '左右转头看来看去，双手跟着摆',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const c = Math.cos(t * Math.PI * 2);
      return {
        // turn 是把头 + 五官偏移，不是整幅图翻面（那样会连身体一起反）
        turn: s,
        tilt: c * 0.16,          // 顺带歪歪头，更俏皮
        nod: Math.max(0, c) * 0.35,
        offsetY: c * 0.02,
        rotate: s * 0.10,
        raiseL: 0.30 + Math.max(0, s) * 0.45, raiseR: 0.30 + Math.max(0, -s) * 0.45,
        legOutL: Math.max(0, s) * 0.20, legOutR: Math.max(0, -s) * 0.20,
      };
    },
  },
  {
    id: 'greet', name: '打招呼', emoji: '🤚',
    desc: '一只手举高挥，头轻轻点一下，像在跟你问好',
    pose(t) {
      const s = Math.sin(t * Math.PI * 2);
      const s2 = Math.sin(t * Math.PI * 4);
      return {
        raiseL: 0.85 + s2 * 0.15,   // 举着手挥
        raiseR: 0.10 + s * 0.10,
        nod: s2 * 0.24,
        offsetY: s * 0.010,
        rotate: -s * 0.03,
        legOutL: 0, legOutR: 0,
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
    return { offsetX: 0, offsetY: 0, rotate: 0, scaleX: 1, scaleY: 1, nod: 0, tilt: 0, turn: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
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
    // 水平位移（比例，相对画布宽）：做"左右踏步"这类动作必需 ——
    // 只有上下浮动时，怎么动都像原地弹，不像在跳舞。
    // 上限比竖直更保守（0.08）：横着挪太多会撞到画布边缘被裁掉。
    offsetX: clamp(num(p.offsetX, 0), -0.08, 0.08),
    offsetY: clamp(num(p.offsetY, 0), -0.12, 0.12),
    rotate: clamp(num(p.rotate, 0), -0.45, 0.45),
    scaleX: clamp(num(p.scaleX, 1), 0.85, 1.15),
    scaleY: clamp(num(p.scaleY, 1), 0.85, 1.15),
    // 点头：头**往下沉 + 竖直压扁**（正面小人的点头是透视缩短，不是平面旋转）。
    //   ★ 踩过的坑：第一版用平面内 rotate 做"点头"，那画出来其实是**歪头**
    //   （脑袋左右倒），完全不是点头的意思。正面角色的点头必须靠"下压 + 压扁"。
    nod: clamp(num(p.nod, 0), -1, 1),
    // 歪头：平面内旋转（可爱的小动作），与点头是两回事
    tilt: clamp(num(p.tilt, 0), -0.5, 0.5),
    // 转身：只把**头 + 五官**镜像过来，像侧过头去看，而不是整幅图翻面
    turn: clamp(num(p.turn, 0), -1, 1),
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
  const pal = effectivePalette(c);

  // 主体占据画布：size 决定"身体宽度占画布的百分比"
  // 尺寸要按"身体 + 四肢"的整体来定，而不是只看身体 ——
  // 否则脚会踩出画布下沿、举手会伸出左右（实测踩到：脚静止时就 y>256 了）。
  const bodyW = W * (0.38 + 0.40 * c.size);
  const bodyH = H * (0.34 + 0.34 * c.size);
  const cx = W / 2;
  const cy = H / 2 - H * 0.02;                 // 略往上，给脚和耳朵都留空间
  let body = { x: cx - bodyW / 2, y: cy - bodyH / 2, w: bodyW, h: bodyH, shape: c.bodyShape };

  // ★ 人形：头 + 身子分开（宠物是"头身一体"的圆滚滚，小人是"有头有身子"）。
  //   这是用户最初那句「人人都可以绘制一个自己的**小人**」的核心 ——
  //   之前工坊只能捏出圆滚滚的宠物，捏不出人。
  //   做法：身体框只留"躯干"，头单独一个圆放在上方，五官画在头上，
  //   手脚的关节挂在躯干上 —— 这样跳舞时头不动、身子和四肢动，像人。
  const isHuman = c.figureType === 'human';
  let head = null;
  if (isHuman) {
    // ★ 小人要**自上而下排布**，并把总高限制在画布内。
    //   第一版凭感觉给了 headR = bodyW*0.62 且头放在 cy 上方 ——
    //   结果头大到冲出画布顶部、脖子只剩两个小圆点（渲染出来一眼就废）。
    //   正确做法：先定总高，再按比例切分「头 : 脖子 : 躯干 : 腿」。
    const totalH = H * (0.52 + 0.34 * c.size);   // 整个人（含腿）占画布高度
    // 比例来自配置（可由「照照片捏小人」写入；默认是一套 Q 版比例）。
    // 先归一化，让"头 + 躯干 + 腿"正好铺满 totalH，不会因为比例之和 ≠ 1 而溢出。
    const pr = normProportions(c.proportions);
    const sum = Math.max(0.1, pr.head + pr.torso + pr.leg);
    const headD = totalH * (pr.head / sum);      // 头的直径
    const torsoH = totalH * (pr.torso / sum);
    const legH = totalH * (pr.leg / sum);
    const headR = headD / 2;
    const gap = totalH * 0.015;                  // 脖子留一点点空隙
    const top = (H - totalH) / 2 - H * 0.02;     // 整体略上移，给脚底留边
    const headCy = top + headR;
    const torsoY = headCy + headR + gap;
    // 躯干要比头**明显窄**，才像"头大身子小"的 Q 版小人。
    // 同时不能窄过头：躯干太细就变火柴人了（实测：1.42 倍头宽时身子比头还宽，很怪）。
    // 还要给躯干一个**下限**，避免"头很小 + 躯干跟着很细"的火柴人效果。
    const torsoW = Math.max(totalH * 0.30, headR * 1.18);
    body = { x: cx - torsoW / 2, y: torsoY, w: torsoW, h: torsoH, shape: c.bodyShape };
    head = { cx, cy: headCy, r: headR };
    // 腿从躯干下缘往下延伸
    body.legH = legH;
  }

  // 耳朵贴在身体顶部
  const earW = bodyW * 0.30;
  const earH = bodyH * 0.30;
  const ears = [];
  if (c.earType !== 'none' && !isHuman) {
    const dx = bodyW * 0.28;
    const topY = body.y + bodyH * 0.06;
    ears.push({ side: 'left', type: c.earType, x: cx - dx - earW / 2, y: topY - earH, w: earW, h: earH });
    ears.push({ side: 'right', type: c.earType, x: cx + dx - earW / 2, y: topY - earH, w: earW, h: earH });
  }

  // 眼睛：宠物画在身体上部；小人画在**头上**（脸的位置）。
  // 头/身分开后五官必须跟着头走，否则脸会长在肚子上（一眼就不像人）。
  const faceW = isHuman && head ? head.r * 1.55 : bodyW;
  const faceCx = isHuman && head ? head.cx : cx;
  const faceCy = isHuman && head ? head.cy : body.y + bodyH * 0.36;
  const eyeR = faceW * (0.055 + 0.075 * c.eyeSize);
  const eyeY = isHuman ? faceCy - head.r * 0.05 : faceCy;
  const eyeDx = faceW * (0.10 + 0.22 * c.eyeGap);
  const eyes = [
    { side: 'left', type: c.eyeType, cx: faceCx - eyeDx, cy: eyeY, r: eyeR },
    { side: 'right', type: c.eyeType, cx: faceCx + eyeDx, cy: eyeY, r: eyeR },
  ];

  // 嘴：眼睛下方
  const mouth = {
    type: c.mouthType, cx: faceCx,
    cy: isHuman ? faceCy + head.r * 0.34 : body.y + bodyH * 0.53,
    w: faceW * 0.16, h: (isHuman ? head.r * 0.36 : bodyH) * 0.20,
  };

  // 腮红：眼睛外侧
  const blushR = faceW * 0.085;
  const blushes = c.blush ? [
    { cx: faceCx - eyeDx - faceW * 0.10, cy: mouth.cy - faceW * 0.06, r: blushR },
    { cx: faceCx + eyeDx + faceW * 0.10, cy: mouth.cy - faceW * 0.06, r: blushR },
  ] : [];

  // 手脚：**带关节的短肢**（肩/髋 -> 末端圆手/圆脚），而不是孤零零的圆点。
  // 为什么必须是"关节 + 胶囊"：跳舞要绕肩/髋旋转，圆点转了还是圆点（看不出在动），
  // 而胶囊从关节画到末端 —— 旋转后**由我们重新画一遍**，所以不存在
  // "照片转过去露出没画过的内侧"那种信息缺失问题。
  // 关节贴在身体边缘、末端伸到身体外 —— 否则整条肢被身体挡住，
  // 旋转再大也"看不见在动"（第一版就是这样，渲染出来只有几个小疙瘩）。
  // 四肢的尺寸与挂点：宠物按身体框算；小人按躯干算，腿往下延伸到 legH。
  const bw = body.w, bh = body.h;
  /**
   * 椭圆身体在某个高度上的**半宽比例**（0~0.5，相对身体宽度）。
   *
   * 为什么需要：躯干/身体是椭圆时，上下两端比中间窄很多。
   * 若把肩按"身体框的 16% 处"来放，在肩膀那个高度其实**已经超出椭圆轮廓**了 ——
   * 渲染出来手臂与身体之间有一道缝，像飘在空中（实测一眼就看出不对）。
   * 这里按椭圆方程算出该高度真正的边缘，让手臂**长在身体上**。
   * @param yFrac 0 = 身体顶，1 = 身体底
   */
  const halfWidthAt = (yFrac) => {
    if (body.shape === 'square') return 0.5;         // 圆角方：上下几乎等宽
    const t = (Math.min(1, Math.max(0, yFrac)) - 0.5) * 2;   // -1..1
    return 0.5 * Math.sqrt(Math.max(0, 1 - t * t));
  };
  const handR = bw * (isHuman ? 0.14 : 0.095);
  const armW = bw * (isHuman ? 0.13 : 0.095);
  // 肩放在"该高度真正的身体边缘"往里一点，保证手臂长在身体上（不飘）
  const shoulderYFrac = isHuman ? 0.22 : 0.38;
  // 必须**完全**收进椭圆轮廓：只收一半会差 2px 落在外面（被守护测试抓到）。
  // 再额外留一点余量，避免椭圆/圆角方的边界误差。
  const shoulderInset = bw * (0.5 - halfWidthAt(shoulderYFrac)) + bw * 0.02;
  const shoulderX = (side) => (side === 'left' ? body.x + shoulderInset : body.x + bw - shoulderInset);
  const bp = normBasePose(c.basePose);
  const hands = c.arms ? [
    { side: 'left', dir: 1, base: bp.armL, sx: shoulderX('left'), sy: body.y + bh * shoulderYFrac,
      ex: body.x + bw * (isHuman ? -0.06 : -0.02), ey: body.y + bh * (isHuman ? 0.74 : 0.78), r: handR, w: armW },
    { side: 'right', dir: -1, base: bp.armR, sx: shoulderX('right'), sy: body.y + bh * shoulderYFrac,
      ex: body.x + bw * (isHuman ? 1.06 : 1.02), ey: body.y + bh * (isHuman ? 0.74 : 0.78), r: handR, w: armW },
  ] : [];
  const footR = bw * (isHuman ? 0.17 : 0.13);
  const legW = bw * (isHuman ? 0.14 : 0.105);
  // 髋同理：放在该高度真正的边缘之内，腿才不会从身体侧面飘出去
  const hipYFrac = isHuman ? 0.96 : 0.84;
  const legSpan = bw * Math.max(0.14, halfWidthAt(hipYFrac) * 0.78);
  const legTop = body.y + bh * (isHuman ? 0.96 : 0.84);
  const legBot = isHuman ? (body.y + bh + (body.legH || 0)) : (body.y + bh * 1.06);
  const feet = c.legs ? [
    { side: 'left', dir: 1, base: bp.legL, sx: cx - legSpan, sy: legTop,
      ex: cx - legSpan * 1.1, ey: legBot, r: footR, w: legW },
    { side: 'right', dir: -1, base: bp.legR, sx: cx + legSpan, sy: legTop,
      ex: cx + legSpan * 1.1, ey: legBot, r: footR, w: legW },
  ] : [];

  // 尾巴：身体右下角外侧
  const tail = (c.tail && !isHuman) ? {
    x1: body.x + bodyW * 0.92, y1: body.y + bodyH * 0.70,
    x2: body.x + bodyW * 1.24, y2: body.y + bodyH * 0.52,
    w: bodyW * 0.075,
  } : null;

  // 肚皮：身体内的浅色椭圆
  const belly = { x: cx, y: body.y + body.h * 0.60, rx: body.w * 0.32, ry: body.h * 0.26 };

  // 每条肢体的"安全抬起上限"：动作库只给 0~1 的程度，真实角度 = 程度 × 上限，
  // 这样任何体型举手都不会伸出画布（实测踩过：写死 90° 会把手裁掉）。
  for (const h of hands) h.maxOut = maxSafeAngle(h, h.dir, { width: W, height: H });
  for (const ft of feet) ft.maxOut = maxSafeAngle(ft, ft.dir, { width: W, height: H });

  return { width: W, height: H, palette: pal, body, head, ears, eyes, mouth, blushes, hands, feet, tail, belly, cfg: c };
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
      offsetX: p.offsetX,
      rotate: p.rotate,
      nod: p.nod,
      tilt: p.tilt,
      turn: p.turn,
      // 舞蹈是**叠加**在基础姿势上的：跳舞时 basePose 取 0（回到自然站立再跳），
      // 不跳时用 basePose —— 这样"照照片捏的小人"不跳时就是他本来的站姿。
      armL: dance === 'none' ? c.basePose.armL : p.armL,
      armR: dance === 'none' ? c.basePose.armR : p.armR,
      legL: dance === 'none' ? c.basePose.legL : p.legL,
      legR: dance === 'none' ? c.basePose.legR : p.legR,
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
