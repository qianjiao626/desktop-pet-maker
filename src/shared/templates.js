// 桌宠「性格模板」：把一堆参数打包成几个一拍即合的预设。
//
// 为什么需要：参数面板有 20+ 项（动画/物理/气泡/行为），新手不知道该配成什么。
// 模板只覆盖**性格相关**的参数（怎么动、怎么说话、活泼还是安静），
// 不碰用户已经调好的抠图/画布/外观（避免"一键模板把我的图搞坏了"）。
//
// 纯逻辑、可单测：模板定义与合并规则都在这里，UI 只负责取值与写回。

/** 模板定义。每个模板是一组「部分覆盖」(partial patch)。 */
export const PERSONALITY_TEMPLATES = [
  {
    id: 'lively',
    name: '活泼好动',
    emoji: '🐰',
    desc: '蹦蹦跳跳、四处溜达、话多',
    patch: {
      animation: { idle: 'breathe', idleSpeed: 1.35, click: 'jump', hover: 'grow', fps: 12 },
      physics: { gravity: 1.3, bounce: 0.72, friction: 0.99, roam: true, roamSpeed: 1.6, throwScale: 1.2 },
      bubble: { enabled: true, intervalSec: 9, durationSec: 3.0 },
      behavior: { bugChase: true },
    },
    flags: { hop: true, look: true, walk: true },
  },
  {
    id: 'gentle',
    name: '温顺安静',
    emoji: '🌙',
    desc: '慢慢晃、偶尔说话、不闹腾',
    patch: {
      animation: { idle: 'breathe', idleSpeed: 0.75, click: 'bounce', hover: 'grow', fps: 10 },
      physics: { gravity: 1.0, bounce: 0.35, friction: 0.975, roam: true, roamSpeed: 0.55, throwScale: 0.8 },
      bubble: { enabled: true, intervalSec: 24, durationSec: 3.6 },
      behavior: { bugChase: false },
    },
    flags: { hop: false, look: true, walk: true },
  },
  {
    id: 'sleepy',
    name: '贪睡宅家',
    emoji: '😴',
    desc: '几乎不挪窝、话很少',
    patch: {
      animation: { idle: 'breathe', idleSpeed: 0.6, click: 'bounce', hover: 'grow', fps: 8 },
      physics: { gravity: 1.0, bounce: 0.25, friction: 0.96, roam: false, roamSpeed: 0.25, throwScale: 0.6 },
      bubble: { enabled: true, intervalSec: 45, durationSec: 4.0 },
      behavior: { bugChase: false },
    },
    flags: { hop: false, look: false, walk: false },
  },
  {
    id: 'clingy',
    name: '粘人跟手',
    emoji: '🥺',
    desc: '总盯着你、凑热闹、爱蹦',
    patch: {
      animation: { idle: 'breathe', idleSpeed: 1.1, click: 'bounce', hover: 'grow', fps: 12 },
      physics: { gravity: 1.2, bounce: 0.6, friction: 0.985, roam: true, roamSpeed: 1.1, throwScale: 1.0 },
      bubble: { enabled: true, intervalSec: 7, durationSec: 3.2 },
      behavior: { bugChase: true },
    },
    flags: { hop: true, look: true, walk: true },
  },
  {
    id: 'quiet',
    name: '静默摆件',
    emoji: '🪨',
    desc: '不动不说话，只当装饰',
    patch: {
      animation: { idle: 'breathe', idleSpeed: 0.85, click: 'bounce', hover: 'grow', fps: 10 },
      physics: { gravity: 1.2, bounce: 0.2, friction: 0.95, roam: false, roamSpeed: 0, throwScale: 0.5 },
      bubble: { enabled: false, intervalSec: 60, durationSec: 3 },
      behavior: { bugChase: false },
    },
    flags: { hop: false, look: false, walk: false },
  },
];

export function findTemplate(id) {
  return PERSONALITY_TEMPLATES.find((t) => t.id === id) || null;
}

/** 只在这些字段上做合并；其它字段（画布/帧/外观/抠图）原样保留。 */
function mergeSection(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    // 只覆盖模板声明过的字段；undefined 不写入（避免把默认值抹掉）
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * 把模板套用到宠物包上（纯函数，不改原对象）。
 * 刻意**不动**：frames / canvas / render / id / name / author / createdAt / clip，
 * 避免"一键模板"把用户上传的图片或尺寸改坏。
 */
export function applyTemplate(pack, templateId) {
  const t = findTemplate(templateId);
  if (!pack || typeof pack !== 'object') return pack;
  if (!t) return pack;

  const out = { ...pack };
  out.animation = mergeSection(pack.animation, t.patch.animation);
  out.physics = mergeSection(pack.physics, t.patch.physics);
  out.bubble = mergeSection(pack.bubble, t.patch.bubble);
  out.behavior = mergeSection(pack.behavior, t.patch.behavior);
  return out;
}

/** 模板会改变哪些「快速条开关」（让 UI 能同步那些勾选框） */
export function templateFlags(templateId) {
  const t = findTemplate(templateId);
  return t ? { ...t.flags } : null;
}

/**
 * 从当前包反推最接近的模板（用于 UI 高亮）。
 * 只比对照模板声明过的字段；完全相同才算匹配。
 */
export function matchTemplate(pack) {
  if (!pack) return null;
  for (const t of PERSONALITY_TEMPLATES) {
    let ok = true;
    for (const [sec, patch] of Object.entries(t.patch)) {
      for (const [k, v] of Object.entries(patch)) {
        if (pack[sec] ? pack[sec][k] !== v : false) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) return t.id;
  }
  return null;
}
