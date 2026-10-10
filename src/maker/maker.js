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
import { emptyState, normalizeState, isFavorite, toggleFavorite, filterLibrary } from '../shared/library.js';
import { classifyDroppedFiles, isShareFile } from '../shared/dnd.js';
import { PERSONALITY_TEMPLATES, applyTemplate, templateFlags, matchTemplate } from '../shared/templates.js';
import { applyCustomTemplate, matchCustomTemplate } from '../shared/mytemplates.js';

const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = 'status ' + cls; }

const state = {
  frames: [],        // [{ original: ImageData, current: ImageData, name }]
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
  const multi = state.frames.length > 1;
  $('#btnPrevFrame').disabled = !multi;
  $('#btnNextFrame').disabled = !multi;
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
    canvas: { width: state.frames[0] ? state.frames[0].current.width : 0, height: state.frames[0] ? state.frames[0].current.height : 0 },
    render: { scale: parseInt($('#scale').value, 10) / 100, flip: false },
    animation: {
      idle: $('#idleAnim').value,
      idleSpeed: parseInt($('#idleSpeed').value, 10) / 100,
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
    behavior: { startCorner: $('#corner').value, keepAbove: $('#keepAbove').checked },
  };
}

function currentImages() {
  return state.frames.map((f) => ({ dataUrl: imageDataToDataURL(f.current), durationMs: Math.round(1000 / parseInt($('#fps').value, 10)) }));
}

function applyPack(pack) {
  $('#petName').value = pack.name || '我的桌宠';
  $('#petAuthor').value = pack.author || '';
  if (pack.render) $('#scale').value = Math.round((pack.render.scale ?? 0.3) * 100);
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
  state.frames = []; state.activeIdx = 0;
  $('#stageEmpty').hidden = false; $('#stageView').hidden = true; $('#frameBadge').hidden = true;
  updateButtons(); setStatus('已清空');
};
$('#btnCut').onclick = () => rebuildAll();
$('#btnTrim').onclick = async () => {
  if (!state.frames.length) return;
  for (const f of state.frames) {
    const b = trimBounds(f.current.data, f.current.width, f.current.height, { pad: 2 });
    if (b.w !== f.current.width || b.h !== f.current.height) f.current = toImageData(cropData(f.current.data, f.current.width, f.current.height, b));
  }
  renderPreview(); setStatus('已裁边', 'ok');
};
$('#btnReset').onclick = async () => {
  // 若当前是「生成动画」产出的帧，回退到生成前的源帧
  const gen = state.frames.find((f) => f.generatedFrom);
  if (gen && gen.motionSource) {
    state.frames = [{ original: gen.motionSource, current: gen.motionSource, name: gen.generatedFrom }];
    state.activeIdx = 0;
    renderPreview();
    updateButtons();
    setStatus('已恢复到生成动画前的原图', 'ok');
    return;
  }
  for (const f of state.frames) if (f.original) f.current = f.original;
  await rebuildAll();
};
$('#chkFlip').onchange = () => rebuildAll();
$('#chkUniform').onchange = () => rebuildAll();
$('#alignMode').onchange = () => rebuildAll();
$('#chkLargest').onchange = () => rebuildAll();
$('#chkPlay').onchange = (e) => { state.playing = e.target.checked; if (!state.playing) renderPreview(); };

$('#btnPrevFrame').onclick = () => { if (state.frames.length) { state.activeIdx = (state.activeIdx - 1 + state.frames.length) % state.frames.length; renderPreview(); } };
$('#btnNextFrame').onclick = () => { if (state.frames.length) { state.activeIdx = (state.activeIdx + 1) % state.frames.length; renderPreview(); } };

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

$('#previewImg').onclick = () => { state.clickP = 1; };

$('#btnPreviewPet').onclick = async () => {
  if (!state.frames.length) return;
  setStatus('正在启动桌面预览…');
  const r = await window.api.launchPreview(readPack(), currentImages());
  setStatus(r.ok ? '预览已启动（查看屏幕右下角）' : '预览失败：' + (r.errors || []).join(';'), r.ok ? 'ok' : 'err');
};
$('#btnExport').onclick = async () => {
  if (!state.frames.length) return;
  const r = await window.api.savePack(readPack(), currentImages(), $('#petName').value || 'mypet');
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
  const r = await window.api.exportShareHtml(readPack(), currentImages());
  if (r.canceled) { setStatus('已取消'); return; }
  if (!r.ok) { setStatus('导出失败：' + (r.errors || []).join(';'), 'err'); return; }
  setStatus('✅ 分享页已导出（' + Math.round(r.bytes / 1024) + ' KB）：' + r.path, 'ok');
  showShareHint(r.path, $('#petName').value || '我的桌宠');
};

