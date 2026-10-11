// 批量导出 GIF 的规划逻辑（纯函数，可单测）。
//
// 场景：宠物库里攒了 20 只宠物，想一次性导出成一批 GIF 表情包。
// 但这里有几个必须做对的地方（不看代码很容易踩）：
//   1) GIF 编码是纯 CPU、单帧量化是 O(像素×调色板)，**大图 × 多帧会非常慢**。
//      必须限制单只的尺寸与帧数，否则用户点一下要等几分钟还以为是卡死。
//   2) 每只宠物的帧尺寸可能不同（有的是 800×600，有的是 32×32）。
//      GIF 要求同一次导出内尺寸一致，所以要**统一缩放到一个目标尺寸**。
//   3) 帧文件名要唯一（zip 里同名会互相覆盖 —— 与上次宠物库导出的同类坑）。
//   4) 要给出可预期的产物清单（导出前就能告诉用户"会得到什么"）。

/** 单张 GIF 的安全上限：最长边像素（再大编码慢且没必要，表情包用不着） */
export const GIF_MAX_EDGE = 320;
/** 单只宠物最多导出多少帧（帧太多体积暴涨、且用户也看不出差别） */
export const GIF_MAX_FRAMES = 40;
/** 一次最多导出多少只（防止一次点下去跑几十分钟） */
export const BULK_GIF_MAX_PETS = 50;

/**
 * 按最长边等比缩放，返回目标尺寸。
 * @returns {{w,h,scaled}} scaled 表示是否真的缩了
 */
export function fitGifSize(w, h, maxEdge = GIF_MAX_EDGE) {
  const W = Math.max(1, Math.round(Number(w) || 0));
  const H = Math.max(1, Math.round(Number(h) || 0));
  const m = Math.max(16, Math.round(Number(maxEdge) || GIF_MAX_EDGE));
  const longest = Math.max(W, H);
  if (longest <= m) return { w: W, h: H, scaled: false };
  const k = m / longest;
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)), scaled: true };
}

/**
 * 把一次导出的所有宠物统一到**同一个** GIF 画布尺寸。
 * 为什么必须统一：不同尺寸的帧混在一个集合里没法一个个编码成"看起来一样大"的动图；
 * 而且用户往往要发到同一个地方，尺寸不一致很难看。
 * 取所有宠物的"缩放后尺寸"里最长边最大者，再套一层上限。
 */
export function unifyGifCanvas(pets, maxEdge = GIF_MAX_EDGE) {
  const list = Array.isArray(pets) ? pets : [];
  let w = 0, h = 0;
  for (const p of list) {
    const s = fitGifSize(p && p.width, p && p.height, maxEdge);
    if (s.w > w) w = s.w;
    if (s.h > h) h = s.h;
  }
  if (!w || !h) return { w: 1, h: 1 };
  // 再夹一次（万一某只的宽高比极端）
  const s = fitGifSize(w, h, maxEdge);
  return { w: s.w, h: s.h };
}

/**
 * 抽取要导出的帧（截断到上限，并均匀采样而不是只取前 N 帧）。
 *
 * 为什么均匀采样：只取前 40 帧会让动画看起来"只播了开头"；
 * 均匀抽稀能保留整段动作的观感（运行时那套内存保护也是同样思路）。
 */
export function pickFrames(frames, maxFrames = GIF_MAX_FRAMES) {
  const list = Array.isArray(frames) ? frames : [];
  const n = Math.max(1, Math.floor(Number(maxFrames) || GIF_MAX_FRAMES));
  if (list.length <= n) return list.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    // 均匀取点，且一定包含首尾（否则首尾姿态丢失，循环会跳）
    const idx = n === 1 ? 0 : Math.round((i * (list.length - 1)) / (n - 1));
    out.push(list[idx]);
  }
  return out;
}

/**
 * 规划一次批量 GIF 导出。
 * @param {Array} items [{ id, name, frames, width, height, builtin, broken }]
 * @param {object} opt  { includeBuiltin, maxEdge, maxFrames }
 * @returns {{ok, entries, canvas, skipped, reason}}
 */
export function planBulkGif(items, opt = {}) {
  const list = Array.isArray(items) ? items : [];
  const includeBuiltin = !!opt.includeBuiltin;
  const maxEdge = Math.max(16, Math.round(Number(opt.maxEdge) || GIF_MAX_EDGE));
  const maxFrames = Math.max(1, Math.floor(Number(opt.maxFrames) || GIF_MAX_FRAMES));

  const usable = [];
  const skipped = [];
  for (const it of list) {
    if (!it || !it.id) continue;
    if (it.builtin && !includeBuiltin) { skipped.push({ id: it.id, reason: '内置宠物（默认不导出）' }); continue; }
    if (it.broken) { skipped.push({ id: it.id, reason: '文件损坏，已跳过' }); continue; }
    if (!it.frames || !it.frames.length) { skipped.push({ id: it.id, reason: '没有可用的帧' }); continue; }
    usable.push(it);
    if (usable.length >= BULK_GIF_MAX_PETS) break;
  }

  if (!usable.length) {
    return { ok: false, entries: [], canvas: { w: 0, h: 0 }, skipped, reason: '没有可导出的宠物' };
  }

  const canvas = unifyGifCanvas(usable, maxEdge);
  const used = new Set();
  const entries = [];
  for (const it of usable) {
    const base = String(it.name || it.id).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'pet';
    let name = base + '.gif';
    let k = 1;
    while (used.has(name)) { k++; name = base + '_' + k + '.gif'; }
    used.add(name);
    const frames = pickFrames(it.frames, maxFrames);
    entries.push({
      sourceId: it.id,
      outName: name,
      name: String(it.name || it.id),
      frameCount: frames.length,
      sourceFrames: it.frames.length,
      sampled: frames.length < it.frames.length,
    });
  }

  const totalFrames = entries.reduce((s, e) => s + e.frameCount, 0);
  return { ok: true, entries, canvas, skipped, totalFrames, reason: '' };
}

/** 导出前的说明文案（让用户在动手前就知道会发生什么） */
export function bulkGifSummary(plan) {
  if (!plan || !plan.ok) return plan && plan.reason ? plan.reason : '没有可导出的宠物';
  const n = plan.entries.length;
  const sampled = plan.entries.filter((e) => e.sampled).length;
  const parts = ['共 ' + n + ' 只宠物 → ' + n + ' 个 GIF'];
  parts.push('画布统一为 ' + plan.canvas.w + '×' + plan.canvas.h);
  parts.push('合计 ' + plan.totalFrames + ' 帧');
  if (sampled) parts.push(sampled + ' 只因帧数过多已均匀抽稀');
  if (plan.skipped.length) parts.push('跳过 ' + plan.skipped.length + ' 只');
  return parts.join('，');
}
