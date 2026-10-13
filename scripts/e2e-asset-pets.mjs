// e2e：把 素材/做好的宠物/*.petpack（AI 生成立绘做成的宠物）真的加载上桌渲染。
//
// 为什么要这个套件：单测只校验包结构，"能不能真的画出来"必须在渲染器里验证。
// 历史上就踩过"结构合格但渲染是空白/尺寸不符导致窗口跳"的坑。
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipRead } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';
import { registerIpc } from '../src/main/main.js';
import { safeWrite, installEpipeGuard } from './lib-e2e-log.mjs';
installEpipeGuard();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// 这 10 只是由 AI 立绘做成的内置宠物（见 scripts/make-pets-from-assets.mjs）。
// 测试读 examples/（随包分发）而不是 素材/ —— 后者是 .gitignore 的，
// 在别的机器 / CI 上不存在，会导致套件无意义地失败。
const AI_PET_NAMES = ['女孩', '男孩', '猫', '狗', '兔', '恐龙', '熊猫', '狐狸', '企鹅', '青蛙'];
const PETS_DIR = path.join(ROOT, 'examples');

let pass = 0, fail = 0;
const log = (m) => safeWrite(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let win = null;
const js = (code) => win.webContents.executeJavaScript(code);

/** 读一个 petpack，返回 { pack, frames }（frames 里带 dataUrl） */
function loadPet(file) {
  const entries = zipRead(fs.readFileSync(file));
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const pack = normalizePack(JSON.parse(byName.get('pet.json').toString('utf8')));
  const mime = (n) => (/\.png$/i.test(n) ? 'image/png' : 'image/jpeg');
  const frames = pack.frames.map((fr) => ({
    file: fr.file,
    durationMs: fr.durationMs,
    dataUrl: 'data:' + mime(fr.file) + ';base64,' + byName.get(fr.file).toString('base64'),
  }));
  return { pack, frames };
}

app.whenReady().then(async () => {
  registerIpc();

  const files = AI_PET_NAMES
    .map((n) => n + '.petpack')
    .filter((f) => fs.existsSync(path.join(PETS_DIR, f)));
  check('10 只 AI 立绘宠物都在内置库里', files.length === AI_PET_NAMES.length,
    files.length + '/' + AI_PET_NAMES.length + (files.length !== AI_PET_NAMES.length
      ? ' 缺: ' + AI_PET_NAMES.filter((n) => !files.includes(n + '.petpack')).join(', ')
      : ''));

  // 逐个宠物开一个离屏窗口加载（复用同一个窗口，逐个换包）
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
  ipcMain.on('pet:setIgnoreMouse', () => {});

  let current = null;
  ipcMain.removeHandler('pet:getPack');
  ipcMain.handle('pet:getPack', () => current);

  win = new BrowserWindow({
    width: 400, height: 400, x: 60, y: 60, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, offscreen: true,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error/i.test(String(msg))) errors.push(String(msg));
  });

  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await sleep(1200);

  const results = [];
  for (const f of files) {
    current = loadPet(path.join(PETS_DIR, f));
    posLog.length = 0; sizeLog.length = 0;
    // 让渲染器重新拉一次包
    await js('window.location.reload()').catch(() => {});
    await sleep(1500);

    const drawn = await js(`(() => {
      const cv = document.querySelector('#stage');
      if (!cv) return { err: 'no canvas' };
      const cx = cv.getContext('2d');
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 24) opaque++;
      return { w: cv.width, h: cv.height, opaque, ratio: opaque / (cv.width * cv.height) };
    })()`);

    const ok = !drawn.err && drawn.opaque > 0 && drawn.ratio > 0.02 && drawn.ratio < 0.95;
    results.push({ f, drawn, ok });
    log((ok ? 'PASS  ' : 'FAIL  ') + f + '  画布 ' + drawn.w + 'x' + drawn.h
      + '  不透明占比 ' + (drawn.ratio != null ? (drawn.ratio * 100).toFixed(1) + '%' : '?')
      + (drawn.err ? '  ' + drawn.err : ''));
    if (!ok) fail++; else pass++;
  }

  check('全部宠物都能渲染出非空画面', results.every((r) => r.ok),
    results.filter((r) => !r.ok).map((r) => r.f).join(', '));
  check('渲染过程没有报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  // 片段的帧文件必须都在包里（否则运行时会丢片段）
  const missingClipFrames = [];
  for (const f of files) {
    const entries = zipRead(fs.readFileSync(path.join(PETS_DIR, f)));
    const names = new Set(entries.map((e) => e.name));
    const pack = normalizePack(JSON.parse(entries.find((e) => e.name === 'pet.json').data.toString('utf8')));
    for (const c of pack.clips) for (const fr of c.frames) {
      if (!names.has(fr.file)) missingClipFrames.push(f + ':' + fr.file);
    }
  }
  check('片段帧文件都在包内', missingClipFrames.length === 0, missingClipFrames.slice(0, 3).join(', '));

  log('');
  log('---- AI 素材宠物 e2e: ' + pass + '/' + (pass + fail) + ' ----');
  app.exit(fail ? 1 : 0);
});