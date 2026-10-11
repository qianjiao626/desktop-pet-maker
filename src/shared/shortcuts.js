// 全局快捷键表（纯数据 + 纯函数，可单测）。
//
// 背景：桌宠是常驻的，用户常常"找不到它"（跑到屏幕角落/被其他窗口挡住）或
// "想立刻让它闭嘴/说话"，此时去翻制作器窗口非常别扭。给几个全局快捷键。
//
// 设计要点：
//   1) 全部用 Ctrl+Alt+ 前缀 —— 与系统/常用软件冲突概率最低。
//   2) 表是**纯数据**：主进程照它注册，测试照它断言，避免"文档写 A、代码注册 B"。
//   3) 每个键都要有中文说明，托盘菜单里直接复用（不给用户猜）。

/** 全部全局快捷键（accelerator 用 Electron 的写法） */
export const SHORTCUTS = [
  {
    id: 'toggle',
    accelerator: 'Control+Alt+P',
    label: '显示 / 隐藏桌宠',
    kbd: 'Ctrl+Alt+P',
  },
  {
    id: 'center',
    accelerator: 'Control+Alt+R',
    label: '把桌宠放回屏幕中央',
    kbd: 'Ctrl+Alt+R',
  },
  {
    id: 'say',
    accelerator: 'Control+Alt+S',
    label: '让它说一句话',
    kbd: 'Ctrl+Alt+S',
  },
  {
    id: 'quit',
    accelerator: 'Control+Alt+Q',
    label: '退出桌宠（兜底）',
    kbd: 'Ctrl+Alt+Q',
  },
];

/** 取某个快捷键的定义 */
export function shortcutOf(id) {
  return SHORTCUTS.find((s) => s.id === id) || null;
}

/** 校验：表里不能有重复的加速键（重复会让后注册的那个静默失效） */
export function validateShortcuts(list = SHORTCUTS) {
  const seen = new Map();
  const errors = [];
  for (const s of list) {
    if (!s || !s.id) { errors.push('缺少 id'); continue; }
    if (!s.accelerator) { errors.push(s.id + ' 缺少 accelerator'); continue; }
    if (seen.has(s.accelerator)) errors.push('加速键重复：' + s.accelerator + '（' + seen.get(s.accelerator) + ' 与 ' + s.id + '）');
    seen.set(s.accelerator, s.id);
  }
  return { ok: errors.length === 0, errors };
}

/** 生成托盘菜单里显示的提示文本（不带 Electron，方便单测） */
export function shortcutHint(id) {
  const s = shortcutOf(id);
  return s ? s.label + '（' + s.kbd + '）' : '';
}
