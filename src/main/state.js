// 主进程共享状态（独立模块，便于测试与避免循环依赖）
//
// 快速模式：用户在制作器里点「启用」后，宠物以同进程窗口出现，
// 因此需要把「宠物包」放在主进程内存里，供 pet 渲染进程通过 pet:getPack 读取。
//
// ── v0.9.19 起支持多宠物同屏 ──
// 以前这里是"单个宠物"的全局变量。要做多宠物同屏，必须能同时装多只。
// 改造采取**向后兼容**策略：对外保留 getPetWindow()/isPetAlive() 等旧 API
// （它们指向"最近启用的那一只"），同时新增按 id / 按窗口反查的接口。
// 这样现有 42 个 e2e 套件不用改就能继续通过，新功能再逐步接上来。

// id -> { id, win, pack, frames, scale }
const pets = new Map();
let activeId = null;         // "最近启用/被操作"的那一只（旧 API 指向它）
let makerWindowRef = null;
let scaleByDefault = null;   // 用户当前缩放（重启桌宠时沿用；退出时清空回默认）

let seq = 0;
/** 生成一个宠物实例 id（不用随机数，便于测试复现） */
export function nextPetId(prefix = 'pet') { seq += 1; return prefix + '-' + seq; }
/** 仅供测试：重置计数器与状态 */
export function __resetState() { pets.clear(); activeId = null; seq = 0; scaleByDefault = null; }

/**
 * 注册一只宠物实例。
 * @param opt { id?, win, pack, frames }
 * @returns 实例 id
 */
export function addPet(opt = {}) {
  const id = String(opt && opt.id ? opt.id : nextPetId());
  pets.set(id, {
    id,
    win: (opt && opt.win) || null,
    pack: (opt && opt.pack) || null,
    frames: (opt && opt.frames) || null,
    scale: null,
  });
  activeId = id;
  return id;
}

/** 移除一只宠物实例（窗口关闭时调用） */
export function removePet(id) {
  const k = String(id || '');
  const had = pets.delete(k);
  if (activeId === k) activeId = pets.size ? [...pets.keys()][pets.size - 1] : null;
  return had;
}

/** 按 id 取实例 */
export function getPet(id) { return pets.get(String(id || '')) || null; }

/** 全部存活实例（会顺手剔除已销毁的窗口） */
export function listPets() {
  const out = [];
  for (const it of pets.values()) {
    // 没有窗口的实例（只登记了包、还没建窗口）不算"存活"。
    // 否则 addPet({pack}) 之后 isPetAlive() 会返回 true，但实际桌面上什么都没有。
    if (!it.win) continue;
    if (it.win.isDestroyed && it.win.isDestroyed()) continue;
    out.push(it);
  }
  return out;
}

/** 宠物总数（存活的） */
export function petCount() { return listPets().length; }

/**
 * 按**窗口**反查是哪一只宠物。
 * 这是多宠物场景的关键：渲染进程问 "我是谁" 时不能靠全局的"当前包"
 * （那样每只宠物都会拿到最后启用的那只的数据）。
 */
/**
 * 按「宠物包 id」反查一个**正在跑**的实例。
 *
 * 为什么需要：`quick:enableMulti` 以前**完全不去重** ——
 * 同一只宠物重复点「一起放出来」会开出多个窗口（叠在屏幕上、看起来像"窗口一直弹"）。
 * 单只路径（quick:enable）查的是 getPetWindow()，但那是**单例**，
 * 在多宠物模式下不适用。
 *
 * @param packId 宠物包 id
 * @returns 实例或 null（窗口已销毁的不算）
 */
export function petByPackId(packId) {
  const want = String(packId == null ? '' : packId);
  if (!want) return null;
  for (const it of pets.values()) {
    if (!it || !it.pack) continue;
    if (String(it.pack.id || '') !== want) continue;
    if (it.win && !(it.win.isDestroyed && it.win.isDestroyed())) return it;
  }
  return null;
}

export function petByWindow(win) {
  if (!win) return null;
  for (const it of pets.values()) if (it.win === win) return it;
  return null;
}

/**
 * 按 webContents 的 id 反查宠物。
 * 为什么不用 petByWindow 比对对象：Electron 的 BrowserWindow 在两个上下文里
 * 未必是同一个 JS 引用（实测多宠物时反查失败 -> 回落到全局包 -> 三只全变同一只）。
 * webContents.id 是稳定的整数，最可靠。
 */
export function petByWebContentsId(wcId) {
  const id = Number(wcId);
  if (!Number.isFinite(id)) return null;
  for (const it of pets.values()) {
    const w = it.win;
    if (!w || (w.isDestroyed && w.isDestroyed())) continue;
    try { if (w.webContents && w.webContents.id === id) return it; } catch (err) { /* 忽略 */ }
  }
  return null;
}

/** 把某只设为"最近活跃"（旧的单例 API 会指向它） */
export function setActivePet(id) {
  const k = String(id || '');
  if (pets.has(k)) { activeId = k; return true; }
  return false;
}
export function getActivePetId() { return activeId; }

// ---------- 向后兼容的单例 API ----------
export function setPetWindow(w) {
  if (!w) { pets.clear(); activeId = null; return; }
  // 旧调用方只给窗口、不给包：绑定到最近的一个实例，或新建一个
  const found = petByWindow(w);
  if (found) { activeId = found.id; return; }
  const it = activeId ? pets.get(activeId) : null;
  if (it) { it.win = w; return; }
  addPet({ win: w });
}
export function getPetWindow() {
  // 旧语义：返回"当前那一只"的窗口；没有就 null
  if (activeId) {
    const it = pets.get(activeId);
    if (it && it.win && !(it.win.isDestroyed && it.win.isDestroyed())) return it.win;
  }
  const list = listPets();
  return list.length ? list[list.length - 1].win : null;
}
export function isPetAlive() {
  if (activeId) {
    const it = pets.get(activeId);
    if (it && it.win && !(it.win.isDestroyed && it.win.isDestroyed())) return true;
  }
  return listPets().length > 0;
}

export function setMakerWindow(w) { makerWindowRef = w; }
export function getMakerWindow() { return makerWindowRef; }

// 缩放：单宠物时代是全局一个值；多宠物时优先记在实例上，兜底用全局默认。
export function setCurrentScale(v) {
  const n = (typeof v === "number" && Number.isFinite(v)) ? v : null;
  scaleByDefault = n;
  const it = activeId ? pets.get(activeId) : null;
  if (it) it.scale = n;
}
export function getCurrentScale() {
  if (activeId) {
    const it = pets.get(activeId);
    if (it && it.scale != null) return it.scale;
  }
  return scaleByDefault;
}

// 兼容旧调用：setCurrentPack/getCurrentPack 作用于"当前那一只"
export function setCurrentPack(v) {
  const it = activeId ? pets.get(activeId) : null;
  if (!it) { addPet({ pack: v && v.pack, frames: v && v.frames }); return; }
  it.pack = v && v.pack;
  it.frames = v && v.frames;
}
export function getCurrentPack() {
  if (activeId) {
    const it = pets.get(activeId);
    if (it) return (it.pack || it.frames) ? { pack: it.pack, frames: it.frames } : null;
  }
  const list = listPets();
  const last = list.length ? list[list.length - 1] : null;
  return last ? { pack: last.pack, frames: last.frames } : null;
}
export function clearCurrentPack() {
  const it = activeId ? pets.get(activeId) : null;
  if (it) { it.pack = null; it.frames = null; }
}
