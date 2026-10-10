import { app, BrowserWindow, ipcMain, dialog, Menu, screen, shell, globalShortcut, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { zipCreate, zipRead } from '../shared/zip.js';
import { normalizePack, validatePack } from '../shared/petpack.js';
import { petPackFileName, safeFileName } from '../shared/safeid.js';
import { computeLayout } from '../shared/layout.js';
import { emptyState, normalizeState, toggleFavorite, touchRecent, forgetPet } from '../shared/library.js';
import { MODELS, listModels, downloadModel, deleteModel, isInstalled } from './models.js';
import { segmentImage, segmentAuto } from './segment.js';
import { setCurrentPack, getCurrentPack, setPetWindow, getPetWindow, setMakerWindow, getMakerWindow, isPetAlive, setCurrentScale, getCurrentScale } from './state.js';
import { buildTrayMenuTemplate, trayTooltip } from './tray.js';
import { startupSwitches, appMenuTemplate } from '../shared/platform.js';
import { buildShareHtml, shareFileName } from '../shared/sharepack.js';
import { normalizeTemplateList, addTemplate, removeTemplate, renameTemplate, templateFromPack, normalizeTemplate, templateFileName, TEMPLATE_SCHEMA } from '../shared/mytemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'preload.cjs');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};
const MIME_TO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' };

// ---------- 参数解析 ----------
// Linux：无边框透明窗需要额外的 Chromium 开关（否则可能整窗黑屏或完全透明）。
// 必须在 app ready 之前追加，故放在模块顶层。
for (const sw of startupSwitches(process.platform, process.env)) {
  try { app.commandLine.appendSwitch(sw); } catch {}
}

const argv = process.argv.slice(1);
const petArg = argv.find((a) => a.startsWith('--pet'));
const selftest = argv.includes('--selftest-ai');
const isMaker = argv.includes('--maker') || !petArg;
const petPath = petArg && petArg.includes('=') ? petArg.split('=').slice(1).join('=') : null;

// ---------- 调试 ----------
const DEBUG = process.env.PETMAKER_DEBUG === '1';
function attachDebug(win, tag) {
  if (!DEBUG) return;
  try {
    win.webContents.on('console-message', (...a) => {
      const ev = a[0];
      const msg = (ev && typeof ev === 'object' && 'message' in ev) ? `${ev.message} (${ev.sourceId}:${ev.lineNumber})` : a[2];
      console.log(`[${tag}] console: ${msg}`);
    });
    win.webContents.on('did-fail-load', (e, code, desc, url) => console.log(`[${tag}] did-fail-load ${code} ${desc} ${url}`));
    win.webContents.on('preload-error', (e, p, err) => console.log(`[${tag}] preload-error ${p} ${err}`));
    win.webContents.on('render-process-gone', (e, d) => console.log(`[${tag}] gone ${JSON.stringify(d)}`));
    win.webContents.on('did-finish-load', () => console.log(`[${tag}] did-finish-load OK`));
  } catch {}
}

// ---------- 宠物库目录 ----------
function petsDir() {
  const d = path.join(app.getPath('userData'), 'pets');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// 内置示例宠物所在的目录（随应用分发；打包后位于 app.asar 内也能读取）
function builtinPetsDir() { return path.join(ROOT, 'examples'); }

/**
 * 把内置示例宠物复制进用户宠物库（首次运行 / 库为空时）。
 * 内置角色（小黄龙等）让用户开箱即用；已存在的同名包不覆盖，避免冲掉用户的修改或删除。
 */
function seedBuiltinPets() {
  const installed = [];
  try {
    const src = builtinPetsDir();
    if (!fs.existsSync(src)) return installed;
    const dst = petsDir();
    for (const f of fs.readdirSync(src)) {
      if (!/\.petpack$/i.test(f)) continue;
      const from = path.join(src, f);
      const to = path.join(dst, f);
      if (fs.existsSync(to)) continue;            // 已装过（或用户删过又重装）就不动
      try {
        const buf = fs.readFileSync(from);        // 先整体读入（asar 内路径可读）
        fs.writeFileSync(to, buf);                // 再写到真实用户目录
        const { pack } = readPackFile(from);      // 校验可解析
        installed.push(pack.name || f);
      } catch (err) {
        // 失败要能看见：打包版里被静默吞掉过一次（宠物库空、无任何提示）
        console.warn('[pet] 内置宠物载入失败: ' + f + ' -> ' + err.message);
      }
    }
  } catch (err) {
    console.warn('[pet] 安装内置宠物失败: ' + err.message);
  }
  return installed;
}

// 旧的简易实现已由 shared/safeid.js 的 safeFileName 取代（处理保留名/限长/路径穿越）

// ---------- 位置记忆 ----------
function positionsFile() { return path.join(app.getPath('userData'), 'positions.json'); }
function loadPositions() { try { return JSON.parse(fs.readFileSync(positionsFile(), 'utf8')); } catch { return {}; } }
function savePosition(id, x, y) {
  if (!id) return;
  const p = loadPositions();
  p[id] = { x: Math.round(x), y: Math.round(y) };
  try { fs.writeFileSync(positionsFile(), JSON.stringify(p, null, 2)); } catch {}
}
function getPosition(id) { const p = loadPositions(); return (id && p[id]) || null; }

// ---------- 宠物库偏好（收藏 / 最近使用） ----------
// 存放在 userData/library.json，与 positions.json 同级。
// 按宠物 id 记录，不写进 .petpack（用户偏好不该污染可分享的宠物包）。
function libraryFile() { return path.join(app.getPath('userData'), 'library.json'); }
function loadLibraryPrefs() {
  try { return normalizeState(JSON.parse(fs.readFileSync(libraryFile(), 'utf8'))); }
  catch { return emptyState(); }
}
function saveLibraryPrefs(state) {
  try { fs.writeFileSync(libraryFile(), JSON.stringify(normalizeState(state), null, 2)); }
  catch (err) { console.warn('[library] 保存偏好失败: ' + (err && err.message)); }
}

// ---------- 我的模板（自定义性格模板） ----------
// 存在 userData/templates.json；可导出成独立 .pettpl 文件分享给朋友。
function templatesFile() { return path.join(app.getPath('userData'), 'templates.json'); }
function loadTemplates() {
  try {
    const raw = JSON.parse(fs.readFileSync(templatesFile(), 'utf8'));
    return normalizeTemplateList(Array.isArray(raw) ? raw : raw && raw.templates);
  } catch { return []; }
}
function saveTemplates(list) {
  try {
    fs.writeFileSync(templatesFile(), JSON.stringify({ schema: TEMPLATE_SCHEMA, templates: normalizeTemplateList(list) }, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  }
}

// ---------- 宠物包读写（多帧） ----------
function mimeOf(file) { return MIME[path.extname(file).toLowerCase()] || 'image/png'; }

function readPackFile(p) {
  const buf = fs.readFileSync(p);
  const map = new Map(zipRead(buf).map((e) => [e.name, e.data]));
  const manifest = map.get('pet.json');
  if (!manifest) throw new Error('宠物包缺少 pet.json');
  const pack = normalizePack(JSON.parse(manifest.toString('utf8')));
  const frames = [];
  for (const f of pack.frames) {
    const b = map.get(f.file);
    if (!b) { if (frames.length) continue; throw new Error('宠物包缺少帧文件: ' + f.file); }
    frames.push({ file: f.file, dataUrl: `data:${mimeOf(f.file)};base64,${b.toString('base64')}`, durationMs: f.durationMs });
  }
  if (!frames.length) throw new Error('宠物包无可用的帧图片');
  return { pack, frames, file: p };
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) throw new Error('图片数据无效');
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

// images: [{ dataUrl, durationMs }]
function buildPackAndEntries(pack, images) {
  if (!Array.isArray(images) || !images.length) throw new Error('没有可导出的图片');
  const files = [];
  const frames = [];
  images.forEach((img, idx) => {
    const { mime, buf } = dataUrlToBuffer(img.dataUrl);
    const ext = MIME_TO_EXT[mime] || '.png';
    const name = images.length === 1 ? 'pet' + ext : `frame_${String(idx).padStart(3, '0')}${ext}`;
    files.push({ name, data: buf });
    frames.push({ file: name, durationMs: Math.max(16, Math.round(img.durationMs || 120)) });
  });
  const p = normalizePack({ ...pack, frames });
  return { pack: p, files };
}

function writePackFile(pack, images, outPath) {
  const { pack: p, files } = buildPackAndEntries(pack, images);
  const v = validatePack(p);
  if (!v.ok) throw new Error(v.errors.join('；'));
  const entries = [
    { name: 'pet.json', data: JSON.stringify(p, null, 2) },
    ...files,
    { name: 'README.txt', data: `桌宠宠物包\n名称: ${p.name}\n作者: ${p.author || '未署名'}\n帧数: ${p.frames.length}\n由「桌宠制作器」生成\n` },
  ];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zipCreate(entries));
  return { path: outPath, pack: p };
}

// ---------- 窗口 ----------
function createMakerWindow() {
  const win = new BrowserWindow({
    width: 1160, height: 800, minWidth: 940, minHeight: 660,
    backgroundColor: '#0f1117', title: '桌宠制作器', autoHideMenuBar: true,
    icon: loadAppIcon(),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  win.on('closed', () => { setMakerWindow(null); refreshTray(); });
  setMakerWindow(win);
  attachDebug(win, 'maker');
  win.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  return win;
}

function initialPetBounds(pack) {
  // 与渲染进程共用同一套公式（src/shared/layout.js），避免尺寸脱节
  const { W, H } = computeLayout(pack);
  return { w: W, h: H };
}

// ---------- 紧急退出（全局快捷键） ----------
// 背景：桌宠是无边框透明置顶窗 + 像素级鼠标穿透，唯一的退出方式原本是「右键点中它」。
// 一旦制作器窗口已关闭、或宠物跑到屏幕外，用户可能完全退不出去。
// 这里注册全局快捷键作为兜底：即使宠物正在鼠标穿透、即使焦点不在宠物上，也能强制退出。
const QUIT_PET_ACCELERATOR = 'Control+Alt+Q';

function quitPetNow() {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.close();
  setPetWindow(null);
  petWindow = null;
  stopCursorFeed();
  setCurrentScale(null);   // 退出后回到默认大小，避免下次启用继承上次的小尺寸
}

function unregisterQuitShortcut() {
  try { globalShortcut.unregister(QUIT_PET_ACCELERATOR); } catch {}
}

function registerQuitShortcut() {
  try {
    if (globalShortcut.isRegistered(QUIT_PET_ACCELERATOR)) return true;
    const ok = globalShortcut.register(QUIT_PET_ACCELERATOR, quitPetNow);
    if (!ok) console.warn('[pet] 全局快捷键 ' + QUIT_PET_ACCELERATOR + ' 注册失败（可能被其他程序占用）');
    return ok;
  } catch (err) {
    console.warn('[pet] 全局快捷键注册异常: ' + err.message);
    return false;
  }
}

// ---------- 光标位置推送（供桌宠「看向鼠标」） ----------
// 为什么用轮询而不是 mousemove：桌宠是像素级鼠标穿透窗口（setIgnoreMouseEvents(true, {forward:true})），
// 实测在穿透状态下窗口收不到 mousemove，且鼠标在窗口外时更拿不到。
// 所以由主进程读屏幕光标坐标，再推给渲染进程。
let cursorTimer = null;

function startCursorFeed() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    const w = getPetWindow();
    if (!w || w.isDestroyed()) { stopCursorFeed(); return; }
    try {
      const p = screen.getCursorScreenPoint();
      w.webContents.send('pet:cursor', { x: p.x, y: p.y });
    } catch { /* 屏幕切换瞬间可能抛，忽略这一帧 */ }
  }, 120);
}

function stopCursorFeed() {
  if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
}

// ---------- 系统托盘 ----------
// 关掉制作器窗口后，托盘仍在，用户随时能退出桌宠 / 重开制作器。
let tray = null;

function iconPath() { return path.join(ROOT, 'src', 'assets', 'icon.png'); }

/** 加载应用图标：兼容 asar（createFromPath 读不了 asar 内的文件） */
function loadAppIcon() {
  try {
    const buf = fs.readFileSync(iconPath());     // asar 内路径可用 fs 读
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) return img;
  } catch (err) {
    console.warn('[icon] 读取图标失败: ' + (err && err.message));
  }
  return nativeImage.createEmpty();
}

function makerAlive() {
  const w = getMakerWindow();
  return !!(w && !w.isDestroyed());
}

function showMakerWindow() {
  const w = getMakerWindow();
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return;
  }
  // 制作器窗口已被关闭：重建一个
  const win = createMakerWindow();
  win.show();
}

