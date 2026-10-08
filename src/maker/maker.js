// 桌宠制作器 - 渲染进程
import {
  floodCut, colorKeyCut, keepLargestComponent, trimBounds, cropData, flipHorizontal, alignFrames,
} from '../shared/imageops.js';
import { decodeGif, parseGifHeader } from '../shared/gif.js';
import { synthesizeMotion, MOTION_NAMES, motionCanvasSize } from '../shared/motion.js';
import { fitFrameLimit, fmtBytes } from '../shared/budget.js';
import { sanitizeSpeech, isSpeakable, pushSpeech } from '../shared/speech.js';

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
  if (mode !== 'none' && state.frames.length > 1) {
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
async function addFrameFromDataUrl(dataUrl, name) {
  if (isGif(dataUrl, name)) return addGifFrames(dataUrl, name); // 返回帧数
  const img = await loadImage(dataUrl);
  const d = drawToImageData(img);
  state.frames.push({ original: d, current: d, name: name || 'frame' });
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
  if (pack.render) $('#scale').value = Math.round((pack.render.scale ?? 0.6) * 100);
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

bindRange('cutTol'); bindRange('cutFeather'); bindRange('scale'); bindRange('idleSpeed');
bindRange('fps'); bindRange('gifMaxFrames'); bindRange('roamSpeed'); bindRange('gravity'); bindRange('bounce');
bindRange('friction'); bindRange('throwScale'); bindRange('interval'); bindRange('duration');

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
  setStatus(r.ok ? '✅ 已导出：' + r.path : '导出失败：' + (r.errors || []).join(';'), r.ok ? 'ok' : 'err');
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
  '【退不出去？】按 Ctrl+Alt+Q 可在任何情况下强制退出桌宠；\n' +
  '  也可以把鼠标移到桌宠身上（不是周围空白）右键 → 退出桌宠。'
);

// 拖拽
const stage = $('#stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault(); stage.classList.remove('dragover');
  const files = [...(e.dataTransfer.files || [])].filter((f) => /^image\//.test(f.type));
  if (!files.length) { setStatus('只支持图片文件', 'err'); return; }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of files) {
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    await addFrameFromDataUrl(dataUrl, f.name);
  }
  await rebuildAll();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.tabpane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
  };
});

// ---------------- 宠物库 ----------------
async function refreshLibrary() {
  const grid = $('#libGrid');
  grid.innerHTML = '<div class="lib-empty">加载中…</div>';
  const list = await window.api.listInstalled();
  if (!list.length) { grid.innerHTML = '<div class="lib-empty">还没有已安装的宠物<br />点击下方「安装宠物包…」</div>'; return; }
  grid.innerHTML = '';
  for (const it of list) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    if (it.broken) {
      el.innerHTML = `<div class="nm">⚠ 损坏</div><div class="meta">${it.id}</div>`;
    } else {
      el.innerHTML = `<img src="${it.thumb}" alt="" /><div class="nm">${escapeHtml(it.name)}</div><div class="meta">${it.frames} 帧 · ${(it.size / 1024).toFixed(0)} KB</div>`;
    }
    const acts = document.createElement('div');
    acts.className = 'acts';
    if (!it.broken) {
      const run = document.createElement('button'); run.className = 'primary'; run.textContent = '启动';
      run.onclick = async () => { const r = await window.api.runInstalled(it.id); setStatus(r.ok ? '已启动 ' + it.name : '启动失败', r.ok ? 'ok' : 'err'); };
      acts.appendChild(run);
    }
    const del = document.createElement('button'); del.textContent = '删除';
    del.onclick = async () => { await window.api.uninstall(it.id); refreshLibrary(); };
    acts.appendChild(del);
    el.appendChild(acts);
    grid.appendChild(el);
  }
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
$('#motionAmp') && $('#motionAmp').addEventListener('input', () => syncLabels());

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
  if (m.installed) { tag.textContent = '✓ 已就绪'; tag.className = 'ai-tag ok'; }
  else { tag.textContent = '未下载'; tag.className = 'ai-tag miss'; }
  $('#btnAiDownload').textContent = m.installed ? '重新下载' : ('下载模型 (' + (m.bytes / 1048576).toFixed(0) + 'MB)');
  $('#btnAiDownload').disabled = AI.busy;
  $('#btnAiSegment').disabled = AI.busy || !m.installed || !state.frames.length;
}

$('#aiModel').onchange = () => { AI.current = $('#aiModel').value; updateAiUi(); };
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

window.api.onDownloadProgress((p) => {
  const pct = Math.round((p.percent || 0) * 100);
  $('#aiProgress').hidden = false;
  $('#aiBar').style.setProperty('--p', pct + '%');
  $('#aiPct').textContent = pct + '%';
});

$('#btnAiSegment').onclick = async () => {
  const m = currentModel();
  if (!m) return;
  if (!m.installed) { setStatus('请先下载模型', 'err'); return; }
  AI.busy = true; updateAiUi();
  const threshold = parseInt($('#aiThresh').value, 10) / 100;
  let done = 0;
  for (let i = 0; i < state.frames.length; i++) {
    setStatus(`AI 抠图中… ${i + 1}/${state.frames.length}`);
    const srcFrame = state.frames[i].original || state.frames[i].current;
    if (!srcFrame) throw new Error('第 ' + (i + 1) + ' 帧数据缺失');
    const src = imageDataToDataURL(srcFrame);
    const r = await window.api.segment(m.id, src, threshold, 0.12);
    if (!r.ok) { setStatus('AI 抠图失败：' + (r.errors || []).join(';'), 'err'); AI.busy = false; updateAiUi(); return; }
    const b64 = r.dataUrl.split(',')[1];
    const decoded = await base64ToImageData(b64);
    state.frames[i].current = decoded.data;
    done++;
    renderPreview();
  }
  // AI 抠图会保留各帧原始尺寸，多帧时需重新统一并对齐
  if (needsFrameNormalize()) unifyAllFrames();
  renderPreview();
  AI.busy = false;
  updateAiUi();
  setStatus(`✅ AI 抠图完成：${done} 帧` + (needsFrameNormalize() ? '（已归一画布/对齐）' : ''), 'ok');
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