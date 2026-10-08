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

function resizeWindowAnimated() {
  api.setSizeAnimated(W, H);
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
    for (let p = 0, k = 3; k < d.length; p++, k += 4) m[p] = d[k];
    return { data: m, w, h };
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
  const speed = a.idleSpeed;
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
/** 画一只从上伸下来的手（摸头） */
function drawHand(now, petRect) {
  if (!handStartAt) return;
  const prog = (now - handStartAt) / HAND_DURATION;
  if (prog >= 1) { handStartAt = 0; return; }
  const st = handState(prog);
  if (!st.visible) return;

  const cx = petRect.cx;
  const topY = petRect.top;
  const H0 = petRect.h;
  // 掌宽按宠物宽度自适应，但限制在合理范围
  const palmW = Math.max(26, Math.min(84, petRect.w * 0.42));
  const palmH = palmW * 0.82;
  // st.y: 0 表示掌心贴头顶；负值表示在上方（按身高比例换算）
  // st.y=0 时掌心下沿正好贴在头顶（不做额外偏移，才有真实接触感）
  const palmBottom = topY + st.y * H0 + 2;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(cx, palmBottom);
  ctx.scale(st.scale, st.scale);

  // 手腕（只画一小截，避免从屏幕顶端垂下的怪异观感）
  const armW = palmW * 0.58;
  const armLen = palmH * 0.95;
  const gArm = ctx.createLinearGradient(0, -armLen, 0, 0);
  gArm.addColorStop(0, "rgba(255,217,184,0)");   // 顶端渐隐，像从画外伸入
  gArm.addColorStop(0.45, "#ffd9b8");
  gArm.addColorStop(1, "#f7c49a");
  ctx.fillStyle = gArm;
  ctx.fillRect(-armW / 2, -armLen, armW, armLen + 2);

  // 手掌
  ctx.beginPath();
  const rr = palmH * 0.42;
  ctx.moveTo(-palmW / 2 + rr, -palmH);
  ctx.lineTo(palmW / 2 - rr, -palmH);
  ctx.quadraticCurveTo(palmW / 2, -palmH, palmW / 2, -palmH + rr);
  ctx.lineTo(palmW / 2, -rr);
  ctx.quadraticCurveTo(palmW / 2, 0, palmW / 2 - rr, 0);
  ctx.lineTo(-palmW / 2 + rr, 0);
  ctx.quadraticCurveTo(-palmW / 2, 0, -palmW / 2, -rr);
  ctx.lineTo(-palmW / 2, -palmH + rr);
  ctx.quadraticCurveTo(-palmW / 2, -palmH, -palmW / 2 + rr, -palmH);
  ctx.closePath();
  const gP = ctx.createLinearGradient(0, -palmH, 0, 0);
  gP.addColorStop(0, "#ffe4c9");
  gP.addColorStop(1, "#f8c79c");
  ctx.fillStyle = gP;
  ctx.fill();
  ctx.strokeStyle = "rgba(190,130,90,.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 四指分缝
  ctx.strokeStyle = "rgba(190,130,90,.4)";
  ctx.lineWidth = 1.2;
  for (let i = 1; i <= 3; i++) {
    const fx = -palmW / 2 + (palmW / 4) * i;
    ctx.beginPath();
    ctx.moveTo(fx, -palmH * 0.72);
    ctx.lineTo(fx, -palmH * 0.16);
    ctx.stroke();
  }

  // 按压力度：掌心高光
  if (st.press > 0.05) {
    ctx.globalAlpha = st.alpha * st.press * 0.5;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(0, -palmH * 0.32, palmW * 0.3, palmH * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 画一个从侧面飞来的拳头（挨拳击） */
function drawFist(now, petRect) {
  if (!fistStartAt) return;
  const prog = (now - fistStartAt) / FIST_DURATION;
  if (prog >= 1) { fistStartAt = 0; return; }
  const st = fistState(prog, fistDir);
  if (!st.visible) return;

  const H0 = petRect.h;
  const size = Math.max(26, Math.min(64, H0 * 0.20));   // 收小，避免压住整个宠物
  const cx = petRect.cx + st.x * petRect.w - fistDir * petRect.w * 0.18;
  const cy = petRect.top + H0 * 0.42 + st.y * H0;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(cx, cy);
  ctx.rotate((st.rot * Math.PI) / 180);
  ctx.scale(st.scale, st.scale);

  // 冲击线（撞击瞬间）
  if (st.impact > 0.05) {
    ctx.save();
    ctx.globalAlpha = st.alpha * st.impact * 0.85;
    ctx.strokeStyle = "#ffd45e";
    ctx.lineWidth = 3;
    const d = -fistDir;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(d * size * 0.55, i * size * 0.22);
      ctx.lineTo(d * size * (0.95 + Math.abs(i) * 0.12), i * size * 0.38);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 拳套主体
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, "#ff8787");
  g.addColorStop(1, "#d93b3b");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.5, size * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,20,20,.5)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 指节
  ctx.strokeStyle = "rgba(120,20,20,.45)";
  ctx.lineWidth = 1.4;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-fistDir * size * 0.1, i * size * 0.2);
    ctx.lineTo(-fistDir * size * 0.42, i * size * 0.24);
    ctx.stroke();
  }
  // 高光
  ctx.globalAlpha = st.alpha * 0.35;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(-fistDir * size * 0.16, -size * 0.16, size * 0.16, size * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function render(now) {
  const k = S.scaleMul; // 窗口缩放动画的补偿
  ctx.clearRect(0, 0, canvasCssW, canvasCssH);
  if (!images.length) return;

  const o = computeTransform(now);
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
  const petRect = {
    cx: cxp,
    w: d.w,
    h: d.h,
    top: cyp - d.h + o.dy,
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
  const bottomPx = Math.min(H - 8, headFromBottom + 12);
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