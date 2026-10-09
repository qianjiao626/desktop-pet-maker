// 系统托盘：给用户一个「关掉制作器后仍然存在」的常驻入口
//
// 背景：桌宠是无边框透明置顶窗 + 像素级鼠标穿透，唯一退出方式原本是「右键点中它」。
// 一旦制作器窗口关闭、或宠物跑到屏幕外/被其他窗口盖住，用户会「退不出去」。
// 之前加了 Ctrl+Alt+Q 作为兜底，但普通人不会记快捷键 —— 托盘才是常规软件的标配入口。
//
// 本模块只负责「菜单结构」这一层纯逻辑（可单测）；Electron 的 Tray 绑定在 main.js 里注入。
// 这样设计的好处：菜单项状态（宠物是否在跑）可以直接测，不需要真的起 Electron。

/**
 * 生成托盘菜单模板（纯数据，便于测试）
 * @param {object} s 状态
 * @param {boolean} s.petAlive   宠物是否正在运行
 * @param {boolean} s.makerAlive 制作器窗口是否存在
 * @param {(ch:string)=>void} click 点击动作回调
 * @returns {Array} Electron Menu 模板
 */
export function buildTrayMenuTemplate(s, click) {
  const petAlive = !!s.petAlive;
  const makerAlive = !!s.makerAlive;
  return [
    { label: '桌宠制作器', enabled: false },
    { type: 'separator' },
    {
      label: petAlive ? '退出桌宠' : '桌宠未运行',
      enabled: petAlive,
      click: () => click('quitPet'),
    },
    {
      label: petAlive ? '隐藏 / 显示桌宠' : '（无桌宠可隐藏）',
      enabled: petAlive,
      click: () => click('togglePetVisible'),
    },
    { type: 'separator' },
    {
      label: makerAlive ? '显示制作器窗口' : '打开制作器',
      click: () => click('showMaker'),
    },
    { label: '宠物库文件夹', click: () => click('openPetsDir') },
    { type: 'separator' },
    { label: '退出制作器', click: () => click('quitApp') },
  ];
}

/** 托盘 tooltip 文案（宠物在跑时给出更强提示） */
export function trayTooltip(s) {
  return s.petAlive ? '桌宠制作器 — 桌宠运行中（右键可退出）' : '桌宠制作器';
}
