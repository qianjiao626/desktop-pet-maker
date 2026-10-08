// 桌宠运行时：多帧渲染 + 物理 + 拖拽抛掷 + 漫游 + 气泡 + 像素级穿透
import { createBody, stepBody, estimateThrowVelocity, clampIntoArea } from '../shared/physics.js';
import { pickAreaForBounds, areaChanged } from '../shared/displays.js';
import { planRuntimeFrames } from '../shared/budget.js';
import { createBehavior, tickBehavior, pat as doPat, isWalking, targetVelocityX, stateLabel, hit as doHit, isReacting } from '../shared/behavior.js';
import { sanitizeSpeech, speechDuration } from '../shared/speech.js';
import { handState, fistState, HAND_DURATION, FIST_DURATION } from '../shared/effects.js';
import { computeLayout, computeFramePlacement, OVER, MARGIN } from '../shared/layout.js';

const api = window.api;
const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubbleEl = $('#bubble');
const bubbleText = $('#bubbleText');
const menuEl = $('#menu');

let pack = null;
let images = [];            // HTMLImageElement[]
let frameDurs = [];         // ms
let W = 0, H = 0;           // 窗口尺寸
let workArea = { x: 0, y: 0, width: 1280, height: 720 };
let area = { x: 0, y: 0, width: 1280, height: 720 };
let allAreas = [];   // 所有显示器工作区（多屏时按位置动态选边界）
let canvasCssW = 0, canvasCssH = 0;
let topPad = 0;
let frameDraw = [];         // 每帧绘制尺寸与位置
let frameCanvasPos = [];    // 每帧在 canvas 内的左上角
let alphaMaps = [];         // Uint8Array[]
let alphaW = 0, alphaH = 0;


// 待机行为（爬动 / 发呆 / 打瞌睡 / 摸头反应）
const B = createBehavior();
let behaviorEnabled = true;   // 可由「让他爬动」开关控制
let walkSpeed = 60;           // px/s

let hitFx = 0;          // 受击特效强度 0..1（用于抖动/闪烁）
let handStartAt = 0;    // 摸头的手：动画开始时间（0=不显示）
let fistStartAt = 0;    // 拳头：动画开始时间（0=不显示）
let fistDir = 1;        // 拳头来向 1=从右来 / -1=从左来
let hitKnockDir = 0;    // 击退方向

const S = {
  body: createBody(0, 0),
  dragging: false, hover: false,
  ignoreMouse: true, topmost: true,
  clickP: 0, clickAnim: 'bounce',
  frameIdx: 0, frameT: 0, oneshotDone: false,
  bubbleTimer: 4, bubbleHideAt: 0,
  scaleMul: 1, scaleTarget: 1,
};

/**
 * 依据宠物当前窗口矩形，选出它实际所处显示器的工作区作为物理边界。
 * 否则宠物被拖到副屏后会被主屏边界强行拉回。
 */
/** 判断当前是否贴左右边界（用于避免朝墙走的「原地踏步」） */
function edgeInfo() {
  const left = area.x;
  const right = area.x + area.width - W;
  const margin = 8;
  return {
    leftEdge: S.body.x <= left + margin,
    rightEdge: S.body.x >= right - margin,
  };
}

function refreshArea(force = false) {
  if (allAreas.length <= 1 && !force) return false;
  const picked = pickAreaForBounds({ x: S.body.x, y: S.body.y, width: W, height: H }, allAreas);
  if (!picked || !areaChanged(picked, area)) {
    if (picked && !area) { area = picked; return true; }
    return false;
  }
  area = picked;
  return true;
}

function showErr(msg) {
  const e = $('#err');
  e.hidden = false;
  e.textContent = '加载失败：' + msg;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('帧图片解码失败'));
    im.src = src;
  });
}

// ---------------- 尺寸 ----------------
function computeSizes() {
  const scale = pack.render.scale;
  const sizes = images.map((im) => ({ w: im.naturalWidth, h: im.naturalHeight }));
  // 与主进程共用同一套布局公式（src/shared/layout.js），避免尺寸脱节
  const L = computeLayout(pack, sizes);
  W = L.W; H = L.H;
  canvasCssW = L.canvasCssW;
  canvasCssH = L.canvasCssH;
  topPad = L.topPad;

  const placed = computeFramePlacement(sizes, scale, canvasCssW, canvasCssH);
  frameDraw = placed.draw;
  frameCanvasPos = placed.pos;

  canvas.width = canvasCssW;
  canvas.height = canvasCssH;
  canvas.style.width = canvasCssW + "px";
  canvas.style.height = canvasCssH + "px";
}

function buildAlphaMaps() {
  alphaMaps = images.map((im, i) => {
    const w = Math.max(1, Math.round(frameDraw[i].w));
    const h = Math.max(1, Math.round(frameDraw[i].h));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, w, h);
    cx.drawImage(im, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const m = new Uint8Array(w * h);
    // 同时求「实际不透明像素」的边界：合成/未裁边的素材四周有透明留白，
    // 若用帧包围盒定位特效，手会浮在主体上方（实测约 13px）。
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      m[p] = d[p * 4 + 3];
      if (d[p * 4 + 3] > 16) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    const content = (!m.length || bx1 < 0)
      ? { x0: 0, y0: 0, x1: 1, y1: 1 }
      : { x0: bx0 / w, y0: by0 / h, x1: (bx1 + 1) / w, y1: (by1 + 1) / h };
    return { data: m, w, h, content };
  });
  alphaW = alphaMaps[0] ? alphaMaps[0].w : 0;
  alphaH = alphaMaps[0] ? alphaMaps[0].h : 0;
}

// ---------------- 命中测试（像素级） ----------------
function isOverPet(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left) / rect.width * canvasCssW;
  const cy = (clientY - rect.top) / rect.height * canvasCssH;
  const i = S.frameIdx;
  const pos = frameCanvasPos[i], d = frameDraw[i], am = alphaMaps[i];
  if (!pos || !am) return false;
  const fx = (cx - pos.x) / d.w;
  const fy = (cy - pos.y) / d.h;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return false;
  const ax = Math.floor(fx * am.w), ay = Math.floor(fy * am.h);
  return am.data[ay * am.w + ax] > 24;
}

// ---------------- 渲染 ----------------
const IDLE_TRANSFORM = { scaleX: 1, scaleY: 1, rot: 0, dx: 0, dy: 0 };

function computeTransform(now) {
  const t = now / 1000;
  const a = pack.animation;
  const speed = Number.isFinite(a.idleSpeed) && a.idleSpeed > 0 ? a.idleSpeed : 1;
  const o = { scaleX: 1, scaleY: 1, rot: 0, dx: 0, dy: 0 };

  const playing = images.length > 1 && (a.idle === 'play' || a.idle === 'once');
  if (!playing) {
    if (a.idle === 'breathe') {
      const s = Math.sin(t * 2.0 * speed);
      o.scaleX = 1 - s * 0.014;
      o.scaleY = 1 + s * 0.028;
    } else if (a.idle === 'sway') {
      o.rot = Math.sin(t * 1.6 * speed) * 3.5;
    }
  }

  if (S.hover && a.hover === 'grow') { o.scaleX *= 1.06; o.scaleY *= 1.06; }

  // 受击特效：短促抖动 + 闪白边
  if (hitFx > 0) {
    hitFx = Math.max(0, hitFx - 0.06);
    const k = hitFx;
    o.dx += Math.sin(k * 55) * 9 * k;
    o.dy -= Math.sin(k * Math.PI) * 5;
    o.rot += Math.sin(k * 60) * 10 * k;
    o.scaleX *= 1 + 0.10 * k;
    o.scaleY *= 1 - 0.07 * k;
  }

  // 行为姿态：打瞌睡时轻微下沉缩小，爬动时随步伐轻摆
  if (behaviorEnabled) {
    if (B.state === 'doze') {
      o.scaleY *= 0.96;
      o.scaleX *= 1.03;
    } else if (B.state === 'pat') {
      o.dy -= 6;
      o.scaleY *= 1.06;
      o.scaleX *= 0.97;
    } else if (B.state === 'walk') {
      const t2 = now / 1000;
      o.rot += Math.sin(t2 * 12) * 2.2 * B.walkDir;
    }
  }

  if (S.clickP > 0) {
    S.clickP = Math.max(0, S.clickP - 0.045);
    const p = S.clickP, k = Math.sin(p * Math.PI);
    if (S.clickAnim === 'bounce') { o.dy = -18 * k; o.scaleX *= 1 + 0.1 * k; o.scaleY *= 1 + 0.1 * k; }
    else if (S.clickAnim === 'jump') { o.dy = -40 * k; }
    else if (S.clickAnim === 'shake') { o.rot = Math.sin(p * 40) * 12 * p; }
    else if (S.clickAnim === 'spin') {
      o.rot = (1 - p) * 360;
      o.scaleX = 1; // 需用 rotate 整体
    }
  }
  return o;
}

function advanceFrame(dtMs) {
  if (images.length < 2) return;
  const a = pack.animation;
  if (a.idle !== 'play' && a.idle !== 'once') return;
  S.frameT += dtMs;
  const dur = frameDurs[S.frameIdx] || (1000 / a.fps);
  while (S.frameT >= dur) {
    S.frameT -= dur;
    if (S.frameIdx + 1 >= images.length) {
      if (a.idle === 'once') { S.frameIdx = images.length - 1; return; }
      S.frameIdx = 0;
    } else S.frameIdx++;
  }
}

// ---------------- 交互特效：手 / 拳头 ----------------
/** 手掌尺寸：按宠物宽度自适应并限幅（drawHand 与气泡避让共用同一套数值） */
function handPalmSize(w) {
  const palmW = Math.max(32, Math.min(96, (w || 0) * 0.46));
  return { palmW, palmH: palmW * 0.95 };
}

/** 圆头指节路径（指根为平口，指尖为圆头） */
function fingerPath(c, x, y, w, h) {
  const r = w * 0.5;
  c.beginPath();
  c.moveTo(x - w / 2, y);
  c.lineTo(x - w / 2, y + h - r);
  c.quadraticCurveTo(x - w / 2, y + h, x, y + h);
  c.quadraticCurveTo(x + w / 2, y + h, x + w / 2, y + h - r);
  c.lineTo(x + w / 2, y);
  c.closePath();
}

// 卡通写实皮肤配色（统一一套，手与拳共用）
const SKIN_HI = "#ffe8d1";
const SKIN = "#f6c49b";
const SKIN_MID = "#e8b183";
const SKIN_DK = "#d99f70";
const SKIN_LINE = "rgba(164,102,64,.55)";
const SKIN_CREASE = "rgba(164,102,64,.30)";

/** 画一只从上伸下来的手（摸头）：俯视手背，手指向下自然搭在头顶 */
function drawHand(now, petRect) {
  if (!handStartAt) return;
  const prog = (now - handStartAt) / HAND_DURATION;
  if (prog >= 1) { handStartAt = 0; return; }
  const st = handState(prog);
  if (!st.visible) return;

  const palmW = handPalmSize(petRect.w).palmW;   // 手的整体宽度
  const FL = palmW * 0.64;                       // 手指长度（≈掌高，接近真实比例）
  const palmWid = palmW;                         // 手掌宽
  const palmHt = palmW * 0.56;                   // 手掌高：明显宽大于高
  // 原点 y=0 定在「指尖落点」：st.y=0 时指尖正好触到头顶
  const tipYCanvas = petRect.top + st.y * petRect.h + 3;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(petRect.cx, tipYCanvas);
  ctx.scale(st.scale, st.scale);

  const palmBot = -FL;                 // 掌下沿（指根线）
  const palmTop = palmBot - palmHt;    // 掌上沿

  // ---- 落在头顶的接触阴影：按压时最明显，制造"分量感" ----
  if (st.press > 0.03) {
    ctx.save();
    ctx.globalAlpha = st.alpha * st.press * 0.20;
    const gsh = ctx.createRadialGradient(0, -palmW * 0.04, 1, 0, -palmW * 0.04, palmWid * 0.60);
    gsh.addColorStop(0, "rgba(70,36,12,.40)");
    gsh.addColorStop(0.6, "rgba(70,36,12,.14)");
    gsh.addColorStop(1, "rgba(70,36,12,0)");
    ctx.fillStyle = gsh;
    ctx.beginPath();
    ctx.ellipse(0, -palmW * 0.04, palmWid * 0.60, palmW * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- 前臂：自手掌上沿向上延伸，顶端贴到画布时渐隐（像从画面外伸入）----
  const armW = palmWid * 0.66;
  const armBot = palmTop + palmHt * 0.06;
  const armTop = Math.max(palmTop - palmW * 2.0, -tipYCanvas + 8);
  const gArm = ctx.createLinearGradient(0, armTop, 0, armBot);
  gArm.addColorStop(0, "rgba(246,196,155,0)");
  gArm.addColorStop(0.34, "rgba(246,196,155,.22)");
  gArm.addColorStop(0.70, "rgba(246,196,155,.72)");
  gArm.addColorStop(1, SKIN);
  ctx.fillStyle = gArm;
  ctx.beginPath();
  ctx.moveTo(-armW * 0.46, armTop);
  ctx.quadraticCurveTo(-armW * 0.56, armBot - (armBot - armTop) * 0.35, -armW * 0.5, armBot);
  ctx.lineTo(armW * 0.5, armBot);
  ctx.quadraticCurveTo(armW * 0.56, armBot - (armBot - armTop) * 0.35, armW * 0.46, armTop);
  ctx.closePath();
  ctx.fill();
  // 手腕褶皱
  ctx.strokeStyle = SKIN_CREASE;
  ctx.lineWidth = 1.1;
  for (const i of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(i * armW * 0.16, armBot - palmHt * 0.30);
    ctx.quadraticCurveTo(i * armW * 0.30, armBot - palmHt * 0.24, i * armW * 0.40, armBot - palmHt * 0.34);
    ctx.stroke();
  }

  // ---- 四指：中指最长，食指/无名指/小指依次略短 ----
  const fingerW = palmWid * 0.214;
  const gap = palmWid * 0.238;
  const lensK = [0.90, 0.985, 1.0, 0.905];
  for (let i = 0; i < 4; i++) {
    const fx = -gap * 1.5 + i * gap;
    const fLen = FL * lensK[i];
    const tip = -FL + fLen;

    fingerPath(ctx, fx, palmBot, fingerW, fLen);
    const gF = ctx.createLinearGradient(fx - fingerW * 0.5, 0, fx + fingerW * 0.5, 0);
    gF.addColorStop(0, SKIN_MID);
    gF.addColorStop(0.42, SKIN);
    gF.addColorStop(1, SKIN_HI);
    ctx.fillStyle = gF;
    ctx.fill();
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 两处指节横纹
    ctx.strokeStyle = SKIN_CREASE;
    ctx.lineWidth = 1;
    for (const k of [0.40, 0.70]) {
      const yy = palmBot + fLen * k;
      const hw = fingerW * (0.46 - k * 0.10);
      ctx.beginPath();
      ctx.moveTo(fx - hw, yy);
      ctx.quadraticCurveTo(fx, yy + fingerW * 0.12, fx + hw, yy);
      ctx.stroke();
    }
    // 指甲
    ctx.beginPath();
    ctx.ellipse(fx, tip + fingerW * 0.40, fingerW * 0.30, fingerW * 0.40, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,228,222,.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(186,126,96,.35)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  // ---- 拇指：自左侧掌缘斜向外下方垂开（先画，掌缘会盖住其根部）----
  ctx.save();
  ctx.translate(-palmWid * 0.38, palmTop + palmHt * 0.78);
  ctx.rotate(0.78);                                  // 朝画面左下外方，掌缘盖住根部
  const thW = palmWid * 0.196, thLen = palmWid * 0.40;
  fingerPath(ctx, 0, 0, thW, thLen);
  const gT = ctx.createLinearGradient(-thW * 0.5, 0, thW * 0.5, 0);
  gT.addColorStop(0, SKIN_HI);
  gT.addColorStop(1, SKIN_MID);
  ctx.fillStyle = gT;
  ctx.fill();
  ctx.strokeStyle = SKIN_LINE;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.strokeStyle = SKIN_CREASE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-thW * 0.34, thLen * 0.42);
  ctx.quadraticCurveTo(0, thLen * 0.48, thW * 0.34, thLen * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, thLen * 0.74, thW * 0.30, thW * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,228,222,.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(186,126,96,.35)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();

  // ---- 手掌：宽扁圆角矩形，盖住指根与拇指根部 ----
  const rr2 = palmHt * 0.34;
  ctx.beginPath();
  ctx.moveTo(-palmWid / 2 + rr2, palmTop);
  ctx.lineTo(palmWid / 2 - rr2, palmTop);
  ctx.quadraticCurveTo(palmWid / 2, palmTop, palmWid / 2, palmTop + rr2);
  ctx.lineTo(palmWid / 2, palmBot - rr2);
  ctx.quadraticCurveTo(palmWid / 2, palmBot, palmWid / 2 - rr2, palmBot);
  ctx.lineTo(-palmWid / 2 + rr2, palmBot);
  ctx.quadraticCurveTo(-palmWid / 2, palmBot, -palmWid / 2, palmBot - rr2);
  ctx.lineTo(-palmWid / 2, palmTop + rr2);
  ctx.quadraticCurveTo(-palmWid / 2, palmTop, -palmWid / 2 + rr2, palmTop);
  ctx.closePath();
  const gPalm = ctx.createLinearGradient(-palmWid * 0.45, palmTop, palmWid * 0.42, palmBot);
  gPalm.addColorStop(0, SKIN_HI);
  gPalm.addColorStop(0.52, SKIN);
  gPalm.addColorStop(1, SKIN_MID);
  ctx.fillStyle = gPalm;
  ctx.fill();
  ctx.strokeStyle = SKIN_LINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 掌背指根分缝
  ctx.strokeStyle = SKIN_CREASE;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const kx = -gap * 1.5 + (i + 0.5) * gap;
    ctx.beginPath();
    ctx.moveTo(kx, palmBot - palmHt * 0.10);
    ctx.lineTo(kx, palmBot + palmHt * 0.04);
    ctx.stroke();
  }

  // ---- 手背高光 + 尺侧暗部 ----
  ctx.globalAlpha = st.alpha * (0.20 + 0.22 * st.press);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(-palmWid * 0.16, palmTop + palmHt * 0.34, palmWid * 0.24, palmHt * 0.26, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = st.alpha * 0.16;
  ctx.fillStyle = SKIN_DK;
  ctx.beginPath();
  ctx.ellipse(palmWid * 0.40, palmTop + palmHt * 0.52, palmWid * 0.11, palmHt * 0.40, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 画一个从侧面飞来的拳头（裸拳）：冲刺 -> 落拳接触 -> 弹回 */
function drawFist(now, petRect) {
  if (!fistStartAt) return;
  const prog = (now - fistStartAt) / FIST_DURATION;
  if (prog >= 1) { fistStartAt = 0; return; }
  const st = fistState(prog, fistDir);
  if (!st.visible) return;

  const size = Math.max(28, Math.min(74, petRect.h * 0.24));
  const f = -fistDir;                              // 拳峰（击打面）朝向
  // 「落拳」：接触点落在宠物身体「近侧边缘」上（fistDir=1 从右来 -> 打右缘），
  // 而不是身体正中，这样拳头是"打到身上"而非"穿过身体"。
  const contactX = petRect.cx + fistDir * (petRect.w * 0.5 - size * 0.42);
  const contactY = petRect.top + petRect.h * 0.46;
  const travel = petRect.w * 0.9 + size;           // st.x 的归一化行程
  const cx = contactX + st.x * travel;
  const cy = contactY + st.y * petRect.h;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(cx, cy);
  ctx.rotate((st.rot * Math.PI) / 180);
  ctx.scale(st.scale, st.scale);

  // ---- 冲击特效：接触瞬间的星芒 + 冲击线 ----
  if (st.impact > 0.05) {
    ctx.save();
    ctx.globalAlpha = st.alpha * st.impact;
    // 冲击线
    ctx.strokeStyle = "#ffd45e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(f * size * 0.48, i * size * 0.24);
      ctx.lineTo(f * size * (0.95 + Math.abs(i) * 0.14), i * size * 0.42);
      ctx.stroke();
    }
    // 接触星芒
    ctx.globalAlpha = st.alpha * st.impact * 0.9;
    ctx.fillStyle = "#fff4c2";
    ctx.beginPath();
    const spikes = 8, R = size * 0.5, r2 = size * 0.17;
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (Math.PI / spikes) * i;
      const rad = i % 2 === 0 ? R : r2;
      const px2 = f * size * 0.44 + Math.cos(ang) * rad;
      const py2 = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- 拳主体（手背 + 蜷握的指节外轮廓）----
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.40, size * 0.44, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(-f * size * 0.3, -size * 0.45, f * size * 0.3, size * 0.4);
  g.addColorStop(0, SKIN_HI);
  g.addColorStop(0.5, SKIN);
  g.addColorStop(1, SKIN_MID);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = SKIN_LINE;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // ---- 拳峰：4 个指关节凸起，排在击打面 ----
  for (let i = 0; i < 4; i++) {
    const ky = -size * 0.28 + i * size * 0.19;
    ctx.beginPath();
    ctx.ellipse(f * size * 0.30, ky, size * 0.13, size * 0.10, 0, 0, Math.PI * 2);
    const gk = ctx.createLinearGradient(0, ky - size * 0.1, 0, ky + size * 0.1);
    gk.addColorStop(0, SKIN_HI);
    gk.addColorStop(1, SKIN_MID);
    ctx.fillStyle = gk;
    ctx.fill();
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- 拇指：扣在拳背对侧下方 ----
  ctx.save();
  ctx.translate(-f * size * 0.14, size * 0.29);
  ctx.rotate(f * 0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.24, size * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.strokeStyle = SKIN_LINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ---- 高光 ----
  ctx.globalAlpha = st.alpha * 0.4;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(-f * size * 0.10, -size * 0.22, size * 0.20, size * 0.11, f * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function render(now) {
  const k = S.scaleMul; // 窗口缩放动画的补偿
  ctx.clearRect(0, 0, canvasCssW, canvasCssH);
  if (!images.length) return;

  const o = computeTransform(now);
  // 兜底：任何非有限的变换值都回退，避免整帧绘制因 NaN 抛错而白屏
  for (const key of ["scaleX", "scaleY", "dx", "dy", "rot"]) {
    if (!Number.isFinite(o[key])) o[key] = key === "scaleX" || key === "scaleY" ? 1 : 0;
  }
  const i = S.frameIdx;
  const pos = frameCanvasPos[i], d = frameDraw[i];
  const cxp = pos.x + d.w / 2;
  const cyp = pos.y + d.h; // 以脚底为变换原点

  ctx.save();
  ctx.translate(cxp, cyp);
  ctx.rotate((o.rot * Math.PI) / 180);
  ctx.scale(o.scaleX, o.scaleY);
  ctx.translate(0, o.dy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(images[i], -d.w / 2, -d.h, d.w, d.h);
  ctx.restore();

  // 交互特效（画在宠物之上）：摸头的手 / 挨拳击的拳头
  // 注意：绘制时以脚底为原点做了 scale(scaleX, scaleY)（pat 时 scaleY=1.06 会抬高头顶）。
  // 特效必须按缩放后的真实包围盒定位，否则手掌会悬在头顶上方约 10px。
  // 用「实际不透明内容的边界」定位，而不是帧包围盒——否则素材四周的透明留白
  // 会让手掌/拳头浮在主体外面（未裁边的图片尤其明显）。
  const am = alphaMaps[i];
  const ct = (am && am.content) || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const cw = d.w * (ct.x1 - ct.x0) * o.scaleX;
  const ch = d.h * (ct.y1 - ct.y0) * o.scaleY;
  const petRect = {
    cx: cxp + d.w * ((ct.x0 + ct.x1) / 2 - 0.5) * o.scaleX,
    w: cw,
    h: ch,
    // 内容顶端在 canvas 中的 y（以脚底为原点缩放，再叠加 dy）
    top: cyp + o.scaleY * (o.dy - d.h * (1 - ct.y0)),
    scaleY: o.scaleY,
  };
  drawHand(now, petRect);
  drawFist(now, petRect);
}

// ---------------- 主循环 ----------------
let lastT = 0;
function loop(ts) {
  const dtMs = lastT ? Math.min(50, ts - lastT) : 0;
  const dt = dtMs / 1000;
  lastT = ts;

  if (pack) {
    advanceFrame(dtMs);
    if (!S.dragging && dt > 0) {
      // 行为状态机：决定当前想做什么（爬动会给出目标速度）
      if (behaviorEnabled) tickBehavior(B, dtMs, { edgeHint: edgeInfo() });
      refreshArea();   // 先按当前位置确定所在显示器，再按该显示器边界积分
      // 爬动：给一个目标水平速度（平滑逼近，避免瞬间变向）
      // 受击击退：短暂水平冲量，随后由摩擦自然衰减
      if (behaviorEnabled && B.state === 'hit' && hitKnockDir !== 0) {
        S.body.vx = hitKnockDir * 260;
        S.body.roamTimer = 1.5;
        hitKnockDir = 0;
      }
      if (behaviorEnabled && isWalking(B)) {
        // 贴到边界且仍朝墙走 -> 立即反向，避免「原地踏步」
        const eg = edgeInfo();
        if ((eg.leftEdge && B.walkDir < 0) || (eg.rightEdge && B.walkDir > 0)) {
          B.walkDir = -B.walkDir;
          S.body.vx = B.walkDir * walkSpeed * 0.6;   // 给一点初速，转身更自然
        }
        const tv = targetVelocityX(B, walkSpeed);
        S.body.vx += (tv - S.body.vx) * Math.min(1, dt * 5);
        S.body.roamTimer = 1.5;   // 抑制内置漫游，避免两套逻辑打架
      }
      stepBody(S.body, {
        dt, gravity: pack.physics.gravity, bounce: pack.physics.bounce,
        friction: pack.physics.friction,
        roamEnabled: behaviorEnabled ? false : pack.physics.roam,   // 行为启用时由状态机接管水平移动
        roamSpeed: pack.physics.roamSpeed, win: { w: W, h: H }, area,
      });
      api.setPos(Math.round(S.body.x), Math.round(S.body.y));
    }
    // 平滑缩放（点击成长/缩小反馈预留）
    S.scaleMul += (S.scaleTarget - S.scaleMul) * Math.min(1, dt * 10);
    render(ts);
    tickBubble(dt);
  }
  requestAnimationFrame(loop);
}

// ---------------- 气泡 ----------------
function randomLine() {
  const ls = pack.bubble.lines;
  return ls[Math.floor(Math.random() * ls.length)];
}
/**
 * 把气泡定位到宠物头顶上方。
 * 布局：画布贴窗口底部，所以头顶距窗口底部 = canvasCssH - pos.y。
 */
function placeBubble() {
  if (!bubbleEl || bubbleEl.hidden) return;
  const i = S.frameIdx;
  const d = frameDraw[i];
  const pos = frameCanvasPos[i];
  if (!d || !pos) return;
  const headFromBottom = canvasCssH - pos.y;
  // 摸头时手掌会占据头顶上方空间，气泡需相应抬高，避免与手重叠。
  // 手掌尺寸与 drawHand 保持一致（按宠物宽度自适应并限幅）。
  let handLift = 0;
  if (handStartAt) {
    const { palmW, palmH } = handPalmSize(d.w);
    handLift = Math.min(palmH + palmW * 0.1, canvasCssH - pos.y - 6);
  }
  const bottomPx = Math.min(H - 8, headFromBottom + 12 + handLift);
  bubbleEl.style.bottom = Math.round(bottomPx) + "px";
  bubbleEl.style.top = "auto";
}

function showBubble(text) {
  if (!text) return;
  bubbleText.textContent = text;
  bubbleEl.hidden = false;
  placeBubble();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  S.bubbleHideAt = performance.now() + pack.bubble.durationSec * 1000;
}
function hideBubble() {
  bubbleEl.classList.remove('show');
  setTimeout(() => { bubbleEl.hidden = true; }, 240);
}
function tickBubble(dt) {
  if (!pack.bubble.enabled) return;
  if (S.bubbleHideAt && performance.now() > S.bubbleHideAt) { hideBubble(); S.bubbleHideAt = 0; }
  if (S.bubbleHideAt) return;
  S.bubbleTimer -= dt;
  if (S.bubbleTimer <= 0) { S.bubbleTimer = pack.bubble.intervalSec; showBubble(randomLine()); }
}

// ---------------- 拖拽 ----------------
let drag = null, downAt = 0, moved = false;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  hideMenu();
  downAt = performance.now(); moved = false;
  S.dragging = true;
  drag = { startSX: e.screenX, startSY: e.screenY, startX: S.body.x, startY: S.body.y, samples: [{ t: performance.now(), x: S.body.x, y: S.body.y }] };
  if (S.ignoreMouse) { S.ignoreMouse = false; api.setIgnoreMouse(false); }
});

window.addEventListener('mousemove', (e) => {
  if (S.dragging && drag) {
    const nx = drag.startX + (e.screenX - drag.startSX);
    const ny = drag.startY + (e.screenY - drag.startSY);
    if (Math.abs(nx - drag.startX) > 3 || Math.abs(ny - drag.startY) > 3) moved = true;
    S.body.x = nx; S.body.y = ny;
    refreshArea();
    api.setPos(Math.round(nx), Math.round(ny));
    drag.samples.push({ t: performance.now(), x: nx, y: ny });
    while (drag.samples.length > 10) drag.samples.shift();
    return;
  }
  const over = isOverPet(e.clientX, e.clientY);
  if (over !== S.hover) {
    S.hover = over;
    if (!over !== S.ignoreMouse) { S.ignoreMouse = !over; api.setIgnoreMouse(S.ignoreMouse); }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !S.dragging) return;
  S.dragging = false;
  const v = drag ? estimateThrowVelocity(drag.samples) : { vx: 0, vy: 0 };
  drag = null;
  if (moved) {
    const k = pack.physics.throwScale;
    S.body.vx = v.vx * k; S.body.vy = v.vy * k;
    S.body.onGround = false; S.body.roamTimer = 1.5;
  } else if (performance.now() - downAt < 400) {
    // 单击 = 摸头：进入 pat 反应状态 + 动画反馈
    S.clickP = 1; S.clickAnim = pack.animation.click;
    if (behaviorEnabled) doPat(B);
  handStartAt = performance.now();
    if (pack.bubble.enabled) { showBubble(randomLine()); S.bubbleTimer = pack.bubble.intervalSec; }
  }
});

window.addEventListener('mouseleave', () => {
  if (S.dragging) return;
  S.hover = false;
  if (!S.ignoreMouse) { S.ignoreMouse = true; api.setIgnoreMouse(true); }
});

// ---------------- 菜单 ----------------
function showMenu(x, y) {
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menuEl.style.right = 'auto';
  menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  menuEl.style.bottom = 'auto';
}
function hideMenu() { menuEl.hidden = true; }

canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY); });
window.addEventListener('mousedown', (e) => { if (!menuEl.contains(e.target)) hideMenu(); }, true);

menuEl.querySelectorAll('.mi').forEach((mi) => {
  mi.onclick = () => {
    const act = mi.dataset.act;
    hideMenu();
    if (act === 'bottom') { refreshArea(true); S.body.y = area.y + area.height - H - 40; S.body.vy = 0; S.body.onGround = false; S.body.roamTimer = 1; }
    else if (act === 'bubble') { showBubble(randomLine()); S.bubbleTimer = pack.bubble.intervalSec; }
    else if (act === 'top') { S.topmost = !S.topmost; api.setAlwaysOnTop(S.topmost); }
    else if (act === 'clickthrough') { S.ignoreMouse = !S.ignoreMouse; api.setIgnoreMouse(S.ignoreMouse); }
    else if (act === 'close') api.closePet();
  };
});

// ---- 快速模式指令（来自制作器窗口） ----
if (api.onQuickWalk) api.onQuickWalk((walking) => {
  behaviorEnabled = !!walking;
  if (!behaviorEnabled) {
    // 停用行为时停住水平移动，交回内置漫游由 pack.physics 决定
    B.walkDir = 0; B.remaining = 0;
  } else {
    tickBehavior(B, 1e9);   // 立即切换到下一个行为，避免「开了却不动」
  }
});
if (api.onQuickPat) api.onQuickPat(() => {
  doPat(B);
  handStartAt = performance.now();
  S.clickP = 1; S.clickAnim = pack && pack.animation ? pack.animation.click : 'bounce';
  // 用户主动摸头：强制给反馈
  const line = (pack && pack.bubble.lines && pack.bubble.lines.length) ? randomLine() : '好舒服～';
  bubbleText.textContent = line;
  bubbleEl.hidden = false;
  placeBubble();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  S.bubbleHideAt = performance.now() + 1800;
});
if (api.onQuickHit) api.onQuickHit((fromDir) => {
  const dir = doHit(B, typeof fromDir === 'number' ? fromDir : 0);
  hitFx = 1;
  hitKnockDir = dir;
  // 拳头从攻击来向的对面视觉上飞来（与击退方向相反）
  fistStartAt = performance.now();
  fistDir = -dir;
  // 用户主动出拳：无论是否开启自动气泡，都要给反馈
  bubbleText.textContent = '呜哇！';
  bubbleEl.hidden = false;
  placeBubble();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  S.bubbleHideAt = performance.now() + 1600;
});
if (api.onQuickSay) api.onQuickSay((text) => {
  const t = sanitizeSpeech(text);
  if (!t) return;
  // 用户主动要求说话：即使 pack 关闭自动气泡也要显示
  bubbleText.textContent = t;
  bubbleEl.hidden = false;
  placeBubble();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  S.bubbleHideAt = performance.now() + speechDuration(t) * 1000;
});
if (api.onQuickReload) api.onQuickReload(() => {
  // 制作器里换了图片：重新加载宠物包（不重建窗口，避免闪烁）
  location.reload();
});

if (api.onWorkArea) api.onWorkArea(async (wa) => {
  workArea = wa;
  try {
    const list = await api.allWorkAreas();
    if (list && list.length) allAreas = list;
  } catch { /* 保持原列表 */ }
  refreshArea(true);
  clampIntoArea(S.body, { w: W, h: H }, area);
  api.setPos(Math.round(S.body.x), Math.round(S.body.y));
});

// 调试钩子：暴露内部状态供自动化测试断言（无副作用）
window.__petDebug = () => ({
  behavior: { state: B.state, walkDir: B.walkDir, enabled: behaviorEnabled, remaining: Math.round(B.remaining), hitCount: B.hitCount, patCount: B.patCount },
  loadedFrames: images.length,
  loadedBytes: images.reduce((a, im) => a + im.naturalWidth * im.naturalHeight * 4, 0),
  W, H,
  area: { ...area },
  allAreas: allAreas.map((a) => ({ ...a })),
  body: { x: S.body.x, y: S.body.y, vx: S.body.vx, vy: S.body.vy },
});

// ---------------- 启动 ----------------
(async function boot() {
  try {
    const r = await api.getPetPack();
    if (!r || r.error) { showErr((r && r.error) || '未知错误'); return; }
    pack = r.pack;

    // 内存防护：petpack 可能来自他人分享，是不可信输入。
    // 先按画布尺寸规划要实际加载多少帧，避免超大包撑爆渲染进程。
    const canvasW = (pack.canvas && pack.canvas.width) || 512;
    const canvasH = (pack.canvas && pack.canvas.height) || 512;
    let framesToLoad = r.frames;
    const plan = planRuntimeFrames(r.frames, canvasW, canvasH);
    if (plan.clamped) {
      framesToLoad = plan.frames;
      console.warn('[pet] 帧数超出内存预算，已从 ' + r.frames.length + ' 抽稀为 ' + plan.frames.length + ' 帧');
      const el = document.getElementById('memNotice');
      if (el) {
        el.hidden = false;
        el.textContent = '该宠物包较大，已自动抽稀为 ' + plan.frames.length + ' 帧以节省内存';
        setTimeout(() => { el.hidden = true; }, 6000);
      }
    }
    pack.frames = framesToLoad;

    frameDurs = pack.frames.map((f) => f.durationMs);
    images = await Promise.all(framesToLoad.map((f) => loadImage(f.dataUrl)));

    area = await api.workArea();
    workArea = area;
    try { const list = await api.allWorkAreas(); if (list && list.length) allAreas = list; } catch {}
    if (!allAreas.length) allAreas = [area];

    computeSizes();
    // 先把窗口尺寸设到位（不带动画，避免尺寸与内部计算脱节）
    api.setSize(W, H);
    await new Promise((res) => setTimeout(res, 200));

    // 关键：以「真实窗口高度」为准。
    // setBounds 在 DPI 缩放下可能取整，若物理层仍用期望值 H，
    // 会导致宠物被放到屏幕可视区之外（表现为下半部分看不见）。
    const b0 = await api.getBounds();
    if (b0 && b0.height > 0) {
      H = b0.height;
      W = b0.width;
    }
    buildAlphaMaps();

    // 初始位置：窗口底边贴住工作区底边
    const gy = area.y + area.height - H;
    S.body.x = b0 ? b0.x : Math.max(area.x, area.x + area.width - W - 20);
    S.body.y = gy;
    S.body.vy = 0;
    S.body.onGround = true;
    api.setPos(Math.round(S.body.x), Math.round(S.body.y));

    S.bubbleTimer = 4;
    S.ignoreMouse = true;
    api.setIgnoreMouse(true);

    console.log('PET_READY frames=' + images.length + ' physics=' + typeof stepBody);
    requestAnimationFrame(loop);
  } catch (err) {
    showErr(String(err && err.message ? err.message : err));
  }
})();