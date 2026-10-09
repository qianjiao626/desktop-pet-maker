// 宠物库偏好：收藏 + 最近使用
//
// 设计要点
// - 按「宠物 id」记录，不写进 .petpack（用户的偏好不该污染可分享的宠物包）
// - 存 userData/library.json，与 positions.json 同级
// - 纯逻辑与磁盘 IO 分离：本模块只处理数据结构，读写在 main.js 注入
//   （这样排序/裁剪/去重这些容易出错的规则可以直接单测）
export const RECENT_MAX = 12;   // 最近使用最多记 12 条

export function emptyState() { return { favorites: [], recent: [] }; }

/** 容错归一化：坏数据不能让整个库打不开 */
export function normalizeState(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const uniq = (arr, max) => {
    const out = [];
    for (const v of Array.isArray(arr) ? arr : []) {
      if (typeof v !== 'string' || !v) continue;
      if (!out.includes(v)) out.push(v);        // 去重，保留首次出现顺序
      if (max && out.length >= max) break;
    }
    return out;
  };
  return {
    favorites: uniq(s.favorites),
    recent: uniq(s.recent, RECENT_MAX),
  };
}

export function isFavorite(state, id) {
  return normalizeState(state).favorites.includes(id);
}

/** 切换收藏，返回新状态（不改原对象） */
export function toggleFavorite(state, id) {
  const s = normalizeState(state);
  if (typeof id !== 'string' || !id) return s;
  const i = s.favorites.indexOf(id);
  if (i >= 0) s.favorites.splice(i, 1);
  else s.favorites.push(id);
  return s;
}

/** 记一次「使用」，把 id 提到最前（最近使用按时间倒序） */
export function touchRecent(state, id) {
  const s = normalizeState(state);
  if (typeof id !== 'string' || !id) return s;
  s.recent = [id, ...s.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
  return s;
}

/**
 * 移除某个 id 的所有痕迹（删除宠物时调用，避免留幽灵记录）
 */
export function forgetPet(state, id) {
  const s = normalizeState(state);
  s.favorites = s.favorites.filter((x) => x !== id);
  s.recent = s.recent.filter((x) => x !== id);
  return s;
}

/**
 * 过滤 + 排序（前端库列表用）
 * @param {Array} items 已安装宠物 [{id,name,builtin,size,frames,...}]
 * @param {object} opt { query, sort, scope }
 * @param {object} state 偏好状态
 */
export function filterLibrary(items, opt, state) {
  const list0 = Array.isArray(items) ? items.slice() : [];
  const s = normalizeState(state);
  const o = opt || {};
  const q = String(o.query || '').trim().toLowerCase();
  const scope = o.scope || 'all';
  const sort = o.sort || 'name';

  let list = list0;
  if (scope === 'builtin') list = list.filter((it) => it.builtin);
  else if (scope === 'mine') list = list.filter((it) => !it.builtin);
  else if (scope === 'fav') list = list.filter((it) => s.favorites.includes(it.id));
  else if (scope === 'recent') {
    // 最近使用按 recent 的顺序还原（不是按名字排）
    list = s.recent.map((id) => list0.find((it) => it.id === id)).filter(Boolean);
  }
  if (q) list = list.filter((it) => String(it.name || '').toLowerCase().includes(q));

  // 最近使用是「按使用时间」，排序应遵循时间而不是再按名字打乱
  if (scope === 'recent') return list;

  if (sort === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (sort === 'frames') list.sort((a, b) => (b.frames || 0) - (a.frames || 0));
  else list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));

  // 收藏的始终排在前面（但「收藏」分类本身不需要再分组）
  if (scope !== 'fav' && s.favorites.length) {
    list.sort((a, b) => {
      const fa = s.favorites.includes(a.id) ? 0 : 1;
      const fb = s.favorites.includes(b.id) ? 0 : 1;
      return fa - fb;
    });
  }
  return list;
}