$('#btnExportFolder').onclick = async () => {
  if (!state.frames.length) { setStatus('请先导入图片', 'err'); return; }
  const r = await window.api.exportFolder(readPack(), currentImages());
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

$('#btnHelp').onclick = () => alert(
  '使用步骤：\n' +
  '1. 拖入或选择角色图片（纯色背景效果最佳）\n' +
  '2. 「抠图」页调整模式与容差，点“应用到所有帧”\n' +
  '3. 拖入 GIF 会自动拆帧；多张图片 = 多帧动画；单张图可用「从单张图生成动画」\n' +
  '   多帧时用「多帧对齐方式」把主体对齐，可消除播放抖动\n' +
  '4. 「外观/动画/物理/气泡」调参数，画布实时预览\n' +
  '5. 点「桌面预览」真实体验，满意后「导出桌宠包」\n\n' +
  '导出的 .petpack 可在「宠物库」安装后随时启动。\n' +
  '命令行运行：npm run pet -- --pet=xxx.petpack\n\n' +
  '【想关掉桌宠？】三种方式，任选一种：\n' +
  '  · 任务栏右下角托盘图标 → 右键 → 「退出桌宠」（推荐）\n' +
  '  · 按 Ctrl+Alt+Q（全局快捷键，任何情况下都有效）\n' +
  '  · 把鼠标移到桌宠身上（不是周围空白）右键 → 退出桌宠\n\n' +
  '【关掉制作器窗口后】托盘图标会继续留在任务栏右下角，\n' +
  '  随时可以右键退出桌宠，或重新打开制作器。'
);

// 拖拽
const stage = $('#stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));

// 整窗兜底：用户可能把文件拖到标题栏/侧栏上，而不是正好落在图片区
// —— 收到宠物包的人最自然的动作就是「把它拖进窗口」，这条路径必须能用。
document.addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types) e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  // 图片区的 drop 已处理过就跳过（避免同一文件被处理两次）
  if (e.defaultPrevented && e.target && e.target.closest && e.target.closest('#stage')) return;
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

/** 拖入 .petpack：安装并直接启动 —— 给「收到宠物包的人」一条最短路径 */
async function handleDroppedPacks(files) {
  for (const f of files) {
    const p = (window.api.pathForFile && window.api.pathForFile(f)) || '';
    if (!p) { setStatus('无法读取文件路径，请改用「宠物库 → 安装宠物包…」', 'err'); continue; }
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
  for (const f of files) {
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    await addFrameFromDataUrl(dataUrl, f.name);
  }
  await rebuildAll();
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

  grid.innerHTML = '';
  for (const it of list) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    if (it.broken) {
      el.innerHTML = '<div class="nm">⚠ 损坏</div><div class="meta">' + escapeHtml(it.id) + '</div>';
    } else {
      const fav = isFavorite(libPrefs, it.id);
      el.innerHTML = '<img src="' + it.thumb + '" alt="" />'
        + '<button class="lib-fav' + (fav ? ' on' : '') + '" title="'
        + (fav ? '取消收藏' : '收藏') + '">' + (fav ? '★' : '☆') + '</button>'
        // 只给「用户自己装的」打标：内置宠物占多数，全都标反而成了噪音
        + (it.builtin ? '' : '<span class="lib-badge mine">我的</span>')
        + '<div class="nm">' + escapeHtml(it.name) + '</div>'
        + '<div class="meta">' + it.frames + ' 帧 · ' + (it.size / 1024).toFixed(0) + ' KB</div>';
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

$('#btnLibrary').onclick = () => { $('#libModal').hidden = false; refreshLibrary(); };
$('#btnLibClose').onclick = () => { $('#libModal').hidden = true; };
$('#libModal').onclick = (e) => { if (e.target.id === 'libModal') $('#libModal').hidden = true; };
$('#btnLibOpenDir').onclick = () => window.api.openDataDir();
$('#btnLibInstall').onclick = async () => {
  const r = await window.api.openPack();
  if (!r || r.error) return;
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

// ================= 初始化 =================
bindQuick();
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