// 跨平台启动适配（纯逻辑，可单测，不依赖 Electron）
//
// 为什么单独成模块：
//   1. Linux 上 Electron 的「无边框 + 透明」窗口有已知的合成器问题，
//      需要启动前补 Chromium 开关；把「该补哪些开关」做成纯函数才好单测。
//   2. macOS 上如果把应用菜单设成 null，Cmd+Q / Cmd+H / 复制粘贴等
//      系统标准快捷键会全部失效，必须保留一份最小菜单。
// 这两件事都属于「按平台决定行为」，集中在这里避免散落到 main.js 各处。

/** Linux 上保证透明窗口正常显示所需的 Chromium 开关 */
export const LINUX_TRANSPARENT_SWITCHES = [
  'enable-transparent-visuals',
  'disable-gpu-compositing',
];

/**
 * 按平台返回启动前要追加的 Chromium 开关名（不含 -- 前缀）。
 * @param {string} platform  process.platform
 * @param {object} env       进程环境变量（用于逃生开关）
 */
export function startupSwitches(platform, env = {}) {
  if (platform !== 'linux') return [];
  const out = LINUX_TRANSPARENT_SWITCHES.slice();
  // 逃生开关：个别显卡驱动下 --disable-gpu-compositing 仍会闪黑，
  // 此时设 PETMAKER_DISABLE_GPU=1 彻底关掉 GPU 加速（本工具是 2D canvas，够用）。
  if (env && env.PETMAKER_DISABLE_GPU === '1') out.push('disable-gpu');
  return out;
}

/**
 * macOS 最小应用菜单。
 * 不返回 null —— 否则系统级快捷键（退出/隐藏/复制粘贴）全部失效。
 * 非 macOS 返回 null（Windows/Linux 用无菜单的干净界面）。
 */
export function appMenuTemplate(platform, appName = '桌宠制作器') {
  if (platform !== 'darwin') return null;
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: '关于 ' + appName },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 ' + appName },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 ' + appName },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
  ];
}
