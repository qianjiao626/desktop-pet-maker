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
export function computeLayout(pack, frameSizes) {
  const scale = (pack && pack.render && pack.render.scale) || 0.3;
  const canvasW = (pack && pack.canvas && pack.canvas.width) || 260;
  const canvasH = (pack && pack.canvas && pack.canvas.height) || 260;

  const sizes = (Array.isArray(frameSizes) && frameSizes.length) ? frameSizes : [{ w: canvasW, h: canvasH }];
  const maxW = Math.max(...sizes.map((s) => s.w || canvasW));
  const maxH = Math.max(...sizes.map((s) => s.h || canvasH));

  const baseW = maxW * scale;
  const baseH = maxH * scale;

  const canvasCssW = Math.round(baseW * OVER + MARGIN * 2);
  const topPad = Math.round(baseH * (OVER - 1) * 0.6) + MARGIN;
  const canvasCssH = Math.round(baseH * OVER + MARGIN);

  const bubbleH = (pack && pack.bubble && pack.bubble.enabled) ? BUBBLE_H : 0;
  const W = Math.max(canvasCssW, 160);
  const H = canvasCssH + topPad + bubbleH;

  return { W, H, canvasCssW, canvasCssH, topPad, bubbleH };
}

/** 每帧在画布内的绘制尺寸与位置（水平居中、底部对齐） */
export function computeFramePlacement(sizes, scale, canvasCssW, canvasCssH) {
  const draw = sizes.map((s) => ({ w: (s.w || 0) * scale, h: (s.h || 0) * scale }));
  const pos = draw.map((d) => ({
    x: (canvasCssW - d.w) / 2,
    y: canvasCssH - d.h - MARGIN * 0.5,
  }));
  return { draw, pos };
}