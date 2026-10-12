// 宠物「记住你」：记录互动，慢慢变得更熟（纯逻辑，可单测）。
//
// 参考思路（GitHub 调研）：blairjordan/codachi（MIT，220 stars）的 XP 系统
// 不是简单累加次数，而是用**滑动时间窗口内的活动量**决定"当前状态" ——
// 打字越快宠物越兴奋。这个思路比"记总次数"自然：它反映的是**最近**的相处，
// 而不是一个只涨不跌的计数器（后者会让宠物在很久不理它之后依然"很粘人"，很假）。
//
// 本模块的设计：
//   1) 滑动窗口：只统计最近 N 分钟内的互动，久了自然"淡下去"。
//   2) 亲密度分档：陌生 → 眼熟 → 熟络 → 亲密。分档让变化**看得见**。
//   3) 只影响口吻与行为倾向，不改外观与参数（与 templates 的定位一致）。
//   4) 纯函数：给 (事件序列, 现在时间) 算出亲密度，可单测、可复现。

/** 亲密度档位（从低到高）。threshold 是进入该档所需的最低分。 */
export const BOND_LEVELS = [
  { id: 'stranger', name: '陌生', threshold: 0,   min: 0,  hint: '它还在观察你' },
  { id: 'familiar', name: '眼熟', threshold: 12,  min: 12, hint: '它开始认得你了' },
  { id: 'close',    name: '熟络', threshold: 40,  min: 40, hint: '它会主动凑过来' },
  { id: 'intimate', name: '亲密', threshold: 100, min: 100, hint: '它很依赖你' },
];

/** 互动事件的分值（越"走心"的动作分越高） */
export const EVENT_SCORE = {
  pat: 3,      // 摸头
  poke: 1,     // 戳一下
  say: 2,      // 跟它说话
  drag: 1,     // 拎起来
  feed: 5,     // 以后可能有的"喂食"
  play: 4,     // 以后可能有的"陪玩"
};

/** 滑动窗口：只算最近这么久之内的互动（毫秒） */
export const WINDOW_MS = 30 * 60 * 1000;   // 30 分钟

/**
 * 把互动记录归一化（丢坏数据、按时间排序）。
 * @returns [{ at, type, score }]
 */
export function normalizeEvents(raw) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object') continue;
    const at = Number(e.at);
    if (!Number.isFinite(at) || at <= 0) continue;
    const type = String(e.type || '');
    if (!type) continue;
    const explicit = Number(e.score);
    const score = Number.isFinite(explicit) && explicit >= 0
      ? explicit
      : (EVENT_SCORE[type] || 1);
    out.push({ at, type, score });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * 计算亲密度：只统计**窗口内**的互动，并且离现在越近权重越高
 * （最近 5 分钟内的算全分，更早的按时间衰减）——
 * 这样"刚陪它玩了一会儿"比"两小时前点过几下"更亲近，符合直觉。
 */
export function bondScore(rawEvents, now) {
  const t = Number(now);
  const nowMs = Number.isFinite(t) ? t : Date.now();
  const events = normalizeEvents(rawEvents);
  let score = 0;
  for (const e of events) {
    const age = nowMs - e.at;
    if (age < 0) continue;              // 未来时间戳（坏数据）不计
    if (age > WINDOW_MS) continue;      // 超出窗口不计
    // 权重：最近 5 分钟 1.0，之后线性降到 0.4
    const k = age <= 5 * 60 * 1000 ? 1 : (1 - 0.6 * ((age - 5 * 60 * 1000) / (WINDOW_MS - 5 * 60 * 1000)));
    score += e.score * Math.max(0.4, k);
  }
  return Math.round(score * 10) / 10;
}

/** 由分数得出档位 */
export function bondLevel(score) {
  const s = Number(score);
  const v = Number.isFinite(s) ? s : 0;
  let cur = BOND_LEVELS[0];
  for (const lv of BOND_LEVELS) if (v >= lv.threshold) cur = lv;
  return cur;
}

/** 还差多少分到下一档（已满级返回 0） */
export function toNextLevel(score) {
  const s = Number(score);
  const v = Number.isFinite(s) ? s : 0;
  for (const lv of BOND_LEVELS) if (v < lv.threshold) return Math.round((lv.threshold - v) * 10) / 10;
  return 0;
}

/** 进度百分比（当前档 -> 下一档），满级 100 */
export function levelProgress(score) {
  const s = Number(score);
  const v = Number.isFinite(s) ? s : 0;
  const cur = bondLevel(v);
  const idx = BOND_LEVELS.findIndex((x) => x.id === cur.id);
  const next = BOND_LEVELS[idx + 1];
  if (!next) return 100;
  const span = next.threshold - cur.threshold;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((v - cur.threshold) / span) * 100)));
}

/**
 * 亲密度带来的"口吻"影响（给对话系统用）。
 * 注意：只**增强**，不替换用户设的性格 —— 用户的选择优先。
 * @returns { prefix: string, extraClingy: number }
 */
export function bondFlavor(levelId) {
  switch (String(levelId)) {
    case 'intimate': return { prefix: '', extraClingy: 1.0, note: '很依赖你' };
    case 'close':    return { prefix: '', extraClingy: 0.6, note: '会主动凑过来' };
    case 'familiar': return { prefix: '', extraClingy: 0.3, note: '开始认得你' };
    default:         return { prefix: '', extraClingy: 0, note: '还在观察你' };
  }
}

/** 追加一条互动（返回新数组；同时裁掉窗口外的旧记录，避免无限增长） */
export function addEvent(rawEvents, type, at, opt = {}) {
  const t = Number(at);
  const nowMs = Number.isFinite(t) ? t : Date.now();
  const maxKeep = Number.isFinite(Number(opt.maxKeep)) ? Math.max(10, Number(opt.maxKeep)) : 200;
  const list = normalizeEvents(rawEvents);
  const explicit = Number(opt.score);
  const score = Number.isFinite(explicit) && explicit >= 0 ? explicit : (EVENT_SCORE[type] || 1);
  list.push({ at: nowMs, type: String(type || 'poke'), score });
  // ★ push 之后必须**重新排序**：新事件的时间戳不保证比已有的晚
  //   （调用方可能按任意顺序补录，实测按时间倒序传入时会把最旧的挤到末尾，
  //   于是 slice(-maxKeep) 保留的就不是"最近的"了）。
  list.sort((a, b) => a.at - b.at);
  // 只保留窗口内的（再留一点余量），并限制条数（保留最近的那批）
  const keep = list.filter((e) => nowMs - e.at <= WINDOW_MS + 60000);
  return keep.slice(-maxKeep);
}
