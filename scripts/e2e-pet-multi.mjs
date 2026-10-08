// 多显示器行为验证：宠物被移到副屏后，物理边界应切换到副屏（而非被拉回主屏）
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { normalizePack } from '../src/shared/petpack.js';
import { registerIpc } from '../src/main/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZE = 128;
// 双屏：主屏 800x600 在左，副屏 1000x800 在右（底部高度不同，便于区分落点）
const LEFT = { x: 0, y: 0, width: 800, height: 600 };
const RIGHT = { x: 800, y: 0, width: 1000, height: 800 };

function still(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.32;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (Math.hypot(x - c, y - c) <= r) { px[i] = 255; px[i + 1] = 140; px[i + 2] = 60; px[i + 3] = 255; }
  }
  return px;
}

let win = null;
const js = (code) => win.webContents.executeJavaScript(code);
app.whenReady().then(async () => {
  registerIpc();

  const dataUrl = 'data:image/png;base64,' + encodePNG(SIZE, SIZE, Buffer.from(still(SIZE))).toString('base64');
  const pack = normalizePack({
    id: 'e2e-multi', name: '多屏测试', image: 'pet.png',
    frames: [{ file: 'pet.png', durationMs: 120 }],
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.6 },
    animation: { idle: 'breathe' },
    physics: { gravity: 1.2, bounce: 0.3, roam: false, roamSpeed: 0 },
    bubble: { enabled: false, lines: ['x'], intervalSec: 60, durationSec: 1 },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });

  ipcMain.removeHandler('pet:getPack');
  ipcMain.handle('pet:getPack', () => ({ pack, frames: [{ file: 'pet.png', dataUrl, durationMs: 120 }] }));

  // 关键：伪造双显示器
  ipcMain.removeHandler('screen:workArea');
  ipcMain.handle('screen:workArea', () => LEFT);
  ipcMain.removeHandler('screen:allWorkAreas');
  ipcMain.handle('screen:allWorkAreas', () => [LEFT, RIGHT]);

  const posLog = [];
  ipcMain.removeAllListeners('pet:setPos');
  ipcMain.on('pet:setPos', (e, p) => {
    posLog.push({ x: p.x, y: p.y });
    if (win && !win.isDestroyed()) win.setPosition(Math.round(p.x), Math.round(p.y));
  });
  for (const ch of ['pet:setSizeAnimated', 'pet:setSize']) {
    ipcMain.removeAllListeners(ch);
    ipcMain.on(ch, (e, s) => { if (win && !win.isDestroyed()) win.setSize(Math.round(s.w), Math.round(s.h)); });
  }
  ipcMain.removeAllListeners('pet:setIgnoreMouse');

  win = new BrowserWindow({
    width: 400, height: 400, x: 100, y: 100, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error/i.test(String(msg))) log('  [renderer] ' + msg);
  });

  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(3000);

  check('window.api 已注入', await js("typeof window.api === 'object'"));
  check('无加载错误', await js("document.querySelector('#err').hidden === true"));

  const s0 = win.getSize();
  const W = s0[0], H = s0[1];
  log('  窗口尺寸: ' + W + 'x' + H);
  const d0 = await js('window.__petDebug ? window.__petDebug() : null');
  if (!d0) { log('FATAL 无 __petDebug 钩子'); app.quit(); return; }
  const Hp = d0.H;   // pet.js 内部使用的窗口高度（与物理计算一致）
  const groundLeft = LEFT.y + LEFT.height - Hp;
  const groundRight = RIGHT.y + RIGHT.height - Hp;
  log('  窗口=' + W + 'x' + H + '  petH=' + Hp);
  log('  主屏底=' + groundLeft + ' 副屏底=' + groundRight);

  await sleep(1500);
  const p0 = posLog[posLog.length - 1];
  check('初始落在主屏底部', Math.abs(p0.y - groundLeft) <= 5, 'y=' + p0.y + ' 期望~' + groundLeft);

  // ---- 拖到副屏（分步移动，贴近真实拖拽）----
  const dbgBefore = await js('window.__petDebug && window.__petDebug()');
  log('  拖动前 area.x=' + (dbgBefore && dbgBefore.area ? dbgBefore.area.x : '?'));

  const dragTo = 1200;   // 落在 RIGHT 内
  await js(`(async () => {
    const cv = document.querySelector('#stage');
    const r = cv.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: cx, clientY: cy, screenX: 300, screenY: 300, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const tgt = ${dragTo}, from = ${p0.x};
    for (let k = 1; k <= 8; k++) {
      const nx = from + (tgt - from) * (k / 8);
      window.dispatchEvent(new MouseEvent('mousemove', { button: 0, clientX: cx, clientY: cy, screenX: 300 + (nx - from), screenY: 300, bubbles: true }));
      await new Promise((res) => setTimeout(res, 45));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, screenX: 300 + (tgt - from), screenY: 300, bubbles: true }));
    return true;
  })()`);
  await sleep(3000);

  const dbgAfter = await js('window.__petDebug && window.__petDebug()');
  log('  拖动后 area=' + JSON.stringify(dbgAfter.area));
  check('物理边界已切换到副屏', dbgAfter.area.x === RIGHT.x, 'area.x=' + dbgAfter.area.x + ' 期望=' + RIGHT.x);
  check('已加载两个显示器工作区', dbgAfter.allAreas.length === 2, JSON.stringify(dbgAfter.allAreas.map((a) => a.x)));

  const p1 = posLog[posLog.length - 1];
  check('拖到副屏后未被拉回主屏', p1.x >= RIGHT.x - 8, 'x=' + p1.x);
  check('落到副屏底部(而非主屏)', Math.abs(p1.y - groundRight) <= 6, 'y=' + p1.y + ' 副屏底~' + groundRight);

  // ---- 再拖回主屏 ----
  await js(`(async () => {
    const cv = document.querySelector('#stage');
    const r = cv.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: cx, clientY: cy, screenX: 300, screenY: 300, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const tgt = 200, from = ${p1.x};
    for (let k = 1; k <= 8; k++) {
      const nx = from + (tgt - from) * (k / 8);
      window.dispatchEvent(new MouseEvent('mousemove', { button: 0, clientX: cx, clientY: cy, screenX: 300 + (nx - from), screenY: 300, bubbles: true }));
      await new Promise((res) => setTimeout(res, 45));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, screenX: 300 + (tgt - from), screenY: 300, bubbles: true }));
    return true;
  })()`);
  await sleep(3000);

  const dbgBack = await js('window.__petDebug && window.__petDebug()');
  check('拖回后边界恢复主屏', dbgBack.area.x === LEFT.x, 'area.x=' + dbgBack.area.x);
  const p2 = posLog[posLog.length - 1];
  check('拖回主屏后落到主屏底部', Math.abs(p2.y - groundLeft) <= 6, 'y=' + p2.y + ' 主屏底~' + groundLeft);
  check('拖回后 x 在主屏内', p2.x >= LEFT.x - 4 && p2.x <= LEFT.x + LEFT.width, 'x=' + p2.x);

  log('');
  log('==== PET MULTI-MONITOR E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + String.fromCharCode(10) + (e.stack || '')); app.quit(); });