function togglePetVisible() {
  const w = getPetWindow();
  if (!w || w.isDestroyed()) return;
  if (w.isVisible()) w.hide(); else w.showInactive();
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  try {
    const s = { petAlive: isPetAlive(), makerAlive: makerAlive() };
    tray.setToolTip(trayTooltip(s));
    const template = buildTrayMenuTemplate(s, (action) => {
      if (action === 'quitPet') { quitPetNow(); refreshTray(); }
      else if (action === 'togglePetVisible') { togglePetVisible(); }
      else if (action === 'showMaker') { showMakerWindow(); }
      else if (action === 'openPetsDir') { shell.openPath(petsDir()); }
      else if (action === 'quitApp') { app.quit(); }
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
    if (DEBUG) console.log('[tray] 菜单已刷新 petAlive=' + s.petAlive + ' makerAlive=' + s.makerAlive);
  } catch (err) {
    // 菜单刷新失败绝不能影响主流程（托盘仍在，只是菜单旧）
    console.warn('[tray] 刷新菜单失败: ' + (err && err.message));
  }
}

export function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  try {
    const img = loadAppIcon();
    tray = new Tray(img);
  } catch (err) {
    console.warn('[tray] 创建托盘失败: ' + (err && err.message));
    return null;
  }
  // 左键单击：快速显示/聚焦制作器
  tray.on('click', () => { showMakerWindow(); });
  refreshTray();
  return tray;
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

function createPetWindow(pack) {
  const { w, h } = initialPetBounds(pack);
  const wa = screen.getPrimaryDisplay().workArea;
  let x = wa.x + wa.width - w - 20;
  let y = wa.y + wa.height - h - 20;
  const remembered = getPosition(pack.id);
  if (remembered && pack.behavior.startCorner === 'remember') {
    x = Math.min(Math.max(remembered.x, wa.x), wa.x + wa.width - w);
    y = Math.min(Math.max(remembered.y, wa.y), wa.y + wa.height - h);
  } else if (pack.behavior.startCorner === 'bottom-left') {
    x = wa.x + 20;
  } else if (pack.behavior.startCorner === 'center') {
    x = Math.round(wa.x + (wa.width - w) / 2);
    y = Math.round(wa.y + (wa.height - h) / 2);
  }

  const win = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: pack.behavior.keepAbove, fullscreenable: false,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  if (pack.behavior.keepAbove) win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachDebug(win, 'pet');
  win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  if (process.env.SIZEDBG === '1') console.log('[SIZEDBG] created  = ' + JSON.stringify(win.getBounds()));
  win.once('ready-to-show', () => win.show());
  // 只有桌宠存活期间才占用该快捷键，没有宠物时不劫持用户按键
  registerQuitShortcut();
  win.on('closed', () => unregisterQuitShortcut());
  return win;
}

// ---------- IPC ----------
let petWindow = null;   // 由 state.js 同步（快速模式下也会被设置）
let currentPet = null;
let sizeAnim = null;
let ipcRegistered = false;

/** 注册全部 IPC 通道（供入口与测试复用） */
export function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

ipcMain.handle('mode:get', () => ({ mode: isMaker ? 'maker' : 'pet', petPath }));

ipcMain.handle('image:open', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择宠物图片', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const buf = fs.readFileSync(p);
  return { path: p, name: path.basename(p), dataUrl: `data:${mimeOf(p)};base64,${buf.toString('base64')}` };
});

ipcMain.handle('image:openMany', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择多帧图片（按文件名顺序）', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((p) => {
      const buf = fs.readFileSync(p);
      return { path: p, name: path.basename(p), dataUrl: `data:${mimeOf(p)};base64,${buf.toString('base64')}` };
    });
});

