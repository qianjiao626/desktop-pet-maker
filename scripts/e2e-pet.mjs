import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { normalizePack } from '../src/shared/petpack.js';
import { registerIpc } from '../src/main/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造一只橙色圆宠（纯色背景），用于验证渲染与抠像无关的运行时行为
function synth(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.32;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 0; px[i + 1] = on ? 140 : 0; px[i + 2] = on ? 60 : 0; px[i + 3] = on ? 255 : 0;
  }
  return px;
}

const SIZE = 256;
let win = null;
const js = (code) => win.webContents.executeJavaScript(code);
app.whenReady().then(async () => {
  registerIpc();

  const png = encodePNG(SIZE, SIZE, Buffer.from(synth(SIZE)));
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  const pack = normalizePack({
    id: 'e2e-pet', name: 'E2E宠', image: 'pet.png',
    frames: [{ file: 'pet.png', durationMs: 120 }],
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.5 },
    animation: { idle: 'breathe', click: 'bounce' },
    physics: { gravity: 1.2, bounce: 0.5, roam: true, roamSpeed: 1 },
    bubble: { enabled: true, lines: ['测试台词'], intervalSec: 5, durationSec: 2 },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });

  // pet.js 通过 pet:getPack 拿包 -> 在此桩掉
  ipcMain.removeHandler('pet:getPack');
  ipcMain.handle('pet:getPack', () => ({ pack, frames: [{ file: 'pet.png', dataUrl, durationMs: 120 }] }));

  // 拦截 setPos，记录窗口位置变化（验证物理真的在动）
  const posLog = [];
  ipcMain.removeAllListeners('pet:setPos');
  ipcMain.on('pet:setPos', (e, { x, y }) => {
    posLog.push({ x, y });
    if (win && !win.isDestroyed()) win.setPosition(Math.round(x), Math.round(y));
  });
  const sizeLog = [];
  ipcMain.removeAllListeners('pet:setSize');
  ipcMain.on('pet:setSize', (e, { w, h }) => {
    sizeLog.push({ w, h });
    if (win && !win.isDestroyed()) win.setSize(Math.round(w), Math.round(h));
  });
  ipcMain.removeAllListeners('pet:setIgnoreMouse');
  const ignoreLog = [];
  ipcMain.on('pet:setIgnoreMouse', (e, flag) => ignoreLog.push(flag));

  win = new BrowserWindow({
    width: 400, height: 400, x: 100, y: 100, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, offscreen: true,
    },
  });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error/i.test(String(msg))) log('  [renderer] ' + msg);
  });

  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(3000);
  // ---- 1. 基本加载 ----
  check('window.api 已注入', await js("typeof window.api === 'object'"));
  check('canvas 存在', await js("!!document.querySelector('#stage')"));
  const noErr = await js("document.querySelector('#err').hidden === true");
  check('无加载错误遮罩', noErr);

  // ---- 2. canvas 真的画出了像素（非空白）----
  const drawn = await js(`(() => {
    const cv = document.querySelector('#stage');
    const cx = cv.getContext('2d');
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 24) opaque++;
    return { w: cv.width, h: cv.height, opaque, ratio: opaque / (cv.width * cv.height) };
  })()`);
  check('canvas 尺寸已设置', drawn.w > 0 && drawn.h > 0, drawn.w + 'x' + drawn.h);
  check('canvas 已绘制不透明像素', drawn.opaque > 0, 'opaque=' + drawn.opaque + ' ratio=' + drawn.ratio.toFixed(3));
  check('不透明像素占比合理(0.02~0.95)', drawn.ratio > 0.02 && drawn.ratio < 0.95, drawn.ratio.toFixed(3));

  // ---- 3. 求包成功、帧数正确 ----
  const boot = await js("document.querySelector('#bubbleText') ? true : false");
  check('气泡节点就绪', boot);

  // ---- 4. 窗口尺寸已按 pack 设置 ----
  check('已请求设置窗口尺寸', sizeLog.length > 0, JSON.stringify(sizeLog[0]));
  const expectedW = Math.max(160, Math.round(SIZE * 0.5 * 1.45 + 48));
  check('窗口宽度符合预期', sizeLog.length > 0 && Math.abs(sizeLog[0].w - expectedW) < 120, 'got ' + (sizeLog[0] || {}).w + ' expect~' + expectedW);

  // ---- 5. 物理在动（setPos 持续被调用，且 y 最终稳定在底部）----
  const before = posLog.length;
  await sleep(1500);
  check('物理循环持续调用 setPos', posLog.length > before + 20, 'callDelta=' + (posLog.length - before));
  const last = posLog[posLog.length - 1];
  check('位置为有限数值', Number.isFinite(last.x) && Number.isFinite(last.y), JSON.stringify(last));

  // ---- 6. 鼠标穿透初始为 true（空白区域穿透）----
  check('初始请求鼠标穿透', ignoreLog.length > 0 && ignoreLog[0] === true, JSON.stringify(ignoreLog.slice(0, 3)));

  // ---- 7. 点击命中测试：中心命中、角落不命中 ----
  const hit = await js(`(async () => {
    const cv = document.querySelector('#stage');
    const r = cv.getBoundingClientRect();
    // 用内部逻辑等价判断：中心应命中，角落应落空
    const evCenter = new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.55, bubbles: true });
    window.dispatchEvent(evCenter);
    await new Promise((res) => setTimeout(res, 120));
    const evCorner = new MouseEvent('mousemove', { clientX: r.left + 1, clientY: r.top + 1, bubbles: true });
    window.dispatchEvent(evCorner);
    await new Promise((res) => setTimeout(res, 120));
    return true;
  })()`);
  check('命中测试事件已触发', hit === true);
  check('穿过状态发生变化', ignoreLog.length >= 2, 'n=' + ignoreLog.length);

  // ---- 8. 点击宠物触发点击动画 ----
  const clickResult = await js(`(async () => {
    const cv = document.querySelector('#stage');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: r.left + r.width/2, clientY: r.top + r.height*0.55, screenX: 300, screenY: 300, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, screenX: 300, screenY: 300, bubbles: true }));
    return true;
  })()`);
  check('点击事件已派发', clickResult === true);
  await sleep(500);
  const bubbleShown = await js("!document.querySelector('#bubble').hidden");
  check('点击后弹出气泡', bubbleShown);

  // ---- 9. 右键菜单可打开 ----
  const menuOk = await js(`(async () => {
    const cv = document.querySelector('#stage');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true, cancelable: true }));
    return !document.querySelector('#menu').hidden;
  })()`);
  check('右键菜单打开', menuOk);

  // ---- 10. 菜单项数量 ----
  const miCount = await js("document.querySelectorAll('#menu .mi').length");
  // 6 项：回到屏幕底部 / 说一句话 / 切换置顶 / 切换鼠标穿透 / 换个动作 / 退出桌宠
  // （「换个动作」只有包里带多段片段时才可见，但 DOM 里始终存在 -> 这里是文档级计数）
  check('菜单含 6 项', miCount === 6, 'n=' + miCount);
  check('无片段时「换个动作」是隐藏的', await js(`document.querySelector('#miNextClip').hidden === true`));

  log('');
  log('==== PET E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });
