import { app, BrowserWindow, ipcMain, dialog, Menu, screen, shell, globalShortcut, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { zipCreate, zipRead, zipWriteToFile } from '../shared/zip.js';
import { installCrashGuard, defaultCrashLogPath } from './crashguard.js';
import { showDialog } from './dialogguard.js';
import { attachWindowHealth } from './windowhealth.js';
import { encodeGif } from '../shared/gifencode.js';
import { normalizePack, validatePack } from '../shared/petpack.js';
import { petPackFileName, safeFileName } from '../shared/safeid.js';
import { computeLayout } from '../shared/layout.js';
import { emptyState, normalizeState, toggleFavorite, touchRecent, forgetPet, addGroup, removeGroup, renameGroup, addToGroup, removeFromGroup, pruneGroups } from '../shared/library.js';
import { MODELS, listModels, downloadModel, deleteModel, isInstalled } from './models.js';
import { segmentImage, segmentAuto } from './segment.js';
import { setCurrentPack, getCurrentPack, setPetWindow, getPetWindow, setMakerWindow, getMakerWindow, isPetAlive, setCurrentScale, getCurrentScale, addPet, removePet, getPet, listPets, petCount, petByWindow, petByPackId, petByWebContentsId, setActivePet, getActivePetId } from './state.js';
import { buildTrayMenuTemplate, trayTooltip } from './tray.js';
import { SHORTCUTS, validateShortcuts } from '../shared/shortcuts.js';
import { startupSwitches, appMenuTemplate } from '../shared/platform.js';
import { buildShareHtml, shareFileName } from '../shared/sharepack.js';
import { assignSlugs, planSiteFiles } from '../shared/sharesite.js';
import { shouldSave, sanitizePos, prunePositions } from '../shared/positionstore.js';
import { stampForExport, compareVersions, updatePrompt, versionLabel } from '../shared/packversion.js';
import { normalizeTemplateList, addTemplate, removeTemplate, renameTemplate, templateFromPack, normalizeTemplate, templateFileName, TEMPLATE_SCHEMA } from '../shared/mytemplates.js';
import { planBatch, batchPackFor, summarizeBatch } from '../shared/batch.js';
import { estimatePose, isPoseModelInstalled } from './pose.js';
import { checkMaterial, MATERIAL_GUIDE } from '../shared/material.js';
import { autoFit, bodyBounds as bodyBoundsOf } from '../shared/autofit.js';
import { MOTIONS, canAnimate, motionSequence, solveJoints, motionBounds, LIMB_LABELS } from '../shared/limb.js';
import { planExport, exportReadme } from '../shared/bulkexport.js';
import { planBulkGif, bulkGifSummary } from '../shared/bulkgif.js';
import { planSheet, sheetFrames, sheetMetadata } from '../shared/spritesheet.js';

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

// 是否允许**真的把窗口显示到屏幕上**。
// 为什么要有这个（用户明确要求：桌面窗口不要反复弹出来影响工作）：
//   e2e 会创建宠物窗口，以前它在 ready-to-show 时无条件 win.show()，
//   于是跑测试时宠物真的出现在用户桌面上（实测看到标题为「桌宠」的窗口）。
//   设 PETMAKER_HEADLESS=1 时一律只创建、不显示 —— 渲染照常跑（离屏），
//   断言照样能读像素/位置，但用户屏幕上什么都不会冒出来。
// 三重保险（用户明确要求：桌面窗口不要反复弹出来影响工作）：
//   ① PETMAKER_HEADLESS=1（e2e-all 会自动带上）
//   ② PETMAKER_NO_LAUNCH=1（老的测试开关）
//   ③ **命令行里有 scripts/e2e- 就自动无头** —— 兜底。
//      这样即使某个测试忘了设环境变量，也绝不会把窗口弹到用户屏幕上。
// ---------- 兜底：任何未捕获异常都**不要弹原生错误框** ----------
// 背景（用户带截图报的真实问题）：Electron 默认会弹原生窗口
// 「A JavaScript error occurred in the main process / Uncaught Exception」，
// 直接跳到用户桌面上。用户明确抱怨过"窗口老是弹出来影响工作"。
// 具体规则见 src/main/crashguard.js。
installCrashGuard({ logPath: null });   // 路径等 app ready 后再补写（userData 此时可能还没就绪）

const HEADLESS = process.env.PETMAKER_HEADLESS === '1'
  || process.env.PETMAKER_NO_LAUNCH === '1'
  || process.argv.some((a) => /scripts[\\/]e2e-/.test(String(a)));
/** 只有非无头模式才真的显示窗口 */
function safeShow(win, mode = 'show') {
  if (!win || (win.isDestroyed && win.isDestroyed())) return;
  // 无头模式（测试）：**不显示任何窗口**，用户屏幕上不会冒出东西。
  // 注意：不可见窗口的 requestAnimationFrame 会被 Chromium 节流（约 1fps），
  // 所以无头下的"帧率/时序"类断言不可靠 —— 那些断言要看**纯逻辑**，
  // 或者用 window.__forceXxx 之类的确定性钩子，而不是"等 N 秒看它动没动"。
  // （试过把窗口挪到屏幕外再 show：Chromium 仍视为不可见，rAF 直接停，反而更糟。）
  if (HEADLESS) return;
  try {
    if (mode === 'inactive') win.showInactive();
    else win.show();
  } catch (err) { /* 忽略 */ }
}

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
// 「记住上次位置」这个 UI 选项以前是**坏的** —— savePos 通道暴露了却从没人调用，
// 选了它等于没生效（实测发现）。这里补上真正的保存，并做了三件事：
//   1) 内存缓存：不再每存一次就把整个 JSON 读一遍再写一遍；
//   2) 节流：宠物一直在走，不能每帧写盘（见 shared/positionstore.js 的 shouldSave）；
//   3) 原子写：先写 .tmp 再 rename，避免写到一半断电留下半个坏 JSON。
function positionsFile() { return path.join(app.getPath('userData'), 'positions.json'); }
let positionsCache = null;
function loadPositions() {
  if (positionsCache) return positionsCache;
  try { positionsCache = JSON.parse(fs.readFileSync(positionsFile(), 'utf8')) || {}; }
  catch (err) { positionsCache = {}; }
  return positionsCache;
}
function flushPositions() {
  if (!positionsCache) return;
  const file = positionsFile();
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(prunePositions(positionsCache), null, 2));
    fs.renameSync(tmp, file);   // 原子替换：要么是完整的旧文件，要么是完整的新文件
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
    if (DEBUG) console.warn('[pos] 写位置失败: ' + (err && err.message));
  }
}
function savePosition(id, x, y) {
  if (!id) return;
  const pt = sanitizePos(x, y);
  if (!pt) return;
  const p = loadPositions();
  p[id] = pt;
  flushPositions();
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

  // 多动作片段：把每段的帧图片也解出来给运行时。
  // 缺帧的片段**整段丢弃**（宁可不播这段，也不要让运行时拿到坏数据）。
  const clips = [];
  for (const c of (pack.clips || [])) {
    const cf = [];
    let broken = false;
    for (const f of c.frames) {
      const b = map.get(f.file);
      if (!b) { broken = true; break; }
      cf.push({ file: f.file, dataUrl: `data:${mimeOf(f.file)};base64,${b.toString('base64')}`, durationMs: f.durationMs });
    }
    if (broken || !cf.length) { console.warn('[pack] 片段缺帧，已跳过: ' + c.id); continue; }
    clips.push({ id: c.id, name: c.name, frames: cf, weight: c.weight });
  }

  return { pack, frames, clips, file: p };
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!m) throw new Error('图片数据无效');
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

/** 一张 width×height 的 BGRA 缓冲需要多少字节 */
function sheetBytes(w, h) { return Math.max(0, (w | 0)) * Math.max(0, (h | 0)) * 4; }

// images: [{ dataUrl, durationMs }]
/**
 * 组装宠物包内容。
 *
 * 两处帧来源：
 *   1) images：主帧序列（决定帧数/画布，也是老包唯一来源）
 *   2) pack.clips：可选的多动作片段，每段有自己的帧
 * clips 里的帧文件必须**一并写进压缩包**，否则运行时找不到文件
 * （只写主帧的话，片段会指向不存在的图片 —— 实测会加载失败）。
 *
 * @param clipImages { [clipId]: [{dataUrl, durationMs}] } 与 pack.clips 顺序对应
 */
