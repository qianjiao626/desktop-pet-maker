// 「记住上次位置」的保存策略（纯逻辑，可单测）。
//
// 背景：UI 里有「记住上次位置」这个选项，但**位置从来没被保存过** ——
// savePos 通道暴露了却没有任何调用方，选了这个功能等于没生效（实测发现）。
//
// 补上保存时要避免两个坑：
//   1) 宠物一直在走动，如果每帧都存 -> 主进程每秒写几十次 JSON（同步写还会卡界面）；
//   2) 关窗口时才存 -> 进程被强杀就丢了。
// 所以策略是：**位置变化足够大 / 距上次保存足够久**才写，且写入要节流。

/** 判断这次要不要真的落盘 */
export function shouldSave(opt = {}) {
  const now = Number(opt.now) || 0;
  const lastAt = Number(opt.lastSaveAt) || 0;
  const minGapMs = Number.isFinite(Number(opt.minGapMs)) ? Number(opt.minGapMs) : 3000;
  const lastX = Number(opt.lastX);
  const lastY = Number(opt.lastY);
  const x = Number(opt.x) || 0;
  const y = Number(opt.y) || 0;
  const minDelta = Number.isFinite(Number(opt.minDelta)) ? Number(opt.minDelta) : 8;

  // 第一次直接存
  if (!lastAt || !Number.isFinite(lastX) || !Number.isFinite(lastY)) return { save: true, reason: '首次' };
  // 时间到了就存（不管动没动 —— 保证"最终位置"会被记住）
  if (now - lastAt >= minGapMs) return { save: true, reason: '间隔到了' };
  // 移动幅度够大也存（用户明显挪过位置，希望被记住）
  if (Math.abs(x - lastX) >= minDelta || Math.abs(y - lastY) >= minDelta) {
    return { save: true, reason: '移动够大' };
  }
  return { save: false, reason: '' };
}

/** 位置数据要做的整形（存成整数、剔除非法值） */
export function sanitizePos(x, y) {
  const nx = Number(x), ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  return { x: Math.round(nx), y: Math.round(ny) };
}

/**
 * 裁剪位置记录：不要无限增长（用户装了又删很多宠物会留一堆幽灵记录）。
 * @param map       { id: {x,y} }
 * @param aliveIds  当前还在的宠物 id（给 null 表示不裁剪）
 * @param maxEntries 上限（兜底）
 */
export function prunePositions(map, aliveIds, maxEntries = 200) {
  const src = (map && typeof map === 'object') ? map : {};
  const limit = Number.isFinite(Number(maxEntries)) && Number(maxEntries) > 0 ? Number(maxEntries) : 200;
  const alive = Array.isArray(aliveIds) ? new Set(aliveIds) : null;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (!k || !v || typeof v !== 'object') continue;
    if (alive && !alive.has(k)) continue;
    const p = sanitizePos(v.x, v.y);
    if (!p) continue;
    out[k] = p;
  }
  // 超出上限时只保留最后写入的那批（Object.entries 保持插入顺序）
  const keys = Object.keys(out);
  if (keys.length > limit) {
    const keep = keys.slice(keys.length - limit);
    const trimmed = {};
    for (const k of keep) trimmed[k] = out[k];
    return trimmed;
  }
  return out;
}
