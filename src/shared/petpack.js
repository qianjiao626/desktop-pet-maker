// 宠物包规范：默认值 / 归一化 / 校验（主进程使用，权威实现）
// schema 2：支持多帧（精灵表/逐帧），并向后兼容 schema 1 的 image/imageSize
export const SCHEMA_VERSION = 2;

export const DEFAULT_PACK = {
  schema: SCHEMA_VERSION,
  id: '',
  name: '我的桌宠',
  author: '',
  createdAt: '',
  // 帧序列：file 为包内文件名，durationMs 为该帧停留毫秒
  frames: [{ file: 'pet.png', durationMs: 120 }],
  // 统一画布尺寸（所有帧按此归一化，避免抖动）
  canvas: { width: 0, height: 0 },
  render: {
    scale: 0.3,
    flip: false,
  },
  animation: {
    clip: 'idle',      // 保留字段，运行时以 idle/click 为准
    idle: 'breathe',   // breathe | sway | play(循环精灵集) | once | none
    idleSpeed: 1,
    fps: 12,           // play/once 模式下的默认帧率
    click: 'bounce',   // bounce | jump | shake | spin | none
    hover: 'grow',     // grow | none
  },
  physics: {
    gravity: 1.2,
    bounce: 0.55,
    friction: 0.985,
    roam: true,
    roamSpeed: 1,
    throwScale: 1,
  },
  bubble: {
    enabled: true,
    lines: ['你好呀～', '点我一下试试？', '今天也要加油哦！'],
    intervalSec: 14,
    durationSec: 3.2,
  },
  behavior: {
    startCorner: 'bottom-right', // bottom-right | bottom-left | center | remember
    keepAbove: true,
    bugChase: true,   // 是否开启「抓虫子」小玩法
  },
};

function num(v, dflt, min, max) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
}
function str(v, dflt, maxLen = 200) {
  if (typeof v !== 'string') return dflt;
  const s = v.trim();
  return s.length ? s.slice(0, maxLen) : dflt;
}
function pick(v, allowed, dflt) {
  return allowed.includes(v) ? v : dflt;
}
function lines(v, dflt) {
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
    if (arr.length) return arr;
  }
  if (typeof v === 'string') {
    const arr = v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50);
    if (arr.length) return arr;
  }
  return dflt;
}

export const IDLE_ANIMS = ['breathe', 'sway', 'play', 'once', 'none'];
export const CLICK_ANIMS = ['bounce', 'jump', 'shake', 'spin', 'none'];
export const HOVER_ANIMS = ['grow', 'none'];
export const CORNERS = ['bottom-right', 'bottom-left', 'center', 'remember'];

function normalizeFrames(i) {
  let raw = i.frames;
  // 向后兼容 schema 1
  if (!Array.isArray(raw) || raw.length === 0) {
    if (i.image) raw = [{ file: i.image, durationMs: 120 }];
    else return DEFAULT_PACK.frames.map((f) => ({ ...f }));
  }
  const out = [];
  for (const f of raw.slice(0, 240)) {
    if (!f) continue;
    if (typeof f === 'string') { out.push({ file: str(f, 'pet.png', 160), durationMs: 120 }); continue; }
    const file = str(f.file, '', 160);
    if (!file) continue;
    out.push({ file, durationMs: Math.round(num(f.durationMs, 120, 16, 5000)) });
  }
  return out.length ? out : DEFAULT_PACK.frames.map((f) => ({ ...f }));
}

export function normalizePack(input = {}) {
  const d = DEFAULT_PACK;
  const i = input || {};
  const ren = i.render || {};
  const ani = i.animation || {};
  const phy = i.physics || {};
  const bub = i.bubble || {};
  const beh = i.behavior || {};

  const frames = normalizeFrames(i);
  // 画布尺寸：优先 canvas，其次 imageSize（兼容），再次取首帧估计
  const canvas = i.canvas || {};
  const legacy = i.imageSize || {};
  const cw = num(canvas.width, num(legacy.width, 0, 0, 8192), 0, 8192);
  const ch = num(canvas.height, num(legacy.height, 0, 0, 8192), 0, 8192);

  return {
    schema: SCHEMA_VERSION,
    id: str(i.id, ''),
    name: str(i.name, d.name, 40),
    author: str(i.author, '', 40),
    createdAt: str(i.createdAt, new Date().toISOString(), 40),
    frames,
    canvas: { width: Math.round(cw), height: Math.round(ch) },
    render: {
      scale: num(ren.scale, d.render.scale, 0.05, 4),
      flip: !!ren.flip,
    },
    animation: {
      clip: str(ani.clip, d.animation.clip, 40),
      idle: pick(ani.idle, IDLE_ANIMS, d.animation.idle),
      idleSpeed: num(ani.idleSpeed, d.animation.idleSpeed, 0.2, 3),
      fps: Math.round(num(ani.fps, d.animation.fps, 1, 60)),
      click: pick(ani.click, CLICK_ANIMS, d.animation.click),
      hover: pick(ani.hover, HOVER_ANIMS, d.animation.hover),
    },
    physics: {
      gravity: num(phy.gravity, d.physics.gravity, 0, 6),
      bounce: num(phy.bounce, d.physics.bounce, 0, 0.95),
      friction: num(phy.friction, d.physics.friction, 0.8, 1),
      roam: phy.roam === undefined ? d.physics.roam : !!phy.roam,
      roamSpeed: num(phy.roamSpeed, d.physics.roamSpeed, 0, 3),
      throwScale: num(phy.throwScale, d.physics.throwScale, 0, 4),
    },
    bubble: {
      enabled: bub.enabled === undefined ? d.bubble.enabled : !!bub.enabled,
      lines: lines(bub.lines, d.bubble.lines),
      intervalSec: num(bub.intervalSec, d.bubble.intervalSec, 3, 600),
      durationSec: num(bub.durationSec, d.bubble.durationSec, 0.8, 60),
    },
    behavior: {
      startCorner: pick(beh.startCorner, CORNERS, d.behavior.startCorner),
      keepAbove: beh.keepAbove === undefined ? d.behavior.keepAbove : !!beh.keepAbove,
      bugChase: beh.bugChase === undefined ? d.behavior.bugChase : !!beh.bugChase,
    },
  };
}

export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') {
    errors.push('宠物包内容为空');
    return { ok: false, errors };
  }
  if (!pack.name) errors.push('缺少宠物名称');
  const frames = pack.frames;
  if (!Array.isArray(frames) || frames.length === 0) errors.push('至少需要一帧图片');
  else {
    for (const f of frames) {
      if (!f || !f.file) { errors.push('存在无文件名的帧'); break; }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 兼容旧字段：对外仍提供 image / imageSize 视图 */
export function packPrimaryImage(pack) {
  return (pack.frames && pack.frames[0] && pack.frames[0].file) || pack.image || 'pet.png';
}
export function packImageSize(pack) {
  if (pack.canvas && (pack.canvas.width || pack.canvas.height)) return pack.canvas;
  return pack.imageSize || { width: 0, height: 0 };
}