// 托盘端到端：验证「启用桌宠后托盘菜单变为可退出」这条关键链路
//
// 说明：Electron 的 Tray 只有 set 方法、没有 get 方法（getImage/getContextMenu 不存在），
// 所以这里通过包装 Tray 实例、记录 setContextMenu 的入参来验证菜单内容。
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { registerIpc } from '../src/main/main.js';
import { isPetAlive } from '../src/main/state.js';
import { buildTrayMenuTemplate, trayTooltip } from '../src/main/tray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function blob(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 250; px[i+1] = on ? 130 : 250; px[i+2] = on ? 60 : 250; px[i+3] = 255;
  }
  return Buffer.from(px);
}

app.whenReady().then(async () => {
  registerIpc();

  // --- 1) 托盘图标资源可加载（真实文件 + nativeImage）---
  const icon = nativeImage.createFromPath(path.join(ROOT, 'src', 'assets', 'icon.png'));
  check('托盘图标可加载且非空', !icon.isEmpty(), icon.getSize().width + 'x' + icon.getSize().height);

  // --- 2) 真实创建 Tray 实例，并接管 setContextMenu 以记录菜单 ---
  const tray = new Tray(icon);
  check('Tray 实例创建成功', !!tray && !tray.isDestroyed());

  let lastMenu = null;
  const realSet = tray.setContextMenu.bind(tray);
  tray.setContextMenu = (m) => { lastMenu = m; return realSet(m); };

  const menuNow = () => lastMenu ? lastMenu.items.map(i => ({ label: i.label, enabled: i.enabled })) : [];
  const refresh = (s) => tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(s, () => {})));

  // --- 3) 初始：无桌宠 -> 退出入口禁用 ---
  refresh({ petAlive: isPetAlive(), makerAlive: true });
  let m = menuNow();
  const q0 = m.find(i => i.label === '退出桌宠' || i.label === '桌宠未运行');
  check('初始无桌宠时退出入口为禁用', !!q0 && q0.enabled === false, q0 ? q0.label : '未找到');

  // --- 4) 真实启用桌宠（走 IPC）---
  const maker = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1200);

  const dataUrl = 'data:image/png;base64,' + blob(256).toString('base64');
  const pack = {
    id: 'tray-e2e', name: '托盘测试宠', author: 'e2e',
    frames: [{ file: 'f.png', durationMs: 200 }],
    canvas: { width: 256, height: 256 },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', fps: 6, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
    bubble: { enabled: false, lines: [] },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: false },
  };
  const res = await maker.webContents.executeJavaScript(
    'window.api.quickEnable(' + JSON.stringify(pack) + ', [{file:"f.png",dataUrl:' + JSON.stringify(dataUrl) + ',durationMs:200}])'
  );
  check('桌宠启用（IPC 返回 ok）', !!(res && res.ok), JSON.stringify(res).slice(0, 100));
  await sleep(1500);
  check('主进程确认桌宠存活', isPetAlive() === true);

  // --- 5) 托盘菜单随状态刷新：出现可用的「退出桌宠」 ---
  refresh({ petAlive: isPetAlive(), makerAlive: true });
  m = menuNow();
  const q1 = m.find(i => i.label === '退出桌宠');
  check('桌宠运行后托盘出现可用的「退出桌宠」', !!q1 && q1.enabled === true, q1 ? 'enabled=' + q1.enabled : '未找到');
  const h1 = m.find(i => i.label === '隐藏 / 显示桌宠');
  check('桌宠运行后托盘出现可用的「隐藏 / 显示桌宠」', !!h1 && h1.enabled === true);

  // --- 6) 停用后菜单回到禁用态 ---
  await maker.webContents.executeJavaScript('window.api.quickDisable()');
  await sleep(1200);
  check('停用后主进程确认桌宠已关闭', isPetAlive() === false);
  refresh({ petAlive: isPetAlive(), makerAlive: true });
  m = menuNow();
  const q2 = m.find(i => i.label === '桌宠未运行');
  check('停用后退出入口回到禁用态', !!q2 && q2.enabled === false, q2 ? q2.label : '未找到');

  // --- 7) 防「退不出去」复发的关键断言 ---
  const t = buildTrayMenuTemplate({ petAlive: true, makerAlive: false }, () => {});
  check('制作器已关闭时，托盘仍有可用的「退出桌宠」', t.some(i => i.label === '退出桌宠' && i.enabled));
  check('制作器已关闭时，托盘能重新打开制作器', t.some(i => i.label === '打开制作器'));
  check('托盘 tooltip 运行中提示退出方式', trayTooltip({ petAlive: true }).includes('退出'));

  log('==== TRAY E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  try { tray.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
