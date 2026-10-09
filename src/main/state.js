// 主进程共享状态（独立模块，便于测试与避免循环依赖）
// 快速模式：用户在制作器里点「启用」后，宠物以同进程窗口出现，
// 因此需要把「当前宠物包」放在主进程内存里，供 pet 渲染进程通过 pet:getPack 读取。

let currentPack = null;      // { pack, frames:[{file,dataUrl,durationMs}], source }
let petWindowRef = null;
let makerWindowRef = null;

let currentScale = null;    // 用户当前缩放（重启桌宠时沿用；退出时清空回默认）

export function setCurrentPack(v) { currentPack = v; }
export function getCurrentPack() { return currentPack; }
export function clearCurrentPack() { currentPack = null; }
export function setCurrentScale(v) { currentScale = (typeof v === "number" && Number.isFinite(v)) ? v : null; }
export function getCurrentScale() { return currentScale; }

export function setPetWindow(w) { petWindowRef = w; }
export function getPetWindow() { return petWindowRef; }
export function setMakerWindow(w) { makerWindowRef = w; }
export function getMakerWindow() { return makerWindowRef; }
export function isPetAlive() {
  return !!(petWindowRef && !petWindowRef.isDestroyed());
}