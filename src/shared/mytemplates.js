// 「我的模板」：把当前配置存成自定义模板，可复用、可导出、可分享。
//
// 与内置 PERSONALITY_TEMPLATES 的关系：
//   - 内置是 5 个只读预设（代码里写死，改不了）；
//   - 这里是用户自己的模板，存本地 userData/templates.json。
//   - 两者在前端合成同一个列表展示，用户模板可删除、可导出成 .pettpl 文件。
//
// 可导出（用户明确要求）：把模板写成独立文件，发给朋友后对方「导入模板」即可复用。
// 纯逻辑、可单测：不碰磁盘，读写在 main.js 注入。
import { safeFileName } from './safeid.js';

export const TEMPLATE_SCHEMA = 1;
export const CUSTOM_TEMPLATE_MAX = 50;

/** 允许被模板覆盖的段落（与内置模板保持同一套字段，避免模板把用户的图搞坏） */
export const TEMPLATABLE_SECTIONS = ['animation', 'physics', 'bubble', 'behavior'];

/** 归一化模板名：去空白、限长、不许空 */
export function normalizeTemplateName(raw, fallback = '我的模板') {
  const s = String(raw == null ? '' : raw).replace(/[\t\n\r]+/g, ' ').trim();
  return s ? Array.from(s).slice(0, 24).join('') : fallback;
}

/** 只保留模板声明过的字段，防止把画布/帧/图片等混进模板 */
function pickSections(obj) {
  const out = {};
  for (const sec of TEMPLATABLE_SECTIONS) {
    const src = obj && obj[sec];
    if (!src || typeof src !== 'object') continue;
    const dst = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined) continue;
      dst[k] = v;
    }
    out[sec] = dst;
  }
  return out;
}

/**
 * 从当前宠物包抽出模板（纯函数）。
 * 刻意不动 frames / canvas / render / id / name / author —— 模板只描述「性格」。
 */
export function templateFromPack(pack, name, { flags } = {}) {
  const p = pack && typeof pack === 'object' ? pack : {};
  return {
    schema: TEMPLATE_SCHEMA,
    id: 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: normalizeTemplateName(name, '我的模板'),
    emoji: '⭐',
    desc: '我保存的配置',
    builtin: false,
    createdAt: new Date().toISOString(),
    patch: pickSections(p),
    // flags 是「走路/跳跃/看向鼠标/抓虫子」四个快速开关，不属于 pack 字段，
    // 但它们是性格的一部分，所以要单独带着走。
    flags: flags && typeof flags === 'object' ? { ...flags } : undefined,
  };
}

/** 容错归一化单个模板；坏数据返回 null（不能让一个坏模板毁掉整个列表） */
export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const patch = pickSections(raw.patch || raw);
  if (!Object.keys(patch).length) return null;
  return {
    schema: TEMPLATE_SCHEMA,
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'u-' + Math.random().toString(36).slice(2, 10),
    name: normalizeTemplateName(raw.name),
    emoji: typeof raw.emoji === 'string' && raw.emoji ? raw.emoji.slice(0, 4) : '⭐',
    desc: typeof raw.desc === 'string' ? Array.from(raw.desc).slice(0, 60).join('') : '我保存的配置',
    builtin: false,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    patch,
    flags: raw.flags && typeof raw.flags === 'object' ? { ...raw.flags } : undefined,
  };
}

/** 归一化整个列表：去重（按 id）、限数量、丢弃坏数据 */
export function normalizeTemplateList(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const t = normalizeTemplate(item);
    if (!t) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= CUSTOM_TEMPLATE_MAX) break;
  }
  return out;
}

/** 新增（同名则覆盖？不 —— 同名各自保留，靠 id 区分，避免误删用户模板） */
export function addTemplate(list, tpl) {
  const l = normalizeTemplateList(list);
  const t = normalizeTemplate(tpl);
  if (!t) return l;
  return normalizeTemplateList([t, ...l]);
}

/** 删除（按 id） */
export function removeTemplate(list, id) {
  return normalizeTemplateList(list).filter((t) => t.id !== id);
}

/** 重命名（按 id）；名字非法则保持原样 */
export function renameTemplate(list, id, name) {
  const l = normalizeTemplateList(list);
  const t = l.find((x) => x.id === id);
  if (!t) return l;
  t.name = normalizeTemplateName(name, t.name);
  return l;
}

/**
 * 导出的文件名。
 * 注意：不能把 ".pettpl" 拼进去再交给 safeFileName —— 空名字时安全化结果会退化成
 * "pettpl"（首尾的点被当成要清理的字符），丢掉文件名主体。所以先安全化主体、再补后缀。
 */
export function templateFileName(name) {
  const base = safeFileName(name, { maxLen: 60, fallback: 'mytemplate' });
  return base + '.pettpl';
}

/**
 * 把模板套用到宠物包上（与内置 applyTemplate 同样的安全边界：
 * 不动 frames / canvas / render / id / name / author / createdAt）。
 */
export function applyCustomTemplate(pack, tpl) {
  if (!pack || typeof pack !== 'object') return pack;
  const t = normalizeTemplate(tpl);
  if (!t) return pack;
  const out = { ...pack };
  for (const sec of TEMPLATABLE_SECTIONS) {
    const patch = t.patch[sec];
    if (!patch) continue;
    const merged = { ...(pack[sec] || {}) };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
    out[sec] = merged;
  }
  return out;
}

/** 反查：当前包是否与某个自定义模板一致（用于高亮） */
export function matchCustomTemplate(pack, tpl) {
  if (!pack || !tpl) return false;
  const t = normalizeTemplate(tpl);
  if (!t) return false;
  for (const [sec, patch] of Object.entries(t.patch)) {
    for (const [k, v] of Object.entries(patch)) {
      if (!pack[sec] || pack[sec][k] !== v) return false;
    }
  }
  return true;
}