function buildPackAndEntries(pack, images, clipImages) {
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

  // 把 clips 的帧也写进去，并把 pack.clips 的文件名重写成实际写入的名字
  const rawClips = Array.isArray(pack && pack.clips) ? pack.clips : [];
  const clips = [];
  for (const c of rawClips) {
    if (!c || !Array.isArray(c.frames) || !c.frames.length) continue;
    const src = (clipImages && clipImages[c.id]) || null;
    if (!src || !src.length) continue;              // 没有对应图片数据就跳过（不产生坏片段）
    const cframes = [];
    for (let i = 0; i < src.length; i++) {
      const img = src[i];
      if (!img || !img.dataUrl) continue;
      const { mime, buf } = dataUrlToBuffer(img.dataUrl);
      const ext = MIME_TO_EXT[mime] || '.png';
      const name = `clip_${safeFileName(String(c.id), { maxLen: 24, fallback: 'c' })}_${String(i).padStart(3, '0')}${ext}`;
      files.push({ name, data: buf });
      cframes.push({ file: name, durationMs: Math.max(16, Math.round(img.durationMs || c.frames[i]?.durationMs || 110)) });
    }
    if (!cframes.length) continue;
    const w = Number(c.weight);
    clips.push({ id: String(c.id || ('clip' + clips.length)), name: String(c.name || c.id || '片段'), frames: cframes, weight: Number.isFinite(w) && w > 0 ? w : 1 });
  }

  const p = normalizePack({ ...pack, frames, clips });
  return { pack: p, files };
}

function writePackFile(pack, images, outPath, clipImages) {
  // 导出时打上版本戳（createdAt 保留、updatedAt 更新、rev 递增）——
  // 这样接收方才能判断"这个包比我现在用的新还是旧"（宠物包一键更新的基础）。
  const stamped = { ...pack, ...stampForExport(pack) };
  const { pack: p, files } = buildPackAndEntries(stamped, images, clipImages);
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
    // ★ show: false 很关键：不加的话窗口**一创建就显示**。
    //   过去跑 e2e 时制作器窗口会真的弹到用户桌面上（实测抓到标题「桌宠制作器」的窗口）。
    //   用户明确要求过：不要让窗口反复跳出来影响工作。
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  // 无头模式（测试）下永不显示；正常使用时再显示出来。
  if (!HEADLESS) win.once('ready-to-show', () => safeShow(win));
  win.on('closed', () => { setMakerWindow(null); refreshTray(); });
  setMakerWindow(win);
  attachDebug(win, 'maker');
  // ★ 始终生效（不只 DEBUG）：渲染进程崩了/加载失败时**别把空白残骸留在桌面上**。
  attachWindowHealth(win, {
    tag: 'maker',
    log: (m) => { try { console.warn(m); } catch {} },
    onGone: () => { try { setMakerWindow(null); refreshTray(); } catch {} },
  });
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
// 除「强制退出」外，再加几个日常会用到的（显示/隐藏、回中央、说一句话）。
// 全部从 shared/shortcuts.js 的表里来 —— 表是纯数据、有单测，
// 避免出现"文档写了 A、代码注册的是 B"。
const QUIT_PET_ACCELERATOR = 'Control+Alt+Q';
let petHidden = false;    // 由 Ctrl+Alt+P 切换

// ★ 防重入：托盘「退出桌宠」连点两次不该做两遍副作用。
//
// 注意语义：不是"同一时刻只跑一个"，而是"**当前没有宠物在跑时就什么都不做**"。
// 为什么必须这样：quitPetNow 是**同步**的 —— 第一次调用结束时已经清干净了，
// 连点第二次时"忙碌标记"早已清掉，于是又会跑一遍
// stopCursorFeed / setCurrentScale（重复副作用）。
// 用"当前状态"判断天然幂等，也不怕异常。
function quitPetNow() {
  const w = getPetWindow();
  // 没有在跑的宠物 -> 已经退过了，直接返回（连点第二次走到这里）
  if (!w || w.isDestroyed()) {
    // 仍要保证状态干净（可能上一次退到一半被打断）
    if (petWindow === null && !petHidden) return false;
  }
  if (w && !w.isDestroyed()) w.close();
  setPetWindow(null);
  petWindow = null;
  stopCursorFeed();
  setCurrentScale(null);   // 退出后回到默认大小，避免下次启用继承上次的小尺寸
  petHidden = false;
  return true;
}

/** 显示 / 隐藏桌宠（不退出，保留状态） */
/** 只关掉指定的那一只（多宠物同屏时用） */
// ★ 防重入：逐只退出连点两次会 removePet 两遍、托盘反复重建。
//   用"这只还在不在"判断即可天然幂等（连点第二次时 getPet 已经查不到）。
//   不需要按 id 分开的守卫 —— 退出 A 本来就该能同时退出 B。
function quitPetById(id) {
  const rec = getPet(id);
  if (!rec || !rec.win || rec.win.isDestroyed()) return false;
  try { rec.win.close(); } catch (err) { console.warn('[pet] 关闭指定宠物失败: ' + err.message); return false; }
  removePet(id);
  if (petCount() === 0) { stopCursorFeed(); setCurrentScale(null); }
  return true;
}

/** 当前在跑的宠物列表（托盘菜单用） */
function runningPets() {
  return listPets().map((it) => ({ id: it.id, name: (it.pack && it.pack.name) || it.id }));
}

function togglePetVisible() {
  const w = getPetWindow();
  if (!w || w.isDestroyed()) return false;
  petHidden = !petHidden;
  try {
    if (petHidden) w.hide();
    else { safeShow(w, 'inactive'); w.setAlwaysOnTop(true, 'screen-saver'); }
  } catch (err) { console.warn('[pet] 显示/隐藏失败: ' + err.message); }
  return true;
}

/** 把桌宠放回当前显示器的屏幕中央底部（找不到它时的救命键） */
function centerPetNow() {
  const w = getPetWindow();
  if (!w || w.isDestroyed()) return false;
  try {
    const b = w.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    const x = Math.round(area.x + (area.width - b.width) / 2);
    const y = Math.round(area.y + area.height - b.height - 40);
    // 用 setContentBounds 而非 setPosition：非整数 DPI 下 setPosition 会让窗口逐渐变宽（见 HANDOFF）
    w.setContentBounds({ x, y, width: b.width, height: b.height });
    if (petHidden) { petHidden = false; safeShow(w, 'inactive'); }
  } catch (err) { console.warn('[pet] 回中央失败: ' + err.message); }
  return true;
}

/** 让它主动说一句（走渲染进程的气泡） */
function petSayNow() {
  const w = getPetWindow();
  if (!w || w.isDestroyed()) return false;
  try { w.webContents.send('quick:pat'); } catch (err) { console.warn('[pet] 说话失败: ' + err.message); }
  return true;
}

const SHORTCUT_ACTIONS = {
  toggle: togglePetVisible,
  center: centerPetNow,
  say: petSayNow,
  quit: quitPetNow,
};

function unregisterQuitShortcut() {
  try { for (const s of SHORTCUTS) globalShortcut.unregister(s.accelerator); } catch {}
}

function registerQuitShortcut() {
  try {
    const v = validateShortcuts(SHORTCUTS);
    if (!v.ok) console.warn('[pet] 快捷键表有问题: ' + v.errors.join('；'));
    let allOk = true;
    for (const s of SHORTCUTS) {
      const fn = SHORTCUT_ACTIONS[s.id];
      if (typeof fn !== 'function') { console.warn('[pet] 快捷键 ' + s.id + ' 没有对应动作'); allOk = false; continue; }
      if (globalShortcut.isRegistered(s.accelerator)) continue;
      const ok = globalShortcut.register(s.accelerator, fn);
      if (!ok) { console.warn('[pet] 全局快捷键 ' + s.accelerator + '（' + s.label + '）注册失败，可能被其他程序占用'); allOk = false; }
    }
    return allOk;
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
    const alive = listPets();
    if (!alive.length) { stopCursorFeed(); return; }
    let cursor = null;
    try { cursor = screen.getCursorScreenPoint(); } catch (err) { cursor = null; }   // 屏幕切换瞬间可能抛

    // 每只宠物的位置先收集一次（O(n)），再分发给每只
    // （它需要知道"除了我以外的其它同伴在哪"）。
    const all = [];
    for (const it of alive) {
      try {
        const b = it.win.getBounds();
        all.push({ id: it.id, name: (it.pack && it.pack.name) || '', x: b.x, y: b.y, w: b.width, h: b.height });
      } catch (err) { /* 窗口正在销毁，跳过 */ }
    }

    for (const it of alive) {
      try {
        if (!it.win || it.win.isDestroyed()) continue;
        if (cursor) it.win.webContents.send('pet:cursor', { x: cursor.x, y: cursor.y });
        // 同伴列表：排除自己，省得自己跟自己互动
        const peers = all.filter((x) => x.id !== it.id);
        it.win.webContents.send('pet:peers', { peers });
      } catch (err) { /* 忽略单只失败，不影响其它宠物 */ }
    }
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
    safeShow(w);
    w.focus();
    return;
  }
  // 制作器窗口已被关闭：重建一个
  const win = createMakerWindow();
  safeShow(win);   // 用户主动点「重开制作器」-> 这里要显示；无头模式下 safeShow 会跳过
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  try {
    const s = { petAlive: isPetAlive(), makerAlive: makerAlive(), pets: runningPets() };
    tray.setToolTip(trayTooltip(s));
    const template = buildTrayMenuTemplate(s, (action) => {
      if (action === 'quitPet') { quitPetNow(); refreshTray(); }
      else if (typeof action === 'string' && action.startsWith('quitPetById:')) { quitPetById(action.slice('quitPetById:'.length)); refreshTray(); }
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

function createPetWindow(pack, opt) {
  const { w, h } = initialPetBounds(pack);
  const wa = screen.getPrimaryDisplay().workArea;
  let x = wa.x + wa.width - w - 20;
  let y = wa.y + wa.height - h - 20;
  // 多宠物同屏时不能都落在右下角（会完全叠住，看起来只有一只）。
  // 按"当前已有几只"做阶梯错位。
  const n = (opt && Number.isFinite(opt.offsetIndex)) ? opt.offsetIndex : petCount();
  if (n > 0) {
    const stepX = Math.round(w * 0.55) + 24;
    const stepY = 18;
    const perRow = Math.max(1, Math.floor((wa.width - w - 40) / stepX) || 1);
    x -= stepX * (n % perRow);
    y -= stepY * Math.floor(n / perRow);
    // 别跑到屏幕外或屏幕顶端之上
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
    y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  }
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
  // 无头（测试）模式：窗口不显示，但**只对这一个 webContents** 关掉后台节流，
  // 否则 Chromium 会把不可见窗口的 rAF 压到 ~1fps，动画/物理类断言全废。
  // 用 setBackgroundThrottling 而不是创建参数 backgroundThrottling：
  //   前者只影响这一个窗口，后者会把全局帧率行为也改掉（实测导致多个时序套件回归）。
  if (HEADLESS) { try { win.webContents.setBackgroundThrottling(false); } catch (err) { /* 忽略 */ } }
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachDebug(win, 'pet');
  // ★ 始终生效：宠物渲染进程崩了就把窗口清掉，
  //   否则桌面上会留下一只"坏掉的宠物"（空白/卡死、点它没反应）。
  attachWindowHealth(win, {
    tag: 'pet',
    log: (m) => { try { console.warn(m); } catch {} },
    onGone: () => {
      try {
        // 把这只从"在跑的宠物"里摘掉，托盘计数才会对。
        // 注意：没有 win.__petId 这种东西 —— 用 state 里的反查函数。
        const entry = petByWindow(win);
        if (entry && entry.id) removePet(entry.id);
        else if (getPetWindow() === win) setPetWindow(null);
        refreshTray();
      } catch {}
    },
  });
  win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  if (process.env.SIZEDBG === '1') console.log('[SIZEDBG] created  = ' + JSON.stringify(win.getBounds()));
  // 注意：这里以前是无条件 win.show()，跑 e2e 时宠物会真的弹到用户桌面上。
  win.once('ready-to-show', () => safeShow(win));
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
  const r = await showDialog(dialog, 'open', {
    title: '选择宠物图片', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  }, getMakerWindow);
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  const buf = fs.readFileSync(p);
  return { path: p, name: path.basename(p), dataUrl: `data:${mimeOf(p)};base64,${buf.toString('base64')}` };
});

ipcMain.handle('image:openMany', async () => {
  const r = await showDialog(dialog, 'open', {
    title: '选择多帧图片（按文件名顺序）', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  }, getMakerWindow);
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((p) => {
      const buf = fs.readFileSync(p);
      return { path: p, name: path.basename(p), dataUrl: `data:${mimeOf(p)};base64,${buf.toString('base64')}` };
    });
});

ipcMain.handle('pack:save', async (e, { pack, images, suggestedName, clipImages }) => {
  const v = validatePack({ ...pack, frames: (images || []).map((_, idx) => ({ file: 'f' + idx })) });
  if (!v.ok) return { ok: false, errors: v.errors };
  const r = await showDialog(dialog, 'save', {
    title: '导出桌宠包',
    defaultPath: petPackFileName(suggestedName || pack.name || 'mypet'),
    filters: [{ name: '桌宠包', extensions: ['petpack', 'zip'] }],
  }, getMakerWindow);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { return { ok: true, path: writePackFile(pack, images, r.filePath, clipImages).path }; }
  catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pack:open', async () => {
  const r = await showDialog(dialog, 'open', {
    title: '打开宠物包', properties: ['openFile'],
    filters: [{ name: '桌宠包', extensions: ['petpack', 'zip'] }],
  }, getMakerWindow);
  if (r.canceled || !r.filePaths.length) return null;
  try { return readPackFile(r.filePaths[0]); }
  catch (err) { return { error: String(err.message || err) }; }
});

// 导出「零依赖分享页」：一个自包含 HTML，双击就能在浏览器里看桌宠动起来。
// 同时把 .petpack 的 base64 塞进去，所以把这个 HTML 拖回桌宠制作器也能还原成完整宠物。
ipcMain.handle('share:exportHtml', async (e, { pack, images, clipImages }) => {
  try {
    const { pack: p, files } = buildPackAndEntries(pack, images, clipImages);
    const v = validatePack(p);
    if (!v.ok) return { ok: false, errors: v.errors };
    const petpackBuf = zipCreate([
      { name: 'pet.json', data: JSON.stringify(p, null, 2) },
      ...files,
    ]);
    // 把动作片段也传给分享页：否则别人打开只看到"一直在呼吸"，看不到跳舞。
    // clipImages 的结构是 { clipId: [{dataUrl, durationMs}] }，要按 p.clips 的顺序对齐。
    const shareClips = (Array.isArray(p.clips) ? p.clips : []).map((c) => ({
      id: c.id, name: c.name, weight: c.weight,
      frames: (clipImages && clipImages[c.id]) ? clipImages[c.id] : [],
    })).filter((c) => c.frames.length);
    const html = buildShareHtml(p, images, {
      title: p.name,
      petpackBase64: petpackBuf.toString('base64'),
      petpackName: petPackFileName(p.name),
      clips: shareClips,
    });
    const r = await showDialog(dialog, 'save', {
      title: '导出分享页（单个 HTML 文件）',
      defaultPath: shareFileName(p.name || 'mypet'),
      filters: [{ name: '网页分享包', extensions: ['html'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, html, 'utf8');
    return { ok: true, path: r.filePath, bytes: Buffer.byteLength(html, 'utf8'), petpackBytes: petpackBuf.length };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 导出「在线分享站」：零后端静态站点，扔到 GitHub Pages 就能给别人逛 ----------
// 单个 .html 只能一对一地发；要做「人人可浏览的广场」就需要一个静态站点。
// 这里逐只宠物渲染成自包含分享页，再生成 index（卡片 + 搜索）/ manifest / README。
// 缩略图直接内嵌 dataURL（站点里不含额外图片文件，方便整体上传）。
ipcMain.handle('share:exportSite', async (e, opt) => {
  const o = opt || {};
  try {
    const dir = petsDir();
    const builtinNames = new Set();
    try { for (const f of fs.readdirSync(builtinPetsDir())) if (/\.petpack$/i.test(f)) builtinNames.add(f); } catch {}
    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(petpack|zip)$/i.test(f)) continue;
      const full = path.join(dir, f);
      const builtin = builtinNames.has(f);
      if (builtin && !o.includeBuiltin) continue;
      try {
        const { pack, frames, clips } = readPackFile(full);
        items.push({ id: f, name: String(pack.name || f), author: String(pack.author || ''), frames, clips, pack, builtin });
      } catch { /* 坏包跳过：不能让一只坏宠物毁掉整站 */ }
    }
    if (!items.length) return { ok: false, errors: ['宠物库里没有可导出的宠物'] };

    // 目标目录：用户选一个文件夹（站点文件都写进它，方便整体拖去托管）
    const r = await showDialog(dialog, 'open', { title: '选择导出站点的文件夹', properties: ['openDirectory', 'createDirectory'] }, getMakerWindow);
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const outDir = path.join(r.filePaths[0], 'desk-pet-site');
    fs.mkdirSync(outDir, { recursive: true });

    const slugs = assignSlugs(items.map((it) => ({ id: it.id, name: it.name })));
    const siteName = String(o.siteName || '我的桌宠广场');
    const petMeta = [];
    const pages = {};

    for (let i = 0; i < items.length; i++) {
      const it = items[i], sl = slugs[i];
      // 每只宠物渲染成一个自包含分享页（复用已有的 buildShareHtml，含 petpack 兜底）
      const clipImages = {};
      for (const c of (it.clips || [])) clipImages[c.id] = c.frames;
      const { pack: p, files } = buildPackAndEntries(it.pack, it.frames, clipImages);
      const petpackBuf = zipCreate([{ name: 'pet.json', data: JSON.stringify(p, null, 2) }, ...files]);
      const shareClips = (Array.isArray(p.clips) ? p.clips : []).map((c) => ({
        id: c.id, name: c.name, weight: c.weight,
        frames: (clipImages && clipImages[c.id]) ? clipImages[c.id] : [],
      })).filter((c) => c.frames.length);
      const html = buildShareHtml(p, it.frames, {
        title: it.name,
        petpackBase64: petpackBuf.toString('base64'),
        petpackName: petPackFileName(it.name),
        clips: shareClips,
      });
      pages[sl.fileName] = html;
      petMeta.push({
        name: it.name, file: sl.fileName, author: it.author,
        frames: it.frames.length, thumb: (it.frames[0] && it.frames[0].dataUrl) || '',
      });
    }

    const siteFiles = planSiteFiles(petMeta, pages, { siteName, description: o.description });
    // 写盘前先确认没有重名，避免静默互相覆盖
    const seen = new Set();
    for (const f of siteFiles) {
      if (seen.has(f.name)) return { ok: false, errors: ['站点内文件名重复：' + f.name] };
      seen.add(f.name);
      fs.writeFileSync(path.join(outDir, f.name), f.data, 'utf8');
    }
    return { ok: true, path: outDir, count: petMeta.length, files: siteFiles.length, bytes: siteFiles.reduce((n, f) => n + Buffer.byteLength(f.data, 'utf8'), 0) };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 角色工坊：把捏好的角色配置存成文件 / 从文件载入 ----------
// 配置文件是纯 JSON，方便用户备份、发给朋友、或者手改。
ipcMain.handle('char:save', async (e, cfg) => {
  try {
    if (!cfg || typeof cfg !== 'object') throw new Error('没有可保存的角色配置');
    const safeName = safeFileName(String(cfg.name || 'my-character'), { maxLen: 40, fallback: 'character' });
    const r = await showDialog(dialog, 'save', {
      title: '保存角色配置',
      defaultPath: safeName + '.petchar.json',
      filters: [{ name: '角色配置', extensions: ['json'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(cfg, null, 2), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('char:load', async () => {
  try {
    const r = await showDialog(dialog, 'open', {
      title: '载入角色配置',
      properties: ['openFile'],
      filters: [{ name: '角色配置', extensions: ['json'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const raw = fs.readFileSync(r.filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('这个文件不是角色配置');
    return { ok: true, character: parsed, path: r.filePaths[0] };
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
    const r = await showDialog(dialog, 'save', {
      title: '导出模板',
      defaultPath: templateFileName(tpl.name),
      filters: [{ name: '桌宠模板', extensions: ['pettpl', 'json'] }],
    }, getMakerWindow);
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
      const r = await showDialog(dialog, 'open', {
        title: '导入模板', properties: ['openFile'],
        filters: [{ name: '桌宠模板', extensions: ['pettpl', 'json'] }],
      }, getMakerWindow);
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
    // ★ 必须把 clips 也带上：readPackFile 已经把片段帧解成 dataUrl 了，
    //   这里若只返回 pack/frames，分享页里那几段动作就会**静默丢掉**
    //   （用户从分享页载入后，动作列表是空的）。
    const { pack, frames, clips } = readPackFile(tmp);   // 校验可解析
    return { ok: true, pack, frames, clips, path: tmp };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pack:exportFolder', async (e, { pack, images, clipImages }) => {
  const r = await showDialog(dialog, 'open', { title: '选择导出文件夹', properties: ['openDirectory', 'createDirectory'] }, getMakerWindow);
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const { pack: p, files } = buildPackAndEntries(pack, images, clipImages);
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

ipcMain.handle('pet:launch', (e, { pack, images, clipImages }) => {
  try {
    const tmp = path.join(app.getPath('userData'), 'preview');
    const out = writePackFile(pack, images, path.join(tmp, 'preview-' + Date.now() + '.petpack'), clipImages);
    launchPet(out.path);
    return { ok: true, path: out.path };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:launchPath', (e, p) => {
  try { launchPet(p); return { ok: true }; }
  catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 宠物库
// ---------- 批量处理：一次把多张图各自变成一只宠物 ----------
// 批量任务是长耗时操作（每张图要跑 AI 抠图），所以：
//   1. 主进程串行执行，逐张回报进度，渲染进程不会被卡住；
//   2. 支持取消 —— 拖了 50 张发现太久要能停下来，已完成的保留；
//   3. 每只成功就立刻原子入库（临时文件 -> 校验 -> rename），中途失败不留半成品。
const BATCH = { running: false, canceled: false };

function readImageAsDataUrl(p) {
  const buf = fs.readFileSync(p);
  return `data:${mimeOf(p)};base64,${buf.toString('base64')}`;
}

/** 把一张已抠好的图片写成宠物包并入库（原子写入，失败不污染宠物库） */
function writeBatchPet(dir, outName, name, pngBuffer, tpl) {
  const dest = path.join(dir, outName);
  const tmp = dest + '.tmp-batch';
  try {
    const pack = batchPackFor(name, tpl, 'pet.png');
    const entries = [
      { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
      { name: 'pet.png', data: pngBuffer },
      { name: 'README.txt', data: `桌宠宠物包\n名称: ${pack.name}\n由「桌宠制作器」批量生成\n` },
    ];
    fs.writeFileSync(tmp, zipCreate(entries));
    readPackFile(tmp);                 // 二次校验：半包绝不允许入库
    fs.renameSync(tmp, dest);
    return { ok: true, id: outName, name: pack.name, path: dest };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

// ---------- 身体识别（姿态估计） ----------
// 用于「上传一张人物图 -> 识别出各个身体部位」。
// 模型是 MoveNet（本地 CPU，实测推理约 11ms）。
ipcMain.handle('pose:estimate', async (e, { dataUrl }) => {
  try {
    const dir = app.getPath('userData');
    if (!isPoseModelInstalled(dir)) {
      return { ok: false, needModel: true, errors: ['姿态模型未下载（约 9MB）'] };
    }
    const r = await estimatePose(dir, dataUrl);
    const mat = checkMaterial(r.keypoints);
    return { ok: true, ...r, material: mat };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 按身体自动适配：算出「人物实际范围」与建议缩放/对齐，
// 让不同构图（半身/全身/偏心）的素材在桌面上观感一致。
ipcMain.handle('pose:autoFit', async (e, { dataUrl }) => {
  try {
    const dir = app.getPath('userData');
    if (!isPoseModelInstalled(dir)) return { ok: false, needModel: true, errors: ['姿态模型未下载'] };
    const r = await estimatePose(dir, dataUrl);
    const fit = autoFit(r.keypoints, { canvasH: r.srcHeight });
    if (!fit.ok) return { ok: false, errors: [fit.reason] };
    return { ok: true, ...fit, srcWidth: r.srcWidth, srcHeight: r.srcHeight, keypoints: r.keypoints };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 骨架微动作：只对「标准立绘」开放（canAnimate 是闸门）。
// 返回逐帧的关节解算结果，渲染层直接照着转就行。
ipcMain.handle('pose:motionPlan', async (e, { dataUrl, motionId, frames }) => {
  try {
    const dir = app.getPath('userData');
    if (!isPoseModelInstalled(dir)) return { ok: false, needModel: true, errors: ['姿态模型未下载'] };
    const r = await estimatePose(dir, dataUrl);
    const gate = canAnimate(r.keypoints);
    if (!gate.ok) {
      return { ok: false, gated: true, reason: gate.reason, missing: gate.missing, errors: [gate.reason] };
    }
    const seq = motionSequence(motionId, { frames });
    const jointsPerFrame = seq.map((pose) => solveJoints(r.keypoints, pose));
    const bounds = motionBounds(jointsPerFrame, bodyBoundsOf(r.keypoints));
    return {
      ok: true,
      keypoints: r.keypoints,
      srcWidth: r.srcWidth, srcHeight: r.srcHeight,
      pose: seq, jointsPerFrame, bounds,
      available: gate.available, reason: gate.reason,
      // 注意：MOTIONS 里的对象带 pose 函数，**不能**直接过 IPC ——
      // 结构化克隆遇到函数会挂住（实测：e2e 卡死十几分钟没有任何输出）。
      // 只回传纯数据字段。
      motion: (() => {
        const m = MOTIONS.find((x) => x.id === motionId);
        return m ? { id: m.id, name: m.name, emoji: m.emoji, desc: m.desc } : null;
      })(),
    };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pose:modelInfo', () => {
  const dir = app.getPath('userData');
  return {
    installed: isPoseModelInstalled(dir),
    model: listModels(dir, { kind: 'pose' })[0] || null,
    guide: MATERIAL_GUIDE,
    motions: MOTIONS.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, desc: m.desc })),
  };
});

ipcMain.handle('pose:downloadModel', async (e, id) => {
  try {
    const r = await downloadModel(app.getPath('userData'), id || 'poseMovenet', (p) => {
      if (e.sender && !e.sender.isDestroyed()) e.sender.send('ai:downloadProgress', { id: id || 'poseMovenet', ...p });
    });
    return r;
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('batch:cancel', () => { if (BATCH.running) BATCH.canceled = true; return { ok: true }; });

ipcMain.handle('batch:run', async (e, { files, tpl, autoModel = true, alwaysFull = false, threshold = 0.5, feather = 0.12 }) => {
  if (BATCH.running) return { ok: false, errors: ['已有一个批量任务在跑'] };
  const send = (p) => { if (e.sender && !e.sender.isDestroyed()) e.sender.send('batch:progress', p); };
  BATCH.running = true; BATCH.canceled = false;
  try {
    const dir = app.getPath('userData');
    const pets = petsDir();
    const images = (Array.isArray(files) ? files : []).map((p) => {
      try { return { name: path.basename(p), dataUrl: readImageAsDataUrl(p), path: p }; }
      catch (err) { return { name: path.basename(p), dataUrl: null, error: String(err.message || err) }; }
    });
    if (!images.length) throw new Error('没有可处理的图片');

    const plan = planBatch(images);
    const results = [];
    send({ phase: 'plan', total: plan.length });

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      const label = item.name;
      if (BATCH.canceled) {
        results.push({ ok: false, canceled: true, name: label });
        send({ phase: 'item', index: i + 1, total: plan.length, name: label, status: 'canceled' });
        continue;
      }
      const src = images[item.index];
      if (!src || !src.dataUrl) {
        results.push({ ok: false, name: label, error: (src && src.error) || '图片读取失败' });
        send({ phase: 'item', index: i + 1, total: plan.length, name: label, status: 'fail', error: (src && src.error) || '图片读取失败' });
        continue;
      }
      try {
        send({ phase: 'item', index: i + 1, total: plan.length, name: label, status: 'cut' });
        // 抠图：默认走「自动挑最好的模型」，和制作器里的 AI 抠图保持一致
        const dir0 = app.getPath('userData');
        const installed = listModels(dir0).filter((m) => m.installed).map((m) => m.id);
        let seg;
        if (autoModel && installed.length) {
          seg = await segmentAuto(dir0, null, src.dataUrl, {
            threshold, feather, alwaysFull: !!alwaysFull,
            ids: installed,
            onProgress: (pr) => send({ phase: 'model', index: i + 1, total: plan.length, name: label, model: pr.id, modelIndex: pr.index, modelTotal: pr.total }),
          });
        } else if (installed.length) {
          seg = await segmentImage(dir0, installed[0], src.dataUrl, { threshold, feather });
        } else {
          throw new Error('没有已下载的 AI 模型（请在「抠图」面板下载一个）');
        }
        if (!seg || !seg.ok) throw new Error((seg && seg.errors && seg.errors.join(';')) || '抠图失败');
        const b64 = String(seg.dataUrl).split(',')[1] || '';
        const png = Buffer.from(b64, 'base64');
        const r = writeBatchPet(pets, item.outName, item.name, png, tpl);
        results.push({ ok: true, ...r, modelId: seg.modelId || null });
        send({ phase: 'item', index: i + 1, total: plan.length, name: label, status: 'ok', outName: item.outName, modelId: seg.modelId || null });
      } catch (err) {
        const msg = String((err && err.message) || err);
        results.push({ ok: false, name: label, error: msg });
        send({ phase: 'item', index: i + 1, total: plan.length, name: label, status: 'fail', error: msg });
      }
    }

    const summary = summarizeBatch(results);
    const wasCanceled = BATCH.canceled;
    send({ phase: 'done', summary, canceled: wasCanceled });
    return { ok: true, summary, results, canceled: wasCanceled, petsDir: pets };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  } finally {
    BATCH.running = false; BATCH.canceled = false;
  }
});

ipcMain.handle('batch:pickFiles', async () => {
  const r = await showDialog(dialog, 'open', {
    title: '选择多张图片（每张会各自变成一只宠物）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  }, getMakerWindow);
  if (r.canceled) return [];
  return r.filePaths.slice();
});

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
      const { pack, frames, clips } = readPackFile(full);
      // 详情面板要用的字段一次带齐（避免点开时再读一遍包）。
      // version 用 shared/packversion 的 versionLabel：老包没有版本信息时给"版本未知"。
      out.push({
        id: f, name: pack.name, author: pack.author, frames: frames.length, file: full,
        thumb: frames[0].dataUrl, size: fs.statSync(full).size, builtin,
        canvas: { width: (pack.canvas && pack.canvas.width) || 0, height: (pack.canvas && pack.canvas.height) || 0 },
        clips: Array.isArray(clips) ? clips.length : 0,
        version: versionLabel(pack),
        createdAt: pack.createdAt || '',
        updatedAt: pack.updatedAt || '',
        rev: Number(pack.rev) || 0,
      });
    } catch (err) {
      out.push({ id: f, name: f, broken: true, error: String(err.message || err), file: full, builtin });
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  return out;
});

// 安装前预检：这个包是"新版 / 同版 / 旧版"？（**不落盘**，只给结论）
// 为什么要预检而不是"装完再说"：覆盖是破坏性的 —— 得让用户在动手之前决定，
// 尤其是"这个包比你现在用的更旧"这种情况，必须先警告。
ipcMain.handle('pet:inspectPack', (e, srcPath) => {
  try {
    if (!srcPath || !fs.existsSync(srcPath)) throw new Error('文件不存在');
    const { pack } = readPackFile(srcPath);
    const dir = petsDir();
    const dest = path.join(dir, petPackFileName(pack.name || path.basename(srcPath)));
    const existed = fs.existsSync(dest);
    let version = null;
    if (existed) {
      try {
        const { pack: current } = readPackFile(dest);
        const cmp = compareVersions(current, pack);
        const pr = updatePrompt(current, pack);
        version = {
          result: cmp.result, reason: cmp.reason,
          current: versionLabel(current), incoming: versionLabel(pack),
          prompt: pr.text, level: pr.level,
        };
      } catch (err) { version = null; }
    }
    return { ok: true, name: pack.name || path.basename(srcPath), existed, version };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
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

    // 「一键更新」判断：如果已经装过同名包，比较版本，把结论一起回报给界面。
    // 注意：这里**只判断、不拦截** —— 是否覆盖由用户决定（界面会问）。
    let version = null;
    if (existed) {
      try {
        const { pack: current } = readPackFile(dest);
        const cmp = compareVersions(current, pack);
        version = {
          result: cmp.result,
          reason: cmp.reason,
          current: versionLabel(current),
          incoming: versionLabel(pack),
          prompt: updatePrompt(current, pack).text,
          level: updatePrompt(current, pack).level,
        };
      } catch (err) { version = null; }
    }

    // 原子写入：先写临时文件再 rename，避免中途失败留下损坏的半包
    tmp = dest + '.tmp-install';
    fs.copyFileSync(srcPath, tmp);
    readPackFile(tmp);                       // 二次校验临时文件可读
    fs.renameSync(tmp, dest);                // 同目录 rename 为原子操作
    tmp = null;

    return { ok: true, path: dest, replaced: existed, id: path.basename(dest), name: pack.name || path.basename(dest), version };
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

    // ★ 幂等：同一只已经在跑就别再开一个窗口。
    //   以前重复拖入同一个包会开出多个窗口（叠在一起，像"窗口一直弹"）。
    const running = petByPackId(pack.id);
    if (running && running.win && !(running.win.isDestroyed && running.win.isDestroyed())) {
      try { running.win.webContents.send('quick:reload'); } catch {}
      try { ensurePetWindowVisibility(); } catch {}
      setActivePet(running.id);
      refreshTray();
      saveLibraryPrefs(touchRecent(loadLibraryPrefs(), id));
      return { ok: true, id, name: pack.name || id, path: dest, replaced: existed, reused: true };
    }

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

// 读某个已安装宠物的完整数据（pack + frames）。
// 多宠物同屏要把多只一起启用，就必须先拿到每一只的完整帧 ——
// listInstalled 只给缩略图，不够用。
ipcMain.handle('pet:readInstalled', (e, id) => {
  try {
    const full = path.join(petsDir(), String(id || ''));
    if (!fs.existsSync(full)) throw new Error('宠物不存在');
    const { pack, frames } = readPackFile(full);
    // 保证 pack.id 一定有值：位置记忆、包标识都以它为键。
    // 有些包（尤其是老包/手写的包）可能没写 id，这里用文件名兜底。
    if (pack && !pack.id) pack.id = String(id);
    return { ok: true, pack, frames, name: pack.name || id };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:runInstalled', (e, id) => {
  try {
    const full = path.join(petsDir(), id);
    if (!fs.existsSync(full)) throw new Error('宠物不存在');
    launchPet(full);
    return { ok: true };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 导出 GIF 动图（发社交平台 / 当表情包）----------
// 宠物包本身是 .petpack，别人不装工具看不了；导出一张 GIF 就能直接发出去。
ipcMain.handle('export:gif', async (e, { frames, width, height, fps, suggestedName }) => {
  try {
    if (!Array.isArray(frames) || !frames.length) return { ok: false, errors: ['没有可导出的帧'] };
    // frames: [{ dataUrl, durationMs }]
    const decoded = [];
    for (const f of frames) {
      const m = /^data:[^;]+;base64,(.*)$/i.exec(f.dataUrl || '');
      if (!m) continue;
      const img = nativeImage.createFromBuffer(Buffer.from(m[1], 'base64'));
      const s = img.getSize();
      if (!s.width || !s.height) continue;
      // **必须把 BGRA 换成 RGBA**：
      // nativeImage.toBitmap() 给的是 BGRA（实测：纯红图读出来是 0,0,255,255），
      // 而 GIF 编码器按 RGBA 解读 —— 不换的话导出图会**红蓝互换**（实测踩到）。
      const bgra = img.toBitmap();
      const rgba = Buffer.allocUnsafe(bgra.length);
      for (let i = 0; i < bgra.length; i += 4) {
        rgba[i] = bgra[i + 2];
        rgba[i + 1] = bgra[i + 1];
        rgba[i + 2] = bgra[i];
        rgba[i + 3] = bgra[i + 3];
      }
      decoded.push({ data: new Uint8ClampedArray(rgba), width: s.width, height: s.height, delayMs: Math.max(16, Math.round(f.durationMs || 100)) });
    }
    if (!decoded.length) return { ok: false, errors: ['帧解码失败'] };
    // 多帧尺寸必须一致（GIF 全局尺寸取第一帧），不一致的按第一帧裁剪/拉伸会变形，
    // 所以这里统一成第一帧尺寸：不一致时用 canvas 缩放（交给渲染进程预处理更合适，这里只做校验提示）
    const W = decoded[0].width, H = decoded[0].height;
    const mismatched = decoded.some((d) => d.width !== W || d.height !== H);
    if (mismatched) {
      return { ok: false, errors: ['各帧尺寸不一致（' + decoded.map((d) => d.width + 'x' + d.height).join(', ') + '）。请先在制作器里「统一画布」再导出 GIF'] };
    }
    const enc = encodeGif(decoded, { loop: 0 });
    const r = await showDialog(dialog, 'save', {
      title: '导出 GIF 动图',
      defaultPath: String(suggestedName || 'pet') + '.gif',
      filters: [{ name: 'GIF 动图', extensions: ['gif'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(enc.buffer));
    return { ok: true, path: r.filePath, bytes: enc.buffer.length, frames: enc.frameCount, width: enc.width, height: enc.height };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 宠物库批量导出（备份 / 换机 / 分享合集）----------
// 逐个宠物包写进一个 zip，用流式写入避免大库 OOM。
ipcMain.handle('pet:exportAll', async (e, opt) => {
  const o = opt || {};
  try {
    const dir = petsDir();
    // 复用 listInstalled 的数据（含 name / size / builtin / broken）
    const builtinNames = new Set();
    try { for (const f of fs.readdirSync(builtinPetsDir())) if (/\.petpack$/i.test(f)) builtinNames.add(f); } catch {}
    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(petpack|zip)$/i.test(f)) continue;
      const full = path.join(dir, f);
      let name = f, broken = false;
      try { const { pack } = readPackFile(full); name = pack.name || f; } catch { broken = true; }
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      items.push({ id: f, name, size, builtin: builtinNames.has(f), broken });
    }

    // 命名模板（可选）：用户想给导出的文件加日期/序号时用。
    // 不传就沿用原来的"宠物名.petpack"，行为不变。
    const now = new Date();
    const plan = planExport(items, {
      includeBuiltin: !!o.includeBuiltin,
      nameTemplate: o.nameTemplate || '',
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 16).replace(':', '-'),
    });
    if (!plan.ok) return { ok: false, errors: [plan.reason], skipped: plan.skipped };

    const r = await showDialog(dialog, 'save', {
      title: '导出宠物库',
      defaultPath: '桌宠合集-' + new Date().toISOString().slice(0, 10) + '.zip',
      filters: [{ name: '压缩包', extensions: ['zip'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };

    const entries = plan.entries.map((en) => ({
      name: en.outName,
      getData: () => fs.readFileSync(path.join(dir, en.sourceId)),
    }));
    entries.unshift({ name: 'README.txt', data: exportReadme(plan.entries) });

    const w = await zipWriteToFile(entries, r.filePath);
    return {
      ok: true, path: r.filePath, count: plan.entries.length,
      bytes: w.bytes, skipped: plan.skipped,
    };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 导出 Sprite Sheet（给开发者接自己的引擎用）----------
// 产出一张拼接图 + 一份 JSON 元数据（每帧坐标/时长），引擎直接读 JSON 就能播。
ipcMain.handle('export:spriteSheet', async (e, { frames, cellW, cellH, suggestedName }) => {
  try {
    if (!Array.isArray(frames) || !frames.length) return { ok: false, errors: ['没有可导出的帧'] };
    const W = Math.max(1, Math.round(Number(cellW) || 0));
    const H = Math.max(1, Math.round(Number(cellH) || 0));
    if (!W || !H) return { ok: false, errors: ['帧尺寸无效'] };

    const plan = planSheet(frames.length, W, H);
    // 拼图：用一张大 canvas 逐帧画（在渲染进程做更合适，但主进程也能用 nativeImage 合成）
    // nativeImage 没有直接"画到画布"的 API，所以这里用 Buffer 手工拼 BGRA。
    const sheetBgra = Buffer.alloc(sheetBytes(plan.width, plan.height));
    const durations = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const m = /^data:[^;]+;base64,(.*)$/i.exec(f.dataUrl || '');
      if (!m) continue;
      const img = nativeImage.createFromBuffer(Buffer.from(m[1], 'base64'));
      const sz = img.getSize();
      if (!sz.width || !sz.height) continue;
      // 逐帧统一到单元尺寸（尺寸不一致时拉伸；调用方一般已统一画布）
      const resized = (sz.width === W && sz.height === H) ? img : img.resize({ width: W, height: H, quality: 'good' });
      const src = resized.toBitmap();   // BGRA
      const col = i % plan.cols, row = Math.floor(i / plan.cols);
      const ox = col * W, oy = row * H;
      for (let y = 0; y < H; y++) {
        const s = y * W * 4;
        const d = ((oy + y) * plan.width + ox) * 4;
        src.copy(sheetBgra, d, s, s + W * 4);
      }
      durations.push(Math.max(16, Math.round(f.durationMs || 100)));
    }

    // 用 nativeImage 把 BGRA 还原成 PNG
    const sheetImg = nativeImage.createFromBuffer(sheetBgra, { width: plan.width, height: plan.height });
    if (sheetImg.isEmpty()) return { ok: false, errors: ['拼接图生成失败'] };

    const frameRects = sheetFrames(frames.length, W, H, plan.cols, plan.rows);
    const meta = sheetMetadata(frameRects, {
      name: String(suggestedName || 'pet'), image: String(suggestedName || 'pet') + '-sheet.png',
      sheetWidth: plan.width, sheetHeight: plan.height, cols: plan.cols, rows: plan.rows, durations,
    });

    const r = await showDialog(dialog, 'save', {
      title: '导出 Sprite Sheet（会同时生成 PNG 与 JSON）',
      defaultPath: String(suggestedName || 'pet') + '-sheet.png',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    }, getMakerWindow);
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const pngPath = r.filePath.replace(/\.[a-z0-9]+$/i, '') + '.png';
    const jsonPath = pngPath.replace(/\.png$/i, '.json');
    fs.writeFileSync(pngPath, sheetImg.toPNG());
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    return {
      ok: true, png: pngPath, json: jsonPath, frames: frames.length,
      sheet: { width: plan.width, height: plan.height, cols: plan.cols, rows: plan.rows },
      oversized: plan.oversized, bytes: fs.statSync(pngPath).size,
    };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// ---------- 批量导出 GIF：宠物库里每只宠物各导出一个 GIF ----------
// 编码是纯 CPU 且量化是 O(像素×调色板)，大图多帧会非常慢，
// 所以 planBulkGif 会把尺寸统一到 <=320px、帧数抽稀到 <=40。
ipcMain.handle('export:bulkGif', async (e, opt) => {
  const o = opt || {};
  try {
    const dir = petsDir();
    const builtinNames = new Set();
    try { for (const f of fs.readdirSync(builtinPetsDir())) if (/\.petpack$/i.test(f)) builtinNames.add(f); } catch {}

    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(petpack|zip)$/i.test(f)) continue;
      const full = path.join(dir, f);
      const builtin = builtinNames.has(f);
      if (builtin && !o.includeBuiltin) continue;
      try {
        const { pack, frames } = readPackFile(full);
        items.push({
          id: f, name: pack.name || f, builtin, broken: false,
          width: (pack.canvas && pack.canvas.width) || 0,
          height: (pack.canvas && pack.canvas.height) || 0,
          frames: frames.map((fr) => ({ dataUrl: fr.dataUrl, durationMs: fr.durationMs })),
        });
      } catch { items.push({ id: f, name: f, builtin, broken: true, frames: [] }); }
    }

    const plan = planBulkGif(items, { includeBuiltin: true, maxEdge: o.maxEdge, maxFrames: o.maxFrames });
    if (!plan.ok) return { ok: false, errors: [plan.reason], skipped: plan.skipped };

    const r = await showDialog(dialog, 'open', {
      title: '选择导出位置（会在里面新建一个文件夹放 GIF）',
      properties: ['openDirectory', 'createDirectory'],
    }, getMakerWindow);
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const outDir = path.join(r.filePaths[0], '桌宠GIF-' + new Date().toISOString().slice(0, 10));
    fs.mkdirSync(outDir, { recursive: true });

    let written = 0, failed = 0, bytes = 0;
    const failures = [];
    for (const en of plan.entries) {
      try {
        const src = items.find((it) => it.id === en.sourceId);
        if (!src) throw new Error('源宠物缺失');
        // 按与 plan 完全相同的规则取帧（保证实际导出与预览一致）
        const list = src.frames;
        const n = en.frameCount;
        const picked = list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
        const decoded = [];
        for (const fr of picked) {
          const m = /^data:[^;]+;base64,(.*)$/i.exec(fr.dataUrl || '');
          if (!m) continue;
          const img = nativeImage.createFromBuffer(Buffer.from(m[1], 'base64'));
          const sz = img.getSize();
          if (!sz.width || !sz.height) continue;
          const resized = img.resize({ width: plan.canvas.w, height: plan.canvas.h, quality: 'good' });
          const bgra = resized.toBitmap();
          // 必须换通道：toBitmap 是 BGRA，编码器按 RGBA 解读（不换则红蓝互换）
          const rgba = Buffer.allocUnsafe(bgra.length);
          for (let i = 0; i < bgra.length; i += 4) {
            rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
          }
          decoded.push({ data: new Uint8ClampedArray(rgba), width: plan.canvas.w, height: plan.canvas.h, delayMs: Math.max(16, Math.round(fr.durationMs || 100)) });
        }
        if (!decoded.length) throw new Error('帧解码失败');
        const enc = encodeGif(decoded, { loop: 0 });
        fs.writeFileSync(path.join(outDir, en.outName), Buffer.from(enc.buffer));
        bytes += enc.buffer.length;
        written++;
        if (e.sender && !e.sender.isDestroyed()) {
          e.sender.send('export:bulkGifProgress', { done: written + failed, total: plan.entries.length, name: en.name });
        }
      } catch (err) {
        failed++;
        failures.push({ name: en.name, error: String(err.message || err) });
      }
    }

    try {
      fs.writeFileSync(path.join(outDir, 'README.txt'), [
        '桌宠 GIF 合集', '='.repeat(32), '',
        '本目录含 ' + written + ' 个 GIF（每只宠物一个），均为无限循环动图。',
        '画布统一为 ' + plan.canvas.w + 'x' + plan.canvas.h + '。', '',
        '导出时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '), '',
      ].join('\n'));
    } catch {}

    return { ok: true, dir: outDir, written, failed, failures, bytes, canvas: plan.canvas, skipped: plan.skipped, summary: bulkGifSummary(plan) };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

// 预览一次导出（不落盘）：让界面先告诉用户"会导出几只、多大、跳过什么"
ipcMain.handle('pet:previewExport', () => {
  try {
    const dir = petsDir();
    const builtinNames = new Set();
    try { for (const f of fs.readdirSync(builtinPetsDir())) if (/\.petpack$/i.test(f)) builtinNames.add(f); } catch {}
    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(petpack|zip)$/i.test(f)) continue;
      const full = path.join(dir, f);
      let name = f, broken = false;
      try { const { pack } = readPackFile(full); name = pack.name || f; } catch { broken = true; }
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      items.push({ id: f, name, size, builtin: builtinNames.has(f), broken });
    }
    const def = planExport(items, {});
    const all = planExport(items, { includeBuiltin: true });
    return {
      ok: true,
      mine: { count: def.entries.length, bytes: def.totalBytes, skipped: def.skipped },
      all: { count: all.entries.length, bytes: all.totalBytes },
    };
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

// ---------- 宠物分组（把库里的宠物归类）----------
// 一只宠物可以在多个分组里 —— 比"只能属于一个文件夹"更贴合真实用法
// （同一只宠物既是"表情包"又是"给孩子的"）。
// 分组偏好只存在本地 library.json，不写进 .petpack（不污染可分享的包）。
ipcMain.handle('library:addGroup', (e, name) => {
  const r = addGroup(loadLibraryPrefs(), name);
  if (!r.ok) return { ok: false, reason: r.reason, library: r.state };
  saveLibraryPrefs(r.state);
  return { ok: true, id: r.id, library: r.state };
});

ipcMain.handle('library:removeGroup', (e, id) => {
  const next = removeGroup(loadLibraryPrefs(), id);
  saveLibraryPrefs(next);
  return { ok: true, library: next };
});

ipcMain.handle('library:renameGroup', (e, { id, name }) => {
  const r = renameGroup(loadLibraryPrefs(), id, name);
  if (!r.ok) return { ok: false, reason: r.reason, library: r.state };
  saveLibraryPrefs(r.state);
  return { ok: true, library: r.state };
});

ipcMain.handle('library:setGroupMember', (e, { id, petId, on }) => {
  const r = on ? addToGroup(loadLibraryPrefs(), id, petId) : removeFromGroup(loadLibraryPrefs(), id, petId);
  if (!r.ok) return { ok: false, reason: r.reason, library: r.state };
  saveLibraryPrefs(r.state);
  return { ok: true, library: r.state };
});

// 清掉已经不存在的宠物在分组里的残留（删除宠物后调用）
ipcMain.handle('library:pruneGroups', (e, aliveIds) => {
  const next = pruneGroups(loadLibraryPrefs(), aliveIds);
  saveLibraryPrefs(next);
  return { ok: true, library: next };
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
ipcMain.handle('ai:segmentAuto', async (e, { dataUrl, threshold, feather, hintId, ids, alwaysFull }) => {
  try {
    const dir = app.getPath('userData');
    const installed = listModels(dir).filter((m) => m.installed).map((m) => m.id);
    if (!installed.length) return { ok: false, errors: ['没有已下载的模型，请先下载至少一个模型'] };
    const r = await segmentAuto(dir, null, dataUrl, {
      threshold, feather, hintId, alwaysFull: !!alwaysFull,
      ids: Array.isArray(ids) && ids.length ? ids.filter((x) => installed.includes(x)) : installed,
      onProgress: (p) => { if (e.sender && !e.sender.isDestroyed()) e.sender.send('ai:autoProgress', p); },
    });
    return r;
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

ipcMain.handle('pet:getPack', (e) => {
  // ★ 多宠物关键：必须按**发问的那个窗口**反查是哪一只。
  // 以前这里返回"当前包"（全局的），多宠物同屏时每只都会拿到最后启用的那只的数据 ——
  // 表现为"三只宠物全都变成同一只"。
  const byWin = (() => {
    try {
      // 优先按 webContents.id 反查（最可靠）；对象比对作为兜底
      const byId = e && e.sender ? petByWebContentsId(e.sender.id) : null;
      if (byId) return byId;
      return petByWindow(e && e.sender ? BrowserWindow.fromWebContents(e.sender) : null);
    } catch (err) { return null; }
  })();
  if (byWin && (byWin.pack || byWin.frames)) return { pack: byWin.pack, frames: byWin.frames };
  // 兼容旧路径：没有登记实例时（比如 --pet= 直接启动）用全局当前包
  const mem = getCurrentPack();
  if (mem) return mem;
  if (!petPath) return null;
  try { return readPackFile(petPath); }
  catch (err) { return { error: String(err.message || err) }; }
});

// 多宠物：告诉制作器现在有几只在跑
ipcMain.handle('pet:count', () => ({ ok: true, count: petCount(), activeId: getActivePetId() }));

// 省电节流开关：转发给**每一只**宠物（多宠物时不能只给当前那只）
ipcMain.handle('pet:setPowerSave', (e, on) => {
  let n = 0;
  for (const it of listPets()) {
    try { it.win.webContents.send('pet:powerSave', on !== false); n++; } catch (err) { /* 忽略 */ }
  }
  return { ok: true, applied: n };
});

// 作息开关：同样转发给每一只（多宠物时不能只给当前那只）
ipcMain.handle('pet:setSchedule', (e, on) => {
  let n = 0;
  for (const it of listPets()) {
    try { it.win.webContents.send('pet:schedule', on !== false); n++; } catch (err) { /* 忽略 */ }
  }
  return { ok: true, applied: n };
});

// ---------- 快速模式：启用 / 停用（同进程，无需重启） ----------
function ensurePetWindowVisibility() {
  const w = getPetWindow();
  if (w && !w.isDestroyed()) {
    safeShow(w, 'inactive');
    w.setAlwaysOnTop(true, 'screen-saver');
    w.moveTop();
  }
}

// ---------- 多宠物同屏 ----------
// 一次性启用多只宠物，各自独立窗口、独立动作、互不影响。
// 与 quick:enable 的区别：这里**不复用**已有窗口，每只都新建；
// 并且把每只登记进 state 的多实例表（pet:getPack 就靠这个按窗口反查）。
/** 把启用进度发回发起请求的那个窗口（多宠物时逐只回报） */
function sendLaunchProgress(event, payload) {
  try {
    const w = event && event.sender && !event.sender.isDestroyed() ? BrowserWindow.fromWebContents(event.sender) : null;
    if (w && !w.isDestroyed()) w.webContents.send('pet:launchProgress', payload);
  } catch (err) { /* 回报失败不能影响真正的启用流程 */ }
}

ipcMain.handle('quick:enableMulti', async (e, payload) => {
  try {
    const items = (payload && Array.isArray(payload.pets)) ? payload.pets : [];
    if (!items.length) return { ok: false, errors: ['没有要启用的宠物'] };
    const maxN = 8;   // 上限：再多会明显吃 CPU（每只一个渲染进程）
    if (items.length > maxN) return { ok: false, errors: ['一次最多同时养 ' + maxN + ' 只（再多会很卡）'] };

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const pack = it.pack, frames = it.frames;
      if (!pack || !Array.isArray(frames) || !frames.length) {
        results.push({ ok: false, name: it.name || '', errors: ['缺少宠物数据'] });
        sendLaunchProgress(e, { done: results.length, total: items.length, name: it.name || '', ok: false });
        continue;
      }
      // 兜底补 id：位置记忆等功能都以 pack.id 为键，缺了就不生效
      if (pack && !pack.id) pack.id = String(it.fileName || it.id || ('pet-' + (i + 1)));

      // ★ 幂等：这一只**已经在跑**就别再开一个窗口。
      //   以前完全没有这层判断 —— 同一只重复点「一起放出来」会开出多个窗口，
      //   叠在屏幕上、看起来就是"窗口一直往外弹"（用户明确抱怨过）。
      const running = petByPackId(pack.id);
      if (running && running.win && !(running.win.isDestroyed && running.win.isDestroyed())) {
        // 把新数据热更新给它（用户可能改了参数后再点一次），并把它带到前面
        try { running.win.webContents.send('quick:reload'); } catch {}
        try { ensurePetWindowVisibility(); } catch {}
        setActivePet(running.id);
        results.push({ ok: true, id: running.id, name: pack.name || '', reused: true });
        sendLaunchProgress(e, { done: results.length, total: items.length, name: pack.name || '', ok: true });
        continue;
      }

      const id = addPet({ pack, frames });        // 先登记（会设为 active）
      let win = null;
      try {
        // 用**循环下标**错位，而不是 petCount()：
        // 刚 addPet 时窗口还没建，petCount() 不变，会让前两只算到同一个位置（实测叠在一起）。
        win = createPetWindow(pack, { offsetIndex: i });
        // 直接把窗口绑到**这只**实例（不能走"绑定到活跃实例"——那样多线程/多次调用会串）。
        const rec = getPet(id);
        if (rec) rec.win = win;
        setActivePet(id);
      } catch (err) {
        removePet(id);
        results.push({ ok: false, name: pack.name || '', errors: [String(err.message || err)] });
        sendLaunchProgress(e, { done: results.length, total: items.length, name: pack.name || '', ok: false });
        continue;
      }
      win.on('closed', () => {
        removePet(id);
        if (petCount() === 0) stopCursorFeed();
        refreshTray();   // 菜单里的宠物列表要跟着更新，否则还列着已经关掉的那只
        const mw = getMakerWindow();
        if (mw && !mw.isDestroyed()) mw.webContents.send('quick:state', { enabled: petCount() > 0, count: petCount() });
      });
      results.push({ ok: true, id, name: pack.name || '' });
      // 逐只回报进度：一次启用多只时，用户需要知道"到哪一步了"，
      // 否则从点击到全部出现之间是一片空白（会以为没反应、重复点击）。
      sendLaunchProgress(e, { done: results.length, total: items.length, name: pack.name || '', ok: true });
    }
    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) {
      startCursorFeed();
      const mw = getMakerWindow();
      if (mw && !mw.isDestroyed()) mw.webContents.send('quick:state', { enabled: true, count: petCount() });
    }
    sendLaunchProgress(e, { done: items.length, total: items.length, name: '', ok: true, finished: true, failed: results.filter((r) => !r.ok).length });
    return { ok: okCount > 0, count: okCount, results };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
});

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
// 位置保存（节流）：宠物走动时会频繁发这个，不能每次都写盘。
// 每个宠物各自记「上次真正保存的时间/坐标」，只有间隔到了或移动够大才落盘。
const posSaveState = new Map();   // packId -> { lastSaveAt, lastX, lastY }
ipcMain.handle('pet:savePos', (e, { id, x, y } = {}) => {
  if (!id) return { ok: false, errors: ['缺少宠物 id'] };
  const st = posSaveState.get(id) || { lastSaveAt: 0, lastX: NaN, lastY: NaN };
  const dec = shouldSave({ now: Date.now(), lastSaveAt: st.lastSaveAt, lastX: st.lastX, lastY: st.lastY, x, y });
  if (!dec.save) return { ok: true, skipped: true, reason: dec.reason };
  savePosition(id, x, y);
  posSaveState.set(id, { lastSaveAt: Date.now(), lastX: x, lastY: y });
  return { ok: true, saved: true, x, y };
});
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
  // userData 就绪了 -> 重新装一次兜底，这次把错误也写进 crash.log。
  // （早期那次 logPath=null，因为那时 app.getPath('userData') 还不能用。）
  try { installCrashGuard({ logPath: defaultCrashLogPath(app.getPath('userData')) }); } catch {}
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
      // ★ 不用 dialog.showErrorBox：它会弹一个原生错误框跳到用户桌面上
      //   （用户明确抱怨过"窗口老是弹出来影响工作"）。
      //   改为写日志 + 控制台，然后安静退出。
      try { process.stderr.write('[PET_LOAD_FAILED] ' + (err && err.stack ? err.stack : err) + String.fromCharCode(10)); } catch {}
      try { console.error('无法加载宠物包: ' + (err && err.message ? err.message : err)); } catch {}
      app.exit(1);
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