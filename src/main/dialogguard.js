// 统一的「对话框」助手：保证**不出现脱离主窗口的飘窗**。
//
// 背景（用户反复强调："不要让窗口重复在桌面跳出来影响我工作"）：
//   项目里有 16 处 dialog.showOpenDialog / showSaveDialog，**全都没传 parent**。
//   不传 parent 时，Electron 的对话框在部分平台会：
//     · 脱离主窗口飘到屏幕中央（看起来像"莫名弹出一个窗口"）；
//     · 或跑到主窗口后面（用户以为点了没反应，再点一次 -> 又弹一个）。
//   传了 parent 后，对话框会**依附于主窗口**、居中于它、并阻止重复交互。
//
// 另外这里也处理"无头/无窗口"的情况：没有可用父窗口时退化为不传 parent，
// 绝不因为拿不到窗口而抛错（对话框失败不该变成新的崩溃源）。

/**
 * 取一个可用的父窗口。
 * 优先用制作器窗口；它不存在时（例如纯宠物模式）返回 null。
 * @param getMakerWindow () => BrowserWindow|null（注入便于单测）
 */
export function pickParentWindow(getMakerWindow) {
  try {
    const w = typeof getMakerWindow === 'function' ? getMakerWindow() : null;
    if (!w) return null;
    if (typeof w.isDestroyed === 'function' && w.isDestroyed()) return null;
    return w;
  } catch { return null; }
}

/**
 * 给对话框选项补上 parent。
 * @param opt    原本要传给 dialog.showXxxDialog 的选项
 * @param parent 父窗口（可为 null）
 * @returns 新的选项对象（不修改传入的那个）
 */
export function withParent(opt, parent) {
  const base = (opt && typeof opt === 'object') ? opt : {};
  if (!parent) return { ...base };
  return { ...base, parent };
}

/**
 * 统一的调用入口。
 * @param dialog Electron 的 dialog 模块
 * @param kind   'open' | 'save'
 * @param opt    对话框选项
 * @param getMakerWindow 取主窗口的函数
 * @returns dialog.showXxxDialog 的 Promise 结果
 */
export async function showDialog(dialog, kind, opt, getMakerWindow) {
  const parent = pickParentWindow(getMakerWindow);
  const args = withParent(opt, parent);
  return kind === 'save' ? dialog.showSaveDialog(args) : dialog.showOpenDialog(args);
}
