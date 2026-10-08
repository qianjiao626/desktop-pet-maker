// 宠物运行时内存防护：加载超大帧数的 petpack 时，应自动抽稀而不崩溃
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { normalizePack } from '../src/shared/petpack.js';
import { planRuntimeFrames } from '../src/shared/budget.js';
import { registerIpc } from '../src/main/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 用较大画布 + 很多帧构造"膨胀包"：800x800 x 200 帧
const SIZE = 800;
const NF = 200;

function still(size, i) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  const R = 60 + (i % 5) * 45;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    if (Math.hypot(x - c, y - c) <= r) { px[k] = R; px[k + 1] = 140; px[k + 2] = 60; px[k + 3] = 255; }
  }
  return px;
}

let win = null;
const js = (code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  registerIpc();

  // 只准备少量实际 PNG（内存考虑），但声称有 200 帧 -> 复用同一批 dataUrl
  const one = 'data:image/png;base64,' + encodePNG(SIZE, SIZE, Buffer.from(still(SIZE, 0))).toString('base64');
  const frames = Array.from({ length: NF }, (_, i) => ({ file: `f${i}.png`, dataUrl: one, durationMs: 100 }));

  const pack = normalizePack({
    id: 'e2e-budget', name: '膨胀包', image: 'f0.png',
    frames: frames.map((f) => ({ file: f.file, durationMs: f.durationMs })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.3 },
    animation: { idle: 'play', fps: 8 },
    physics: { gravity: 0, bounce: 0, roam: false, roamSpeed: 0 },
    bubble: { enabled: false, lines: ['x'], intervalSec: 60, durationSec: 1 },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });

  // 先离线算出期望保留帧数
  const expect = planRuntimeFrames(frames, SIZE, SIZE);
  log('  预期抽稀: ' + NF + ' -> ' + expect.frames.length + ' 帧, 约 ' + (expect.bytes / 1048576).toFixed(1) + 'MB');

  ipcMain.removeHandler('pet:getPack');
  ipcMain.handle('pet:getPack', () => ({ pack, frames }));

  ipcMain.removeAllListeners('pet:setPos');
  ipcMain.on('pet:setPos', (e, p) => { if (win && !win.isDestroyed()) win.setPosition(Math.round(p.x), Math.round(p.y)); });
  for (const ch of ['pet:setSizeAnimated', 'pet:setSize']) {
    ipcMain.removeAllListeners(ch);
    ipcMain.on(ch, (e, s) => { if (win && !win.isDestroyed()) win.setSize(Math.round(s.w), Math.round(s.h)); });
  }
  ipcMain.removeAllListeners('pet:setIgnoreMouse');

  let crashed = false;
  win = new BrowserWindow({
    width: 400, height: 400, x: 50, y: 50, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  win.webContents.on('render-process-gone', () => { crashed = true; });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/已从|抽稀/.test(String(msg))) log('  [renderer] ' + msg);
  });

  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(6000);

  check('渲染进程未崩溃', crashed === false);
  check('无加载错误遮罩', await js("document.querySelector('#err').hidden === true"));

  const dbg = await js("window.__petDebug ? window.__petDebug() : null");
  check('调试钩子可用', !!dbg);

  // 关键：内部实际帧数应被抽稀到预期值

  // 决定性断言：实际加载帧数必须等于预算规划结果
  check('实际加载帧数=预算规划值', dbg.loadedFrames === expect.frames.length,
    'loaded=' + dbg.loadedFrames + ' expect=' + expect.frames.length + ' 原始=' + NF);
  check('确实发生了抽稀', dbg.loadedFrames < NF, dbg.loadedFrames + ' < ' + NF);
  check('加载字节在预算内', dbg.loadedBytes <= expect.bytes * 1.05,
    (dbg.loadedBytes / 1048576).toFixed(1) + 'MB');

  const inner = await js("(function(){ try { return document.querySelector('#stage').width; } catch(e) { return -1; } })()");
  check('canvas 已正常绘制', typeof inner === 'number' && inner > 0, 'w=' + inner);

  // 通过 __petDebug 暴露的内存提示元素状态验证
  const noticeSeen = await js("(function(){ const el = document.querySelector('#memNotice'); return el ? 'exists' : 'missing'; })()");
  check('内存提示元素存在', noticeSeen === 'exists');

  // 画面确实绘制了内容（未因抽稀而空白）
  const drawn = await js(`(function(){
    const cv = document.querySelector('#stage');
    const cx = cv.getContext('2d');
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++;
    return { w: cv.width, h: cv.height, opaque: n };
  })()`);
  check('抽稀后仍有画面内容', drawn.opaque > 0, 'opaque=' + drawn.opaque + ' canvas=' + drawn.w + 'x' + drawn.h);

  log('');
  log('==== PET BUDGET E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });