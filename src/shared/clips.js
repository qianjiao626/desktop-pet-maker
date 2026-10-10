// 多动作片段（clip）调度：把同一只宠物的多段微动作放进一个宠物包，
// 运行时按权重随机切换，让桌宠"有多个小动作"而不是永远循环同一段。
//
// 为什么值得做：
//   上一轮做的 10 个微动作，只能在**生成时**选一个烘进包里 ——
//   桌宠上桌后永远重复那一小段，看起来很机械。
//   把多段都存进去、运行时随机切换，同样的素材立刻"活"起来。
//
// 设计：
//   - 纯逻辑（可单测）：权重选取、避免连续重复、片段循环取帧。
//   - 与现有 frames 结构兼容：每个 clip 就是一段帧序列 + 时长。
//     单片段时行为与以前完全一致（向后兼容，老包不受影响）。

/**
 * 归一化 clip 列表（容错：坏数据不能让宠物起不来）。
 * @param {Array} clips [{id, name, frames:[{file,durationMs}], weight}]
 * @returns {Array}
 */
export function normalizeClips(clips) {
  const list = Array.isArray(clips) ? clips : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const frames = Array.isArray(c.frames) ? c.frames.filter((f) => f && f.file) : [];
    if (!frames.length) continue;
    const w = Number(c.weight);
    out.push({
      id: String(c.id || ('clip' + out.length)),
      name: String(c.name || c.id || ('片段' + (out.length + 1))),
      frames: frames.map((f) => ({
        file: String(f.file),
        durationMs: Math.max(16, Math.round(Number(f.durationMs) || 110)),
      })),
      // 权重必须为正；缺失/非法一律给 1（等概率）
      weight: Number.isFinite(w) && w > 0 ? w : 1,
    });
  }
  return out;
}

/**
 * 按权重挑一个片段。
 * @param {Array} clips    normalizeClips 结果
 * @param {Function} rng   注入的随机源（便于单测）
 * @param {string} avoidId 尽量避开的片段 id（避免连续两次相同动作）
 * @returns {{id, index}|null}
 */
export function pickClip(clips, rng = Math.random, avoidId = null) {
  const list = normalizeClips(clips);
  if (!list.length) return null;
  if (list.length === 1) return { id: list[0].id, index: 0 };
  // 只有一个候选以外的选择：先把 avoidId 摘掉，避免"同一个动作连着播两遍"
  let pool = list.map((c, i) => ({ c, i }));
  if (avoidId) {
    const filtered = pool.filter((x) => x.c.id !== avoidId);
    if (filtered.length) pool = filtered;
  }
  const total = pool.reduce((s, x) => s + x.c.weight, 0);
  if (!(total > 0)) return { id: pool[0].c.id, index: pool[0].i };
  let r = rng() * total;
  for (const x of pool) {
    r -= x.c.weight;
    if (r <= 0) return { id: x.c.id, index: x.i };
  }
  return { id: pool[pool.length - 1].c.id, index: pool[pool.length - 1].i };
}

/**
 * 片段内部按时间取当前帧（循环）。
 * @param {object} clip    单个片段
 * @param {number} elapsedMs 进入该片段以来经过的毫秒
 * @returns {{frameIndex:number, file:string, durationMs:number}}
 */
export function clipFrameAt(clip, elapsedMs) {
  const c = normalizeClips([clip])[0];
  if (!c) return { frameIndex: 0, file: '', durationMs: 110 };
  const total = c.frames.reduce((s, f) => s + f.durationMs, 0) || 1;
  let t = Number.isFinite(elapsedMs) ? elapsedMs % total : 0;
  if (t < 0) t += total;
  for (let i = 0; i < c.frames.length; i++) {
    t -= c.frames[i].durationMs;
    if (t < 0) return { frameIndex: i, file: c.frames[i].file, durationMs: c.frames[i].durationMs };
  }
  const last = c.frames.length - 1;
  return { frameIndex: last, file: c.frames[last].file, durationMs: c.frames[last].durationMs };
}

/** 一个片段播完一轮要多久 */
export function clipDuration(clip) {
  const c = normalizeClips([clip])[0];
  if (!c) return 0;
  return c.frames.reduce((s, f) => s + f.durationMs, 0);
}

/**
 * 调度器：决定"什么时候换下一个动作"。
 * 用法：每帧调 tick(dt)，它会在到点时给出新片段。
 */
export function createClipScheduler(clips, opt = {}) {
  const list = normalizeClips(clips);
  const rng = opt.rng || Math.random;
  const minMs = Math.max(500, Number(opt.minMs) || 4000);
  const maxMs = Math.max(minMs, Number(opt.maxMs) || 12000);
  let current = null;
  let elapsed = 0;
  let holdFor = 0;
  return {
    /** 当前片段（未开始时为 null） */
    get currentId() { return current ? current.id : null; },
    /** 片段内部已播放时长（供取帧） */
    get elapsedMs() { return elapsed; },
    hasClips() { return list.length > 0; },
    clipCount() { return list.length; },
    /**
     * 推进时间。返回 {changed, clip, frame} —— changed 为 true 表示换片段了。
     */
    tick(dtMs) {
      if (!list.length) return { changed: false, clip: null, frame: null };
      if (!current) {
        const p = pickClip(list, rng, null);
        current = list[p.index];
        elapsed = 0;
        holdFor = minMs + rng() * (maxMs - minMs);
        return { changed: true, clip: current, frame: clipFrameAt(current, 0) };
      }
      elapsed += Math.max(0, Number(dtMs) || 0);
      if (elapsed >= holdFor) {
        const p = pickClip(list, rng, current.id);
        current = list[p.index];
        elapsed = 0;
        holdFor = minMs + rng() * (maxMs - minMs);
        return { changed: true, clip: current, frame: clipFrameAt(current, 0) };
      }
      return { changed: false, clip: current, frame: clipFrameAt(current, elapsed) };
    },
    /** 手动强制切换（供右键菜单/交互触发） */
    forceSwitch(avoidCurrent = true) {
      if (!list.length) return null;
      const p = pickClip(list, rng, avoidCurrent && current ? current.id : null);
      current = list[p.index];
      elapsed = 0;
      holdFor = minMs + rng() * (maxMs - minMs);
      return current;
    },
  };
}
