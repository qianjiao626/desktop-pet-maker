// 宠物窗口布局计算（纯函数，可单测）
//
// 背景：主进程创建窗口时用一套公式、渲染进程 pet.js 又用另一套，
// 导致窗口实际尺寸与内部计算脱节，宠物被画到可视区之外（下半部分看不见）。
// 这里把公式收敛到唯一实现，双方共用。

export const OVER = 1.45;     // 变换（放大/旋转/位移）预留倍数
export const MARGIN = 24;     // 画布内边距
export const BUBBLE_H = 92;   // 为气泡预留的高度

/**
 * 由宠物包计算窗口与画布尺寸。
 * @param pack 宠物包（使用 render.scale / bubble.enabled / frames[].size 或 canvas）
 * @param frameSizes 每帧的原始像素尺寸 [{w,h}]（可选；缺省用 canvas）
 */
/**
 * @param pack 宠物包
 * @param frameSizes 每帧原始像素尺寸
 * @param opt { bottomReserve } 需要在画布底部额外预留的高度（像素）
 *
 * bottomReserve 的用途（踩过的坑）：
 *   素材底部常有透明留白，整图底对齐会让宠物"浮在地面上方"。
 *   运行时会按真实不透明底边算出需要下移多少（groundDy），
 *   但画布底部原本只留了 MARGIN/2 的空间 —— 直接下移会把精灵**裁掉**（实测裁了 28px）。
 *   所以要把这部分空间预留出来：先量出 groundDy，再用它重算一次布局。
 */
export function computeLayout(pack, frameSizes, opt = {}) {
  const scale = (pack && pack.render && pack.render.scale) || 0.3;
  const canvasW = (pack && pack.canvas && pack.canvas.width) || 260;
  const canvasH = (pack && pack.canvas && pack.canvas.height) || 260;

  const sizes = (Array.isArray(frameSizes) && frameSizes.length) ? frameSizes : [{ w: canvasW, h: canvasH }];
  const maxW = Math.max(...sizes.map((s) => s.w || canvasW));
  const maxH = Math.max(...sizes.map((s) => s.h || canvasH));

  const baseW = maxW * scale;
  const baseH = maxH * scale;
  const bottomReserve = Math.max(0, Math.round(Number(opt.bottomReserve) || 0));

  const canvasCssW = Math.round(baseW * OVER + MARGIN * 2);
  const topPad = Math.round(baseH * (OVER - 1) * 0.6) + MARGIN;
  // 底部多留 bottomReserve：让"脚底下移"有地方放，不会被裁
  const canvasCssH = Math.round(baseH * OVER + MARGIN) + bottomReserve;

  const bubbleH = (pack && pack.bubble && pack.bubble.enabled) ? BUBBLE_H : 0;
  const W = Math.max(canvasCssW, 160);
  const H = canvasCssH + topPad + bubbleH;

  return { W, H, canvasCssW, canvasCssH, topPad, bubbleH, bottomReserve };
}

/**
 * 每帧在画布内的绘制尺寸与位置（水平居中、"脚底基线"对齐）。
 *
 * 关键：bottomReserve 只把画布**加高**，绘制基线**不上移**。
 * 画布加高是为了给"脚底下移量"留空间；如果这里也跟着往下挪，
 * 就会和下移量叠加成双倍位移，把精灵顶部推出画布（实测踩过）。
 *
 * @param bottomReserve 画布底部为此预留的高度（像素）
 */
export function computeFramePlacement(sizes, scale, canvasCssW, canvasCssH, bottomReserve = 0) {
  const draw = sizes.map((s) => ({ w: (s.w || 0) * scale, h: (s.h || 0) * scale }));
  const reserve = Math.max(0, Number(bottomReserve) || 0);
  const pos = draw.map((d) => ({
    x: (canvasCssW - d.w) / 2,
    // 基线固定在"原画布高 - 边距"处；reserve 部分留给后续的 groundDy 下移
    y: canvasCssH - reserve - d.h - MARGIN * 0.5,
  }));
  return { draw, pos };
}