// 单帧替换的规划逻辑（纯函数，可单测）。
//
// 场景：20 帧动画里有一帧抠坏了/姿势不对。现在只能全部重来。
// 补上"把一张新图直接拖到缩略图上替换那一帧"。
//
// 需要做对的几件事（都不是简单的数组赋值）：
//   1) 新图尺寸往往和原帧不同 -> 替换后整段动画会**抖动**（画面忽大忽小）。
//      所以要把新图统一到原帧的画布尺寸（缩放 / 居中放置）。
//   2) 替换只动一帧，其它帧必须原样不动（引用都要保持，避免"改一帧动全身"）。
//   3) 替换后当前帧应停在被替换的那一帧上（用户立刻能看到结果）。

/** 统一的画布尺寸取原帧的尺寸；新图按最长边等比缩放后居中放置 */
export function fitIntoCanvas(srcW, srcH, canvasW, canvasH) {
  const W = Math.max(1, Math.round(Number(srcW) || 1));
  const H = Math.max(1, Math.round(Number(srcH) || 1));
  const CW = Math.max(1, Math.round(Number(canvasW) || W));
  const CH = Math.max(1, Math.round(Number(canvasH) || H));
  // 放大也允许（新图太小的话，缩放到刚好填满画布会更好看），但不超过画布
  const k = Math.min(CW / W, CH / H);
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  return {
    w, h,
    x: Math.round((CW - w) / 2),
    y: Math.round((CH - h) / 2),
    scaled: w !== W || h !== H,
  };
}

/**
 * 把一帧替换到指定下标。
 * @param frames 原帧数组（不会被修改）
 * @param index  要替换的下标
 * @param frame  新帧 { original, current, name }
 * @returns {{frames, activeIdx, replaced:boolean}}
 */
export function replaceFrameAt(frames, index, frame) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  if (!list.length) return { frames: list, activeIdx: 0, replaced: false };
  if (!frame) return { frames: list, activeIdx: Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0))), replaced: false };
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0)));
  list[i] = frame;
  return { frames: list, activeIdx: i, replaced: true };
}

/**
 * 校验"能不能替换"：给出可读的原因，避免用户拖上去没反应。
 * @returns {{ok, reason}}
 */
export function canReplaceFrame(frames, index, incoming) {
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) return { ok: false, reason: '还没有帧，请先导入图片' };
  const i = Math.floor(Number(index) || 0);
  if (!(i >= 0 && i < list.length)) return { ok: false, reason: '目标帧不存在' };
  if (!incoming) return { ok: false, reason: '没有拿到这张图的数据' };
  return { ok: true, reason: '' };
}
