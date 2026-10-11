// 宠物库偏好：收藏 + 最近使用
//
// 设计要点
// - 按「宠物 id」记录，不写进 .petpack（用户的偏好不该污染可分享的宠物包）
// - 存 userData/library.json，与 positions.json 同级
// - 纯逻辑与磁盘 IO 分离：本模块只处理数据结构，读写在 main.js 注入
//   （这样排序/裁剪/去重这些容易出错的规则可以直接单测）
export const RECENT_MAX = 12;   // 最近使用最多记 12 条

export function emptyState() { return { favorites: [], recent: [], groups: [] }; }

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
    groups: normalizeGroups(s.groups),
  };
}

// ---------- 分组 ----------
// 用户宠物多了之后需要归类（"工作用的"/"表情包"/"给孩子的"…）。
// 设计：
//   - 一个宠物可以在**多个**分组里（比"只能属于一个文件夹"更实用）
//   - 分组名唯一（重名会让用户分不清），id 由名字派生但保证唯一
//   - 坏数据一律丢掉，不能让一个畸形分组把整个库打不开
export const MAX_GROUPS = 40;
export const MAX_GROUP_NAME = 24;

/** 分组 id：从名字派生，只保留字母数字与中文，保证稳定且可读 */
export function groupIdOf(name) {
  const base = String(name == null ? '' : name).trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return base || 'group';
}

/**
 * 归一化分组列表：丢坏数据、去重 id、限个数与名字长度。
 * @returns [{ id, name, pets: [petId, ...] }]
 */
export function normalizeGroups(raw) {
  const out = [];
  const usedIds = new Set();
  const usedNames = new Set();
  for (const g of Array.isArray(raw) ? raw : []) {
    if (!g || typeof g !== 'object') continue;
    let name = String(g.name == null ? '' : g.name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!name) continue;
    const cps = Array.from(name);
    if (cps.length > MAX_GROUP_NAME) name = cps.slice(0, MAX_GROUP_NAME).join('');
    if (usedNames.has(name)) continue;                    // 重名直接跳过
    let id = String(g.id == null ? '' : g.id).trim();
    if (!id) id = groupIdOf(name);
    let n = 1, base = id;
    while (usedIds.has(id)) { n++; id = base + '-' + n; }
    const pets = [];
    for (const pid of Array.isArray(g.pets) ? g.pets : []) {
      if (typeof pid !== 'string' || !pid) continue;
      if (!pets.includes(pid)) pets.push(pid);
    }
    usedIds.add(id);
    usedNames.add(name);
    out.push({ id, name, pets });
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

/** 新建一个分组；重名或超限时返回 { ok:false, reason } */
export function addGroup(state, name) {
  const s = normalizeState(state);
  let nm = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!nm) return { ok: false, reason: '分组名不能为空', state: s };
  const cps = Array.from(nm);
  if (cps.length > MAX_GROUP_NAME) nm = cps.slice(0, MAX_GROUP_NAME).join('');
  if (s.groups.some((g) => g.name === nm)) return { ok: false, reason: '已经有同名分组了', state: s };
  if (s.groups.length >= MAX_GROUPS) return { ok: false, reason: '分组太多了（最多 ' + MAX_GROUPS + ' 个）', state: s };
  let id = groupIdOf(nm), n = 1, base = id;
  while (s.groups.some((g) => g.id === id)) { n++; id = base + '-' + n; }
  s.groups.push({ id, name: nm, pets: [] });
  return { ok: true, id, state: s };
}

/** 删除分组（宠物本身不动） */
export function removeGroup(state, id) {
  const s = normalizeState(state);
  s.groups = s.groups.filter((g) => g.id !== id);
  return s;
}

/** 重命名分组（重名则拒绝） */
export function renameGroup(state, id, name) {
  const s = normalizeState(state);
  let nm = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!nm) return { ok: false, reason: '分组名不能为空', state: s };
  const cps = Array.from(nm);
  if (cps.length > MAX_GROUP_NAME) nm = cps.slice(0, MAX_GROUP_NAME).join('');
  if (s.groups.some((g) => g.id !== id && g.name === nm)) return { ok: false, reason: '已经有同名分组了', state: s };
  const g = s.groups.find((x) => x.id === id);
  if (!g) return { ok: false, reason: '分组不存在', state: s };
  g.name = nm;
  return { ok: true, state: s };
}

/** 把宠物加入分组（已在里面则幂等） */
export function addToGroup(state, id, petId) {
  const s = normalizeState(state);
  if (typeof petId !== 'string' || !petId) return { ok: false, reason: '宠物 id 无效', state: s };
  const g = s.groups.find((x) => x.id === id);
  if (!g) return { ok: false, reason: '分组不存在', state: s };
  if (!g.pets.includes(petId)) g.pets.push(petId);
  return { ok: true, state: s };
}

/** 把宠物移出分组（不在里面则幂等） */
export function removeFromGroup(state, id, petId) {
  const s = normalizeState(state);
  const g = s.groups.find((x) => x.id === id);
  if (!g) return { ok: false, reason: '分组不存在', state: s };
  g.pets = g.pets.filter((x) => x !== petId);
  return { ok: true, state: s };
}

/** 某只宠物在哪些分组里（库里展示标签用） */
export function groupsOf(state, petId) {
  const s = normalizeState(state);
  return s.groups.filter((g) => g.pets.includes(petId));
}

/** 清掉已不存在的宠物的分组残留（删除宠物时调用） */
export function pruneGroups(state, aliveIds) {
  const s = normalizeState(state);
  const alive = new Set(Array.isArray(aliveIds) ? aliveIds : []);
  for (const g of s.groups) g.pets = g.pets.filter((p) => alive.has(p));
  return s;
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
  for (const g of s.groups) g.pets = g.pets.filter((p) => p !== id);
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
  else if (scope.startsWith('group:')) {
    // 按分组筛选：scope 形如 group:<groupId>
    const gid = scope.slice('group:'.length);
    const g = s.groups.find((x) => x.id === gid);
    const ids = new Set(g ? g.pets : []);
    list = list.filter((it) => ids.has(it.id));
  }
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