ipcMain.handle('pack:save', async (e, { pack, images, suggestedName }) => {
  const v = validatePack({ ...pack, frames: (images || []).map((_, idx) => ({ file: 'f' + idx })) });
  if (!v.ok) return { ok: false, errors: v.errors };
  const r = await dialog.showSaveDialog({
    title: '导出桌宠包',
    defaultPath: petPackFileName(suggestedName || pack.name || 'mypet'),
    filters: [{ name: '桌宠包', extensions: ['petpack', 'zip'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { return { ok: true, path: writePackFile(pack, images, r.filePath).path }; }
  catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pack:open', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开宠物包', properties: ['openFile'],
    filters: [{ name: '桌宠包', extensions: ['petpack', 'zip'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  try { return readPackFile(r.filePaths[0]); }
  catch (err) { return { error: String(err.message || err) }; }
});

// 导出「零依赖分享页」：一个自包含 HTML，双击就能在浏览器里看桌宠动起来。
// 同时把 .petpack 的 base64 塞进去，所以把这个 HTML 拖回桌宠制作器也能还原成完整宠物。
ipcMain.handle('share:exportHtml', async (e, { pack, images }) => {
  try {
    const { pack: p, files } = buildPackAndEntries(pack, images);
    const v = validatePack(p);
    if (!v.ok) return { ok: false, errors: v.errors };
    const petpackBuf = zipCreate([
      { name: 'pet.json', data: JSON.stringify(p, null, 2) },
      ...files,
    ]);
    const html = buildShareHtml(p, images, {
      title: p.name,
      petpackBase64: petpackBuf.toString('base64'),
      petpackName: petPackFileName(p.name),
    });
    const r = await dialog.showSaveDialog({
      title: '导出分享页（单个 HTML 文件）',
      defaultPath: shareFileName(p.name || 'mypet'),
      filters: [{ name: '网页分享包', extensions: ['html'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, html, 'utf8');
    return { ok: true, path: r.filePath, bytes: Buffer.byteLength(html, 'utf8'), petpackBytes: petpackBuf.length };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 我的模板：增删改 / 导入导出 ----------
ipcMain.handle('tpl:list', () => ({ ok: true, templates: loadTemplates() }));

ipcMain.handle('tpl:save', (e, { pack, name, flags }) => {
  try {
    if (!pack || typeof pack !== 'object') throw new Error('没有可保存的配置');
    const tpl = templateFromPack(pack, name, { flags });
    const list = addTemplate(loadTemplates(), tpl);
    const w = saveTemplates(list);
    if (!w.ok) return w;
    return { ok: true, id: tpl.id, name: tpl.name, templates: list };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('tpl:remove', (e, id) => {
  const list = removeTemplate(loadTemplates(), id);
  const w = saveTemplates(list);
  return w.ok ? { ok: true, templates: list } : w;
});

ipcMain.handle('tpl:rename', (e, { id, name }) => {
  const list = renameTemplate(loadTemplates(), id, name);
  const w = saveTemplates(list);
  return w.ok ? { ok: true, templates: list } : w;
});

// 导出单个模板为独立文件，方便发给朋友
ipcMain.handle('tpl:export', async (e, id) => {
  try {
    const tpl = loadTemplates().find((x) => x.id === id);
    if (!tpl) throw new Error('模板不存在');
    const r = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath: templateFileName(tpl.name),
      filters: [{ name: '桌宠模板', extensions: ['pettpl', 'json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify({ schema: TEMPLATE_SCHEMA, templates: [tpl] }, null, 2));
    return { ok: true, path: r.filePath };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 导入模板文件（可以含多个模板）
ipcMain.handle('tpl:import', async (e, srcPath) => {
  try {
    let p = srcPath;
    if (!p) {
      const r = await dialog.showOpenDialog({
        title: '导入模板', properties: ['openFile'],
        filters: [{ name: '桌宠模板', extensions: ['pettpl', 'json'] }],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      p = r.filePaths[0];
    }
    if (!fs.existsSync(p)) throw new Error('文件不存在');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const incoming = normalizeTemplateList(Array.isArray(raw) ? raw : (raw && (raw.templates || [raw])));
    if (!incoming.length) throw new Error('文件里没有可用的模板');
    let list = loadTemplates();
    for (const t of incoming) list = addTemplate(list, { ...t, id: 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) });
    const w = saveTemplates(list);
    if (!w.ok) return w;
    return { ok: true, count: incoming.length, templates: list };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});


// 解析分享页：把内嵌的 .petpack 抽出来（接收方把 .html 拖进制作器时走这条路）
ipcMain.handle('share:readHtml', (e, htmlPath) => {
  try {
    if (!htmlPath || !fs.existsSync(htmlPath)) throw new Error('文件不存在');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const m = /"petpack"\s*:\s*"([A-Za-z0-9+/=]+)"/.exec(html);
    if (!m) throw new Error('这个 HTML 里没有内嵌宠物包（可能不是本工具导出的分享页）');
    const buf = Buffer.from(m[1], 'base64');
    const tmp = path.join(app.getPath('userData'), 'preview', 'from-share-' + Date.now() + '.petpack');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, buf);
    const { pack, frames } = readPackFile(tmp);   // 校验可解析
    return { ok: true, pack, frames, path: tmp };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pack:exportFolder', async (e, { pack, images }) => {
  const r = await dialog.showOpenDialog({ title: '选择导出文件夹', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const { pack: p, files } = buildPackAndEntries(pack, images);
    const dir = path.join(r.filePaths[0], safeFileName(p.name));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(p, null, 2));
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.data);
    return { ok: true, path: dir };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

function launchPet(packPath) {
  // CI/测试下不真正拉起子进程（否则会遗留孤儿窗口）
  if (process.env.PETMAKER_NO_LAUNCH === '1') return;
  const child = spawn(process.execPath, [ROOT, `--pet=${packPath}`], { detached: true, stdio: 'ignore' });
  child.unref();
}

ipcMain.handle('pet:launch', (e, { pack, images }) => {
  try {
    const tmp = path.join(app.getPath('userData'), 'preview');
    const out = writePackFile(pack, images, path.join(tmp, 'preview-' + Date.now() + '.petpack'));
    launchPet(out.path);
    return { ok: true, path: out.path };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:launchPath', (e, p) => {
  try { launchPet(p); return { ok: true }; }
  catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 宠物库
ipcMain.handle('pet:listInstalled', () => {
  const dir = petsDir();
  // 内置宠物清单：与 examples/ 下同名的包视为「内置」（随程序分发、可删除）
  const builtinNames = new Set();
  try {
    for (const f of fs.readdirSync(builtinPetsDir())) if (/\.petpack$/i.test(f)) builtinNames.add(f);
  } catch { /* 读不到就不标注 */ }

  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(petpack|zip)$/i.test(f)) continue;
    const full = path.join(dir, f);
    const builtin = builtinNames.has(f);
    try {
      const { pack, frames } = readPackFile(full);
      out.push({ id: f, name: pack.name, author: pack.author, frames: frames.length, file: full,
        thumb: frames[0].dataUrl, size: fs.statSync(full).size, builtin });
    } catch (err) {
      out.push({ id: f, name: f, broken: true, error: String(err.message || err), file: full, builtin });
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  return out;
});

ipcMain.handle('pet:install', (e, srcPath) => {
  let tmp = null;
  try {
    if (!srcPath || !fs.existsSync(srcPath)) throw new Error('文件不存在');
    const { pack } = readPackFile(srcPath); // 校验：包可读才安装
    const dir = petsDir();
    // 用包内名称命名（更可读），并做文件名安全化
    const dest = path.join(dir, petPackFileName(pack.name || path.basename(srcPath)));
    const existed = fs.existsSync(dest);

    // 原子写入：先写临时文件再 rename，避免中途失败留下损坏的半包
    tmp = dest + '.tmp-install';
    fs.copyFileSync(srcPath, tmp);
    readPackFile(tmp);                       // 二次校验临时文件可读
    fs.renameSync(tmp, dest);                // 同目录 rename 为原子操作
    tmp = null;

    return { ok: true, path: dest, replaced: existed, id: path.basename(dest), name: pack.name || path.basename(dest) };
  } catch (err) {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
    return { ok: false, errors: [String(err.message || err)] };
  }
});

// 拖入宠物包 -> 安装并直接启动（给「收到 .petpack 的人」一条最短路径）
ipcMain.handle('pet:installAndRun', (e, srcPath) => {
  try {
    if (!srcPath || !fs.existsSync(srcPath)) throw new Error('文件不存在');
    const { pack } = readPackFile(srcPath);
    const dir = petsDir();
    const dest = path.join(dir, petPackFileName(pack.name || path.basename(srcPath)));
    const existed = fs.existsSync(dest);
    const tmp = dest + '.tmp-install';
    fs.copyFileSync(srcPath, tmp);
    readPackFile(tmp);                 // 二次校验，避免半包
    fs.renameSync(tmp, dest);

    const id = path.basename(dest);
    const w = createPetWindow(pack);
    petWindow = w;
    setPetWindow(w);
    currentPet = { pack };
    startCursorFeed();
    refreshTray();
    // 与库内启动保持一致：记一次「最近使用」
    saveLibraryPrefs(touchRecent(loadLibraryPrefs(), id));

    return { ok: true, id, name: pack.name || id, path: dest, replaced: existed };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  }
});

ipcMain.handle('pet:runInstalled', (e, id) => {
  try {
    const full = path.join(petsDir(), id);
    if (!fs.existsSync(full)) throw new Error('宠物不存在');
    launchPet(full);
    return { ok: true };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:uninstall', (e, id) => {
  try {
    const full = path.join(petsDir(), id);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    // 同时清掉它的收藏/最近使用记录，避免留下点不开的幽灵条目
    saveLibraryPrefs(forgetPet(loadLibraryPrefs(), id));
    return { ok: true };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 宠物库偏好 IPC（收藏 / 最近使用）----------
ipcMain.handle('library:get', () => loadLibraryPrefs());

ipcMain.handle('library:toggleFav', (e, id) => {
  const next = toggleFavorite(loadLibraryPrefs(), id);
  saveLibraryPrefs(next);
  return next;
});

// 记一次「使用」：启动宠物后调用
ipcMain.handle('library:touch', (e, id) => {
  const next = touchRecent(loadLibraryPrefs(), id);
  saveLibraryPrefs(next);
  return next;
});

// 版本号唯一来源是 package.json；UI 不再硬编码（否则会像 v0.2 vs 0.8.0 那样脱节）
// 版本号以 package.json 为准。
// 注意：开发模式（electron .）下 app.getVersion() 返回的是 **Electron 的版本**
// （实测显示成 v44.7.0），而不是应用版本；打包后才正确。所以这里显式读 package.json 兜底。
ipcMain.handle('app:version', () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg && pkg.version) return String(pkg.version);
  } catch {}
  return app.getVersion();
});
// 在文件管理器里定位到某个文件（导出后"分享给别人"的入口）
ipcMain.handle('app:revealFile', (e, p) => {
  try {
    if (!p || !fs.existsSync(p)) return { ok: false, errors: ['文件不存在'] };
    shell.showItemInFolder(p);
    return { ok: true };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});
ipcMain.handle('app:openDataDir', () => { shell.openPath(petsDir()); return { ok: true, path: petsDir() }; });

// ---------- AI 抠图 ----------
ipcMain.handle('ai:listModels', () => listModels(app.getPath('userData')));

ipcMain.handle('ai:downloadModel', async (e, id) => {
  try {
    const r = await downloadModel(app.getPath('userData'), id, (p) => {
      if (e.sender && !e.sender.isDestroyed()) e.sender.send('ai:downloadProgress', { id, ...p });
    });
    return r;
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('ai:deleteModel', (e, id) => deleteModel(app.getPath('userData'), id));

ipcMain.handle('ai:segment', async (e, { modelId, dataUrl, threshold, feather }) => {
  try {
    if (!isInstalled(app.getPath('userData'), modelId)) return { ok: false, errors: ['模型未下载'] };
    return await segmentImage(app.getPath('userData'), modelId, dataUrl, { threshold, feather });
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});
// 自动选模型：把所有已下载的模型都跑一遍，用客观质量分数挑最好的（用户要求"精确率优先"）。
// 逐个模型回报进度，因为 1024 模型单张就要 800ms+，三模型串起来用户会觉得卡死。
ipcMain.handle('ai:segmentAuto', async (e, { dataUrl, threshold, feather, hintId, ids }) => {
  try {
    const dir = app.getPath('userData');
    const installed = listModels(dir).filter((m) => m.installed).map((m) => m.id);
    if (!installed.length) return { ok: false, errors: ['没有已下载的模型，请先下载至少一个模型'] };
    const r = await segmentAuto(dir, null, dataUrl, {
      threshold, feather, hintId,
      ids: Array.isArray(ids) && ids.length ? ids.filter((x) => installed.includes(x)) : installed,
      onProgress: (p) => { if (e.sender && !e.sender.isDestroyed()) e.sender.send('ai:autoProgress', p); },
    });
    return r;
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:getPack', () => {
  // 快速模式：宠物由制作器「启用」直接创建，包在主进程内存里
  const mem = getCurrentPack();
  if (mem) return mem;
  if (!petPath) return null;
  try { return readPackFile(petPath); }
  catch (err) { return { error: String(err.message || err) }; }
});

// ---------- 快速模式：启用 / 停用（同进程，无需重启） ----------
function ensurePetWindowVisibility() {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) {
    w.showInactive();
    w.setAlwaysOnTop(true, 'screen-saver');
    w.moveTop();
  }
}

ipcMain.handle('quick:enable', (e, payload) => {
  try {
    const { pack, frames } = payload || {};
    if (!pack || !Array.isArray(frames) || !frames.length) {
      return { ok: false, errors: ['缺少宠物数据'] };
    }
    // 复用用户上次调好的大小（退出后已清空 -> 回到包内默认）
    const saved = getCurrentScale();
    if (saved != null && pack.render) pack.render.scale = saved;
    setCurrentPack({ pack, frames });

    const existing = getPetWindow();
    if (existing && !existing.isDestroyed()) {
      // 已在运行：把新包推给渲染进程热更新，避免闪烁重建窗口
      existing.webContents.send('quick:reload');
      ensurePetWindowVisibility();
      startCursorFeed();
      return { ok: true, reused: true };
    }

    const win = createPetWindow(pack);
    petWindow = win;
    setPetWindow(win);
    startCursorFeed();          // 「看向鼠标」需要屏幕光标坐标
    win.on('closed', () => {
      stopCursorFeed();
      if (getPetWindow() === win) setPetWindow(null);
      if (petWindow === win) petWindow = null;
      const mw = getMakerWindow();
      if (mw && !mw.isDestroyed()) mw.webContents.send('quick:state', { enabled: false });
    });

    const mw = getMakerWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send('quick:state', { enabled: true });
    return { ok: true, reused: false };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  }
});

ipcMain.handle('quick:disable', () => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.close();
  setPetWindow(null);
  petWindow = null;
  stopCursorFeed();
  refreshTray();
  return { ok: true };
});

// 开关「抓虫子」小玩法（推给宠物渲染进程）
ipcMain.handle('quick:setBugChase', (e, on) => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:bugchase', !!on);
  return { ok: isPetAlive(), bugChase: !!on };
});
ipcMain.handle('quick:isEnabled', () => ({ enabled: isPetAlive() }));

ipcMain.handle('quick:setWalk', (e, walking) => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:walk', !!walking);
  return { ok: isPetAlive(), walking: !!walking };
});

ipcMain.handle('quick:setLook', (e, on) => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:look', !!on);
  return { ok: isPetAlive(), look: !!on };
});

ipcMain.handle('quick:setHop', (e, on) => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:hop', !!on);
  return { ok: isPetAlive(), hop: !!on };
});

ipcMain.handle('quick:hit', (e, fromDir) => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:hit', typeof fromDir === 'number' ? fromDir : 0);
  return { ok: isPetAlive() };
});

ipcMain.handle('quick:say', (e, text) => {
  const w = getPetWindow();
  if (!w || w.isDestroyed()) return { ok: false, errors: ['桌宠未启用'] };
  w.webContents.send('quick:say', String(text == null ? '' : text));
  return { ok: true };
});

ipcMain.handle('quick:pat', () => {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:pat');
  return { ok: isPetAlive() };
});

// 移动宠物窗口。
// 必须用 setContentBounds 而非 setPosition：在 Windows + 非整数 DPI 缩放（如 1.5x）下，
// setPosition 每传入一个新的 x 坐标就会让窗口宽度增长约 1px（实测），
// 而宠物每帧都在移动 -> 形成正反馈，窗口持续膨胀并把宠物推出可视区。
// setContentBounds 显式带上内容尺寸，可把尺寸钉住（实测 4s 稳定 281x417）。
ipcMain.on('pet:setPos', (e, { x, y }) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [cw, ch] = petWindow.getContentSize();
  petWindow.setContentBounds({ x: Math.round(x), y: Math.round(y), width: cw, height: ch });
});
// 设置宠物窗口的内容区尺寸。
// 注意：不要在这里同步调用 setPosition（bounds 会滞后，导致窗口漂移或被 DPI 二次缩放），
// 位置统一由 pet:setPos 通道负责。
// 调整宠物显示大小（制作器滑块 / 滚轮）。转发给渲染进程，由其重排并保持"脚不离地"。
ipcMain.on('pet:setScale', (e, scale) => {
  const v = Number(scale);
  if (!Number.isFinite(v)) return;
  const k = Math.min(3, Math.max(0.1, v));
  setCurrentScale(k);
  const w = getPetWindow();
  if (w && !w.isDestroyed()) w.webContents.send('quick:scale', k);
});
ipcMain.on('pet:setSize', (e, { w, h }) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const nw = Math.max(40, Math.round(w));
  const nh = Math.max(40, Math.round(h));
  try {
    petWindow.setContentSize(nw, nh);
    if (process.env.SIZEDBG === '1') console.log('[SIZEDBG] setSize ' + nw + 'x' + nh + ' -> ' + JSON.stringify(petWindow.getContentBounds()));
  } catch (err) {
    if (process.env.SIZEDBG === '1') console.log('[SIZEDBG] setSize 失败: ' + err.message);
  }
});
ipcMain.handle('pet:getBounds', () => (petWindow && !petWindow.isDestroyed()) ? petWindow.getBounds() : null);
ipcMain.handle('screen:workArea', () => screen.getPrimaryDisplay().workArea);
ipcMain.handle('screen:allWorkAreas', () => screen.getAllDisplays().map((d) => d.workArea));
ipcMain.on('pet:setAlwaysOnTop', (e, flag) => { if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(!!flag, 'screen-saver'); });
ipcMain.on('pet:savePos', (e, { id, x, y }) => savePosition(id, x, y));
ipcMain.on('pet:setIgnoreMouse', (e, flag) => { if (petWindow && !petWindow.isDestroyed()) petWindow.setIgnoreMouseEvents(!!flag, { forward: true }); });
ipcMain.on('pet:close', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    const b = petWindow.getBounds();
    if (currentPet && currentPet.pack) savePosition(currentPet.pack.id, b.x, b.y);
    petWindow.close();
  }
});
ipcMain.handle('pet:loadImageFile', (e, p) => `data:${mimeOf(p)};base64,${fs.readFileSync(p).toString('base64')}`);

}  // end registerIpc

// ---------- 自检：验证 AI 抠图在打包后仍可用 ----------
async function runSelfTest() {
  const log = (m) => process.stdout.write(m + '\n');
  try {
    log('SELFTEST userData: ' + app.getPath('userData'));
    const ort = await import('onnxruntime-node');
    log('SELFTEST onnxruntime: OK v' + (ort.default || ort).env.versions.node);
  } catch (e) {
    log('SELFTEST onnxruntime: FAIL ' + e.message);
    return 1;
  }
  try {
    const ud = app.getPath('userData');
    const id = 'silueta';
    if (!isInstalled(ud, id)) { log('SELFTEST model: 未下载（跳过推理），但引擎可用'); return 0; }
    const dev = 256;
    const px = new Uint8ClampedArray(dev * dev * 4);
    const c0 = dev / 2, r0 = dev * 0.3;
    for (let y = 0; y < dev; y++) for (let x = 0; x < dev; x++) {
      const i = (y * dev + x) * 4;
      if (Math.hypot(x - c0, y - r0) <= r0) { px[i] = 255; px[i + 1] = 140; px[i + 2] = 60; px[i + 3] = 255; }
    }
    const { encodePNG } = await import('../shared/png.js');
    const dataUrl = 'data:image/png;base64,' + encodePNG(dev, dev, Buffer.from(px)).toString('base64');
    const res = await segmentImage(ud, id, dataUrl, { threshold: 0.5, feather: 0.1 });
    log('SELFTEST segment: ok=' + res.ok + ' size=' + res.width + 'x' + res.height + ' coverage=' + res.coverage.toFixed(3) + ' ms=' + res.ms);
    const { nativeImage: ni } = await import('electron');
    const im = ni.createFromBuffer(Buffer.from(res.dataUrl.split(',')[1], 'base64'));
    const b = im.toBitmap();
    const w = im.getSize().width, h = im.getSize().height;
    const center = b[((h >> 1) * w + (w >> 1)) * 4 + 3];
    const corner = b[(2 * w + 2) * 4 + 3];
    log('SELFTEST alpha: center=' + center + ' corner=' + corner);
    const okAll = res.coverage > 0.05 && res.coverage < 0.5 && center > 200 && corner < 40;
    log('SELFTEST RESULT: ' + (okAll ? 'PASS' : 'FAIL'));
    return okAll ? 0 : 1;
  } catch (e) {
    log('SELFTEST segment: FAIL ' + e.message);
    return 1;
  }
}
// ---------- 启动 ----------
function startApp() {
app.whenReady().then(async () => {
  if (selftest) { const code = await runSelfTest(); app.exit(code); return; }
  registerIpc();
  const broadcast = () => {
    const wa = screen.getPrimaryDisplay().workArea;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('screen:displayChanged', wa);
  };
  screen.on('display-metrics-changed', broadcast);
  screen.on('display-added', broadcast);
  screen.on('display-removed', broadcast);

  if (isMaker) {
    // macOS 必须保留最小菜单，否则 Cmd+Q / 复制粘贴等系统快捷键全部失效。
    const tpl = appMenuTemplate(process.platform);
    Menu.setApplicationMenu(tpl ? Menu.buildFromTemplate(tpl) : null);
    // 首次运行把内置卡通宠物装进宠物库（开箱即用）
    const seeded = seedBuiltinPets();
    if (seeded.length) console.log('[pet] 已安装内置宠物: ' + seeded.join('、'));
    createMakerWindow();
    createTray();   // 常驻入口：关掉制作器窗口也能退出桌宠 / 重开
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMakerWindow(); });
  } else {
    const tpl = appMenuTemplate(process.platform);
    Menu.setApplicationMenu(tpl ? Menu.buildFromTemplate(tpl) : null);
    try {
      const { pack } = readPackFile(petPath);
      currentPet = { pack };
      petWindow = createPetWindow(pack);
      setPetWindow(petWindow);
      createTray();
    } catch (err) {
      dialog.showErrorBox('无法加载宠物包', String(err.message || err));
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  // 有托盘时常驻，不随窗口一起退出（否则又变成「关掉窗口就找不回来」）
  if (tray && !tray.isDestroyed()) return;
  app.quit();
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} stopCursorFeed(); destroyTray(); });
}

// PETMAKER_NO_AUTOSTART=1 时不自启（供 e2e 测试自行驱动）
if (process.env.PETMAKER_NO_AUTOSTART !== '1') startApp();