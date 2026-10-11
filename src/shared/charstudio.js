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
  };
}

/** 取调色板（永远返回一个有效对象） */
export function paletteOf(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
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
  const bodyW = W * (0.42 + 0.5 * c.size);
  const bodyH = H * (0.40 + 0.46 * c.size);
  const cx = W / 2;
  const cy = H / 2 + H * 0.06;                 // 略向下，给耳朵留空间
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

  // 手脚：小圆，贴在身体下缘/两侧
  const handR = bodyW * 0.11;
  const hands = c.arms ? [
    { cx: body.x + bodyW * 0.06, cy: body.y + bodyH * 0.62, r: handR },
    { cx: body.x + bodyW * 0.94, cy: body.y + bodyH * 0.62, r: handR },
  ] : [];
  const footR = bodyW * 0.12;
  const feet = c.legs ? [
    { cx: cx - bodyW * 0.20, cy: body.y + bodyH * 0.98, r: footR },
    { cx: cx + bodyW * 0.20, cy: body.y + bodyH * 0.98, r: footR },
  ] : [];

  // 尾巴：身体右下角外侧
  const tail = c.tail ? {
    x1: body.x + bodyW * 0.92, y1: body.y + bodyH * 0.70,
    x2: body.x + bodyW * 1.24, y2: body.y + bodyH * 0.52,
    w: bodyW * 0.075,
  } : null;

  // 肚皮：身体内的浅色椭圆
  const belly = { x: cx, y: body.y + bodyH * 0.62, rx: bodyW * 0.30, ry: bodyH * 0.24 };

  return { width: W, height: H, palette: pal, body, ears, eyes, mouth, blushes, hands, feet, tail, belly, cfg: c };
}

/**
 * 生成一批**动画帧**的角色参数。
 * 「造宠物」的产出应该本来就是动的 —— 只有一帧的宠物只能靠 idleAnim 呼吸。
 * 这里用简单的正弦上下浮动 + 轻微挤压，得到 8 帧无缝循环。
 */
export function characterFrames(cfg, count = 8) {
  const n = Math.max(2, Math.min(48, Math.round(Number(count) || 8)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const bob = Math.sin(t * Math.PI * 2);          // -1..1 上下浮动
    const squash = Math.cos(t * Math.PI * 2);        // 1..-1 挤压
    out.push({
      index: i,
      durationMs: 110,
      offsetY: bob * 0.03,        // 相对画布高度的比例
      scaleX: 1 + squash * 0.02,
      scaleY: 1 - squash * 0.02,
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
  });
}
