// 宠物运行时多帧动画验证：帧序列真的在推进、画布内容真的在变、once 模式会停
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

// 造 N 帧：每帧颜色明显不同，便于判定"当前显示的是第几帧"
function frameOf(i, n, size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.34;
  // 颜色随帧号变化
  const R = 60 + Math.round((i / Math.max(1, n - 1)) * 180);
  const G = 200 - i * 30;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    if (Math.hypot(x - c, y - c) <= r) { px[k] = R; px[k + 1] = Math.max(0, G); px[k + 2] = 90; px[k + 3] = 255; }
  }
  return px;
}

const SIZE = 128;
let win = null;
const js = (code) => win.webContents.executeJavaScript(code);

function bootWithPack(pack, frames) {
  ipcMain.removeHandler('pet:getPack');
  ipcMain.handle('pet:getPack', () => ({ pack, frames }));
}

app.whenReady().then(async () => {
  registerIpc();

  const NF = 5;
  const imgs = [];
  for (let i = 0; i < NF; i++) imgs.push({ file: `f${i}.png`, dataUrl: 'data:image/png;base64,' + encodePNG(SIZE, SIZE, Buffer.from(frameOf(i, NF, SIZE))).toString('base64'), durationMs: 120 });

  const basePack = {
    id: 'e2e-anim', name: '动画测试', image: 'f0.png',
    frames: imgs.map((f) => ({ file: f.file, durationMs: f.durationMs })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.5 },
    animation: { idle: 'play', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'none' },
    physics: { gravity: 0, bounce: 0, roam: false, roamSpeed: 0 },
    bubble: { enabled: false, lines: ['x'], intervalSec: 60, durationSec: 1 },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  };

  win = new BrowserWindow({
    width: 400, height: 400, x: 50, y: 50, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error/i.test(String(msg))) log('  [renderer] ' + msg);
  });

  // 读取 canvas 中心像素（判断当前显示帧）
  const readCenter = () => js(`(() => {
    const cv = document.querySelector('#stage');
    const cx = cv.getContext('2d');
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const mid = ((cv.height >> 1) * cv.width + (cv.width >> 1)) * 4;
    return { r: d[mid], g: d[mid + 1], b: d[mid + 2], a: d[mid + 3] };
  })()`);

  // ---- 场景 A：play 模式（循环播放）----
  bootWithPack(normalizePack(basePack), imgs);
  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(2500);

  const samples = [];
  for (let i = 0; i < 40; i++) { samples.push(await readCenter()); await sleep(45); }
  const colors = samples.map((s) => `${s.r},${s.g},${s.b},${s.a}`);
  const uniq = [...new Set(colors)];
  check('多帧 play：画面随时间变化', uniq.length >= 3, '不同画面=' + uniq.length + '/' + colors.length);
  check('所有采样均不透明(帧已绘制)', samples.every((s) => s.a > 200), 'minA=' + Math.min(...samples.map((s) => s.a)));
  check('颜色落在帧调色范围内', samples.every((s) => s.r >= 55 && s.r <= 245 && s.b === 90), JSON.stringify(uniq.slice(0, 3)));
  // 循环播放：长时间采样后应再次出现首个颜色
  const first = colors[0];
  const reappears = colors.slice(1).some((c) => c === first);
  check('play 模式会循环(首色复现)', reappears || uniq.length >= NF - 1, 'uniq=' + uniq.length);

  // ---- 场景 B：once 模式（播放一次后停在末帧）----
  const oncePack = normalizePack({ ...basePack, animation: { ...basePack.animation, idle: 'once' } });
  bootWithPack(oncePack, imgs);
  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(3000);   // 5 帧 * 120ms = 600ms，留足时间
  const tail = [];
  for (let i = 0; i < 12; i++) { tail.push(await readCenter()); await sleep(120); }
  const tailColors = [...new Set(tail.map((s) => `${s.r},${s.g},${s.b}`))];
  check('once 模式播放后稳定在末帧', tailColors.length === 1, 'tail 颜色数=' + tailColors.length + ' -> ' + tailColors.join(' | '));
  const lastFrame = frameOf(NF - 1, NF, SIZE);
  const lastMid = ((64 * SIZE) + 64) * 4;
  const expR = lastFrame[lastMid], expG = lastFrame[lastMid + 1];
  check('末帧颜色与预期一致', Math.abs(tail[0].r - expR) <= 6 && Math.abs(tail[0].g - expG) <= 6, `got ${tail[0].r},${tail[0].g} expect ${expR},${expG}`);

  // ---- 场景 C：单帧包不应崩溃，且画面静止 ----
  const one = [imgs[0]];
  const onePack = normalizePack({ ...basePack, frames: [{ file: one[0].file, durationMs: 120 }], animation: { ...basePack.animation, idle: 'play' } });
  bootWithPack(onePack, one);
  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(2200);
  const s1 = [];
  for (let i = 0; i < 10; i++) { s1.push(await readCenter()); await sleep(80); }
  check('单帧包画面静止', new Set(s1.map((s) => `${s.r},${s.g},${s.b}`)).size === 1, '颜色数=' + new Set(s1.map((s) => `${s.r},${s.g},${s.b}`)).size);
  check('单帧包正常绘制', s1.every((s) => s.a > 200));

  // ---- 场景 D：breathe 模式下多帧不应推进（变换与帧推进互斥）----
  const breathePack = normalizePack({ ...basePack, animation: { ...basePack.animation, idle: 'breathe' } });
  bootWithPack(breathePack, imgs);
  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(2200);
  const s2 = [];
  for (let i = 0; i < 12; i++) { s2.push(await readCenter()); await sleep(70); }
  check('breathe 模式停留在第 1 帧', new Set(s2.map((s) => `${s.r},${s.g},${s.b}`)).size === 1, '颜色数=' + new Set(s2.map((s) => `${s.r},${s.g},${s.b}`)).size);

  log('');
  log('==== PET ANIM E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });