// 桌宠制作器 - 渲染进程
import {
  floodCut, colorKeyCut, keepLargestComponent, trimBounds, cropData, flipHorizontal, alignFrames,
  looksLikeFlatBackground, assessCut, cutAdvice,
} from '../shared/imageops.js';
import { decodeGif, parseGifHeader } from '../shared/gif.js';
import { composeQBody } from './qcompose.js';
import { synthesizeMotion, MOTION_NAMES, motionCanvasSize } from '../shared/motion.js';
import { fitFrameLimit, fmtBytes } from '../shared/budget.js';
import { sanitizeSpeech, isSpeakable, pushSpeech } from '../shared/speech.js';
import { emptyState, normalizeState, isFavorite, toggleFavorite, filterLibrary, groupsOf } from '../shared/library.js';
import { detailRows, detailSummary, humanBytes } from '../shared/petdetail.js';
import { expandTemplate, unknownPlaceholders, templateHelp } from '../shared/nametemplate.js';
import { classifyDroppedFiles, isShareFile } from '../shared/dnd.js';
import { PERSONALITY_TEMPLATES, applyTemplate, templateFlags, matchTemplate } from '../shared/templates.js';
import { applyCustomTemplate, matchCustomTemplate } from '../shared/mytemplates.js';
import { renderLimbFrames } from './limbrender.js';
import { createHistory, estimateSnapshotBytes } from '../shared/history.js';
import { removeFrame, duplicateFrame, shiftFrame, moveFrame, uniqueFrameName } from '../shared/frames.js';
import { fitIntoCanvas, replaceFrameAt, canReplaceFrame } from '../shared/framereplace.js';
import { visibleWindow, thumbSize, dropTarget, insertIndexAt, stripLabel } from '../shared/filmstrip.js';
import { planSheet, sheetSummary } from '../shared/spritesheet.js';
import { mapKey, isTypingTarget } from '../shared/makerkeys.js';
import { progressText, summaryText, progressPct } from '../shared/launchprogress.js';
import { helpText } from '../shared/help.js';
import { normalizeCharacter, randomCharacter, PALETTES, paletteOf, DEFAULT_CHARACTER, characterFrames, DANCES } from '../shared/charstudio.js';
import { poseToCharacter, applyPoseToCharacter } from '../shared/posetochar.js';
import { colorsFromImageData } from '../shared/colors.js';
import { effectivePalette } from '../shared/charstudio.js';
import { renderCharacter, renderCharacterFrames } from './charrender.js';

const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = 'status ' + cls; }

const state = {
  frames: [],        // [{ original: ImageData, current: ImageData, name }]
  clips: [],         // 已保存的动作片段 [{ id, name, frames:[{data:ImageData,durationMs}], weight }]
  activeIdx: 0,
  playing: false,
  playT: 0,
  clickP: 0,
  animT: 0,
};
const MAX_EDGE = 1600;

// ---------------- 图片工具 ----------------
function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}
function drawToImageData(img) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, MAX_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
  return cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
}
function imageDataToDataURL(imgData) {
  const cv = document.createElement('canvas');
  cv.width = imgData.width; cv.height = imgData.height;
  cv.getContext('2d').putImageData(imgData, 0, 0);
  return cv.toDataURL('image/png');
}
function toImageData(res) { return new ImageData(new Uint8ClampedArray(res.data), res.width, res.height); }

// 把一帧绘制到统一画布尺寸（居中底部对齐）
function unifyToCanvas(frame, cw, ch) {
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const x = Math.round((cw - frame.width) / 2);
  const y = ch - frame.height;
  const tmp = document.createElement('canvas');
  tmp.width = frame.width; tmp.height = frame.height;
  tmp.getContext('2d').putImageData(frame, 0, 0);
  ctx.drawImage(tmp, x, y);
  return ctx.getImageData(0, 0, cw, ch);
}

// ---------------- 流水线 ----------------
function cutParams() {
  return { mode: $('#cutMode').value, tol: parseInt($('#cutTol').value, 10), feather: parseInt($('#cutFeather').value, 10) };
}

function processFrame(frame) {
  const { mode, tol, feather } = cutParams();
  // 容错：合成帧若缺 original，回退到 current（避免解引用 null 抛错）
  const src = frame.original || frame.current;
  if (!src) throw new Error('帧数据缺失，无法处理');
  let out;
  if (mode === 'flood') out = toImageData(floodCut(src.data, src.width, src.height, { tol, feather }));
  else if (mode === 'colorkey') out = toImageData(colorKeyCut(src.data, src.width, src.height, { tol, feather }));
  else out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);

  if ($('#chkLargest').checked && mode !== 'none') {
    out = toImageData(keepLargestComponent(out.data, out.width, out.height));
  }
  if ($('#chkFlip').checked) out = toImageData(flipHorizontal(out.data, out.width, out.height));
  return out;
}

/** 多帧归一：统一画布尺寸，并按所选方式对齐主体（消除抖动） */
/** 是否需要做多帧归一（统一画布 或 选了主体对齐） */
function needsFrameNormalize() {
  if (state.frames.length < 2) return false;
  const mode = $('#alignMode') ? $('#alignMode').value : 'none';
  return $('#chkUniform').checked || (mode && mode !== 'none');
}

function unifyAllFrames() {
  const mode = $('#alignMode') ? $('#alignMode').value : 'none';
  // 由「大头照 → Q 版身体」生成的帧已经精确对齐：
  // 再按 alignMode 移动主体会把固定的头挪下来、与四肢重叠（实测爬动模式）。
  // 因此这类帧只统一画布尺寸，不做主体对齐。
  const allComposed = state.frames.every((f) => f.qComposed || (f.current && f.current.qComposed));
  if (!allComposed && mode !== 'none' && state.frames.length > 1) {
    const res = alignFrames(
      state.frames.map((f) => ({ data: f.current.data, width: f.current.width, height: f.current.height, name: f.name, durationMs: f.durationMs })),
      { mode }
    );
    for (let i = 0; i < state.frames.length; i++) {
      const fr = res.frames[i];
      state.frames[i].current = new ImageData(new Uint8ClampedArray(fr.data), fr.width, fr.height);
    }
    return;
  }
  unifyCanvasOnly();
}

/** 只统一画布尺寸（不移动主体） */
function unifyCanvasOnly() {
  let cw = 0, ch = 0;
  for (const f of state.frames) { cw = Math.max(cw, f.current.width); ch = Math.max(ch, f.current.height); }
  for (const f of state.frames) if (f.current.width !== cw || f.current.height !== ch) f.current = unifyToCanvas(f.current, cw, ch);
}

async function rebuildAll() {
  if (!state.frames.length) return;
  setStatus('处理中…');
  await new Promise((r) => setTimeout(r, 10));

  try {
    for (const f of state.frames) f.current = processFrame(f);

    // 多帧归一：统一画布 + 主体对齐（消除播放抖动）
    if (needsFrameNormalize()) unifyAllFrames();

    state.activeIdx = Math.min(state.activeIdx, state.frames.length - 1);
    renderPreview();
    // 处理完成即记录「操作后」状态，重做才有目标可去。
    // 放在 rebuildAll 内部：所有破坏性操作最终都会汇集到这里，不必在每个调用点补。
    recordUndoAfter();
    const f0 = state.frames[0] && state.frames[0].current;
    setStatus(`已处理 ${state.frames.length} 帧` + (f0 ? ` · ${f0.width}×${f0.height}px` : ''), 'ok');
  } catch (e) {
    // 不吞异常：明确告知用户，避免状态卡在“处理中…”
    setStatus('处理失败：' + (e && e.message ? e.message : e), 'err');
  } finally {
    updateButtons();
  }
}

function renderPreview() {
  const f = state.frames[state.activeIdx];
  if (!f) return;
  $('#previewImg').src = imageDataToDataURL(f.current);
  $('#stageEmpty').hidden = true;
  $('#stageView').hidden = false;
  const badge = $('#frameBadge');
  badge.hidden = state.frames.length < 2;
  badge.textContent = `帧 ${state.activeIdx + 1}/${state.frames.length}`;
  renderCutHint();
  // 缩略图条与预览共用同一个入口：只要预览刷新，条上的高亮/窗口就跟着对
  if (typeof renderFilmstrip === 'function') renderFilmstrip();
}

/**
 * 抠图质量反馈：透明背景在棋盘格上不容易看出扣得干不干净，
 * 这里给出一句可操作的结论（该调大还是调小抠图强度）。
 * 只在「已上传图片」时显示，没图时不占位置。
 */
function renderCutHint() {
  const el = $('#cutHint');
  if (!el) return;
  const f = state.frames[state.activeIdx];
  if (!f || !f.current) { el.hidden = true; return; }

  const a = assessCut(f.current.data, f.current.width, f.current.height);
  const adv = cutAdvice(a);
  if (!adv.text) { el.hidden = true; return; }

  el.hidden = false;
  el.className = 'cut-hint ' + (adv.level === 'ok' ? 'ok' : 'warn');
  const pct = Math.round(a.coverage * 100);
  el.innerHTML = '<span class="ch-dot"></span><span>' + adv.text + '</span>'
    + '<span class="ch-meta">主体占 ' + pct + '%</span>';
}

function updateButtons() {
  const has = state.frames.length > 0;
  $('#btnCut').disabled = !has;
  $('#btnExport').disabled = !has;
  $('#btnTrim').disabled = !has;
  $('#btnReset').disabled = !has;
  $('#btnPreviewPet').disabled = !has;
  $('#btnAddFrames').disabled = !has;
  $('#btnClearFrames').disabled = !has;
  if ($('#btnSaveTpl')) $('#btnSaveTpl').disabled = !has;
  if ($('#btnExportShare')) $('#btnExportShare').disabled = !has;
  if ($('#btnExportGif')) $('#btnExportGif').disabled = !has;
  if ($('#btnExportSheet')) $('#btnExportSheet').disabled = !has;
  if (typeof poseUpdateButtons === 'function') poseUpdateButtons();
  const multi = state.frames.length > 1;
  $('#btnPrevFrame').disabled = !multi;
  $('#btnNextFrame').disabled = !multi;
  // 帧序列编辑按钮：有帧就能复制/删除；排序需要至少两帧
  if ($('#btnFrameClone')) $('#btnFrameClone').disabled = !has;
  if ($('#btnFrameDel')) $('#btnFrameDel').disabled = !has;
  if ($('#btnFrameUp')) $('#btnFrameUp').disabled = !multi;
  if ($('#btnFrameDown')) $('#btnFrameDown').disabled = !multi;
  if (typeof quickUpdateButtons === 'function') quickUpdateButtons();
}

// ---- GIF 拆帧 ----
function dataUrlToUint8(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function isGif(dataUrl, name) {
  return /\.gif$/i.test(name || '') || /^data:image\/gif/i.test(dataUrl || '');
}

/** 把 GIF 拆成多帧加入（保留每帧延迟），返回加入的帧数 */
async function addGifFrames(dataUrl, name) {
  const bytes = dataUrlToUint8(dataUrl);
  let maxFrames = parseInt($('#gifMaxFrames').value, 10) || 60;
  // 先估尺寸再定帧数上限（GIF 头里有逻辑画布尺寸）
  const hdr = (() => { try { return parseGifHeader(bytes); } catch { return null; } })();
  if (hdr) {
    const fit = fitFrameLimit(hdr.width, hdr.height, maxFrames);
    if (fit.clamped) {
      setStatus('⚠ ' + fit.limitReason, 'err');
      maxFrames = fit.frames;
    }
  }
  const g = decodeGif(bytes, { maxFrames });
  if (!g.frames.length) throw new Error('GIF 中没有可用的帧');
  // 逐帧转换为 ImageData（decodeGif 已给出完整画布）
  const made = [];
  for (let i = 0; i < g.frames.length; i++) {
    const f = g.frames[i];
    const full = new ImageData(new Uint8ClampedArray(f.data), g.width, g.height);
    // 缩放到 MAX_EDGE 以内
    const cv = document.createElement('canvas');
    let cw = g.width, ch = g.height;
    const s = Math.min(1, MAX_EDGE / Math.max(cw, ch));
    cw = Math.max(1, Math.round(cw * s)); ch = Math.max(1, Math.round(ch * s));
    cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const tmp = document.createElement('canvas');
    tmp.width = g.width; tmp.height = g.height;
    tmp.getContext('2d').putImageData(full, 0, 0);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(tmp, 0, 0, cw, ch);
    const d = cx.getImageData(0, 0, cw, ch);
    made.push({ original: d, current: d, name: `${name || 'gif'}#${i}`, durationMs: f.delayMs });
  }
  state.activeIdx = state.frames.length;   // 指向本批次第一帧
  state.frames.push(...made);
  return made.length;
}
/**
 * 自动抠图（上传即用）：只在检测到「四周有同色背景」时执行，
 * 避免误伤已抠好的透明 PNG。失败则保持原图。
 */
function autoCutIfNeeded(frame, name) {
  try {
    const { data, width, height } = frame.current || frame;
    if (!data || !width || !height) return frame;

    // 判据：边缘颜色是否「连续」（纯色或渐变都算），见 shared/imageops.js 的说明。
    // 旧实现只看「相对首像素的平均色差」阈 36，实测会把浅色渐变（墙面/天空 —— 用户最常拍的）
    // 误判成复杂背景而跳过；但 floodCut 对这类图其实完全可用。
    const look = looksLikeFlatBackground(data, width, height);
    if (!look.ok) return frame;

    // 执行边缘漫水抠图（容差偏保守，只删与边界连通的同色区域）
    // 容差 38（与面板默认一致）：只删与边界连通的同色背景，不误伤主体内部同色区域。
    const out = floodCut(data, width, height, { tol: 38, feather: 14 });

    // 兜底：若几乎没扣掉任何东西，说明本来就不像"带背景的照片"（比如主体占满整幅），
    // 保持原图，避免用户看到一个"什么都没变的抠图结果"而困惑。
    let transparent = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] < 16) transparent++;
    const ratio = transparent / (out.width * out.height);
    if (ratio < 0.05) return frame;

    return { current: { width: out.width, height: out.height, data: out.data }, __autoCut: true };
  } catch (err) {
    console.warn('[autoCut] 跳过：' + (err && err.message ? err.message : err));
    return frame;
  }
}

/**
 * 把一张新图规整成"目标画布尺寸"的 ImageData：等比缩放后居中放置。
 * 单帧替换必须做这一步 —— 新图尺寸通常和原帧不同，直接换会让整段动画忽大忽小（抖动）。
 */
async function frameDataFromImage(dataUrl, cw, ch) {
  const img = await loadImage(dataUrl);
  const fit = fitIntoCanvas(img.naturalWidth, img.naturalHeight, cw, ch);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
  return ctx.getImageData(0, 0, cw, ch);
}

/**
 * 单帧替换：把一张新图拖到缩略图上，只替换那一帧。
 * 关键点：
 *   1) 画布尺寸沿用原帧 -> 播放不抖动；
 *   2) 只动这一帧 -> 其它帧引用原样保留；
 *   3) 替换前 recordUndo() -> 可撤销。
 */
async function replaceFrameWithFile(index, file) {
  const check = canReplaceFrame(state.frames, index, file);
  if (!check.ok) { setStatus('无法替换：' + check.reason, 'err'); return; }
  const target = state.frames[index];
  const cw = target.current.width, ch = target.current.height;
  setStatus('正在替换第 ' + (index + 1) + ' 帧…');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('读取文件失败'));
      r.readAsDataURL(file);
    });
    const d = await frameDataFromImage(dataUrl, cw, ch);
    const f = { original: d, current: d, name: file.name || ('frame' + (index + 1) + '.png') };
    // 与导入路径一致：检测到纯色/渐变背景就自动抠一次
    const cut = autoCutIfNeeded(f, file.name);
    if (cut && cut.__autoCut) { f.current = cut.current; f.__autoCut = true; }
    const r = replaceFrameAt(state.frames, index, f);
    if (!r.replaced) { setStatus('替换失败：目标帧不存在', 'err'); return; }
    recordUndo();                 // 必须在改动 state.frames 之前记录
    state.frames = r.frames;
    FS.thumbCache.clear();        // 帧对象换了，旧缩略图缓存作废
    state.activeIdx = r.activeIdx;
    syncFrameMeta();
    renderPreview();
    updateButtons();
    recordUndoAfter();
    setStatus('✅ 已替换第 ' + (index + 1) + ' 帧（画布保持 ' + cw + '×' + ch + '，不会抖动）', 'ok');
  } catch (err) {
    // 绝不静默吞异常（历史教训：空 catch 藏过 ReferenceError，白查几十分钟）
    console.warn('[frameReplace] 失败：' + (err && err.message ? err.message : err));
    setStatus('替换失败：' + String((err && err.message) || err), 'err');
  }
}

async function addFrameFromDataUrl(dataUrl, name) {
  if (isGif(dataUrl, name)) return addGifFrames(dataUrl, name); // 返回帧数
  const img = await loadImage(dataUrl);
  const d = drawToImageData(img);
  const f = { original: d, current: d, name: name || 'frame' };
  // 上传即用：若检测到纯色背景，自动抠一次，避免桌面上出现"带白边的方块宠物"
  const cut = autoCutIfNeeded(f, name);
  if (cut && cut.__autoCut) {
    f.current = cut.current;
    f.__autoCut = true;
    // 让快速条的「抠图」滑块可用（用户可继续微调）
    const qt = $('#qCutTol');
    if (qt) { qt.disabled = false; const t = $('#cutTol'); if (t) qt.value = t.value; const tv = $('#qCutTolV'); if (tv) tv.textContent = qt.value; }
  }
  state.frames.push(f);
  state.activeIdx = state.frames.length - 1;
  return 1;
}

// ---------------- 预览动画循环 ----------------
function loop(ts) {
  const img = $('#previewImg');
  if (state.frames.length) {
    const speed = parseInt($('#idleSpeed').value, 10) / 100;
    if (state.playing && state.frames.length > 1) {
      const fps = parseInt($('#fps').value, 10);
      state.playT += 1 / 60;
      if (state.playT >= 1 / fps) {
        state.playT = 0;
        state.activeIdx = (state.activeIdx + 1) % state.frames.length;
        renderPreview();
      }
    }
    state.animT += 0.016 * speed;
    const t = state.animT;
    const mode = $('#idleAnim').value;
    let tf = '';
    if (!state.playing) {
      if (mode === 'breathe') { const s = Math.sin(t * 2.2); tf = `scale(${1 - s * 0.015}, ${1 + s * 0.03})`; }
      else if (mode === 'sway') tf = `rotate(${Math.sin(t * 1.6) * 3.5}deg)`;
    }
    if (state.clickP > 0) {
      state.clickP = Math.max(0, state.clickP - 0.05 * speed);
      const p = state.clickP, k = Math.sin(p * Math.PI);
      const click = $('#clickAnim').value;
      if (click === 'bounce') tf += ` translateY(${-14 * k}px) scale(${1 + 0.08 * k})`;
      else if (click === 'jump') tf += ` translateY(${-30 * k}px)`;
      else if (click === 'shake') tf += ` rotate(${Math.sin(p * 40) * 10 * p}deg)`;
      else if (click === 'spin') tf += ` rotate(${(1 - p) * 360}deg)`;
    }
    img.style.transform = tf || 'none';
    const sc = parseInt($('#scale').value, 10) / 100;
    const box = Math.round(88 * Math.min(1, sc + 0.4));
    img.style.maxWidth = box + '%';
    img.style.maxHeight = box + '%';
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------- 表单 ----------------
function readPack() {
  const frames = state.frames.map((f, i) => ({ file: 'frame_' + String(i).padStart(3, '0') + '.png', durationMs: Math.round(1000 / parseInt($('#fps').value, 10)) }));
  if (frames.length === 1) frames[0].file = 'pet.png';
  return {
    schema: 2,
    id: 'pet-' + Date.now().toString(36),
    name: $('#petName').value || '我的桌宠',
    author: $('#petAuthor').value || '',
    createdAt: new Date().toISOString(),
    frames,
    // 已生成的动作片段（可多个）。为空数组时与老包行为一致。
    clips: state.clips.map((c) => ({
      id: c.id,
      name: c.name,
      frames: c.frames.map((f, i) => ({ file: 'clip_' + c.id + '_' + String(i).padStart(3, '0') + '.png', durationMs: f.durationMs })),
      weight: c.weight,
    })),
    canvas: { width: state.frames[0] ? state.frames[0].current.width : 0, height: state.frames[0] ? state.frames[0].current.height : 0 },
    render: { scale: parseInt($('#scale').value, 10) / 100, flip: false },
    animation: {
      idle: $('#idleAnim').value,
      idleSpeed: parseInt($('#idleSpeed').value, 10) / 100,
      // 多动作片段的切换间隔（秒）。0 = 用运行时默认（4~12 秒随机）。
      clipIntervalSec: parseInt($('#clipInterval').value, 10) / 10,
      fps: parseInt($('#fps').value, 10),
      click: $('#clickAnim').value,
      hover: $('#hoverAnim').value,
    },
    physics: {
      gravity: parseInt($('#gravity').value, 10) / 100,
      bounce: parseInt($('#bounce').value, 10) / 100,
      friction: parseInt($('#friction').value, 10) / 1000,
      roam: $('#roam').checked,
      roamSpeed: parseInt($('#roamSpeed').value, 10) / 100,
      throwScale: parseInt($('#throwScale').value, 10) / 100,
    },
    bubble: {
      enabled: $('#bubbleEnabled').checked,
      lines: $('#bubbleLines').value.split('\n').map((s) => s.trim()).filter(Boolean),
      intervalSec: parseInt($('#interval').value, 10),
      durationSec: parseInt($('#duration').value, 10) / 10,
    },
    // personality 供运行时「对话脑」决定口吻（活泼/温顺/贪睡/粘人/静默）。
    // 之前这里没有这个字段 -> 性格模板选了也传不到宠物，对话永远用默认口吻。
    behavior: {
      startCorner: $('#corner').value,
      keepAbove: $('#keepAbove').checked,
      personality: currentTemplate || 'default',
      // 省电模式：静止/打瞌睡降帧。默认开；关掉就一律满帧（更顺但更费电）。
      powerSave: $('#chkPowerSave') ? $('#chkPowerSave').checked : true,
      // 作息：跟着真实时间改变行为倾向（默认开）。
      schedule: $('#chkSchedule') ? $('#chkSchedule').checked : true,
    },
  };
}

function currentImages() {
  return state.frames.map((f) => ({ dataUrl: imageDataToDataURL(f.current), durationMs: Math.round(1000 / parseInt($('#fps').value, 10)) }));
}

/** 片段帧的图片数据（按 clipId 分组），导出时与 pack.clips 一起写进包 */
function currentClipImages() {
  const out = {};
  for (const c of state.clips) {
    out[c.id] = c.frames.map((f) => ({ dataUrl: imageDataToDataURL(f.data), durationMs: f.durationMs }));
  }
  return out;
}

function applyPack(pack) {
  $('#petName').value = pack.name || '我的桌宠';
  $('#petAuthor').value = pack.author || '';
  if (pack.render) $('#scale').value = Math.round((pack.render.scale ?? 0.3) * 100);
  if (pack.animation && $('#clipInterval')) $('#clipInterval').value = String(Math.round((pack.animation.clipIntervalSec || 0) * 10));
  if (pack.animation) {
    $('#idleAnim').value = pack.animation.idle || 'breathe';
    $('#idleSpeed').value = Math.round((pack.animation.idleSpeed ?? 1) * 100);
    $('#fps').value = pack.animation.fps ?? 12;
    $('#clickAnim').value = pack.animation.click || 'bounce';
    $('#hoverAnim').value = pack.animation.hover || 'grow';
  }
  if (pack.physics) {
    $('#gravity').value = Math.round((pack.physics.gravity ?? 1.2) * 100);
    $('#bounce').value = Math.round((pack.physics.bounce ?? 0.55) * 100);
    $('#friction').value = Math.round((pack.physics.friction ?? 0.985) * 1000);
    $('#roam').checked = pack.physics.roam !== false;
    $('#roamSpeed').value = Math.round((pack.physics.roamSpeed ?? 1) * 100);
    $('#throwScale').value = Math.round((pack.physics.throwScale ?? 1) * 100);
  }
  if (pack.bubble) {
    $('#bubbleEnabled').checked = pack.bubble.enabled !== false;
    $('#bubbleLines').value = (pack.bubble.lines || []).join('\n');
    $('#interval').value = pack.bubble.intervalSec ?? 14;
    $('#duration').value = Math.round((pack.bubble.durationSec ?? 3.2) * 10);
  }
  if (pack.behavior) {
    if (pack.behavior.personality) currentTemplate = pack.behavior.personality;
    if ($('#chkPowerSave') && pack.behavior.powerSave !== undefined) $('#chkPowerSave').checked = pack.behavior.powerSave !== false;
    if ($('#chkSchedule') && pack.behavior.schedule !== undefined) $('#chkSchedule').checked = pack.behavior.schedule !== false;
    $('#corner').value = pack.behavior.startCorner || 'bottom-right';
    $('#keepAbove').checked = pack.behavior.keepAbove !== false;
  }
  syncLabels();
}

function syncLabels() {
  $('#cutTolV').textContent = $('#cutTol').value;
  $('#cutFeatherV').textContent = $('#cutFeather').value;
  $('#scaleV').textContent = $('#scale').value + '%';
  $('#idleSpeedV').textContent = (parseInt($('#idleSpeed').value, 10) / 100).toFixed(1) + '×';
  $('#fpsV').textContent = $('#fps').value;
  $('#roamSpeedV').textContent = (parseInt($('#roamSpeed').value, 10) / 100).toFixed(1) + '×';
  $('#gravityV').textContent = (parseInt($('#gravity').value, 10) / 100).toFixed(1);
  $('#bounceV').textContent = (parseInt($('#bounce').value, 10) / 100).toFixed(2);
  $('#frictionV').textContent = (parseInt($('#friction').value, 10) / 1000).toFixed(3);
  $('#throwV').textContent = (parseInt($('#throwScale').value, 10) / 100).toFixed(1) + '×';
  $('#intervalV').textContent = $('#interval').value + 's';
  $('#durationV').textContent = (parseInt($('#duration').value, 10) / 10).toFixed(1) + 's';
  if ($('#aiThreshV')) $('#aiThreshV').textContent = (parseInt($('#aiThresh').value, 10) / 100).toFixed(2);
  if ($('#motionFramesV')) $('#motionFramesV').textContent = $('#motionFrames').value;
  if ($('#motionAmpV')) $('#motionAmpV').textContent = $('#motionAmp').value + '%';
  if ($('#clipIntervalV')) {
    const v = parseInt($('#clipInterval').value, 10);
    $('#clipIntervalV').textContent = v === 0 ? '自动' : (v / 10).toFixed(1) + 's';
  }
}

// ---------------- 事件 ----------------
function bindRange(id, cb) { const el = $('#' + id); el.addEventListener('input', () => { syncLabels(); if (cb) cb(); }); }

$('#btnChoose').onclick = async () => {
  const r = await window.api.openImage();
  if (r && r.dataUrl) { await addFrameFromDataUrl(r.dataUrl, r.name); await rebuildAll(); }
};
$('#btnAddFrames').onclick = async () => {
  const list = await window.api.openImages();
  if (!list || !list.length) return;
  const wasEmpty = state.frames.length === 0;
  for (const it of list) await addFrameFromDataUrl(it.dataUrl, it.name);
  if (wasEmpty) { state.activeIdx = 0; await rebuildAll(); }
  else await rebuildAll();
};
$('#btnClearFrames').onclick = () => {
  recordUndo();
  state.frames = []; state.activeIdx = 0;
  $('#stageEmpty').hidden = false; $('#stageView').hidden = true; $('#frameBadge').hidden = true;
  renderFilmstrip();
  updateButtons();
  recordUndoAfter();   // 不记的话：能撤销，但重做回不来
  setStatus('已清空');
};
$('#btnCut').onclick = () => { recordUndo(); rebuildAll(); };
$('#btnTrim').onclick = async () => {
  if (!state.frames.length) return;
  recordUndo();
  for (const f of state.frames) {
    const b = trimBounds(f.current.data, f.current.width, f.current.height, { pad: 2 });
    if (b.w !== f.current.width || b.h !== f.current.height) f.current = toImageData(cropData(f.current.data, f.current.width, f.current.height, b));
  }
  renderPreview();
  recordUndoAfter();
  setStatus('已裁边', 'ok');
};
$('#btnReset').onclick = async () => {
  recordUndo();
  // 若当前是「生成动画」产出的帧，回退到生成前的源帧
  const gen = state.frames.find((f) => f.generatedFrom);
  if (gen && gen.motionSource) {
    state.frames = [{ original: gen.motionSource, current: gen.motionSource, name: gen.generatedFrom }];
    state.activeIdx = 0;
    renderPreview();
    updateButtons();
    recordUndoAfter();
    setStatus('已恢复到生成动画前的原图', 'ok');
    return;
  }
  for (const f of state.frames) if (f.original) f.current = f.original;
  await rebuildAll();
};
$('#chkFlip').onchange = () => { recordUndo(); rebuildAll(); };
$('#chkUniform').onchange = () => rebuildAll();
$('#alignMode').onchange = () => rebuildAll();
$('#chkLargest').onchange = () => rebuildAll();
$('#chkPlay').onchange = (e) => { state.playing = e.target.checked; if (!state.playing) renderPreview(); };

$('#btnPrevFrame').onclick = () => { if (state.frames.length) { state.activeIdx = (state.activeIdx - 1 + state.frames.length) % state.frames.length; renderPreview(); } };
$('#btnNextFrame').onclick = () => { if (state.frames.length) { state.activeIdx = (state.activeIdx + 1) % state.frames.length; renderPreview(); } };

// ---- 帧序列编辑：删除 / 复制 / 排序 ----
// 这三件事以前只能靠"全部重来"，做多帧动画时非常卡人。
// 逻辑都走 shared/frames.js（纯函数、有单测），这里只管接线与状态同步。
function applyFrameOp(op) {
  if (!state.frames.length) return;
  recordUndo();
  const r = op();
  state.frames = r.frames;
  // 帧数组变了 -> 缩略图缓存的 key(帧对象) 可能已失效，清掉避免显示错图
  FS.thumbCache.clear();
  state.activeIdx = r.activeIdx;
  syncFrameMeta();
  renderPreview();
  updateButtons();
  // 帧操作也必须记「操作后」，否则重做会跳到错误状态（实测：Ctrl+← 排序后重做回不去）
  recordUndoAfter();
}

/** 帧名要保证唯一：包内是按文件名寻址的，重名会静默丢帧 */
function syncFrameMeta() {
  const used = [];
  for (const f of state.frames) {
    f.name = uniqueFrameName(used, String(f.name || 'frame').replace(/\.[a-z0-9]+$/i, ''), '.png');
    used.push(f.name);
  }
}

$('#btnFrameDel').onclick = () => applyFrameOp(() => removeFrame(state.frames, state.activeIdx, state.activeIdx));
$('#btnFrameClone').onclick = () => applyFrameOp(() => duplicateFrame(state.frames, state.activeIdx, state.activeIdx, (f) => ({
  original: f.original ? toImageData({ data: new Uint8ClampedArray(f.original.data), width: f.original.width, height: f.original.height }) : null,
  current: toImageData({ data: new Uint8ClampedArray(f.current.data), width: f.current.width, height: f.current.height }),
  name: f.name,
  generatedFrom: f.generatedFrom,
})));
$('#btnFrameUp').onclick = () => applyFrameOp(() => shiftFrame(state.frames, state.activeIdx, state.activeIdx, -1));
$('#btnFrameDown').onclick = () => applyFrameOp(() => shiftFrame(state.frames, state.activeIdx, state.activeIdx, 1));

// 「抠图」页的容差/羽化：拖动时也实时预览（之前必须点"应用到所有帧"才看得到，
// 与快速条的实时行为不一致，用户会以为滑块没生效）。带节流避免拖动时卡顿。
let cutPreviewTimer = 0;
const scheduleCutPreview = () => {
  if (!state.frames.length) return;
  clearTimeout(cutPreviewTimer);
  cutPreviewTimer = setTimeout(() => { rebuildAll(); }, 160);
};
// ---------------- 性格模板 ----------------
// 新手面对 20+ 个参数（动画/物理/气泡/行为）不知道该配成什么。
// 模板把这些打包成几个一拍即合的预设；只覆盖「性格」相关的字段，
// 不碰用户已上传的图片、画布与外观（见 shared/templates.js 的说明）。
let currentTemplate = null;
let currentMyTemplate = null;   // 高亮的「我的模板」id（与内置模板互斥）

/** 把模板的数值写回界面控件（必须覆盖模板涉及的每一项，否则界面与实际不一致） */
function writeTemplateToUi(t) {
  const p = t.patch || {};
  const setVal = (id, v) => { const el = $('#' + id); if (el && v !== undefined) el.value = String(v); };
  const setChk = (id, v) => { const el = $('#' + id); if (el && v !== undefined) el.checked = !!v; };
  const setSel = (id, v) => { const el = $('#' + id); if (el && v !== undefined) el.value = v; };

  // animation
  const a = p.animation || {};
  setSel('idleAnim', a.idle);
  setVal('idleSpeed', a.idleSpeed !== undefined ? Math.round(a.idleSpeed * 100) : undefined);
  setVal('fps', a.fps);
  setSel('clickAnim', a.click);
  setSel('hoverAnim', a.hover);

  // physics（注意界面的单位换算：重力/弹性 ×100，摩擦 ×1000）
  const ph = p.physics || {};
  setVal('gravity', ph.gravity !== undefined ? Math.round(ph.gravity * 100) : undefined);
  setVal('bounce', ph.bounce !== undefined ? Math.round(ph.bounce * 100) : undefined);
  setVal('friction', ph.friction !== undefined ? Math.round(ph.friction * 1000) : undefined);
  setChk('roam', ph.roam);
  setVal('roamSpeed', ph.roamSpeed !== undefined ? Math.round(ph.roamSpeed * 100) : undefined);
  setVal('throwScale', ph.throwScale !== undefined ? Math.round(ph.throwScale * 100) : undefined);

  // bubble
  const b = p.bubble || {};
  setChk('bubbleEnabled', b.enabled);
  setVal('interval', b.intervalSec);
  setVal('duration', b.durationSec);

  // behavior（bugChase 在快速条上）
  const fl = t.flags || {};
  setChk('chkBug', fl.bugChase !== undefined ? fl.bugChase : p.behavior && p.behavior.bugChase);
  setChk('chkWalk', fl.walk);
  setChk('chkHop', fl.hop);
  setChk('chkLook', fl.look);

  // 同步所有数值标签 + 让改动生效
  syncLabels();
  if (typeof quickUpdateButtons === 'function') quickUpdateButtons();
}

/** 套用一个模板：改界面控件 + 立即重建预览（如果正在跑桌宠，也会同步过去） */
/**
 * 套用模板后的共同副作用：重建预览 + 把配置推给正在运行的桌宠。
 * 抽出来是因为内置模板与「我的模板」都要走同一条路 ——
 * 早期只在 quickEnable 里推 pack，忘了「走路/跳跃/看向鼠标/抓虫子」是独立 IPC 通道，
 * 结果界面变了、桌上的宠物却没变（实测踩过）。
 */
async function applyToPet(t) {
  if (state.frames.length) await rebuildAll();
  try {
    if (window.api.quickIsEnabled) {
      const r0 = await window.api.quickIsEnabled();
      if (r0 && r0.enabled) {
        await window.api.quickEnable(quickPack(), quickFrames());
        const walk = $('#chkWalk'), hop = $('#chkHop'), look = $('#chkLook'), bug = $('#chkBug');
        if (walk && window.api.quickSetWalk) await window.api.quickSetWalk(walk.checked);
        if (hop && window.api.quickSetHop) await window.api.quickSetHop(hop.checked);
        if (look && window.api.quickSetLook) await window.api.quickSetLook(look.checked);
        if (bug && window.api.quickSetBugChase) await window.api.quickSetBugChase(bug.checked);
      }
    }
  } catch {}
  void t;
}

async function useTemplate(id) {
  const t = PERSONALITY_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  currentTemplate = id;
  currentMyTemplate = null;
  writeTemplateToUi(t);
  await applyToPet(t);
  markTemplateButtons();
  setStatus('已套用「' + t.name + '」：' + t.desc, 'ok');
}

/** 高亮当前模板（用户手改过参数就不再高亮，避免误导） */
function markTemplateButtons() {
  const box = $('#qbTemplates');
  if (!box) return;
  for (const b of box.querySelectorAll('button[data-tpl]')) {
    b.classList.toggle('on', b.dataset.tpl === currentTemplate);
  }
  for (const b of box.querySelectorAll('button[data-mytpl]')) {
    b.classList.toggle('on', b.dataset.mytpl === currentMyTemplate);
  }
}

function initTemplates() {
  const box = $('#qbTemplates');
  if (!box) return;
  for (const t of PERSONALITY_TEMPLATES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qb-tpl';
    btn.dataset.tpl = t.id;
    btn.title = t.desc + '（不会改动你上传的图片与画布）';
    btn.innerHTML = '<span class="tpl-emoji">' + t.emoji + '</span>' + escapeHtml(t.name);
    btn.onclick = () => useTemplate(t.id);
    box.appendChild(btn);
  }
  renderMyTemplates();
  markTemplateButtons();
}

// ---------------- 我的模板（自定义，可导出分享） ----------------
let myTemplates = [];

async function loadMyTemplates() {
  try {
    const r = await window.api.templatesList();
    myTemplates = (r && r.templates) || [];
  } catch { myTemplates = []; }
  renderMyTemplates();
  markTemplateButtons();
}

function renderMyTemplates() {
  const box = $('#qbTemplates');
  if (!box) return;
  for (const b of [...box.querySelectorAll('button[data-mytpl]')]) b.remove();
  const anchor = box.querySelector('.qb-tpl-label');
  for (const t of myTemplates) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qb-tpl qb-tpl-mine';
    btn.dataset.mytpl = t.id;
    btn.title = t.name + '（我的模板 · 右键可删除/导出）';
    btn.innerHTML = '<span class="tpl-emoji">' + (t.emoji || '⭐') + '</span>' + escapeHtml(t.name);
    btn.onclick = () => useMyTemplate(t.id);
    btn.oncontextmenu = (e) => { e.preventDefault(); myTemplateMenu(t); };
    if (anchor) anchor.after(btn); else box.appendChild(btn);
  }
}

function useMyTemplate(id) {
  const t = myTemplates.find((x) => x.id === id);
  if (!t) return;
  currentTemplate = null;
  currentMyTemplate = id;

  // 套用到界面：与内置模板同样的字段映射
  const synth = { patch: t.patch || {}, flags: t.flags || {} };
  writeTemplateToUi(synth);

  applyToPet(synth);
  markTemplateButtons();
  setStatus('已套用我的模板「' + t.name + '」', 'ok');
}

function myTemplateMenu(t) {
  const act = prompt('模板「' + t.name + '」\n\n输入 1 = 重命名\n输入 2 = 导出为文件（发给朋友）\n输入 3 = 删除\n留空取消', '1');
  if (act === '1') {
    const name = prompt('新的模板名：', t.name);
    if (name === null) return;
    window.api.templatesRename(t.id, name).then((r) => {
      if (r && r.templates) { myTemplates = r.templates; renderMyTemplates(); markTemplateButtons(); setStatus('已重命名', 'ok'); }
    });
  } else if (act === '2') {
    window.api.templatesExport(t.id).then((r) => {
      if (r && r.canceled) return;
      setStatus(r && r.ok ? '✅ 模板已导出：' + r.path : '导出失败：' + ((r && r.errors) || []).join(';'), r && r.ok ? 'ok' : 'err');
    });
  } else if (act === '3') {
    if (!confirm('确定删除我的模板「' + t.name + '」？')) return;
    window.api.templatesRemove(t.id).then((r) => {
      if (r && r.templates) { myTemplates = r.templates; renderMyTemplates(); markTemplateButtons(); setStatus('已删除模板', 'ok'); }
    });
  }
}

function currentFlags() {
  return {
    walk: !!($('#chkWalk') && $('#chkWalk').checked),
    hop: !!($('#chkHop') && $('#chkHop').checked),
    look: !!($('#chkLook') && $('#chkLook').checked),
    bug: !!($('#chkBug') && $('#chkBug').checked),
  };
}

async function saveMyTemplate() {
  if (!state.frames.length) { setStatus('请先导入图片再保存模板', 'err'); return; }
  const name = prompt('给这个模板起个名字：', '我的模板');
  if (name === null) return;
  const r = await window.api.templatesSave(readPack(), name, currentFlags());
  if (!r || !r.ok) { setStatus('保存失败：' + ((r && r.errors) || []).join(';'), 'err'); return; }
  myTemplates = r.templates || myTemplates;
  renderMyTemplates();
  currentTemplate = null;
  currentMyTemplate = r.id;
  markTemplateButtons();
  setStatus('✅ 已存为我的模板「' + (r.name || name) + '」', 'ok');
}

async function importMyTemplate() {
  const r = await window.api.templatesImport();
  if (!r || r.canceled) return;
  if (!r.ok) { setStatus('导入失败：' + ((r.errors) || []).join(';'), 'err'); return; }
  myTemplates = r.templates || myTemplates;
  renderMyTemplates();
  markTemplateButtons();
  setStatus('✅ 已导入 ' + (r.count || 1) + ' 个模板', 'ok');
}

initTemplates();
if ($('#btnSaveTpl')) $('#btnSaveTpl').onclick = saveMyTemplate;
if ($('#btnImportTpl')) $('#btnImportTpl').onclick = importMyTemplate;
loadMyTemplates();
bindRange('cutTol', scheduleCutPreview);
bindRange('cutFeather', scheduleCutPreview);
bindRange('scale'); bindRange('idleSpeed');
bindRange('fps', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('gifMaxFrames'); bindRange('roamSpeed', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('gravity', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('bounce', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('friction', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('throwScale', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('interval', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('duration', () => { currentTemplate = null; currentMyTemplate = null; markTemplateButtons(); });
bindRange('clipInterval');

$('#previewImg').onclick = () => { state.clickP = 1; };

$('#btnPreviewPet').onclick = async () => {
  if (!state.frames.length) return;
  setStatus('正在启动桌面预览…');
  const r = await window.api.launchPreview(readPack(), currentImages(), currentClipImages());
  setStatus(r.ok ? '预览已启动（查看屏幕右下角）' : '预览失败：' + (r.errors || []).join(';'), r.ok ? 'ok' : 'err');
};
$('#btnExport').onclick = async () => {
  if (!state.frames.length) return;
  const r = await window.api.savePack(readPack(), currentImages(), $('#petName').value || 'mypet', currentClipImages());
  if (r.canceled) { setStatus('已取消'); return; }
  if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
  setStatus('✅ 已导出：' + r.path, 'ok');
  // 导出的 .petpack 是单文件，可直接发给朋友 / 传到群里。
  // 这里主动把文件夹打开并说明，让"分享"这一步不需要用户自己找路径。
  const name = $('#petName').value || '我的桌宠';
  showShareHint(r.path, name);
};

/** 导出成功后的分享引导：定位文件 + 说明对方怎么用 */
function showShareHint(filePath, petName) {
  const modal = $('#shareModal');
  if (!modal) return;
  const pth = $('#sharePath');
  if (pth) pth.textContent = filePath;
  const nm = $('#shareName');
  if (nm) nm.textContent = petName;
  modal.hidden = false;
}
// ---- 分享引导弹窗 ----
if ($('#shareReveal')) $('#shareReveal').onclick = () => window.api.revealFile($('#sharePath').textContent);
// 复制路径：很多人分享时是"先复制路径再粘贴到聊天框"，比让他们去文件夹里找快得多
if ($('#shareCopy')) $('#shareCopy').onclick = async () => {
  const btn = $('#shareCopy');
  const text = $('#sharePath').textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '✅ 已复制';
    setTimeout(() => { btn.textContent = '📋 复制文件路径'; }, 1800);
  } catch {
    // 剪贴板不可用时退化为选中文本，用户可手动 Ctrl+C
    const r = document.createRange();
    r.selectNodeContents($('#sharePath'));
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    btn.textContent = '请按 Ctrl+C';
    setTimeout(() => { btn.textContent = '📋 复制文件路径'; }, 2600);
  }
};
if ($('#shareClose')) $('#shareClose').onclick = () => { $('#shareModal').hidden = true; };
if ($('#shareModal')) $('#shareModal').onclick = (e) => { if (e.target.id === 'shareModal') $('#shareModal').hidden = true; };

// 导出「零依赖分享页」：一个自包含 HTML。对方双击用浏览器打开就能看到桌宠动起来，
// 不需要装任何东西、不需要服务器、不需要网络（图片与宠物包全部内嵌在文件里）。
$('#btnExportShare').onclick = async () => {
  if (!state.frames.length) { setStatus('请先导入图片', 'err'); return; }
  setStatus('正在生成分享页…');
  const r = await window.api.exportShareHtml(readPack(), currentImages(), currentClipImages());
  if (r.canceled) { setStatus('已取消'); return; }
  if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
  setStatus('✅ 分享页已导出（' + Math.round(r.bytes / 1024) + ' KB）：' + r.path, 'ok');
  showShareHint(r.path, $('#petName').value || '我的桌宠');
};

// 界面用的网格预估（直接复用 shared 的纯函数，保证与实际导出一致）
function planSheetUI(n, w, h) { return planSheet(n, w, h); }

// 导出 Sprite Sheet 的界面接线。
// 导出前先把"会得到多大的图、几行几列"告诉用户 —— 引擎对纹理尺寸有上限，
// 用户需要提前知道（尤其是多帧大图时会超 4096）。
if ($('#btnExportSheet')) $('#btnExportSheet').onclick = async () => {
  if (!state.frames.length) { setStatus('请先导入图片', 'err'); return; }
  const f0 = state.frames[0].current;
  const plan = planSheetUI(state.frames.length, f0.width, f0.height);
  const warn = plan.oversized ? '\n\n⚠ 这张图会比 4096px 还大，部分引擎/显卡不支持这么大的纹理。' : '';
  if (!window.confirm('将导出 Sprite Sheet：\n\n'
    + '· ' + state.frames.length + ' 帧拼成 ' + plan.cols + '×' + plan.rows + ' 网格\n'
    + '· 图片 ' + plan.width + '×' + plan.height + ' 像素\n'
    + '· 同时生成一份 JSON（含每帧坐标与时长）\n\n'
    + '引擎读 JSON 就能直接播放。继续吗？' + warn)) return;

  const btn = $('#btnExportSheet');
  btn.disabled = true;
  setStatus('正在拼接 Sprite Sheet…');
  try {
    const useRaw = !!($('#chkGifDelay') && $('#chkGifDelay').checked);
    const fpsDelay = Math.round(1000 / parseInt($('#fps').value, 10));
    const frames = state.frames.map((f) => ({
      dataUrl: imageDataToDataURL(f.current),
      durationMs: (useRaw && f.durationMs) ? f.durationMs : fpsDelay,
    }));
    const r = await window.api.exportSpriteSheet(frames, f0.width, f0.height, $('#petName').value || 'pet');
    btn.disabled = false;
    if (r.canceled) { setStatus('已取消'); return; }
    if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
    setStatus('✅ Sprite Sheet 已导出（' + r.frames + ' 帧 · ' + r.sheet.width + '×' + r.sheet.height
      + ' · ' + (r.bytes / 1024).toFixed(0) + ' KB）：' + r.png + ' 与同名 .json', 'ok');
  } catch (err) {
    btn.disabled = false;
    setStatus('导出异常：' + String(err.message || err), 'err');
  }
};
// 导出 GIF 动图：把当前帧序列编码成一张 GIF（对方不装工具也能看，可直接发表情包）
if ($('#btnExportGif')) $('#btnExportGif').onclick = async () => {
  if (!state.frames.length) { setStatus('请先导入图片', 'err'); return; }
  const btn = $('#btnExportGif');
  btn.disabled = true;
  setStatus('正在编码 GIF…');
  try {
    // 每帧延迟优先用 GIF 原始延迟（若当前是导入的 GIF），否则用帧率换算
    const useRaw = !!($('#chkGifDelay') && $('#chkGifDelay').checked);
    const fpsDelay = Math.round(1000 / parseInt($('#fps').value, 10));
    const frames = state.frames.map((f, i) => ({
      dataUrl: imageDataToDataURL(f.current),
      durationMs: (useRaw && f.durationMs) ? f.durationMs : fpsDelay,   // GIF 拆帧时把原始延迟存在 durationMs 上
    }));
    const r = await window.api.exportGif(frames, 0, 0, parseInt($('#fps').value, 10), $('#petName').value || 'pet');
    btn.disabled = false;
    if (r.canceled) { setStatus('已取消'); return; }
    if (!r.ok) { setStatus('导出 GIF 失败：' + (r.errors || []).join(';'), 'err'); return; }
    setStatus('✅ GIF 已导出（' + r.frames + ' 帧 · ' + r.width + '×' + r.height + ' · ' + (r.bytes / 1024).toFixed(0) + ' KB）：' + r.path, 'ok');
  } catch (err) {
    btn.disabled = false;
    setStatus('导出 GIF 异常：' + String(err.message || err), 'err');
  }
};

$('#btnExportFolder').onclick = async () => {
  if (!state.frames.length) { setStatus('请先导入图片', 'err'); return; }
  const r = await window.api.exportFolder(readPack(), currentImages(), currentClipImages());
  if (r.canceled) { setStatus('已取消'); return; }
  setStatus(r.ok ? '✅ 已导出文件夹：' + r.path : '导出失败：' + (r.errors || []).join(';'), r.ok ? 'ok' : 'err');
};
$('#btnOpenPack').onclick = async () => {
  const r = await window.api.openPack();
  if (!r) return;
  if (r.error) { setStatus('打开失败：' + r.error, 'err'); return; }
  state.frames = [];
  for (const f of r.frames) await addFrameFromDataUrl(f.dataUrl, f.file);
  state.activeIdx = 0;
  applyPack(r.pack);
  await rebuildAll();
  setStatus('已载入宠物包：' + r.pack.name, 'ok');
};

// 使用说明：文案在 shared/help.js（纯函数 + 单测锁住"必须提到每一类能力"）。
// 以前这段文案直接写在 alert 里，做了新功能没人更新它 —— 用户点开看到的还是旧说明。
$('#btnHelp').onclick = () => alert(helpText());

// 拖拽
const stage = $('#stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));

// 整窗兜底：用户可能把文件拖到标题栏/侧栏上，而不是正好落在图片区
// —— 收到宠物包的人最自然的动作就是「把它拖进窗口」，这条路径必须能用。
document.addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types) e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  // 已经被更具体的处理器处理过的 drop 要跳过（避免同一文件被处理两次）。
  // 注意：不能只判断 #stage —— 帧缩略图条（#filmstrip）在 stage 外面，
  // 它自己处理「拖文件替换某帧」时，如果不在这里一并跳过，
  // 同一次 drop 会既替换那一帧、又被这里当成「新图导入」追加一帧（实测：3 帧变 4 帧）。
  if (e.defaultPrevented && e.target && e.target.closest
      && (e.target.closest('#stage') || e.target.closest('#filmstrip'))) return;
  e.preventDefault();
  stage.classList.remove('dragover');
  const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
  if (!files.length) return;
  const { packs, images, shares } = classifyDroppedFiles(files);
  if (packs.length) { await handleDroppedPacks(packs); return; }
  if (shares.length) { await handleDroppedShares(shares); return; }
  if (images.length) { await addImageFiles(images); return; }
  setStatus('只支持图片、.petpack 宠物包、或分享页 .html', 'err');
});

/** 拖入分享页 .html：把里面内嵌的宠物包抽出来并载入编辑 */
async function handleDroppedShares(files) {
  for (const f of files) {
    const p = (window.api.pathForFile && window.api.pathForFile(f)) || '';
    if (!p) { setStatus('拿不到文件路径，试试用「打开宠物包」', 'err'); continue; }
    setStatus('正在读取分享页…');
    const r = await window.api.readShareHtml(p);
    if (!r || !r.ok) { setStatus('读取失败：' + ((r && r.errors) || []).join(';'), 'err'); continue; }
    state.frames = [];
    for (const fr of r.frames) await addFrameFromDataUrl(fr.dataUrl, fr.file);
    state.activeIdx = 0;
    applyPack(r.pack);
    await rebuildAll();
    setStatus('已从这个分享页载入「' + r.pack.name + '」', 'ok');
    return;
  }
}

/**
 * 安装前的版本预检 + 询问（宠物包一键更新的核心）。
 * 为什么必须"先问再装"：覆盖是破坏性的，尤其"这个包比你现在用的更旧"要先警告；
 * 装完再说就晚了（旧版已经把新版覆盖掉了）。
 * @returns true 表示可以继续安装
 */
async function confirmInstallVersion(srcPath) {
  let info = null;
  try { info = await window.api.inspectPack(srcPath); } catch (err) { info = null; }
  if (!info || !info.ok || !info.version) return true;   // 没有版本信息 / 首次安装 -> 直接装
  const v = info.version;
  if (v.result === 'same') {
    setStatus('ℹ ' + (v.prompt || '这个版本已经装过了'), 'ok');
    return true;    // 同版不拦，装一次也无害（可能是文件损坏后重装）
  }
  const detail = '\n\n当前：' + v.current + '\n这个包：' + v.incoming + '\n（' + (v.reason || '') + '）';
  return window.confirm((v.prompt || '要覆盖同名宠物吗？') + detail);
}

/** 拖入 .petpack：安装并直接启动 —— 给「收到宠物包的人」一条最短路径 */
async function handleDroppedPacks(files) {
  for (const f of files) {
    const p = (window.api.pathForFile && window.api.pathForFile(f)) || '';
    if (!p) { setStatus('无法读取文件路径，请改用「宠物库 → 安装宠物包…」', 'err'); continue; }
    const okGo = await confirmInstallVersion(p);
    if (!okGo) { setStatus('已取消更新「' + f.name + '」'); continue; }
    setStatus('正在安装「' + f.name + '」…');
    const r = await window.api.installAndRun(p);
    if (r && r.ok) {
      setStatus('✅ 已安装并启动「' + (r.name || f.name) + '」' + (r.replaced ? '（覆盖了同名宠物）' : '') + '，它已出现在桌面上', 'ok');
      await refreshLibrary();
    } else {
      setStatus('安装失败：' + (((r && r.errors) || []).join('; ') || '未知错误'), 'err');
    }
  }
}

/** 拖入图片：按文件名自然顺序加入帧 */
async function addImageFiles(files) {
  files.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const wasEmpty = state.frames.length === 0;
  for (const f of files) {
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    await addFrameFromDataUrl(dataUrl, f.name);
  }
  await rebuildAll();
  // 从"空"变成"有图"时建立撤销基线，否则第一次操作后无法撤销（详见 establishUndoBaseline 的说明）
  if (wasEmpty && state.frames.length) establishUndoBaseline();
}

stage.addEventListener('drop', async (e) => {
  e.preventDefault(); e.stopPropagation(); stage.classList.remove('dragover');
  const files = [...(e.dataTransfer.files || [])];
  const { packs, images, shares } = classifyDroppedFiles(files);
  if (packs.length) { await handleDroppedPacks(packs); return; }   // 拖宠物包也允许落在图片区
  if (shares.length) { await handleDroppedShares(shares); return; } // 分享页同样允许
  if (!images.length) { setStatus('只支持图片、.petpack 宠物包、或分享页 .html', 'err'); return; }
  await addImageFiles(images);
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.tabpane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
  };
});

// ---------------- 帧缩略图条 ----------------
// 把整段动画可视化成一排小图：点击切帧、拖动排序。
// 帧多时只渲染可视窗口（200 帧全渲染会卡死），窗口跟随当前帧自动滚动。
const FS = { viewCount: 12, dragFrom: -1, thumbCache: new Map() };

/** 取某帧的缩略图 dataURL（按帧对象缓存，避免每次重绘都重编码 PNG） */
function thumbFor(frame) {
  const f = frame && (frame.current || frame);
  if (!f || !f.data || !f.width) return '';
  const cached = FS.thumbCache.get(frame);
  if (cached && cached.src === f) return cached.url;
  const s = thumbSize(f.width, f.height);
  const cv = document.createElement('canvas');
  cv.width = s.w; cv.height = s.h;
  const ctx = cv.getContext('2d');
  const src = new ImageData(new Uint8ClampedArray(f.data), f.width, f.height);
  // 先把原图放到临时 canvas 再缩放（直接 putImageData 到小 canvas 不会缩放）
  const tmp = document.createElement('canvas');
  tmp.width = f.width; tmp.height = f.height;
  tmp.getContext('2d').putImageData(src, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, f.width, f.height, 0, 0, s.w, s.h);
  const url = cv.toDataURL('image/png');
  FS.thumbCache.set(frame, { src: f, url });
  return url;
}

/** 重建缩略图条（帧变动或缩略图缓存失效时调用） */
function renderFilmstrip() {
  const box = $('#filmstrip'), track = $('#fsTrack'), label = $('#fsLabel');
  if (!box || !track) return;
  const n = state.frames.length;
  if (n < 2) { box.hidden = true; track.innerHTML = ''; return; }
  box.hidden = false;
  if (label) label.textContent = stripLabel(state.activeIdx, n);
  const win = visibleWindow(n, state.activeIdx, FS.viewCount);
  track.innerHTML = '';
  for (const i of win.indices) {
    const el = document.createElement('div');
    el.className = 'fs-cell' + (i === state.activeIdx ? ' on' : '');
    el.dataset.idx = String(i);
    el.draggable = true;
    el.title = '第 ' + (i + 1) + ' 帧（点一下切到这帧，拖动可排序）';
    const img = document.createElement('img');
    img.draggable = false;
    img.src = thumbFor(state.frames[i]);
    img.alt = String(i + 1);
    el.appendChild(img);
    const num = document.createElement('span');
    num.className = 'fs-num';
    num.textContent = String(i + 1);
    el.appendChild(num);
    track.appendChild(el);
  }
  bindFilmstripEvents();
}

function bindFilmstripEvents() {
  const track = $('#fsTrack');
  if (!track) return;
  for (const el of track.querySelectorAll('.fs-cell')) {
    el.onclick = () => {
      const i = parseInt(el.dataset.idx, 10);
      if (Number.isFinite(i) && i !== state.activeIdx) {
        state.activeIdx = i;
        renderPreview();
        renderFilmstrip();
      }
    };
    el.ondragstart = (e) => {
      FS.dragFrom = parseInt(el.dataset.idx, 10);
      el.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', String(FS.dragFrom)); e.dataTransfer.effectAllowed = 'move'; } catch {}
    };
    el.ondragend = () => { el.classList.remove('dragging'); FS.dragFrom = -1; };
    el.ondragover = (e) => {
      e.preventDefault();
      // 拖文件进来给「复制」光标（内部排序才是「移动」），让用户分清两种拖拽
      const hasFiles = e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
      e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
      el.classList.toggle('drop-target', !!hasFiles);
    };
    el.ondragleave = () => el.classList.remove('drop-target');
    el.ondrop = async (e) => {
      e.preventDefault();
      // 双保险：别让事件冒泡到 document 的处理（否则会被当成「导入新图」再追加一帧）
      e.stopPropagation();
      el.classList.remove('drop-target');
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      const idx = parseInt(el.dataset.idx, 10);
      // 拖进来的是**文件** -> 替换这一帧（而不是排序）
      if (files.length) {
        const cls = classifyDroppedFiles(files);
        if (cls.images.length) { await replaceFrameWithFile(idx, cls.images[0]); return; }
      }
      const from = FS.dragFrom;
      if (!Number.isFinite(from) || from < 0) return;
      // 用鼠标位置算插入点（而不是"落在哪一格"，避免只能整格跳）
      const cells = [...track.querySelectorAll('.fs-cell')];
      const rects = cells.map((c) => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right }; });
      const ins = insertIndexAt(e.clientX, rects);
      // 注意：rects 是"可视窗口"里的坐标，要换算回全局帧下标
      const globalIns = visibleWindow(state.frames.length, state.activeIdx, FS.viewCount).start + ins;
      const to = dropTarget(from, globalIns, state.frames.length);
      if (to === null) return;
      applyFrameOp(() => moveFrame(state.frames, state.activeIdx, from, to));
    };
  }
}
// ---------------- 撤销 / 重做 ----------------
// 制作器里每个操作都是破坏性的（抠图/裁边/翻转/生成动画/自动适配），
// 点错一次就得重新拖图 —— 这是最卡"制作性"的一处。用快照栈解决。
// 上限 20 层、32MB：一张 1600x1600 帧约 10MB，不限制的话内存会涨得很凶。
const history = createHistory({
  limit: 20,
  maxBytes: 32 * 1024 * 1024,
  estimate: estimateSnapshotBytes,
});

/** 把当前编辑状态做成快照（只存帧数据，别的字段都很小） */
function snapshotState() {
  return {
    frames: state.frames.map((f) => ({
      original: f.original ? new ImageData(new Uint8ClampedArray(f.original.data), f.original.width, f.original.height) : null,
      current: new ImageData(new Uint8ClampedArray(f.current.data), f.current.width, f.current.height),
      name: f.name,
      generatedFrom: f.generatedFrom,
    })),
    clips: state.clips.map((c) => ({
      ...c,
      frames: c.frames.map((cf) => ({ data: new ImageData(new Uint8ClampedArray(cf.data.data), cf.data.width, cf.data.height), durationMs: cf.durationMs })),
    })),
    activeIdx: state.activeIdx,
  };
}

/**
 * 记录一次"操作前的状态"。
 * 用法：**在改动 state.frames 之前**调一次 recordUndo()。
 * 这样撤销就是"回到操作前"。
 */
function recordUndo() {
  if (suppressHistory) return;
  // 有帧、或有动作片段，都值得记一步 —— 工坊可以"只存片段不生成主帧"
  if (!state.frames.length && !state.clips.length) return;
  history.push(snapshotState());
  updateUndoButtons();
}

/**
 * 建立撤销基线：**首次**导入图片后调用一次。
 *
 * 为什么必须单独做这件事：撤销栈需要至少两个状态才能撤销。
 * 如果只在"操作前"记录，第一次操作时栈里只有 1 层 -> canUndo() 为 false，
 * 用户点翻转后会发现"撤销按钮是灰的"（实测踩到）。
 * 正确做法：导入完成就把**初始状态**压进栈，之后的每次操作压新状态，
 * 这样第一次操作后就能撤回到导入时的样子。
 */
function establishUndoBaseline() {
  history.clear();
  if (state.frames.length) history.push(snapshotState());
  updateUndoButtons();
}

let suppressHistory = false;   // 撤销/重做期间不记录，否则会把「恢复」本身也记成一步

/**
 * 记录「操作后」的状态，供重做使用。
 *
 * 为什么前后各记一次：撤销栈要能双向走，必须同时有「操作前」和「操作后」两个状态。
 * 只记操作前 -> 撤销能回到前面，但重做无处可去（实测：撤销正常、重做没反应）。
 * 完整的破坏性操作 = recordUndo() -> 改数据 -> rebuildAll()（内部 recordUndoAfter）
 */
function recordUndoAfter() {
  if (suppressHistory) return;
  // 例外：允许把"空帧"状态也压栈 —— 否则「清空所有帧」能撤销、却永远重做不回来。
  // 同时：只要栈里已有东西（比如只有动作片段），也要继续记，否则重做无处可去。
  if (!state.frames.length && !state.clips.length && !history.size()) return;
  history.push(snapshotState());
  updateUndoButtons();
}

/** 把快照写回 state */
function restoreSnapshot(snap) {
  if (!snap) return;
  state.frames = snap.frames.map((f) => ({
    original: f.original, current: f.current, name: f.name, generatedFrom: f.generatedFrom,
  }));
  state.clips = snap.clips || [];
  state.activeIdx = Math.min(snap.activeIdx || 0, Math.max(0, state.frames.length - 1));
  renderClipList();
  renderPreview();
  updateButtons();
  updateUndoButtons();
}

function updateUndoButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = !history.canUndo();
  if (r) r.disabled = !history.canRedo();
}

/**
 * 撤销 / 重做。
 *
 * 关键：**不要**在恢复快照后再调 rebuildAll()。
 * 快照里存的已经是"处理完的像素"（current），而 rebuildAll 会按当前的界面参数
 * （勾选状态等）重新处理一遍 —— 于是刚撤销掉的翻转又被应用回去，
 * 表现为"撤销按钮生效了、但画面没变"（实测踩到）。
 * 恢复快照 + 重绘预览即可。
 */
async function doUndo() {
  const snap = history.undo();
  suppressHistory = true;
  if (!snap) return;
  restoreSnapshot(snap);
  suppressHistory = false;
  setStatus('已撤销（还可撤销 ' + Math.max(0, history.position()) + ' 步）', 'ok');
}

async function doRedo() {
  const snap = history.redo();
  suppressHistory = true;
  if (!snap) return;
  restoreSnapshot(snap);
  suppressHistory = false;
  setStatus('已重做', 'ok');
}

if ($('#btnUndo')) $('#btnUndo').onclick = () => { doUndo().catch(() => {}); };
if ($('#btnRedo')) $('#btnRedo').onclick = () => { doRedo().catch(() => {}); };
// 快捷键（判断逻辑在 shared/makerkeys.js，有单测）：
//   ←/→ 切帧 · 空格 播放/暂停 · Home/End 首尾帧 · Ctrl+Z 撤销 · Ctrl+Shift+Z 重做
//   Ctrl+←/Ctrl+→ 把当前帧往前/往后挪 · Shift+Delete 清空帧 · Shift+Enter 让它说一句
// 两条铁律（都写进单测了）：
//   ① 焦点在输入框里时**绝不抢键**（空格/方向键/按词移动光标在文本框里是刚需）；
//   ② 除 Ctrl+←/→（输入框外没有别的用途，用来排序）外，不碰 Ctrl/Alt 组合键。
window.addEventListener('keydown', (e) => {
  const t = e.target || {};
  const typing = isTypingTarget(t.tagName, t.isContentEditable, t.type);
  const hit = mapKey({
    key: e.key,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    typing,
    hasFrames: state.frames.length > 0,
  });
  if (!hit) return;
  switch (hit.action) {
    case 'undo': e.preventDefault(); doUndo().catch(() => {}); break;
    case 'redo': e.preventDefault(); doRedo().catch(() => {}); break;
    case 'prevFrame':
      if (state.frames.length) { e.preventDefault(); state.activeIdx = (state.activeIdx - 1 + state.frames.length) % state.frames.length; renderPreview(); }
      break;
    case 'nextFrame':
      if (state.frames.length) { e.preventDefault(); state.activeIdx = (state.activeIdx + 1) % state.frames.length; renderPreview(); }
      break;
    case 'firstFrame':
      if (state.frames.length) { e.preventDefault(); state.activeIdx = 0; renderPreview(); }
      break;
    case 'lastFrame':
      if (state.frames.length) { e.preventDefault(); state.activeIdx = state.frames.length - 1; renderPreview(); }
      break;
    case 'togglePlay': {
      const cb = $('#chkPlay');
      if (cb) { e.preventDefault(); cb.checked = !cb.checked; cb.onchange({ target: cb }); }
      break;
    }
    case 'clearFrames':
      e.preventDefault();
      if (state.frames.length && window.confirm('清空所有帧？（可用 Ctrl+Z 撤销）')) $('#btnClearFrames').click();
      break;
    // 帧排序：键盘也能调顺序（不用鼠标拖），对应缩略图条上的拖动排序
    case 'moveFrameLeft':
      // 已经在第一帧就别记一次没用的撤销快照（免得 Ctrl+Z 看起来"没反应"）
      if (state.frames.length > 1 && state.activeIdx > 0) {
        e.preventDefault();
        applyFrameOp(() => shiftFrame(state.frames, state.activeIdx, state.activeIdx, -1));
      }
      break;
    case 'moveFrameRight':
      if (state.frames.length > 1 && state.activeIdx < state.frames.length - 1) {
        e.preventDefault();
        applyFrameOp(() => shiftFrame(state.frames, state.activeIdx, state.activeIdx, 1));
      }
      break;
    case 'say': {
      e.preventDefault();
      const inp = $('#sayInput');
      if (inp && !inp.disabled) { inp.focus(); }
      break;
    }
    default: break;
  }
});
// ---------------- 身体识别（姿态估计） ----------------
// 上传一张人物图 -> 识别头/肩/肘/腕/髋/膝/踝 -> 画出骨架 + 逐部位结果 +
// 「素材是否合格」的可执行建议（这是「标准立绘」方案的核心：
//  与其让用户猜为什么效果不好，不如直接告诉他哪里不合格、怎么改）。
const POSE = { info: null, last: null, busy: false };

const POSE_LABEL = {
  nose: '鼻', leftEye: '左眼', rightEye: '右眼', leftEar: '左耳', rightEar: '右耳',
  leftShoulder: '左肩', rightShoulder: '右肩', leftElbow: '左肘', rightElbow: '右肘',
  leftWrist: '左腕', rightWrist: '右腕', leftHip: '左髋', rightHip: '右髋',
  leftKnee: '左膝', rightKnee: '右膝', leftAnkle: '左踝', rightAnkle: '右踝',
};

/** 骨架连线（画图用） */
const POSE_BONES = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
  ['nose', 'leftEye'], ['nose', 'rightEye'], ['leftEye', 'leftEar'], ['rightEye', 'rightEar'],
];

function poseSetTag(text, cls) {
  const t = $('#poseTag');
  if (t) { t.textContent = text; t.className = 'ai-tag ' + (cls || 'miss'); }
}

async function refreshPoseInfo() {
  try { POSE.info = await window.api.poseModelInfo(); } catch { POSE.info = null; }
  const info = POSE.info;
  if (!info) { poseSetTag('不可用', 'miss'); return; }
  // 引导文案
  const g = $('#poseGuide');
  if (g) g.innerHTML = (info.guide || []).map((x) => '<div>' + escapeHtml(x) + '</div>').join('');
  // 微动作下拉框
  const sel = $('#poseMotion');
  if (sel && info.motions && !sel.options.length) {
    sel.innerHTML = info.motions.map((m) => '<option value="' + m.id + '">' + m.emoji + ' ' + m.name + '</option>').join('');
  }
  if (info.installed) poseSetTag('✓ 已就绪', 'ok');
  else poseSetTag('未下载', 'miss');
  const dl = $('#btnPoseDownload');
  if (dl) {
    dl.hidden = !!info.installed;
    dl.textContent = '下载识别模型（约 ' + Math.round(((info.model && info.model.bytes) || 9466715) / 1048576) + 'MB）';
  }
  poseUpdateButtons();
}

function poseUpdateButtons() {
  const info = POSE.info;
  const installed = !!(info && info.installed);
  const run = $('#btnPoseRun');
  if (run) run.disabled = POSE.busy || !installed || !state.frames.length;
  const fit = $('#btnPoseFit');
  if (fit) fit.disabled = POSE.busy || !installed || !state.frames.length;
  const anim = $('#btnPoseAnim');
  if (anim) anim.disabled = POSE.busy || !installed || !state.frames.length;
  const p2c = $('#btnPoseToChar');
  if (p2c) p2c.disabled = POSE.busy || !installed || !state.frames.length;
  const dl = $('#btnPoseDownload');
  if (dl) dl.disabled = POSE.busy;
}

/** 在 canvas 上画出人物 + 骨架 + 关键点 */
function drawPoseOverlay(res) {
  const cv = $('#poseCanvas');
  if (!cv) return;
  const img = $('#previewImg');
  const W = res.srcWidth || (img && img.naturalWidth) || 400;
  const H = res.srcHeight || (img && img.naturalHeight) || 400;
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  if (img && img.src) { try { c.drawImage(img, 0, 0, W, H); } catch {} }
  const kpOf = (n) => (res.keypoints || []).find((k) => k.name === n);
  // 骨架：只画两端都可信的
  c.lineWidth = Math.max(2, W / 220);
  for (const [a, b] of POSE_BONES) {
    const A = kpOf(a), B = kpOf(b);
    if (!A || !B || A.score < 0.3 || B.score < 0.3) continue;
    c.strokeStyle = '#00e07a';
    c.beginPath(); c.moveTo(A.x * W, A.y * H); c.lineTo(B.x * W, B.y * H); c.stroke();
  }
  // 关键点：可信的实心亮色，不可信的灰点（让用户看到"这里没认出来"）
  for (const k of res.keypoints || []) {
    const ok = k.score >= 0.3;
    c.fillStyle = ok ? '#ff2d55' : 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(k.x * W, k.y * H, Math.max(3, W / 110), 0, Math.PI * 2);
    c.fill();
  }
}

function renderPoseResult(res) {
  const box = $('#poseResult');
  if (box) box.hidden = false;
  drawPoseOverlay(res);
  const mat = res.material || {};
  const sum = $('#poseSummary');
  if (sum) {
    const cls = mat.ok ? 'ok' : 'err';
    sum.innerHTML = '<span class="' + (mat.ok ? 'pose-chip' : 'pose-chip off') + '">'
      + escapeHtml(mat.summary || res.reason || '') + '</span>'
      + '<div style="margin-top:6px;font-size:12px;color:#8b97ad">识别到 '
      + (res.describe ? res.describe.reliable : 0) + '/17 个关键点'
      + (res.ms ? ' · 耗时 ' + res.ms + 'ms' : '') + '</div>';
  }
  const parts = $('#poseParts');
  if (parts) {
    const p = (mat && mat.parts) || {};
    const names = [['core', '躯干'], ['head', '头'], ['leftArm', '左臂'], ['rightArm', '右臂'], ['leftLeg', '左腿'], ['rightLeg', '右腿']];
    parts.innerHTML = names.map(([k, label]) =>
      '<span class="pose-chip' + (p[k] ? '' : ' off') + '">' + (p[k] ? '✓ ' : '✕ ') + label + '</span>'
    ).join('');
  }
  const issues = $('#poseIssues');
  if (issues) {
    const list = (mat && mat.issues) || [];
    issues.innerHTML = list.map((i) =>
      '<div class="pose-issue' + (i.level === 'block' ? ' block' : '') + '">'
      + '<b>' + escapeHtml(i.msg) + '</b><br />→ ' + escapeHtml(i.fix) + '</div>'
    ).join('');
  }
  POSE.last = res;
}

$('#btnPoseDownload').onclick = async () => {
  if (POSE.busy) return;
  POSE.busy = true; poseUpdateButtons();
  const info = POSE.info;
  const id = (info && info.model && info.model.id) || 'poseMovenet';
  setStatus('正在下载识别模型…');
  const r = await window.api.poseDownloadModel(id);
  POSE.busy = false;
  if (!r || !r.ok) { setStatus('下载失败：' + ((r && r.errors) || []).join(';'), 'err'); await refreshPoseInfo(); return; }
  setStatus('识别模型已就绪', 'ok');
  await refreshPoseInfo();
};

// 「按身体自动适配」：用识别到的人物范围裁剪当前帧，并把显示缩放调到建议值。
// 这样半身照 / 全身照 / 偏心构图在桌面上看起来大小一致、不会偏到屏幕一角。
$('#btnPoseFit').onclick = async () => {
  recordUndo();
  if (POSE.busy || !state.frames.length) return;
  const frame = state.frames[state.activeIdx] || state.frames[0];
  const src = frame.original || frame.current;
  if (!src) { setStatus('当前帧没有图片数据', 'err'); return; }
  POSE.busy = true; poseUpdateButtons();
  setStatus('正在计算身体范围…');
  try {
    const r = await window.api.poseAutoFit(imageDataToDataURL(src));
    POSE.busy = false; poseUpdateButtons();
    if (!r || !r.ok) {
      if (r && r.needModel) { setStatus('请先下载识别模型', 'err'); await refreshPoseInfo(); return; }
      setStatus('自动适配失败：' + ((r && r.errors) || []).join(';'), 'err');
      return;
    }
    const W = frame.current.width, H = frame.current.height;
    const box = {
      x: Math.max(0, Math.round(r.crop.x * W) - 1),
      y: Math.max(0, Math.round(r.crop.y * H) - 1),
      w: Math.round(r.crop.w * W) + 2,
      h: Math.round(r.crop.h * H) + 2,
    };
    box.w = Math.min(box.w, W - box.x);
    box.h = Math.min(box.h, H - box.y);
    if (!(box.w > 2) || !(box.h > 2)) { setStatus('身体范围太小，未做裁剪', 'err'); return; }
    for (const f of state.frames) {
      const fw = f.current.width, fh = f.current.height;
      const bx = Math.min(box.x, Math.max(0, fw - 2));
      const by = Math.min(box.y, Math.max(0, fh - 2));
      const fb = { x: bx, y: by, w: Math.min(box.w, fw - bx), h: Math.min(box.h, fh - by) };
      if (fb.w > 2 && fb.h > 2) f.current = toImageData(cropData(f.current.data, fw, fh, fb));
    }
    const pct = Math.round(r.scale * 100);
    if ($('#scale')) $('#scale').value = String(Math.max(15, Math.min(200, pct)));
    if ($('#qScale')) $('#qScale').value = String(Math.max(10, Math.min(200, pct)));
    syncLabels();
    if (needsFrameNormalize()) unifyAllFrames();
    renderPreview();
    recordUndoAfter();
    setStatus('✅ 已按身体适配：' + r.reason + '（缩放 ' + pct + '%，按' + (r.anchor === 'feet' ? '脚' : '腰') + '对齐）', 'ok');
    if (window.api.quickIsEnabled) {
      try { const r0 = await window.api.quickIsEnabled(); if (r0 && r0.enabled) await window.api.quickEnable(quickPack(), quickFrames()); } catch {}
    }
  } catch (err) {
    POSE.busy = false; poseUpdateButtons();
    setStatus('自动适配异常：' + String(err.message || err), 'err');
  }
};
// ★ 照着照片捏一个**可动小人**：识别 -> 取身体比例与站姿 -> 用参数化小人重画。
//
// 为什么这条路能成，而"让照片本身跳舞"不能成（必须写清楚，别被误解成绕路）：
//   让照片跳舞要**搬运像素** —— 但照片没有背面、没有关节内侧、没有被遮挡肢体的像素，
//   任何搬运都补不出来（三条渲染路线实测全败，见 HANDOFF 已知坑第 23 条）。
//   这里做的是**换介质**：照片只当**参照**（提供比例与姿势），
//   像素由我们按参数**重新画** —— 抬手后腋下长什么样我们知道，不存在信息缺失。
//   专业 2D 骨骼动画（Spine 等）也是这么做的：绑骨 + 重绘，而不是扭曲照片。
$('#btnPoseToChar') && ($('#btnPoseToChar').onclick = async () => {
  if (POSE.busy || !state.frames.length) return;
  const frame = state.frames[state.activeIdx] || state.frames[0];
  const src = frame.original || frame.current;
  if (!src) { setStatus('当前帧没有图片数据', 'err'); return; }
  POSE.busy = true; poseUpdateButtons();
  setStatus('正在识别身体比例…');
  try {
    const r = await window.api.poseEstimate(imageDataToDataURL(src));
    POSE.busy = false; poseUpdateButtons();
    if (!r || !r.ok) {
      if (r && r.needModel) { setStatus('请先下载识别模型', 'err'); await refreshPoseInfo(); return; }
      setStatus('识别失败：' + ((r && r.errors) || []).join(';'), 'err');
      return;
    }
    const derived = poseToCharacter(r.keypoints, { width: 256, height: 256 });
    if (!derived) {
      setStatus('没识别到可靠的躯干（肩+髋），换一张正面站好的照片试试', 'err');
      return;
    }
    // 顺便从照片里取主色：让捏出来的小人**颜色也像他本人**，
    // 而不是顶着预设的蓝色。取不到就保留用户当前配色（不硬塞）。
    const pal = colorsFromImageData(src.data, { step: 4 });
    // 把比例与站姿套到当前工坊外观上（五官等保持用户已选的）
    let cfg = normalizeCharacter(applyPoseToCharacter(stReadCfg(), derived));
    if (pal) cfg = normalizeCharacter({ ...cfg, customPalette: pal, paletteId: cfg.paletteId });
    stWriteCfg(cfg);
    // 切到工坊页，让用户当场看到"照着他捏出来的小人"
    const tab = document.querySelector('.tab[data-tab="studio"]');
    if (tab) tab.click();
    const pct = (v) => Math.round(v * 100) + '%';
    setStatus('✅ 已照着他捏出一个小人：头 ' + pct(cfg.proportions.head)
      + ' · 躯干 ' + pct(cfg.proportions.torso) + ' · 腿 ' + pct(cfg.proportions.leg)
      + (pal ? ' · 配色取自照片 ' + pal.dominantHex : '')
      + (derived.notes.length ? '（' + derived.notes.join('；') + '）' : '')
      + '。选个舞步再点「生成动画帧」就能跳起来', 'ok');
  } catch (err) {
    POSE.busy = false; poseUpdateButtons();
    setStatus('照着照片捏小人失败：' + String((err && err.message) || err), 'err');
  }
});

// 生成骨架微动作：把当前帧当作标准立绘，按选中的微动作烘出多帧。
// 闸门在 canAnimate（主进程）：素材不合格会直接拒绝并说明原因。
/** 渲染「动作片段」列表（可删） */
function renderClipList() {
  const box = $('#clipList');
  if (!box) return;
  if (!state.clips.length) { box.innerHTML = ''; return; }
  // 每个片段带一个"出现频率"（权重）：想让某个动作更常出现就调大它。
  // 运行时早就支持按权重随机切换，但此前**用户没法调** ——
  // 界面文案写着"按权重随机切换"却没有入口，属于文案与能力脱节。
  box.innerHTML = state.clips.map((c) => {
    const w = Math.max(0.01, Number(c.weight) || 1);
    const lvl = w >= 2 ? '常' : (w <= 0.5 ? '少' : '中');
    return '<span class="clip-chip" data-clip="' + escapeHtml(c.id) + '">'
      + escapeHtml(c.name) + ' · ' + c.frames.length + '帧'
      + '<button class="clip-w" data-dir="-1" title="让它少出现一点">−</button>'
      + '<span class="clip-wv" title="出现频率（越大越常出现）">' + lvl + '</span>'
      + '<button class="clip-w" data-dir="1" title="让它多出现一点">＋</button>'
      + '<button class="clip-del" title="移除这个片段">✕</button></span>';
  }).join('');

  // 权重加减：按 0.5 一档，范围 0.1 ~ 8（太极端会变成"只会播这一段"）
  for (const b of box.querySelectorAll('.clip-w')) {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const chip = ev.target.closest('.clip-chip');
      const id = chip && chip.dataset.clip;
      const dir = Number(ev.target.dataset.dir) || 0;
      const c = state.clips.find((x) => x.id === id);
      if (!c || !dir) return;
      const next = Math.max(0.1, Math.min(8, (Number(c.weight) || 1) + dir * 0.5));
      c.weight = next;
      renderClipList();
      const lvl = next >= 2 ? '常出现' : (next <= 0.5 ? '少出现' : '正常');
      setStatus('「' + c.name + '」出现频率：' + lvl + '（' + next.toFixed(1) + '）', 'ok');
    };
  }

  for (const b of box.querySelectorAll('.clip-del')) {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const id = ev.target.closest('.clip-chip').dataset.clip;
      recordUndo();
      state.clips = state.clips.filter((x) => x.id !== id);
      renderClipList();
      recordUndoAfter();
      setStatus('已移除片段（可 Ctrl+Z 撤销）', 'ok');
    };
  }
}
$('#btnPoseAnim').onclick = async () => {
  if (POSE.busy || !state.frames.length) return;
  const frame = state.frames[state.activeIdx] || state.frames[0];
  const src = frame.original || frame.current;
  if (!src) { setStatus('当前帧没有图片数据', 'err'); return; }
  const motionId = ($('#poseMotion') && $('#poseMotion').value) || 'idle';
  POSE.busy = true; poseUpdateButtons();
  setStatus('正在生成微动作…');
  try {
    const plan = await window.api.poseMotionPlan(imageDataToDataURL(src), motionId, 12);
    if (!plan || !plan.ok) {
      POSE.busy = false; poseUpdateButtons();
      if (plan && plan.needModel) { setStatus('请先下载识别模型', 'err'); await refreshPoseInfo(); return; }
      if (plan && plan.gated) {
        setStatus('⛔ 这张图不能生成动作：' + plan.reason + '（请按上面的建议调整素材）', 'err');
        return;
      }
      setStatus('生成失败：' + ((plan && plan.errors) || []).join(';'), 'err');
      return;
    }
    // 源 canvas：把当前帧画出来交给渲染器
    const scv = document.createElement('canvas');
    scv.width = frame.current.width; scv.height = frame.current.height;
    scv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.current.data), frame.current.width, frame.current.height), 0, 0);
    const out = renderLimbFrames(scv, plan.keypoints, plan.pose, plan.jointsPerFrame, plan.bounds, { size: Math.max(160, Math.min(560, frame.current.width)) });
    // 用生成的帧替换当前编辑内容
    const newFrames = [];
    for (let i = 0; i < out.frames.length; i++) {
      const c2 = out.frames[i].canvas;
      const id2 = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height);
      newFrames.push({ original: id2, current: id2, name: 'dance_' + i + '.png' });
    }
    const keepGen = { motionSource: src, generatedFrom: '微动作 ' + motionId };
    Object.assign(newFrames[0], keepGen);
    const asClip = !!($('#chkSaveAsClip') && $('#chkSaveAsClip').checked);
    if (asClip) {
      // 存为片段：主帧不动，只把这段动作登记下来，运行时随机切换
      const cid = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      const moName = (POSE.info && (POSE.info.motions || []).find((m) => m.id === motionId));
      state.clips.push({
        id: cid,
        name: (moName ? moName.name : motionId),
        weight: 1,
        // 对齐主帧画布尺寸：否则切到这个片段时宠物会突然变大/变小
        frames: normalizeClipFramesToMain(newFrames.map((f) => ({ data: f.current, durationMs: 110 }))),
      });
      renderClipList();
      POSE.busy = false; poseUpdateButtons();
      setStatus('✅ 已存为动作片段「' + (moName ? moName.name : motionId) + '」（共 ' + newFrames.length + ' 帧）。现在可以继续生成别的动作，导出后桌宠会随机切换。', 'ok');
      return;
    }
    state.frames = newFrames;
    state.activeIdx = 0;
    if ($('#idleAnim')) $('#idleAnim').value = 'play';
    await rebuildAll();
    POSE.busy = false; poseUpdateButtons();
    const mo = (POSE.info && POSE.info.motions || []).find((m) => m.id === motionId);
    setStatus('✅ 已生成微动作「' + (mo ? mo.name : motionId) + '」共 ' + newFrames.length + ' 帧', 'ok');
    if (window.api.quickIsEnabled) {
      try { const r0 = await window.api.quickIsEnabled(); if (r0 && r0.enabled) await window.api.quickEnable(quickPack(), quickFrames()); } catch {}
    }
  } catch (err) {
    POSE.busy = false; poseUpdateButtons();
    setStatus('生成异常：' + String(err.message || err), 'err');
  }
};
$('#btnPoseRun').onclick = async () => {
  if (POSE.busy || !state.frames.length) return;
  const frame = state.frames[state.activeIdx] || state.frames[0];
  const src = frame.original || frame.current;
  if (!src) { setStatus('当前帧没有图片数据', 'err'); return; }
  POSE.busy = true; poseUpdateButtons();
  setStatus('正在识别身体部位…');
  try {
    const r = await window.api.poseEstimate(imageDataToDataURL(src));
    POSE.busy = false; poseUpdateButtons();
    if (!r || !r.ok) {
      if (r && r.needModel) { setStatus('请先下载识别模型', 'err'); await refreshPoseInfo(); return; }
      setStatus('识别失败：' + ((r && r.errors) || []).join(';'), 'err');
      return;
    }
    renderPoseResult(r);
    const mat = r.material || {};
    setStatus((mat.ok ? '✅ ' : '⚠ ') + (mat.summary || '识别完成'), mat.ok ? 'ok' : 'err');
  } catch (err) {
    POSE.busy = false; poseUpdateButtons();
    setStatus('识别异常：' + String(err.message || err), 'err');
  }
};

refreshPoseInfo();
// ---------------- 批量处理：一批图 -> 一批独立宠物 ----------------
// 关键区别：拖多张图到画布 = 同一只宠物的多帧；点「批量做宠物」= 每张各是一只。
// 这两种意图完全不同，所以批量走独立入口，避免用户想做 20 只却得到一只闪烁怪。
const BATCH = { running: false };

function batchSetProgress(pct, line) {
  const fill = $('#batchFill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (line !== undefined && $('#batchLine')) $('#batchLine').textContent = line;
}

function batchAppendLog(text, cls = '') {
  const box = $('#batchLog');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'batch-row ' + cls;
  d.textContent = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function batchOpen() {
  if ($('#batchPanel')) $('#batchPanel').hidden = false;
  if ($('#batchLog')) $('#batchLog').innerHTML = '';
  batchSetProgress(0, '准备中…');
  if ($('#batchCount')) $('#batchCount').textContent = '';
}

function batchClose() {
  if ($('#batchPanel')) $('#batchPanel').hidden = true;
  BATCH.running = false;
  const btn = $('#btnBatch');
  if (btn) btn.disabled = false;
}

// 主进程逐个模型回报时，让用户看到「卡住」其实是在跑第二个模型
window.api.onBatchProgress((p) => {
  if (!p) return;
  if (p.phase === 'plan') {
    batchSetProgress(0, '共 ' + p.total + ' 张图，开始处理…');
    if ($('#batchCount')) $('#batchCount').textContent = '0 / ' + p.total;
    return;
  }
  if (p.phase === 'model') {
    batchSetProgress(((p.index - 1) / Math.max(1, p.total)) * 100, '「' + p.name + '」试跑模型 ' + p.modelIndex + '/' + p.modelTotal + '…');
    return;
  }
  if (p.phase !== 'item') return;
  const pct = (p.index / Math.max(1, p.total)) * 100;
  if ($('#batchCount')) $('#batchCount').textContent = p.index + ' / ' + p.total;
  if (p.status === 'cut') { batchSetProgress(pct - 40 / Math.max(1, p.total), '「' + p.name + '」抠图中…'); return; }
  if (p.status === 'ok') { batchSetProgress(pct, '✅ 「' + p.name + '」→ ' + p.outName); batchAppendLog('✅ ' + p.name, 'ok'); return; }
  if (p.status === 'canceled') { batchSetProgress(pct, '已取消'); return; }
  batchSetProgress(pct, '❌ 「' + p.name + '」失败：' + p.error);
  batchAppendLog('❌ ' + p.name + '：' + p.error, 'err');
});

async function runBatch() {
  if (BATCH.running) return;
  if (!window.api.batchRun) { setStatus('当前版本不支持批量处理', 'err'); return; }
  // 1) 先选文件
  const files = await window.api.batchPickFiles();
  if (!files || !files.length) return;

  // 2) 够不够跑？没有 AI 模型时批量只能用不上（纯色抠图对照片不可靠，宁可不做）
  let installed = [];
  try { installed = (await window.api.listModels()).filter((m) => m.installed); } catch {}
  if (!installed.length) {
    setStatus('批量处理需要先下载一个 AI 抠图模型（右侧「抠图」面板）', 'err');
    return;
  }

  BATCH.running = true;
  const btn = $('#btnBatch');
  if (btn) btn.disabled = true;
  batchOpen();

  // 3) 用当前的界面配置作为每只宠物的默认外观/物理（用户可事后微调）
  const tpl = readPack();
  const autoModel = !!($('#chkAiAuto') && $('#chkAiAuto').checked);
  const threshold = parseInt($('#aiThresh').value, 10) / 100;
  const alwaysFull = !!($('#chkAiAlwaysFull') && $('#chkAiAlwaysFull').checked);
  const r = await window.api.batchRun(files, tpl, autoModel, threshold, 0.12, alwaysFull);

  if (!r || !r.ok) {
    setStatus('批量处理失败：' + ((r && r.errors) || []).join(';'), 'err');
    batchSetProgress(0, '失败');
    BATCH.running = false;
    if (btn) btn.disabled = false;
    return;
  }
  const s = r.summary || {};
  batchSetProgress(100, (r.canceled ? '已停止 · ' : '完成 · ') + (s.text || ''));
  setStatus((r.canceled ? '⏹ 批量已停止：' : '✅ 批量完成：') + (s.text || ''), r.canceled ? '' : 'ok');
  if (s.failures && s.failures.length) {
    for (const f of s.failures) batchAppendLog('❌ ' + f.name + '：' + f.error, 'err');
  }
  BATCH.running = false;
  if (btn) btn.disabled = false;
  // 4) 刷新宠物库，让新做的宠物立刻出现
  try { await refreshLibrary(); } catch {}
}

if ($('#btnBatch')) $('#btnBatch').onclick = runBatch;
if ($('#btnBatchCancel')) $('#btnBatchCancel').onclick = async () => {
  if (!BATCH.running) { batchClose(); return; }
  await window.api.batchCancel();
  batchSetProgress(0, '正在停止（已完成的会保留）…');
  if ($('#btnBatchCancel')) $('#btnBatchCancel').disabled = true;
};
// ---------------- 宠物库 ----------------
// 列表数据缓存一份，搜索/排序在前端做，避免每次输入都重新读盘、重解压缩略图。
let libCache = [];

// 过滤 + 排序统一走 src/shared/library.js（有单测覆盖，避免前端另写一套规则）
let libPrefs = emptyState();

/** 渲染分组栏：每个分组一个可点的 chip（点了就只看它），末尾是新建分组 */
function renderGroupBar() {
  const box = $('#libGroups');
  if (!box) return;
  const groups = (libPrefs && libPrefs.groups) || [];
  box.innerHTML = '';
  if (!groups.length) {
    box.innerHTML = '<span class="lib-groups-empty">还没有分组。宠物多了可以分组归类（点宠物卡片上的 🏷）</span>';
  }
  for (const g of groups) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lib-gchip' + (libScope === 'group:' + g.id ? ' on' : '');
    chip.dataset.gid = g.id;
    chip.innerHTML = '<span>' + escapeHtml(g.name) + '</span><em>' + g.pets.length + '</em>';
    chip.title = '只看这个分组（右键可改名 / 删除）';
    chip.onclick = () => {
      libScope = (libScope === 'group:' + g.id) ? 'all' : ('group:' + g.id);
      for (const b of $('#libSeg').querySelectorAll('button')) b.classList.toggle('on', libScope === b.dataset.scope);
      renderLibrary();
    };
    chip.oncontextmenu = (e) => { e.preventDefault(); openGroupAdmin(g); };
    box.appendChild(chip);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'lib-gchip lib-gadd';
  add.textContent = '＋ 新建分组';
  add.onclick = () => createGroupFlow();
  box.appendChild(add);
}

/** 新建分组 */
async function createGroupFlow() {
  const name = window.prompt('新分组叫什么？例如：表情包 / 工作用 / 给孩子的');
  if (name == null) return;
  const t = String(name).trim();
  if (!t) { setStatus('分组名不能为空', 'err'); return; }
  try {
    const r = await window.api.libraryAddGroup(t);
    if (!r || !r.ok) { setStatus('新建分组失败：' + ((r && r.reason) || '未知错误'), 'err'); return; }
    libPrefs = normalizeState(r.library);
    renderLibrary();
    setStatus('✅ 已新建分组「' + t + '」', 'ok');
  } catch (err) {
    console.warn('[library] 新建分组失败：' + (err && err.message ? err.message : err));
    setStatus('新建分组异常：' + String((err && err.message) || err), 'err');
  }
}

/** 点宠物卡片上的 🏷：勾选它属于哪些分组 */
function openGroupMenu(item, anchorEl) {
  // 用轻量浮层而不是 window.prompt：分组是多选，要看到全部并逐项勾选
  const old = document.getElementById('groupMenu');
  if (old) old.remove();
  const groups = (libPrefs && libPrefs.groups) || [];
  const box = document.createElement('div');
  box.id = 'groupMenu';
  box.className = 'group-menu';
  const mine = new Set(groupsOf(libPrefs, item.id).map((g) => g.id));
  if (!groups.length) {
    box.innerHTML = '<div class="gm-empty">还没有分组</div>';
  } else {
    for (const g of groups) {
      const row = document.createElement('label');
      row.className = 'gm-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = mine.has(g.id);
      cb.onchange = async () => {
        try {
          const r = await window.api.librarySetGroupMember(g.id, item.id, cb.checked);
          if (r && r.ok) { libPrefs = normalizeState(r.library); renderLibrary(); renderGroupBar(); }
        } catch (err) { console.warn('[library] 改分组失败：' + (err && err.message ? err.message : err)); }
      };
      const span = document.createElement('span');
      span.textContent = g.name;
      row.appendChild(cb);
      row.appendChild(span);
      box.appendChild(row);
    }
  }
  const addRow = document.createElement('button');
  addRow.type = 'button';
  addRow.className = 'gm-add';
  addRow.textContent = '＋ 新建分组…';
  addRow.onclick = async () => { box.remove(); await createGroupFlow(); };
  box.appendChild(addRow);
  document.body.appendChild(box);
  const r = anchorEl.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.min(r.bottom + 6, window.innerHeight - box.offsetHeight - 8) + 'px';
  const close = (ev) => {
    if (box.contains(ev.target)) return;
    box.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

/** 右键分组 chip：改名 / 删除 */
async function openGroupAdmin(g) {
  const action = window.prompt('分组「' + g.name + '」：输入新名字 = 改名；输入 - = 删除；取消 = 什么都不做', g.name);
  if (action == null) return;
  const t = String(action).trim();
  if (t === '-') {
    if (!window.confirm('删除分组「' + g.name + '」？宠物本身不会被删')) return;
    try {
      const r = await window.api.libraryRemoveGroup(g.id);
      if (r && r.ok) { libPrefs = normalizeState(r.library); if (libScope === 'group:' + g.id) libScope = 'all'; renderLibrary(); setStatus('已删除分组', 'ok'); }
    } catch (err) { setStatus('删除分组失败：' + String((err && err.message) || err), 'err'); }
    return;
  }
  if (!t || t === g.name) return;
  try {
    const r = await window.api.libraryRenameGroup(g.id, t);
    if (!r || !r.ok) { setStatus('改名失败：' + ((r && r.reason) || '未知错误'), 'err'); return; }
    libPrefs = normalizeState(r.library);
    renderLibrary();
    setStatus('✅ 分组已改名为「' + t + '」', 'ok');
  } catch (err) { setStatus('改名异常：' + String((err && err.message) || err), 'err'); }
}

// ---------------- 宠物详情面板 ----------------
// 以前库里只有"名字 + 帧数 + 体积"，想看作者/版本/画布/片段数就得去翻文件夹。
// 这里把详情折成一组条目显示（折行逻辑在 shared/petdetail.js，有单测）。
let libDetailId = null;   // 当前正在看详情的那只（id）

function showPetDetail(item) {
  const box = $('#libDetail');
  if (!box || !item) return;
  libDetailId = item.id;
  const groups = groupsOf(libPrefs, item.id).map((g) => g.name);
  const rows = detailRows(item, {
    clips: item.clips,
    canvas: item.canvas,
    version: item.version,
    groups,
  });
  const thumb = $('#libDetailThumb');
  if (thumb) { thumb.src = item.thumb || ''; thumb.alt = item.name || ''; }
  const nm = $('#libDetailName');
  if (nm) nm.textContent = item.name || item.id || '未命名';
  const sum = $('#libDetailSummary');
  if (sum) sum.textContent = detailSummary(item, { clips: item.clips });
  const list = $('#libDetailRows');
  if (list) {
    list.innerHTML = rows.map((r) =>
      '<div class="lib-detail-row' + (r.tone === 'warn' ? ' warn' : '') + '">'
      + '<span class="k">' + escapeHtml(r.label) + '</span>'
      + '<span class="v">' + escapeHtml(r.value) + '</span></div>').join('');
  }
  box.hidden = false;
}

function hidePetDetail() {
  const box = $('#libDetail');
  if (box) box.hidden = true;
  libDetailId = null;
}

function currentDetailItem() {
  return libCache.find((x) => x.id === libDetailId) || null;
}

if ($('#btnLibDetailClose')) $('#btnLibDetailClose').onclick = () => hidePetDetail();
if ($('#btnLibDetailRun')) $('#btnLibDetailRun').onclick = async () => {
  const it = currentDetailItem();
  if (!it || it.broken) { setStatus('这只读不出来，没法启动', 'err'); return; }
  hidePetDetail();
  const modal = $('#libModal');
  if (modal) modal.hidden = true;
  setStatus('正在启动「' + it.name + '」…');
  const r = await window.api.runInstalled(it.id);
  if (r && r.ok) {
    setStatus('✅「' + it.name + '」已出现在桌面上', 'ok');
    try { const saved = await window.api.libraryTouch(it.id); if (saved) libPrefs = normalizeState(saved); } catch (err) { /* 忽略 */ }
  } else {
    setStatus('启动失败：' + (((r && r.errors) || []).join('; ') || '未知错误'), 'err');
  }
};
if ($('#btnLibDetailFolder')) $('#btnLibDetailFolder').onclick = () => {
  const it = currentDetailItem();
  if (it && it.file) window.api.revealFile(it.file);
};
if ($('#btnLibDetailCopyPath')) $('#btnLibDetailCopyPath').onclick = async () => {
  const it = currentDetailItem();
  if (!it || !it.file) return;
  const btn = $('#btnLibDetailCopyPath');
  try {
    await navigator.clipboard.writeText(it.file);
    if (btn) { const old = btn.textContent; btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = old; }, 1500); }
  } catch (err) {
    if (btn) btn.textContent = '复制失败';
    setStatus('复制失败（可以手动从详情里选中路径）', 'err');
  }
};

function libFiltered() {
  return filterLibrary(libCache, {
    query: ($('#libSearch') ? $('#libSearch').value : ''),
    sort: ($('#libSort') ? $('#libSort').value : 'name'),
    scope: libScope,
  }, libPrefs);
}

function renderLibrary() {
  const grid = $('#libGrid');
  const list = libFiltered();
  const cnt = $('#libCount');
  if (cnt) cnt.textContent = libCache.length ? (list.length + ' / ' + libCache.length + ' 只') : '';

  if (!libCache.length) {
    grid.innerHTML = '<div class="lib-empty">🐾 这里空空的～<br />点下方「安装宠物包…」领一只带回家吧</div>';
    return;
  }
  if (!list.length) {
    const q = ($('#libSearch').value || '').trim();
    if (q) {
      grid.innerHTML = '<div class="lib-empty">🔍 没有匹配「' + escapeHtml(q) + '」的宠物</div>';
    } else if (libScope === 'fav') {
      grid.innerHTML = '<div class="lib-empty">★ 还没有收藏的宠物<br />点卡片右上角的星标就能收藏</div>';
    } else if (libScope === 'recent') {
      grid.innerHTML = '<div class="lib-empty">🕘 还没有使用记录<br />启动过的宠物会出现在这里</div>';
    } else if (libScope === 'mine') {
      grid.innerHTML = '<div class="lib-empty">🐾 你还没安装自己的宠物<br />点下方「安装宠物包…」或在制作器里导出一只</div>';
    } else {
      grid.innerHTML = '<div class="lib-empty">🐾 这里空空的～</div>';
    }
    return;
  }

  renderGroupBar();
  updateMultiButton();
  // 详情面板：如果正在看的那只已经不在当前列表里（换了筛选/分组/被删），就关掉它，
  // 否则会显示"已经看不到的那只"的详情，让人以为它还在。
  if (libDetailId && !list.some((x) => x.id === libDetailId)) hidePetDetail();
  grid.innerHTML = '';
  for (const it of list) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.dataset.petId = it.id;   // 按 id 定位（重渲染后位置会变，靠位置点会点错）
    if (it.broken) {
      el.innerHTML = '<div class="nm">⚠ 损坏</div><div class="meta">' + escapeHtml(it.id) + '</div>';
    } else {
      const fav = isFavorite(libPrefs, it.id);
      // 这只宠物已在哪些分组里（卡片上显示小标签，否则用户不知道分过组没）
      const inGroups = groupsOf(libPrefs, it.id);
      el.innerHTML = (libMulti.on ? '<div class="lib-pick' + (libMulti.picked.has(it.id) ? ' on' : '') + '">' + (libMulti.picked.has(it.id) ? '✓' : '') + '</div>' : '')
        + '<img src="' + it.thumb + '" alt="" />'
        + '<button class="lib-fav' + (fav ? ' on' : '') + '" title="'
        + (fav ? '取消收藏' : '收藏') + '">' + (fav ? '★' : '☆') + '</button>'
        + '<button class="lib-groupbtn" title="加入 / 移出分组">🏷</button>'
        + '<button class="lib-infobtn" title="看这只的详细信息">ⓘ</button>'
        + (inGroups.length ? '<div class="lib-gtags">' + inGroups.map((g) => '<span class="lib-gtag">' + escapeHtml(g.name) + '</span>').join('') + '</div>' : '')
        // 只给「用户自己装的」打标：内置宠物占多数，全都标反而成了噪音
        + (it.builtin ? '' : '<span class="lib-badge mine">我的</span>')
        + '<div class="nm">' + escapeHtml(it.name) + '</div>'
        + '<div class="meta">' + it.frames + ' 帧 · ' + (it.size / 1024).toFixed(0) + ' KB</div>';
      const ibtn = el.querySelector('.lib-infobtn');
      if (ibtn) ibtn.onclick = (ev) => { ev.stopPropagation(); showPetDetail(it); };
      const gbtn = el.querySelector('.lib-groupbtn');
      if (gbtn) gbtn.onclick = (ev) => { ev.stopPropagation(); openGroupMenu(it, gbtn); };
      el.querySelector('.lib-fav').onclick = async (ev) => {
        ev.stopPropagation();
        const prev = libPrefs;
        libPrefs = toggleFavorite(libPrefs, it.id);   // 立即反馈
        renderLibrary();
        try {
          const saved = await window.api.libraryToggleFav(it.id);
          if (saved) { libPrefs = normalizeState(saved); renderLibrary(); }
        } catch { libPrefs = prev; renderLibrary(); setStatus('收藏保存失败', 'err'); }
      };
    }
    // 多选模式下，点卡片本身 = 勾选 / 取消勾选（而不是启动）
    if (libMulti.on && !it.broken) {
      el.classList.toggle('picked', libMulti.picked.has(it.id));
      el.onclick = (ev) => {
        // 点收藏/分组/启动按钮时不触发勾选
        if (ev.target.closest('.lib-fav') || ev.target.closest('.lib-groupbtn') || ev.target.closest('.lib-infobtn') || ev.target.closest('.acts')) return;
        if (libMulti.picked.has(it.id)) libMulti.picked.delete(it.id);
        else libMulti.picked.add(it.id);
        renderLibrary();
      };
    }
    const acts = document.createElement('div');
    acts.className = 'acts';
    if (!it.broken) {
      const run = document.createElement('button'); run.className = 'primary'; run.textContent = '启动';
      run.onclick = async () => {
        // 桌宠是独立窗口，点完就"消失"在桌面上 —— 必须有明确反馈，否则用户以为没反应。
        run.disabled = true;
        run.textContent = '启动中…';
        setStatus('正在启动「' + it.name + '」…');
        const r = await window.api.runInstalled(it.id);
        if (r && r.ok) {
          run.textContent = '✓ 已启动';
          // 关掉库弹窗，让用户直接看到桌面上的宠物
          const modal = $('#libModal');
          if (modal) modal.hidden = true;
          setStatus('✅「' + it.name + '」已出现在桌面上（若没看到，可能在屏幕另一角）', 'ok');
          // 记一次使用（失败不影响启动）
          try { const saved = await window.api.libraryTouch(it.id); if (saved) libPrefs = normalizeState(saved); } catch {}
          setTimeout(() => { run.disabled = false; run.textContent = '启动'; }, 2200);
        } else {
          run.disabled = false;
          run.textContent = '启动';
          setStatus('启动失败：' + ((r && r.errors) || []).join('; '), 'err');
        }
      };
      acts.appendChild(run);
    }
    const del = document.createElement('button'); del.textContent = '删除';
    del.onclick = async () => { await window.api.uninstall(it.id); refreshLibrary(); };
    acts.appendChild(del);
    el.appendChild(acts);
    grid.appendChild(el);
  }
}

/** 重新读盘（安装/删除后调用） */
async function refreshLibrary() {
  const grid = $('#libGrid');
  if (grid) grid.innerHTML = '<div class="lib-empty">加载中…</div>';
  // 偏好（收藏/最近使用）与宠物列表一起拉，避免渲染时星标状态闪一下
  try {
    const [list, prefs] = await Promise.all([window.api.listInstalled(), window.api.libraryGet()]);
    libCache = list || [];
    libPrefs = normalizeState(prefs);
  } catch { libCache = []; libPrefs = emptyState(); }
  renderLibrary();
}

// 多选模式：勾选多只宠物，一次一起放出来（多宠物同屏）
const libMulti = { on: false, picked: new Set() };

let libScope = 'all';
if ($('#libSeg')) {
  $('#libSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scope]');
    if (!btn) return;
    libScope = btn.dataset.scope;
    for (const b of $('#libSeg').querySelectorAll('button')) b.classList.toggle('on', b === btn);
    renderLibrary();
  });
}
if ($('#libSearch')) $('#libSearch').addEventListener('input', () => renderLibrary());
if ($('#libSort')) $('#libSort').addEventListener('change', () => renderLibrary());

// 测试用：直接以 ImageData 走真实的上传路径（合成拖放拿不到真实文件路径）
if (typeof window !== 'undefined') {
  window.__clearFramesForTest = () => { state.frames = []; state.activeIdx = 0; renderPreview(); return true; };
  window.__rebuildForTest = async () => { await rebuildAll(); return true; };
  window.__addFrameForTest = async (imageData, name) => {
    const f = { original: imageData, current: imageData, name: name || 'test' };
    const cut = autoCutIfNeeded(f, name);
    if (cut && cut.__autoCut) { f.current = cut.current; f.__autoCut = true; }
    state.frames.push(f);
    state.activeIdx = state.frames.length - 1;
    await rebuildAll();
    return true;
  };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }


// ---- 多选模式：勾选多只，一起放到桌面上（多宠物同屏）----
function updateMultiButton() {
  const btn = $('#btnLibEnableMulti');
  if (!btn) return;
  btn.hidden = !libMulti.on;
  btn.disabled = libMulti.picked.size === 0;
  btn.textContent = '▶ 一起放出来（' + libMulti.picked.size + '）';
}

if ($('#btnLibMulti')) $('#btnLibMulti').onclick = () => {
  libMulti.on = !libMulti.on;
  if (!libMulti.on) libMulti.picked.clear();
  $('#btnLibMulti').classList.toggle('on', libMulti.on);
  $('#btnLibMulti').textContent = libMulti.on ? '☑ 多选中…' : '☑ 多选';
  updateMultiButton();
  renderLibrary();
};

// 多宠物启用进度：主进程每放出来一只就回报一次，这里更新状态栏，
// 免得"点了之后到全部出现"之间是一片空白（用户会以为没反应）。
if (window.api.onLaunchProgress) {
  window.api.onLaunchProgress((p) => {
    if (!p) return;
    if (p.finished) setStatus(summaryText({ total: p.total, failed: p.failed }), p.failed ? 'err' : 'ok');
    else setStatus(progressText(p), p.ok === false ? 'err' : '');
    const fill = $('#libLaunchFill');
    const bar = $('#libLaunchBar');
    if (bar) bar.hidden = false;
    if (fill) fill.style.width = progressPct(p) + '%';
    if (p.finished) {
      // 完成后停一下再收起，让用户看得到"100%"
      clearTimeout(window.__launchBarTimer);
      window.__launchBarTimer = setTimeout(() => { if (bar) bar.hidden = true; }, 1500);
    }
  });
}

if ($('#btnLibEnableMulti')) $('#btnLibEnableMulti').onclick = async () => {
  const btn = $('#btnLibEnableMulti');
  const ids = [...libMulti.picked];
  if (!ids.length) return;
  const picked = libCache.filter((it) => ids.includes(it.id));
  if (!picked.length) { setStatus('没有可启用的宠物', 'err'); return; }
  // 每只需要完整的帧数据 —— 从磁盘读包（listInstalled 只给了缩略图）
  btn.disabled = true;
  const bar0 = $('#libLaunchBar'), fill0 = $('#libLaunchFill');
  if (bar0) { bar0.hidden = false; }
  if (fill0) { fill0.style.width = '0%'; }
  setStatus('正在准备 ' + picked.length + ' 只宠物…');
  try {
    const pets = [];
    for (const it of picked) {
      // 用与「启动」同一条路径拿包：runInstalled 会自己建窗口，这里要的是数据，
      // 所以改用 pet:getPack 之外的现成接口 —— 通过 api 读包内容
      const data = await window.api.readInstalledPack(it.id);
      if (data && data.ok && data.pack && Array.isArray(data.frames)) {
        pets.push({ name: it.name, pack: data.pack, frames: data.frames });
      }
    }
    if (!pets.length) { setStatus('读不到宠物数据，无法启用', 'err'); btn.disabled = false; return; }
    const r = await window.api.quickEnableMulti(pets);
    if (r && r.ok) {
      setStatus('✅ 已把 ' + r.count + ' 只宠物一起放到桌面上（若没看到，可能在屏幕另一角）', 'ok');
      $('#libModal').hidden = true;
      libMulti.picked.clear();
      libMulti.on = false;
      const mb = $('#btnLibMulti');
      if (mb) { mb.classList.remove('on'); mb.textContent = '☑ 多选'; }
      updateMultiButton();
      const cnt = await window.api.petCount();
      if (cnt && cnt.count) quickSetStatus(true, '桌面上有 ' + cnt.count + ' 只宠物在跑', 3);
    } else {
      setStatus('一起放出来失败：' + ((r && r.errors) || []).join('; '), 'err');
      btn.disabled = false;
    }
  } catch (err) {
    console.warn('[multi] 启用多只失败：' + (err && err.message ? err.message : err));
    setStatus('一起放出来异常：' + String((err && err.message) || err), 'err');
    btn.disabled = false;
  }
};

// 省电模式开关：改了要**立刻**下发给正在跑的宠物（而不是等下次启用）。
// 多宠物时主进程会转发给每一只。
// 作息开关：同样立刻下发（不用等下次启用）
if ($('#chkSchedule')) {
  $('#chkSchedule').onchange = () => {
    const on = $('#chkSchedule').checked;
    try {
      if (window.api.setSchedule) window.api.setSchedule(on);
      setStatus(on ? '已开启作息（会跟着真实时间变化）' : '已关闭作息（一直保持同样的活跃度）', 'ok');
    } catch (err) {
      console.warn('[schedule] 切换失败：' + (err && err.message ? err.message : err));
    }
  };
}

if ($('#chkPowerSave')) {
  $('#chkPowerSave').onchange = () => {
    const on = $('#chkPowerSave').checked;
    try {
      if (window.api.setPowerSave) window.api.setPowerSave(on);
      setStatus(on ? '已开启省电模式（静止/打瞌睡时降帧）' : '已关闭省电模式（一直满帧，会更费电）', 'ok');
    } catch (err) {
      console.warn('[powersave] 切换失败：' + (err && err.message ? err.message : err));
    }
  };
}

// 空状态里的另外两条出路：让第一次打开的人知道"没素材也能做"。
// 以前空状态只提"拖图片/选图片"，而 22 只内置宠物和刚做好的角色工坊都没被提及 ——
// 有能力但用户不知道，等于没有。
if ($('#btnEmptyStudio')) $('#btnEmptyStudio').onclick = () => {
  const tab = document.querySelector('.tab[data-tab="studio"]');
  if (tab) tab.click();
  setStatus('在右侧「工坊」里用滑块捏一只 —— 左边会实时预览', 'ok');
};
if ($('#btnEmptyLibrary')) $('#btnEmptyLibrary').onclick = () => {
  const modal = $('#libModal');
  if (modal) { modal.hidden = false; refreshLibrary(); setStatus('挑一只内置宠物，点「启动」就能上桌', 'ok'); }
};

$('#btnLibrary').onclick = () => { $('#libModal').hidden = false; refreshLibrary(); };
$('#btnLibClose').onclick = () => { $('#libModal').hidden = true; };
$('#libModal').onclick = (e) => { if (e.target.id === 'libModal') $('#libModal').hidden = true; };
$('#btnLibOpenDir').onclick = () => window.api.openDataDir();

// 批量导出 GIF 的界面接线。
// 与「导出合集」一样，先给用户交代清楚会发生什么（数量 / 画布 / 是否会抽稀），
// 再让他决定要不要连内置宠物一起导。
if ($('#btnLibExportGif')) $('#btnLibExportGif').onclick = async () => {
  const btn = $('#btnLibExportGif');
  const includeBuiltin = window.confirm(
    '批量导出 GIF：宠物库里每只宠物会各变成一个 GIF 文件。\n\n'
    + '点「确定」= 连内置宠物一起导出\n'
    + '点「取消」= 只导出你自己的宠物\n\n'
    + '（为保证速度，画布会统一缩到最长边 320px 以内，帧数过多的会均匀抽稀）'
  );
  btn.disabled = true;
  setStatus('正在批量导出 GIF（宠物多时需要一会儿）…');
  try {
    const r = await window.api.exportBulkGif({ includeBuiltin });
    btn.disabled = false;
    if (r.canceled) { setStatus('已取消'); return; }
    if (!r.ok) { setStatus('批量导出失败：' + (r.errors || []).join(';'), 'err'); return; }
    const kb = (r.bytes / 1024).toFixed(0);
    let msg = '✅ 已导出 ' + r.written + ' 个 GIF（共 ' + kb + ' KB，画布 ' + r.canvas.w + '×' + r.canvas.h + '）到：' + r.dir;
    if (r.failed) msg += '；失败 ' + r.failed + ' 个';
    setStatus(msg, r.failed ? 'err' : 'ok');
    if (r.failed && r.failures && r.failures.length) {
      console.warn('[bulk-gif] 失败明细:', r.failures);
    }
  } catch (err) {
    btn.disabled = false;
    setStatus('批量导出异常：' + String(err.message || err), 'err');
  }
};

// 导出「在线分享站」：零后端静态站点，扔到 GitHub Pages 就能给别人逛。
// 单个 .html 只能一对一地发；这一步是把整个宠物库变成一个可浏览的广场。
if ($('#btnLibExportSite')) $('#btnLibExportSite').onclick = async () => {
  const btn = $('#btnLibExportSite');
  const includeBuiltin = window.confirm(
    '导出在线分享站：会在你选的文件夹里生成一个 desk-pet-site/，里面有：\n'
    + '  · index.html   首页（卡片网格 + 搜索）\n'
    + '  · pet-*.html   每只宠物的独立分享页（双击就能玩）\n'
    + '  · manifest.json / README.txt\n\n'
    + '点「确定」= 连内置宠物一起导出（站更大、更有排面）\n'
    + '点「取消」= 只导出你自己的宠物\n\n'
    + '导出后把整个 desk-pet-site 文件夹传上 GitHub Pages / Netlify 即可分享（README 里有步骤）'
  );
  btn.disabled = true;
  setStatus('正在生成在线分享站（宠物多时需要一会儿）…');
  try {
    const r = await window.api.exportShareSite({ includeBuiltin });
    btn.disabled = false;
    if (r.canceled) { setStatus('已取消'); return; }
    if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
    const kb = (r.bytes / 1024).toFixed(0);
    setStatus('✅ 已生成 ' + r.count + ' 只宠物的在线分享站（' + r.files + ' 个文件，' + kb + ' KB）到：' + r.path, 'ok');
    showShareHint(r.path, '在线分享站');
  } catch (err) {
    btn.disabled = false;
    // 绝不静默吞异常
    console.warn('[share-site] 失败：' + (err && err.message ? err.message : err));
    setStatus('导出异常：' + String((err && err.message) || err), 'err');
  }
};

// 进度回报：宠物多时让用户看到"在动"而不是以为卡死
if (window.api.onBulkGifProgress) {
  window.api.onBulkGifProgress((p) => {
    if (!p) return;
    setStatus('批量导出 GIF… ' + p.done + '/' + p.total + '（' + p.name + '）');
  });
}

// 导出整个宠物库为一个 zip（备份 / 换机 / 分享合集）。
// 先问用户「要不要包含内置宠物」，并给出体积预估 —— 避免导出一个几百 MB 的包才发现不对。
if ($('#btnLibExport')) $('#btnLibExport').onclick = async () => {
  const btn = $('#btnLibExport');
  let pv = null;
  try { pv = await window.api.previewExport(); } catch {}
  if (!pv || !pv.ok) { setStatus('读取宠物库失败', 'err'); return; }
  const mine = pv.mine, all = pv.all;
  const fmt = (b) => b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const ask = '你的宠物有 ' + mine.count + ' 只（' + fmt(mine.bytes) + '）。\n\n'
    + '要不要连内置宠物一起导出？\n'
    + '  一起导出：共 ' + all.count + ' 只，约 ' + fmt(all.bytes) + '\n'
    + '  只导出我的：' + mine.count + ' 只，约 ' + fmt(mine.bytes) + '\n\n'
    + '点确定 = 连内置一起导出；点取消 = 只导出我的宠物。';
  const includeBuiltin = window.confirm(ask);
  // 用户点取消又恰好没有自制宠物时，要明确告知（否则会以为点了没反应）
  if (!includeBuiltin && mine.count === 0) {
    setStatus('宠物库里还没有你自己的宠物（只有内置的）。想导出内置宠物请在上一步点确定', 'err');
    return;
  }
  // 命名模板（可选）：留空就用「宠物名.petpack」。
  // 批量导出十几只时，很多人想加日期或序号 —— 以前只能导完手动改。
  const tpl = window.prompt(
    '导出文件的命名规则（留空 = 用宠物名）\n\n' + templateHelp() + '\n\n例如：{date}_{name}  或  {n:02}_{name}',
    ''
  );
  if (tpl === null) { setStatus('已取消'); return; }
  const unknown = unknownPlaceholders(tpl);
  if (unknown.length) {
    setStatus('⚠ 模板里有不认识的占位符：' + unknown.map((x) => '{' + x + '}').join('、') + '（会原样保留）', 'err');
  }
  // 用**真实的第一只宠物**预览一下模板效果 —— 用户能立刻看到自己写的规则对不对，
  // 而不是等导完 20 个文件才发现写错了（expandTemplate 就是干这个的）。
  if (tpl && libCache.length) {
    const first = libCache[0];
    const d = new Date();
    const preview = expandTemplate(tpl, {
      name: String(first.name || first.id), author: String(first.author || ''),
      n: 1, date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16).replace(':', '-'),
      ext: 'petpack',
    });
    setStatus('命名预览：' + preview + '（导出 ' + libCache.length + ' 只）');
  }
  btn.disabled = true;
  setStatus('正在打包宠物库…');
  try {
    const r = await window.api.exportAll({ includeBuiltin, nameTemplate: tpl });
    btn.disabled = false;
    if (r.canceled) { setStatus('已取消'); return; }
    if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
    const skipped = (r.skipped || []).length;
    setStatus('✅ 已导出 ' + r.count + ' 只宠物到合集包（' + fmt(r.bytes) + '）'
      + (skipped ? '，跳过 ' + skipped + ' 只' : '') + '：' + r.path, 'ok');
  } catch (err) {
    btn.disabled = false;
    setStatus('导出异常：' + String(err.message || err), 'err');
  }
};
$('#btnLibInstall').onclick = async () => {
  const r = await window.api.openPack();
  if (!r || r.error) return;
  const okGo = await confirmInstallVersion(r.file);
  if (!okGo) { setStatus('已取消安装'); return; }
  const inst = await window.api.installPack(r.file);
  setStatus(
    inst.ok
      ? (inst.replaced ? '已安装到宠物库（覆盖了同名宠物）' : '已安装到宠物库')
      : '安装失败：' + (inst.errors || []).join(';'),
    inst.ok ? 'ok' : 'err'
  );
  refreshLibrary();
};


// ================= 从单张图生成动画 =================
$('#motionFrames') && $('#motionFrames').addEventListener('input', () => syncLabels());
$('#qFrames') && $('#qFrames').addEventListener('input', () => { const el = $('#qFramesV'); if (el) el.textContent = $('#qFrames').value; });
$('#motionAmp') && $('#motionAmp').addEventListener('input', () => syncLabels());

$('#btnGenQBody') && ($('#btnGenQBody').onclick = () => {
  recordUndo();
  if (!state.frames.length) { setStatus('请先导入一张大头照', 'err'); return; }
  const cur = state.frames[state.activeIdx];
  if (!cur) { setStatus('没有可用的帧', 'err'); return; }

  // 用当前帧的像素构造 canvas
  const sw = cur.current.width, sh = cur.current.height;
  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const sx = src.getContext('2d', { willReadFrequently: true });
  const imgData = sx.createImageData(sw, sh);
  imgData.data.set(cur.current.data);
  sx.putImageData(imgData, 0, 0);

  const mode = $('#qMode') ? $('#qMode').value : 'walk';
  const frames = $('#qFrames') ? parseInt($('#qFrames').value, 10) : 12;

  // 先检测：如果图下方已有大量内容，说明它已含身体（不是纯头像），
  // 叠加四肢会与原身体重叠 —— 提前告知，避免生成出奇怪的图。
  try {
    let low = 0, tot = 0;
    const d = cur.current.data, cw = sw, ch = sh;
    const y0 = Math.floor(ch * 0.72);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3] < 40) continue;
      tot++; if (y >= y0) low++;
    }
    const ratio = tot ? low / tot : 0;
    if (ratio > 0.30) {
      setStatus('⚠ 这张图下方已有很多内容（像是完整身体，不是纯头像）。生成后可「恢复原图」再试。', 'err');
    } else {
      setStatus('正在生成 Q 版身体…');
    }
  } catch { /* 检测失败不阻塞 */ }

  try {
    const res = composeQBody(src, { mode, frames });
    if (!res || !res.frames.length) throw new Error('合成失败');

    // 替换为多帧：每帧取出 RGBA
    const list = res.frames.map((fr) => {
      const cx = fr.canvas.getContext('2d', { willReadFrequently: true });
      const d = cx.getImageData(0, 0, fr.canvas.width, fr.canvas.height);
      return {
        current: { width: fr.canvas.width, height: fr.canvas.height, data: new Uint8ClampedArray(d.data) },
        original: null,
        durationMs: fr.durationMs,
        name: mode + '.png',
      };
    });
    state.frames = list;
    state.activeIdx = 0;
    // 标记：这些帧已由 composeQBody 精确对齐，后处理不要再移动主体。
    // 注意要把标记同时挂到帧对象与 current 数据上：processFrame 会替换 f.current，
    // 若标记只挂在一处，重建后会丢失（实测 crawl 因此仍走了主体对齐）。
    for (const f of list) { f.qComposed = true; if (f.current) f.current.qComposed = true; }
    rebuildAll();
    setStatus('✅ 已生成 ' + list.length + ' 帧（' + (mode === 'crawl' ? '爬动' : '走路') + '，' + res.width + '×' + res.height + '）', 'ok');
  } catch (err) {
    setStatus('生成失败：' + (err && err.message ? err.message : err), 'err');
  }
});

$('#btnGenMotion') && ($('#btnGenMotion').onclick = () => {
  recordUndo();
  if (!state.frames.length) { setStatus('请先导入一张图片', 'err'); return; }
  const src = state.frames[state.activeIdx];
  if (!src) return;

  const motion = $('#motionType').value;
  const amplitude = parseInt($('#motionAmp').value, 10) / 100;
  // 帧数受内存预算约束：注意生成帧的画布会外扩，须按「生成后尺寸」估算
  const outSize = motionCanvasSize(src.current.width, src.current.height, motion, amplitude);
  const fit = fitFrameLimit(outSize.width, outSize.height, parseInt($('#motionFrames').value, 10));
  const frames = fit.frames;
  if (fit.clamped) setStatus('⚠ ' + fit.limitReason, 'err');

  setStatus('正在生成动画…');
  try {
    const res = synthesizeMotion(src.current.data, src.current.width, src.current.height, {
      motion, frames, amplitude,
    });
    // 生成前记录原图（若尚未记录），保证「恢复原图」可用
    if (!src.original) src.original = src.current;
    if (!src.motionSource) src.motionSource = src.current;

    // 替换为多帧：以当前帧为源，替换整批帧
    const dur = Math.round(1000 / parseInt($('#fps').value, 10));
    const baseName = (src.name || 'frame').replace(/#\d+$/, '');
    state.frames = res.frames.map((f, i) => ({
      original: src.current,                // 引用合成前的源帧，保证抠图/AI/恢复原图可用
      current: new ImageData(new Uint8ClampedArray(f.data), f.width, f.height),
      name: baseName + '#' + i,
      durationMs: dur,
      generatedFrom: baseName,
    }));
    state.activeIdx = 0;

    // 合成后已统一尺寸，保持对齐开关不再二次处理
    renderPreview();
    updateButtons();
    recordUndoAfter();
    const used = fitFrameLimit(res.canvas.width, res.canvas.height, res.frames.length).bytes;
    setStatus('✅ 已生成 ' + res.frames.length + ' 帧（' + motion + '，' + res.canvas.width + '×' + res.canvas.height
      + '，约 ' + fmtBytes(used) + '）', 'ok');
  } catch (e) {
    setStatus('生成失败：' + (e && e.message ? e.message : e), 'err');
  }
});

// ================= AI 智能抠图 =================
const AI = { models: [], current: null, busy: false };

function base64ToImageData(b64, w, h) {
  // 用 canvas 解码后取 ImageData（保证与预览一致）
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, 0, 0);
      resolve({ data: cx.getImageData(0, 0, cv.width, cv.height), width: cv.width, height: cv.height });
    };
    img.src = 'data:image/png;base64,' + b64;
  });
}

async function refreshAiModels() {
  try {
    AI.models = await window.api.listModels();
  } catch { AI.models = []; }
  const sel = $('#aiModel');
  sel.innerHTML = '';
  for (const m of AI.models) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name + (m.installed ? '  ✓已下载' : '');
    sel.appendChild(o);
  }
  if (AI.models.length) { AI.current = AI.models[0].id; sel.value = AI.current; }
  updateAiUi();
}

function currentModel() { return AI.models.find((m) => m.id === $('#aiModel').value) || null; }

function updateAiUi() {
  const m = currentModel();
  const tag = $('#aiTag');
  if (!m) { tag.textContent = '不可用'; tag.className = 'ai-tag miss'; return; }
  $('#aiDesc').textContent = m.desc + '   ·   ' + (m.bytes / 1048576).toFixed(0) + 'MB   ·   ' + m.license;
  // 三种状态要分清：已就绪 / 下载中断（残件）/ 未下载。
  // 第二种最重要 —— 以前它会被当成「已就绪」，点抠图就永久卡死（真 bug，已修）。
  if (m.installed) { tag.textContent = '✓ 已就绪'; tag.className = 'ai-tag ok'; }
  else if (m.corrupt) { tag.textContent = '⚠ 下载不完整'; tag.className = 'ai-tag miss'; }
  else { tag.textContent = '未下载'; tag.className = 'ai-tag miss'; }
  if (m.corrupt) {
    $('#aiDesc').textContent += '   ·   ⚠ 上次下载没完成，请点「重新下载」';
  }
  $('#btnAiDownload').textContent = (m.installed || m.corrupt) ? '重新下载' : ('下载模型 (' + (m.bytes / 1048576).toFixed(0) + 'MB)');
  $('#btnAiDownload').disabled = AI.busy;
  // 只有真下载过（且没在损坏状态）才允许删，避免用户对着不存在的文件点
  if ($('#btnAiDelete')) $('#btnAiDelete').disabled = AI.busy || !(m.installed && !m.corrupt);
  // 自动模式：只要「任意一个」模型已下载就能用（会把它作为提示，但实际跑全部已下载的）
  const anyInstalled = AI.models.some((x) => x.installed);
  const auto = !!($('#chkAiAuto') && $('#chkAiAuto').checked);
  const ready = auto ? anyInstalled : m.installed;
  $('#btnAiSegment').disabled = AI.busy || !ready || !state.frames.length;
  // 「总是跑遍所有模型」只在自动模式下有意义，手动选模型时置灰
  const rowFull = $('#rowAiAlwaysFull');
  if (rowFull) { rowFull.style.opacity = auto ? '' : '0.45'; rowFull.style.pointerEvents = auto ? '' : 'none'; }
  const note = $('#aiAutoNote');
  if (note) {
    const installedIds = AI.models.filter((x) => x.installed).map((x) => x.name);
    if (auto && anyInstalled) {
      note.hidden = false;
      const full = !!($('#chkAiAlwaysFull') && $('#chkAiAlwaysFull').checked);
      note.textContent = full
        ? ('总是全跑：' + installedIds.join(' · ') + '，最准但最慢（约 2.4 秒/帧）。')
        : ('按「先快后慢」试跑：' + installedIds.join(' · ') + '，够干净就提前收手。'
           + (installedIds.length > 1 ? '' : '（只装了一个模型，想更准可再下载其他模型）'));
    } else if (auto) {
      note.hidden = false;
      note.textContent = '自动模式需要至少下载一个模型。';
    } else {
      note.hidden = true;
    }
  }
}

$('#aiModel').onchange = () => { AI.current = $('#aiModel').value; updateAiUi(); };
if ($('#chkAiAuto')) $('#chkAiAuto').onchange = () => updateAiUi();
if ($('#chkAiAlwaysFull')) $('#chkAiAlwaysFull').onchange = () => updateAiUi();
bindRange('aiThresh');

// 删除已下载的模型：给用户一个"下错了/不用了能清掉"的出口。
// 以前模型只能下载、不能在界面里删，只能自己去文件夹找（见 HANDOFF 第 121 条）。
if ($('#btnAiDelete')) $('#btnAiDelete').onclick = async () => {
  const m = currentModel();
  if (!m || !m.installed) return;
  const okDel = window.confirm('删除已下载的模型「' + m.name + '」？\n（省出约 ' + (m.bytes / 1048576).toFixed(0) + 'MB 磁盘；以后想用可以再下载）');
  if (!okDel) return;
  AI.busy = true; updateAiUi();
  try {
    const r = await window.api.deleteModel(m.id);
    if (r && r.ok) {
      setStatus('已删除模型「' + m.name + '」', 'ok');
      await refreshAiModels();
    } else {
      setStatus('删除失败：' + ((r && r.errors) || []).join('; '), 'err');
    }
  } catch (err) {
    console.warn('[ai] 删除模型失败：' + (err && err.message ? err.message : err));
    setStatus('删除异常：' + String((err && err.message) || err), 'err');
  } finally {
    AI.busy = false; updateAiUi();
  }
};

$('#btnAiDownload').onclick = async () => {
  const m = currentModel();
  if (!m) return;
  AI.busy = true; updateAiUi();
  $('#aiProgress').hidden = false;
  $('#aiBar').style.setProperty('--p', '0%');
  $('#aiPct').textContent = '0%';
  setStatus('正在下载模型 ' + m.name + '…');
  const r = await window.api.downloadModel(m.id);
  $('#aiProgress').hidden = true;
  AI.busy = false;
  if (r.ok) { setStatus('模型已就绪：' + m.name + (r.cached ? '（本地已有）' : ''), 'ok'); await refreshAiModels(); }
  else { setStatus('下载失败：' + (r.errors || []).join(';'), 'err'); updateAiUi(); }
};

// 自动模式逐个模型的进度：让用户知道"卡住"其实是在跑第二个模型
window.api.onAutoProgress((p) => {
  if (!p || p.phase !== 'run') return;
  $('#aiProgress').hidden = false;
  $('#aiBar').style.setProperty('--p', Math.round((p.index - 1) / Math.max(1, p.total) * 100) + '%');
  $('#aiPct').textContent = '试跑 ' + p.index + '/' + p.total;
  setStatus('AI 抠图中… 正在试跑模型 ' + p.index + '/' + p.total);
});

window.api.onDownloadProgress((p) => {
  const pct = Math.round((p.percent || 0) * 100);
  $('#aiProgress').hidden = false;
  $('#aiBar').style.setProperty('--p', pct + '%');
  $('#aiPct').textContent = pct + '%';
});

$('#btnAiSegment').onclick = async () => {
  recordUndo();
  const m = currentModel();
  const auto = !!($('#chkAiAuto') && $('#chkAiAuto').checked);
  const alwaysFull = !!(auto && $('#chkAiAlwaysFull') && $('#chkAiAlwaysFull').checked);
  const anyInstalled = AI.models.some((x) => x.installed);
  if (auto ? !anyInstalled : (!m || !m.installed)) { setStatus('请先下载模型', 'err'); return; }
  AI.busy = true; updateAiUi();
  const threshold = parseInt($('#aiThresh').value, 10) / 100;
  let done = 0;
  const chosen = {};      // 每个模型被选中的次数，收尾时告诉用户"为什么选它"
  let lastReason = '';
  let lastStopReason = '';
  for (let i = 0; i < state.frames.length; i++) {
    setStatus(`AI 抠图中… ${i + 1}/${state.frames.length}` + (auto ? '（自动比分数）' : ''));
    const srcFrame = state.frames[i].original || state.frames[i].current;
    if (!srcFrame) throw new Error('第 ' + (i + 1) + ' 帧数据缺失');
    const src = imageDataToDataURL(srcFrame);
    // 自动模式：把已下载的模型都跑一遍，按客观质量分数选最好的（精确率优先）
    const r = auto
      ? await window.api.segmentAuto(src, threshold, 0.12, m ? m.id : null, null, alwaysFull)
      : await window.api.segment(m.id, src, threshold, 0.12);
    if (!r.ok) { setStatus('AI 抠图失败：' + (r.errors || []).join(';'), 'err'); AI.busy = false; updateAiUi(); return; }
    const b64 = r.dataUrl.split(',')[1];
    const decoded = await base64ToImageData(b64);
    state.frames[i].current = decoded.data;
    done++;
    if (r.modelId) { chosen[r.modelId] = (chosen[r.modelId] || 0) + 1; lastReason = r.reason || ''; lastStopReason = r.stopReason || ''; }
    renderPreview();
  }
  // AI 抠图会保留各帧原始尺寸，多帧时需重新统一并对齐
  if (needsFrameNormalize()) unifyAllFrames();
  renderPreview();
  recordUndoAfter();
  AI.busy = false;
  updateAiUi();
  const norm = needsFrameNormalize() ? '（已归一画布/对齐）' : '';
  if (auto) {
    const used = Object.entries(chosen).map(([id, n]) => {
      const mm = AI.models.find((x) => x.id === id);
      return (mm ? mm.name : id) + '×' + n;
    }).join('、');
    setStatus(`✅ AI 抠图完成：${done} 帧，自动选用 ${used}${lastReason ? '（' + lastReason + '）' : ''}${norm}`, 'ok');
  } else {
    setStatus(`✅ AI 抠图完成：${done} 帧${norm}`, 'ok');
  }
};


// ================= 快速模式：上传 -> 启用 / 停用 =================
const QK = { enabled: false };


/** 取当前帧数据（含每帧时长），供快速启用使用 */
function quickFrames() { return currentImages(); }

/** 生成一份「能用就行」的默认包：不做抠图配置也能立刻跑起来 */
function quickPack() {
  const p = readPack();
  p.animation.idle = p.frames.length > 1 ? 'play' : 'breathe';
  return p;
}

/** 更新步骤指示：1=待上传 2=可启用 3=运行中 */
function quickSetStatus(on, text, step) {
  if (step === undefined) step = QK.enabled ? 3 : (state.frames.length ? 2 : 1);
  const t = $('#qbText');
  const num = $('#qbNum');
  const bar = $('#quickbar');
  if (t) t.textContent = text;
  if (num) {
    num.textContent = String(step || 1);
    num.className = 'qb-num' + (step === 3 ? ' done' : '');
  }
  if (bar) bar.classList.toggle('needs-upload', step === 1);
  void on;
}

/** 按当前状态刷新按钮可用性（爬动/摸头始终可见，仅灰显） */
function quickUpdateButtons() {
  const has = state.frames.length > 0;
  const en = $('#btnEnablePet');
  const dis = $('#btnDisablePet');
  const walk = $('#chkWalk');
  const pat = $('#btnPat');
  const hitBtn = $('#btnHit');
  const sayInput = $('#sayInput');
  const sayBtn = $('#btnSay');

  if (en) en.disabled = !has || QK.enabled;
  if (dis) dis.disabled = !QK.enabled;
  if (walk) walk.disabled = !QK.enabled;
  const bugSw = $('#chkBug');
  if (bugSw) bugSw.disabled = !QK.enabled;
  const hopSw = $('#chkHop');
  if (hopSw) hopSw.disabled = !QK.enabled;
  const lookSw = $('#chkLook');
  if (lookSw) lookSw.disabled = !QK.enabled;
  if (pat) pat.disabled = !QK.enabled;
  if (hitBtn) hitBtn.disabled = !QK.enabled;
  if (sayInput) sayInput.disabled = !QK.enabled;
  if (sayBtn) sayBtn.disabled = !QK.enabled || !isSpeakable(sayInput && sayInput.value);

  // 步骤提示文案
  if (QK.enabled) quickSetStatus(true, '桌宠正在桌面上运行', 3);
  else if (has) quickSetStatus(false, '准备好了，点「启用桌宠」', 2);
  else quickSetStatus(false, '拖入一张图片开始', 1);

  // 帧徽章等
}

function bindQuick() {
  const en = $('#btnEnablePet'), dis = $('#btnDisablePet'), pat = $('#btnPat'), walk = $('#chkWalk');
  if (!en) return;

  en.onclick = async () => {
    if (!state.frames.length) { setStatus('请先上传一张图片', 'err'); return; }
    setStatus('正在启用桌宠…');
    const r = await window.api.quickEnable(quickPack(), quickFrames());
    if (r && r.ok) {
      QK.enabled = true;
      quickSetStatus(true, '桌宠正在桌面上运行', 3);
      quickUpdateButtons();
      await window.api.quickSetWalk(walk ? walk.checked : true);
      const bs = $('#chkBug');
      if (bs && window.api.quickSetBugChase) await window.api.quickSetBugChase(bs.checked);
      const hs = $('#chkHop');
      if (hs && window.api.quickSetHop) await window.api.quickSetHop(hs.checked);
      const ls = $('#chkLook');
      if (ls && window.api.quickSetLook) await window.api.quickSetLook(ls.checked);
      setStatus(r.reused ? '✅ 已更新并启用' : '✅ 桌宠已出现在屏幕上', 'ok');
    } else {
      setStatus('启用失败：' + ((r && r.errors) || []).join('; '), 'err');
    }
  };

  dis.onclick = async () => {
    await window.api.quickDisable();
    QK.enabled = false;
    quickUpdateButtons();
    setStatus('已停用桌宠', 'ok');
  };

  // ---- 快捷条「抠图」滑块：背景没扣干净就调大，主体被扣掉就调小。
  // 拖动时立刻用新容差重跑一遍所有帧（体现在预览上），解决"自动抠图不理想就没救"的问题。
  const qTol = $('#qCutTol'), qTolV = $('#qCutTolV'), mainTol = $('#cutTol');
  const pushTol = (v) => {
    const n = Math.max(0, Math.min(140, Math.round(v)));
    if (qTol && qTol.value !== String(n)) qTol.value = String(n);
    if (qTolV) qTolV.textContent = String(n);
    if (mainTol && mainTol.value !== String(n)) { mainTol.value = String(n); }
    const mv = $('#cutTolV'); if (mv) mv.textContent = String(n);
  };
  if (qTol) {
    qTol.oninput = () => {
      pushTol(parseInt(qTol.value, 10));
      if (state.frames.length) rebuildAll();     // 立即重抠
    };
    qTol.onchange = () => setStatus('抠图强度 ' + qTol.value, 'ok');
  }
  if (mainTol) mainTol.addEventListener('input', () => pushTol(parseInt(mainTol.value, 10)));


  // ---- 快捷条「大小」滑块：拖动实时改变正在跑的桌宠（也可直接在桌宠上滚轮） ----
  const qScale = $('#qScale'), qScaleV = $('#qScaleV'), mainScale = $('#scale');
  const pushScale = (pct, fromQuick) => {
    const v = Math.max(10, Math.min(300, Math.round(pct)));
    if (qScale && qScale.value !== String(v)) qScale.value = String(v);
    if (qScaleV) qScaleV.textContent = v + '%';
    if (mainScale && mainScale.value !== String(v)) {
      mainScale.value = String(v);
      if (typeof syncLabels === 'function') syncLabels();
      else { const el = $('#scaleV'); if (el) el.textContent = v + '%'; }
    }
    if (QK.enabled) window.api.setScale(v / 100);
    void fromQuick;
  };
  if (qScale) {
    qScale.oninput = () => pushScale(parseInt(qScale.value, 10), true);
    qScale.onchange = () => setStatus('桌宠大小 ' + qScale.value + '%', 'ok');
  }
  if (mainScale) {
    mainScale.addEventListener('input', () => pushScale(parseInt(mainScale.value, 10), false));
  }

  if (pat) pat.onclick = async () => {
    const r = await window.api.quickPat();
    setStatus(r && r.ok ? '摸了摸头 ✋' : '桌宠未启用', r && r.ok ? 'ok' : 'err');
  };

  const hitBtn = $('#btnHit');
  const sayInput = $('#sayInput');
  const sayBtn = $('#btnSay');

  if (hitBtn) hitBtn.onclick = async () => {
    const r = await window.api.quickHit(-1);   // 从左边打来（向左飞）
    setStatus(r && r.ok ? '给了它一拳 👊' : '桌宠未启用', r && r.ok ? 'ok' : 'err');
  };

  /** 发送当前输入框文本 */
  const doSay = async () => {
    if (!sayInput) return;
    const text = sanitizeSpeech(sayInput.value);
    if (!text) { setStatus('请先输入一句话', 'err'); return; }
    const r = await window.api.quickSay(text);
    if (r && r.ok) {
      setStatus('已让它说：' + text, 'ok');
      sayInput.value = '';
    } else {
      setStatus('说话失败：' + ((r && r.errors) || []).join('; '), 'err');
    }
    quickUpdateButtons();
  };

  if (sayBtn) sayBtn.onclick = doSay;
  if (sayInput) {
    sayInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSay(); } };
    sayInput.oninput = () => quickUpdateButtons();
  }

  const lookSw2 = $('#chkLook');
  if (lookSw2) lookSw2.onchange = async () => {
    if (window.api.quickSetLook) await window.api.quickSetLook(lookSw2.checked);
    setStatus(lookSw2.checked ? '它会朝你的鼠标瞄一眼啦' : '已关掉看向鼠标，它不盯你了', 'ok');
  };

  const hopSw2 = $('#chkHop');
  if (hopSw2) hopSw2.onchange = async () => {
    if (window.api.quickSetHop) await window.api.quickSetHop(hopSw2.checked);
    setStatus(hopSw2.checked ? '桌宠会自己蹦一蹦啦' : '已关掉跳跃，它会安静一些', 'ok');
  };

  const bugSw2 = $('#chkBug');
  if (bugSw2) bugSw2.onchange = async () => {
    if (window.api.quickSetBugChase) await window.api.quickSetBugChase(bugSw2.checked);
    setStatus(bugSw2.checked ? '桌宠会去抓虫子啦' : '已关掉抓虫子', 'ok');
  };

  if (walk) walk.onchange = async () => {
    await window.api.quickSetWalk(walk.checked);
    setStatus(walk.checked ? '已让他到处爬动' : '已停止爬动，安静待着', 'ok');
  };

  if (window.api.onQuickState) {
    window.api.onQuickState((v) => {
      QK.enabled = !!(v && v.enabled);
      quickUpdateButtons();
    });
  }

  window.api.quickIsEnabled().then((r) => {
    QK.enabled = !!(r && r.enabled);
    quickUpdateButtons();
  }).catch(() => {});
}

// ---------------- 角色工坊 ----------------
// 用参数当场画一只原创小人。完全程序化绘制：不联网、不要素材、不要 API Key。
// 几何计算在 shared/charstudio.js（有单测），这里只管读控件 / 重绘预览 / 变成帧。
const ST = { cfg: normalizeCharacter(DEFAULT_CHARACTER), previewTimer: 0, animT: 0, raf: 0 };

/** 比例滑块是否已经显示过（没显示就说明当前不是小人，或还没同步） */
function stPropsVisible() {
  const row = $('#stHeadRow');
  return !!(row && !row.hidden);
}

/**
 * 从比例滑块读比例；滑块不可用时返回 null（表示"沿用 ST.cfg 里的"）。
 * 为什么要这个判断：滑块只在"小人"形体下显示 ——
 * 若在小人以外也去读它们，会把用户精心调好的比例悄悄换成滑块里的旧值。
 */
function stReadProportions() {
  if (!stPropsVisible()) return ST.cfg.proportions;
  const num = (id, dflt) => {
    const el = $('#' + id);
    const v = el ? Number(el.value) / 100 : NaN;
    return Number.isFinite(v) ? v : dflt;
  };
  return {
    head: num('stHead', 0.42), torso: num('stTorso', 0.36),
    leg: num('stLeg', 0.22), arm: num('stArm', 0.42),
  };
}

/** 把比例写进滑块并显示/隐藏那一组控件 */
function stWriteProportions(pr) {
  const rows = ['stHeadRow', 'stTorsoRow', 'stLegRow', 'stArmRow'];
  const hint = $('#stPropHint');
  const isHuman = (($('#stFigure') && $('#stFigure').value) === 'human');
  for (const id of rows) {
    const el = $('#' + id);
    if (el) el.hidden = !isHuman;
  }
  if (hint) hint.hidden = !isHuman;
  if (!isHuman) return;
  const set = (id, v, dflt) => {
    const el = $('#' + id);
    if (!el) return;
    const n = Number(v);
    el.value = String(Math.round((Number.isFinite(n) ? n : dflt) * 100));
  };
  const p = pr || { head: 0.42, torso: 0.36, leg: 0.22, arm: 0.42 };
  set('stHead', p.head, 0.42);
  set('stTorso', p.torso, 0.36);
  set('stLeg', p.leg, 0.22);
  set('stArm', p.arm, 0.42);
}

function stReadCfg() {
  return normalizeCharacter({
    name: $('#stName') ? $('#stName').value : '我的小人',
    bodyShape: $('#stShape') ? $('#stShape').value : 'round',
    earType: $('#stEar') ? $('#stEar').value : 'cat',
    eyeType: $('#stEye') ? $('#stEye').value : 'round',
    mouthType: $('#stMouth') ? $('#stMouth').value : 'smile',
    paletteId: ST.cfg.paletteId,
    // 这两个没有对应的 DOM 控件（由「照照片捏小人」写入），必须从 ST.cfg 带过来。
    // 否则每次读配置都会退回默认比例 —— 白名单式归一化把新字段静默丢掉（踩过）。
    // 比例滑块优先；滑块还没同步过（比如刚载入配置）就沿用 ST.cfg 的比例。
    // 这两个来源必须只有一个权威，否则会互相覆盖（踩过：DOM 覆盖掉照片算出来的比例）。
    proportions: stReadProportions(),
    basePose: ST.cfg.basePose,
    customPalette: ST.cfg.customPalette,
    size: $('#stSize') ? parseInt($('#stSize').value, 10) / 100 : 0.7,
    eyeGap: $('#stGap') ? parseInt($('#stGap').value, 10) / 100 : 0.5,
    eyeSize: $('#stEyeSize') ? parseInt($('#stEyeSize').value, 10) / 100 : 0.5,
    blush: $('#stBlush') ? $('#stBlush').checked : true,
    tail: $('#stTail') ? $('#stTail').checked : true,
    arms: $('#stArms') ? $('#stArms').checked : true,
    legs: $('#stLegs') ? $('#stLegs').checked : true,
    dance: $('#stDance') ? $('#stDance').value : 'none',
    danceSpeed: $('#stSpeed') ? Number($('#stSpeed').value) / 100 : 1,
    figureType: $('#stFigure') ? $('#stFigure').value : 'pet',
  });
}

function stWriteCfg(cfg) {
  const c = normalizeCharacter(cfg);
  ST.cfg = c;
  if ($('#stName')) $('#stName').value = c.name;
  if ($('#stShape')) $('#stShape').value = c.bodyShape;
  if ($('#stEar')) $('#stEar').value = c.earType;
  if ($('#stEye')) $('#stEye').value = c.eyeType;
  if ($('#stMouth')) $('#stMouth').value = c.mouthType;
  if ($('#stSize')) $('#stSize').value = String(Math.round(c.size * 100));
  if ($('#stGap')) $('#stGap').value = String(Math.round(c.eyeGap * 100));
  if ($('#stEyeSize')) $('#stEyeSize').value = String(Math.round(c.eyeSize * 100));
  if ($('#stBlush')) $('#stBlush').checked = c.blush;
  if ($('#stTail')) $('#stTail').checked = c.tail;
  if ($('#stArms')) $('#stArms').checked = c.arms;
  if ($('#stLegs')) $('#stLegs').checked = c.legs;
  if ($('#stDance')) $('#stDance').value = c.dance;
  if ($('#stSpeed')) $('#stSpeed').value = String(Math.round((Number(c.danceSpeed) || 1) * 100));
  if ($('#stFigure')) $('#stFigure').value = c.figureType;
  stWriteProportions(c.proportions);
  stSyncLabels();
  stRenderPalettes();
  stPreview();
}

function stSyncLabels() {
  if ($('#stSizeV')) $('#stSizeV').textContent = $('#stSize').value + '%';
  if ($('#stGapV')) $('#stGapV').textContent = $('#stGap').value + '%';
  if ($('#stEyeSizeV')) $('#stEyeSizeV').textContent = $('#stEyeSize').value + '%';
  if ($('#stFramesV')) $('#stFramesV').textContent = $('#stFrames').value;
  if ($('#stSpeedV') && $('#stSpeed')) {
    $('#stSpeedV').textContent = (Number($('#stSpeed').value) / 100).toFixed(1) + '×';
  }
  for (const [v, s2] of [['stHeadV','stHead'], ['stTorsoV','stTorso'], ['stLegV','stLeg'], ['stArmV','stArm']]) {
    const a = $('#' + v), b = $('#' + s2);
    if (a && b) a.textContent = b.value + '%';
  }
}

function stRenderPalettes() {
  const box = $('#stPalettes');
  if (!box) return;
  if (!box.dataset.built) {
    box.innerHTML = PALETTES.map((p) =>
      '<button type="button" class="st-pal" data-pal="' + p.id + '" title="' + escapeHtml(p.name) + '" style="background:' + p.body + '"></button>'
    ).join('');
    box.dataset.built = '1';
    box.onclick = (e) => {
      const b = e.target.closest('.st-pal');
      if (!b) return;
      // 选预设 = 明确放弃照片取色（否则自定义色会一直盖住预设，点了像没反应）
      ST.cfg = normalizeCharacter({ ...stReadCfg(), paletteId: b.dataset.pal, customPalette: null });
      stRenderPalettes();
      stPreview();
    };
  }
  const custom = ST.cfg.customPalette;
  // 自定义配色时**不高亮任何预设**（否则用户会以为还是那个预设色），
  // 并把「照片取色」那一格高亮出来。
  for (const b of box.querySelectorAll('.st-pal')) {
    b.classList.toggle('on', !custom && b.dataset.pal === ST.cfg.paletteId);
  }
  let cbtn = box.querySelector('.st-pal-custom');
  if (custom) {
    if (!cbtn) {
      cbtn = document.createElement('button');
      cbtn.type = 'button';
      cbtn.className = 'st-pal st-pal-custom';
      cbtn.title = '照片取色（来自你上传的照片）';
      cbtn.onclick = () => {
        // 点一下就退回预设配色（给用户一条"我不想用它"的出路）
        ST.cfg = normalizeCharacter({ ...stReadCfg(), customPalette: null });
        stRenderPalettes();
        stPreview();
        setStatus('已改回预设配色', 'ok');
      };
      box.appendChild(cbtn);
    }
    cbtn.style.background = custom.body;
    cbtn.classList.add('on');
  } else if (cbtn) {
    cbtn.remove();
  }
}

/** 按某个时间点画一帧预览（静态预览与动画循环共用同一条路径） */
function stDrawPreviewAt(cfg, frameSpec) {
  const cv = $('#studioCanvas');
  if (!cv) return;
  // 预览按设备像素比放大，避免高分屏上发虚
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const css = 180;
  renderCharacter(cv, cfg, { width: Math.round(css * dpr), height: Math.round(css * dpr), frame: frameSpec });
  cv.style.width = css + 'px';
  cv.style.height = css + 'px';
}

function stPreview() {
  const cv = $('#studioCanvas');
  if (!cv) return;
  try {
    ST.cfg = stReadCfg();
    // 选了舞蹈 -> 预览也真的动起来（否则用户只能靠导出猜效果）
    if (ST.cfg.dance && ST.cfg.dance !== 'none') { stStartPreviewAnim(); return; }
    stStopPreviewAnim();
    stDrawPreviewAt(ST.cfg, null);
  } catch (err) {
    console.warn('[studio] 预览失败：' + (err && err.message ? err.message : err));
  }
}

// 预览动画循环：和导出的帧用**同一套 characterFrames 采样**，
// 保证「预览里看到的」就是「导出来会得到的」。
function stStartPreviewAnim() {
  if (ST.raf) return;
  const step = () => {
    ST.raf = 0;
    if (!document.querySelector('.tabpane[data-pane="studio"]') ||
        !document.querySelector('.tabpane[data-pane="studio"]').classList.contains('active')) return;  // 离开工坊就停，别白烧 CPU
    const cfg = ST.cfg;
    if (!cfg.dance || cfg.dance === 'none') return;
    // 预览速度跟着「跳舞速度」倍率走 —— 否则用户调了滑块看不出变化。
    ST.animT = (ST.animT + 0.02 * (Number(cfg.danceSpeed) || 1)) % 1;
    try {
      const specs = characterFrames(cfg, 24);
      const spec = specs[Math.min(specs.length - 1, Math.floor(ST.animT * specs.length))];
      stDrawPreviewAt(cfg, spec);
    } catch (err) { return; }
    ST.raf = requestAnimationFrame(step);
  };
  ST.raf = requestAnimationFrame(step);
}

function stStopPreviewAnim() {
  if (ST.raf) { cancelAnimationFrame(ST.raf); ST.raf = 0; }
}

// 拖动滑块时不要每个像素都重画（高频重绘会明显卡顿）
function stSchedulePreview() {
  if (ST.previewTimer) return;
  ST.previewTimer = setTimeout(() => { ST.previewTimer = 0; stPreview(); }, 40);
}

/**
 * 把一段片段帧**统一成主帧的画布尺寸**。
 *
 * ★ 为什么必须做（实测确认的真缺陷）：
 *   运行时切换片段时会按新尺寸重算布局（setupGround + setSize）——
 *   如果片段与主帧尺寸不同，切过去那一瞬间**宠物会突然变大/变小**，
 *   窗口也跟着跳一下。照片路径生成的片段是正方形（560x560），
 *   而主帧是照片尺寸（例如 800x600），正好踩中这个问题。
 *
 * 做法：等比缩放 + 居中放进主帧画布（"contain"）。
 * 尺寸已经一致时**原样返回**，不做任何多余的重编码。
 */
function normalizeClipFramesToMain(frames) {
  const list = Array.isArray(frames) ? frames : [];
  const cur = state.frames[state.activeIdx] || state.frames[0];
  const W = (cur && cur.current && cur.current.width) || 0;
  const H = (cur && cur.current && cur.current.height) || 0;
  if (!W || !H) return list;
  return list.map((f) => {
    const d = f && (f.data || f.current);
    if (!d || !d.width || !d.height) return f;
    if (d.width === W && d.height === H) return f;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tmp = document.createElement('canvas');
    tmp.width = d.width; tmp.height = d.height;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data), d.width, d.height), 0, 0);
    const k = Math.min(W / d.width, H / d.height);
    const w = d.width * k, h = d.height * k;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, d.width, d.height, (W - w) / 2, (H - h) / 2, w, h);
    const out = ctx.getImageData(0, 0, W, H);
    return { data: out, current: out, durationMs: f.durationMs };
  });
}

/**
 * 把工坊角色渲染成一段「片段帧」（带 data，供 clip 使用）。
 * 与 stGenerateFrames 共用同一个渲染入口，保证"看到的"和"存下来的"一致。
 *
 * ★ 尺寸必须**对齐主帧**，不能一律 256x256。
 *   运行时切换片段时会按新尺寸重算布局（setupGround + setSize）——
 *   若片段与主帧尺寸不同，切过去的那一瞬间宠物会**突然变大/变小**。
 *   主帧还没有时（只存片段、不生成主帧）才退回 256x256。
 */
function stRenderClipFrames(cfg, frameCount) {
  const cur = state.frames[state.activeIdx] || state.frames[0];
  const w = (cur && cur.current && cur.current.width) || 256;
  const h = (cur && cur.current && cur.current.height) || 256;
  const list = renderCharacterFrames(cfg, { width: w, height: h, frames: frameCount });
  return list.map((item) => {
    const ctx = item.canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, item.canvas.width, item.canvas.height);
    return { data: d, durationMs: item.durationMs };
  });
}

/** 把工坊角色变成真实的帧，返回加入的帧数 */
function stGenerateFrames(cfg, frameCount) {
  const list = renderCharacterFrames(cfg, { width: 256, height: 256, frames: frameCount });
  const made = [];
  for (let i = 0; i < list.length; i++) {
    const ctx = list[i].canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, list[i].canvas.width, list[i].canvas.height);
    made.push({
      original: d,
      current: d,
      name: (cfg.name || 'pet') + '_' + String(i).padStart(3, '0') + '.png',
      durationMs: list[i].durationMs,
      generatedFrom: 'studio',
    });
  }
  return made;
}

function stBind() {
  if (!$('#studioCanvas')) return;
  stRenderPalettes();
  stWriteCfg(ST.cfg);

  for (const id of ['stName', 'stFigure', 'stShape', 'stEar', 'stEye', 'stMouth', 'stDance']) {
    if ($('#' + id)) $('#' + id).oninput = () => stSchedulePreview();
  }
  for (const id of ['stSize', 'stGap', 'stEyeSize', 'stFrames', 'stSpeed', 'stHead', 'stTorso', 'stLeg', 'stArm']) {
    if ($('#' + id)) $('#' + id).oninput = () => { stSyncLabels(); stSchedulePreview(); };
  }
  // 切形体时，身体比例那组控件要跟着显示/隐藏（宠物没有这些比例）
  if ($('#stFigure')) {
    const prev = $('#stFigure').oninput;
    $('#stFigure').oninput = (e) => {
      if (prev) prev(e);
      stWriteProportions(stReadProportions());
      stSyncLabels();
      stSchedulePreview();
    };
  }
  for (const id of ['stBlush', 'stTail', 'stArms', 'stLegs']) {
    if ($('#' + id)) $('#' + id).onchange = () => stPreview();
  }
  // 切到工坊页才跑预览动画（在别的页上没必要烧 CPU）
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => { setTimeout(() => stPreview(), 30); });
  }

  $('#btnStRandom').onclick = () => { stWriteCfg(randomCharacter()); setStatus('🎲 随机了一只，不喜欢就再点一次', 'ok'); };

  $('#btnStAdd').onclick = () => {
    const cfg = stReadCfg();
    const n = parseInt($('#stFrames').value, 10) || 8;
    const wasEmpty = state.frames.length === 0;
    recordUndo();
    const made = stGenerateFrames(cfg, n);
    state.frames.push(...made);
    state.activeIdx = state.frames.length - made.length;
    syncFrameMeta();
    FS.thumbCache.clear();
    renderPreview();
    updateButtons();
    if (wasEmpty && state.frames.length) establishUndoBaseline();
    else recordUndoAfter();
    if ($('#petName')) $('#petName').value = cfg.name;
    // 生成的帧已经是抠好的（本身就是透明背景）-> 关掉抠图，别把它当照片抠
    if ($('#cutMode')) $('#cutMode').value = 'none';
    setStatus('✅ 已生成 ' + made.length + ' 帧「' + cfg.name + '」，点「启用桌宠」就能上桌', 'ok');
  };

  // ★ 存为动作片段：主帧不动，只把这一段动作登记下来。
  //   多存几段（不同舞步/不同配色），桌宠上桌后会**随机切换**，不会永远重复一个动作。
  //   这条链路此前只接在"照片微动作"上，捏的小人存不了片段 —— 所以只能有一个舞步。
  /**
   * 把一个舞步存成动作片段。单存与"一键存全部"共用这一段，
   * 保证两条路径产生的片段**完全一致**（不会一个走了归一化、另一个没走）。
   * @returns 成功返回片段名，失败返回 null
   */
  let stClipSeq = 0;
  function stPushClip(cfg, n) {
    const frames = normalizeClipFramesToMain(stRenderClipFrames(cfg, n));
    if (!frames.length) return null;
    // ★ id 必须**确定性唯一**：片段 id 会变成包内帧文件名
    //   （clip_<id>_000.png），撞号会让后一段**静默覆盖**前一段的帧 —— 整段动作丢掉。
    //   早先只靠"时间戳+随机数"，而"一键存全部"是同一毫秒内连存 8 段，
    //   生日问题下撞号概率约 3%，太高了。这里加自增序号兜底。
    stClipSeq++;
    const cid = 'c' + Date.now().toString(36) + '_' + stClipSeq.toString(36)
      + Math.floor(Math.random() * 1296).toString(36);
    const dn = (DANCES.find((d) => d.id === cfg.dance) || {}).name;
    const clipName = (cfg.dance && cfg.dance !== 'none' ? dn : cfg.name) || cfg.name;
    state.clips.push({ id: cid, name: String(clipName), weight: 1, frames });
    return String(clipName);
  }

  // ★ 一键存全部舞步：8 个舞步手动点 8 次太烦，而且用户很容易只存一两个，
  //   结果桌宠还是"老重复一个动作"。这个按钮把「舞蹈」里的每个舞步都存一段。
  if ($('#btnStAllClips')) $('#btnStAllClips').onclick = () => {
    const cfg = stReadCfg();
    const n = parseInt($('#stFrames').value, 10) || 8;
    // 跳过 "不跳"（那是静止姿态，不是动作）—— 存进去只会稀释其它动作的出现频率
    const ids = DANCES.map((d) => d.id).filter((id) => id !== 'none');
    recordUndo();
    const names = [];
    for (const id of ids) {
      const nm = stPushClip({ ...cfg, dance: id }, n);
      if (nm) names.push(nm);
    }
    if (!names.length) { setStatus('没能生成动作片段', 'err'); return; }
    renderClipList();
    recordUndoAfter();
    setStatus('✅ 已一次存下 ' + names.length + ' 段动作：' + names.join(' / ')
      + '。导出后桌宠会随机换着跳（每段旁的 −/＋ 可调出现频率）', 'ok');
  };

  if ($('#btnStAddClip')) $('#btnStAddClip').onclick = () => {
    const cfg = stReadCfg();
    const n = parseInt($('#stFrames').value, 10) || 8;
    recordUndo();
    const clipName = stPushClip(cfg, n);
    if (!clipName) { setStatus('生成片段失败：没有帧', 'err'); return; }
    renderClipList();
    recordUndoAfter();
    setStatus('✅ 已存为动作片段「' + clipName + '」。'
      + '再换个舞步继续存，导出后桌宠会随机切换（当前共 ' + state.clips.length + ' 段）', 'ok');
  };

  $('#btnStReplace').onclick = () => {
    if (!state.frames.length) { setStatus('还没有帧，先用「生成动画帧」', 'err'); return; }
    const cfg = stReadCfg();
    const n = parseInt($('#stFrames').value, 10) || 8;
    recordUndo();
    const made = stGenerateFrames(cfg, n);
    const r = replaceFrameAt(state.frames, state.activeIdx, made[0]);
    if (!r.replaced) { setStatus('替换失败', 'err'); return; }
    state.frames = r.frames;
    state.activeIdx = r.activeIdx;
    FS.thumbCache.clear();
    syncFrameMeta();
    renderPreview();
    updateButtons();
    recordUndoAfter();
    setStatus('✅ 已用「' + cfg.name + '」替换第 ' + (r.activeIdx + 1) + ' 帧（可 Ctrl+Z 撤销）', 'ok');
  };

  $('#btnStSaveChar').onclick = async () => {
    const cfg = stReadCfg();
    const r = await window.api.saveCharacter ? await window.api.saveCharacter(cfg) : { ok: false, errors: ['当前版本不支持'] };
    if (r && r.ok) setStatus('✅ 角色配置已保存到：' + r.path, 'ok');
    else if (r && r.canceled) setStatus('已取消');
    else setStatus('保存失败：' + ((r && r.errors) || []).join(';'), 'err');
  };

  $('#btnStLoadChar').onclick = async () => {
    const r = await window.api.loadCharacter ? await window.api.loadCharacter() : { ok: false, errors: ['当前版本不支持'] };
    if (r && r.ok && r.character) { stWriteCfg(r.character); setStatus('✅ 已载入角色：' + r.character.name, 'ok'); }
    else if (r && r.canceled) setStatus('已取消');
    else setStatus('载入失败：' + ((r && r.errors) || []).join(';'), 'err');
  };
}

// ================= 初始化 =================
bindQuick();
stBind();
syncLabels();
updateButtons();
setStatus('就绪');
refreshAiModels();
// 版本号来自 package.json（app.getVersion()），UI 不硬编码
if (window.api.appVersion) {
  window.api.appVersion().then((v) => {
    const el = document.getElementById('appVer');
    if (el && v) el.textContent = 'v' + v;
  }).catch(() => {});
}
console.log('MAKER_READY imageops=' + typeof floodCut + ' gif=' + typeof decodeGif);
