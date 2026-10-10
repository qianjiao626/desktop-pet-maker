// 帧缩略图条的「视图逻辑」（纯函数，可单测）。
//
// 为什么要单独抽：缩略图条看起来只是"画一排小图"，但有几个必须做对的地方，
// 而它们与 DOM 无关、很适合单测：
//   1) 帧很多时不能把整条渲染出来（200 帧 × 每张都是 dataURL 会卡死）-> 只渲染可视窗口
//   2) 当前帧必须始终在可视范围内（换帧/删帧后要自动滚动到它）
//   3) 拖动排序时，落点下标要按"是否跨过自己"修正（与 frames.js 的 moveFrame 一致）
//   4) 缩略图不需要原图分辨率：按最长边缩到很小，省内存

/** 缩略图最长边（像素）。太大浪费内存，太小看不清 */
export const THUMB_MAX_EDGE = 72;

/**
 * 计算缩略图条的可见窗口。
 * @param total     帧总数
 * @param activeIdx 当前帧下标
 * @param viewCount 一次最多显示几张
 * @returns {{start, end, indices:number[]}} end 为开区间
 */
export function visibleWindow(total, activeIdx, viewCount = 12) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return { start: 0, end: 0, indices: [] };
  const v = Math.max(1, Math.floor(Number(viewCount) || 1));
  if (n <= v) {
    const indices = Array.from({ length: n }, (_, i) => i);
    return { start: 0, end: n, indices };
  }
  let a = Math.floor(Number(activeIdx) || 0);
  a = Math.max(0, Math.min(n - 1, a));
  // 让当前帧尽量居中，同时贴住两端（不能在头尾留空白）
  let start = a - Math.floor(v / 2);
  start = Math.max(0, Math.min(n - v, start));
  const indices = Array.from({ length: v }, (_, i) => start + i);
  return { start, end: start + v, indices };
}

/**
 * 缩略图的绘制尺寸（等比缩到最长边 THUMB_MAX_EDGE）。
 * @returns {{w, h}} 至少 1x1，避免 0 尺寸 canvas 报错
 */
export function thumbSize(w, h, maxEdge = THUMB_MAX_EDGE) {
  const W = Math.max(1, Number(w) || 0);
  const H = Math.max(1, Number(h) || 0);
  const m = Math.max(1, Number(maxEdge) || THUMB_MAX_EDGE);
  const k = Math.min(1, m / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

/**
 * 拖动排序时，把"落点"换算成 moveFrame 的目标下标。
 *
 * 关键：拖动时鼠标位置给的是**视觉上的插入位置**（0..n，表示插到第 i 个之前）。
 * 而 moveFrame 的 to 是"移动后应该在的下标"。如果落点在原位置之后，
 * 因为自己先被移除了，下标要减 1（经典 off-by-one）。
 *
 * @param from       被拖动的帧下标
 * @param insertAt   插入点（0..n，插到第 insertAt 个之前）
 * @param total      帧总数
 * @returns {null | number} null 表示"位置没变、不用动"
 */
export function dropTarget(from, insertAt, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n < 2) return null;
  const f = Math.max(0, Math.min(n - 1, Math.floor(Number(from) || 0)));
  let ins = Math.max(0, Math.min(n, Math.floor(Number(insertAt) || 0)));
  // 插到自己前面或自己后面 = 没动
  if (ins === f || ins === f + 1) return null;
  // 落在自己之后 -> 因为自己会被抽走，目标下标左移一位
  const to = ins > f ? ins - 1 : ins;
  const t = Math.max(0, Math.min(n - 1, to));
  return t === f ? null : t;
}

/**
 * 根据鼠标 X 与每个格子的边界，算出插入点（0..n）。
 * @param clientX    鼠标的 X
 * @param rects      [{left, right}] 各格子的屏幕位置（按帧顺序）
 * @returns {number} 0..n
 */
export function insertIndexAt(clientX, rects) {
  const list = Array.isArray(rects) ? rects : [];
  if (!list.length) return 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r) continue;
    const mid = ((Number(r.left) || 0) + (Number(r.right) || 0)) / 2;
    if (clientX < mid) return i;
  }
  return list.length;
}

/**
 * 缩略图条的标题文案（给用户"现在第几帧、共几帧"的清晰读数）。
 */
export function stripLabel(activeIdx, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return '还没有帧';
  const a = Math.max(0, Math.min(n - 1, Math.floor(Number(activeIdx) || 0)));
  return `帧 ${a + 1}/${n}`;
}
