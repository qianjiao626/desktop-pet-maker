// 多帧内存预算（纯函数，可单测）
// 背景：每帧需保存 original（原图）与 current（抠图/处理后）两份 RGBA。
// 1600x1600 的单帧约 9.8MB，两份 19.5MB；300 帧可达 5.7GB，足以让渲染进程崩溃。
// 这里用可预测的规则限制帧数，并明确告知用户为何被限制。

export const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;   // 512MB 帧数据上限

/** 计算 frames 帧、每帧 w*h 的 RGBA 数据占用（copies 份） */
export function estimateFramesBytes(w, h, frames, copies = 2) {
  return Math.max(1, w) * Math.max(1, h) * 4 * Math.max(0, frames) * Math.max(1, copies);
}

/** 在给定预算下，该尺寸最多能放多少帧 */
export function maxFramesFor(w, h, budgetBytes = DEFAULT_BUDGET_BYTES, copies = 2) {
  const per = Math.max(1, w) * Math.max(1, h) * 4 * Math.max(1, copies);
  return Math.max(1, Math.floor(budgetBytes / per));
}

/**
 * 把请求帧数夹到预算内
 * @returns { frames, bytes, clamped, maxAllowed, limitReason }
 */
export function fitFrameLimit(w, h, requested, { budgetBytes = DEFAULT_BUDGET_BYTES, copies = 2 } = {}) {
  const want = Math.max(1, Math.round(requested || 1));
  const maxAllowed = maxFramesFor(w, h, budgetBytes, copies);
  const frames = Math.min(want, maxAllowed);
  const bytes = estimateFramesBytes(w, h, frames, copies);
  return {
    frames,
    bytes,
    clamped: frames < want,
    maxAllowed,
    limitReason: frames < want ? `图像较大，帧数已从 ${want} 限制为 ${frames}（避免内存溢出）` : '',
  };
}

/** 人类可读的字节数 */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

/**
 * 运行时帧规划：把任意来源的宠物包帧序列裁剪到内存预算内。
 * 场景：制作器已有预算保护，但运行时仍会加载「宠物库 / 他人分享」的 petpack，
 * 那是不可信输入——一个 240 帧 x 1600x1600 的包会吃掉约 3GB。
 * 策略：均匀抽取保留一个子集（动画看起来仍连贯），而不是只留前 N 帧。
 * @returns { frames, dropped, bytes, clamped }
 */
export function planRuntimeFrames(frames, canvasW, canvasH, {
  budgetBytes = DEFAULT_BUDGET_BYTES,
  copies = 5,   // 运行时 = 位图(4B/px) + 命中测试 alpha 图(1B/px)
} = {}) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) return { frames: [], dropped: 0, bytes: 0, clamped: false };

  const perFrame = Math.max(1, canvasW) * Math.max(1, canvasH) * Math.max(1, copies);
  const maxAllowed = Math.max(1, Math.floor(budgetBytes / perFrame));
  if (list.length <= maxAllowed) {
    return { frames: list.slice(), dropped: 0, bytes: perFrame * list.length, clamped: false };
  }

  const kept = [];
  for (let i = 0; i < maxAllowed; i++) {
    // 均匀抽样：i * (n-1)/(maxAllowed-1)，保证首末帧都在
    const idx = maxAllowed === 1 ? 0 : Math.round((i * (list.length - 1)) / (maxAllowed - 1));
    kept.push(list[idx]);
  }
  return { frames: kept, dropped: list.length - kept.length, bytes: perFrame * kept.length, clamped: true };
}
