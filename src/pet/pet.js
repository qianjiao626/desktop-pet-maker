// 桌宠运行时：多帧渲染 + 物理 + 拖拽抛掷 + 漫游 + 气泡 + 像素级穿透
import { createBody, stepBody, estimateThrowVelocity, clampIntoArea } from '../shared/physics.js';
import { pickAreaForBounds, areaChanged } from '../shared/displays.js';
import { planRuntimeFrames } from '../shared/budget.js';
import { createBehavior, tickBehavior, enterState, pat as doPat, isWalking, targetVelocityX, stateLabel, hit as doHit, isReacting, hopPose, dozePose, shouldSnore, lookAtPose } from '../shared/behavior.js';
import { sanitizeSpeech, speechDuration } from '../shared/speech.js';
import { handState, fistState, pettingPose, strugglePose, HAND_DURATION, FIST_DURATION, PETTING_DURATION } from '../shared/effects.js';
import { computeLayout, computeFramePlacement, OVER, MARGIN } from '../shared/layout.js';
import { createBug, stepBug, catchBug, isBugActive, canPounce } from '../shared/bugchase.js';
import { commonGroundOffset } from '../shared/groundcontact.js';
import { createClipScheduler, clipFrameAt } from '../shared/clips.js';

// 跳跃时最大抬高像素（渲染层视觉高度，不影响物理与窗口尺寸）
const HOP_HEIGHT = 26;

// 看向鼠标时，把自带的摇摆倾斜压到这个比例，避免两种倾斜叠加后乱晃
const LOOK_SWAY_DAMP = 0.25;

// 拖拽挣扎时，把自带倾斜压到这个比例，避免叠加后超出挣扎姿态声明的幅度上限
const DRAG_ROT_DAMP = 0.15;

// 最近一帧的真实渲染姿态（调试钩子用）
const lastPose = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rot: 0 };

const api = window.api;
const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubbleEl = $('#bubble');
const bubbleText = $('#bubbleText');
const menuEl = $('#menu');

let pack = null;
let images = [];            // HTMLImageElement[]（当前正在播放的那一段）
let clipScheduler = null;   // 多动作片段调度器（包里有 clips 时才非 null）
let clipImages = new Map(); // clipId -> { images, durs }
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
let groundDy = 0;        // 让脚底真正踩到地面线所需的垂直微调（像素）
let groundReserve = 0;   // 为上面的微调在画布底部预留的高度（否则会被裁）


// 待机行为（爬动 / 发呆 / 打瞌睡 / 摸头反应）
const B = createBehavior();
let behaviorEnabled = true;   // 可由「让他爬动」开关控制
let walkSpeed = 60;           // px/s
let hopEnabled = true;        // 可由「活泼跳跃」开关控制
let snorePending = false;     // 本次睡眠是否该冒一次「Zzz…」
let cursorScreen = null;      // 屏幕光标坐标（由主进程推送）
let lookEnabled = true;       // 「看向鼠标」开关

let hitFx = 0;          // 受击特效强度 0..1（用于抖动/闪烁）
let handStartAt = 0;    // 摸头的手：动画开始时间（0=不显示）
let petStartAt = 0;     // 被摸头的「舒服」姿态开始时间（独立于手，留得更久）
let fistStartAt = 0;    // 拳头：动画开始时间（0=不显示）
let fistDir = 1;        // 拳头来向 1=从右来 / -1=从左来
let bug = null;         // 桌面上的小虫子（抓虫子玩法）
let bugChaseEnabled = true;  // 是否开启抓虫子（可由制作器勾选框控制）
let petOffset = 0;      // 宠物在窗口内的横向偏移（追虫时用于靠近虫子，不移动整个窗口）
let bugSpawnTimer = 5;  // 多少秒后出现下一只虫子（首只早点出现，玩法更快被看到）
let bugCatchCount = 0;  // 累计抓到几只（调试用）
let userSpokeAt = 0;    // 用户最近一次主动说话的时间（期间不弹抓虫气泡，避免顶掉用户的话）
let catchCelebrateAt = 0; // 抓到虫子的庆祝动画开始时间（冒爱心用）
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
  // 与主进程共用同一套布局公式（src/shared/layout.js），避免尺寸脱节。
  // bottomReserve：把"脚底下移量"先预留进画布高度，否则下移会把精灵裁掉。
  const L = computeLayout(pack, sizes, { bottomReserve: groundReserve });
  W = L.W; H = L.H;
  canvasCssW = L.canvasCssW;
  canvasCssH = L.canvasCssH;
  topPad = L.topPad;

  const placed = computeFramePlacement(sizes, scale, canvasCssW, canvasCssH, groundReserve);
  frameDraw = placed.draw;
  frameCanvasPos = placed.pos;
  // 注意：落点对齐（groundDy）**不能**在这里算 —— computeSizes 是在
  // buildAlphaMaps 之前调用的，此时 alphaMaps 还是空的，算出来恒为 0
  // （这个顺序问题让修复"看起来生效、实际没生效"，实测 gap 差 40px 才发现）。
  // 统一放到 updateGroundOffset() 里，在 alphaMaps 建好之后调用。

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
  updateGroundOffset();
}

/**
 * 计算落点微调：让「真实不透明底边」（脚底）而不是「图片底边」贴地。
 * 必须在 buildAlphaMaps() 之后调用（它依赖 alphaMaps 里的 content 边界）。
 * 取多帧公共值，避免逐帧留白不同导致上下抽搐。
 */
function updateGroundOffset() {
  // 注意：这里**不能**用空 catch 兜住一切 —— 曾经因为漏了 import，
  // ReferenceError 被静默吞掉，导致"看起来改好了、实际根本没跑"，
  // 排查了很久。现在只在真正拿不到数据时回退，并把异常打到控制台。
  let dy = 0;
  try {
    const gc = commonGroundOffset(alphaMaps, frameDraw.map((d) => d.h));
    dy = gc.dy;
  } catch (err) {
    console.warn('[ground] 落点计算失败，回退为 0：' + (err && err.message));
    dy = 0;
  }
  groundDy = dy;
  // 刻意**不在这里**重算布局：buildAlphaMaps -> updateGroundOffset -> computeSizes
  // -> buildAlphaMaps 会形成重入，在渲染循环中途重建画布与 alpha 图，
  // 表现为"有些采样点是透明的"（实测把 e2e-pet-anim 打挂）。
  // 收敛交给 setupGround()：先量、再按需重算一次，然后才开始渲染。
}

/**
 * 启动时收敛「落点预留」：先按无预留建一次 alpha 图，量出需要下移多少，
 * 若超出画布底部空间就带上预留重建**一次**，之后不再变动。
 *
 * 为什么必须收敛在渲染之前：
 *   重建会换掉 canvas 尺寸与 alphaMaps。若放在渲染循环里做，
 *   会出现"这一帧用旧尺寸画、下一帧用新尺寸读"的错配（实测采样出全透明）。
 */
function setupGround() {
  groundReserve = 0;
  groundDy = 0;
  computeSizes();
  buildAlphaMaps();          // 这里会调用 updateGroundOffset，得到 groundDy
  // 预留量 = 下移量本身。
  //
  // 推导（别凭感觉改）：基线固定在「原画布高 - MARGIN/2 - drawH」，
  // 内容底边 = 基线 + groundDy，画布高 = 原画布高 + reserve。
  // 要让内容底边落回「距画布底 MARGIN/2」处，解得 reserve = groundDy 正好。
  // 早先写成 reserve = groundDy - MARGIN/2，结果内容正好贴到画布最边缘（gap=0），
  // 被 e2e 抓出来。
  if (groundDy > 0.5) {
    const need = Math.ceil(groundDy);
    groundReserve = need;
    computeSizes();
    buildAlphaMaps();       // 第二轮里 groundDy 不会超过已预留量
  }
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
  const fy = (cy - (pos.y + groundDy)) / d.h;   // 命中区域跟着落点微调
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
      // 稍后若要叠加「看向鼠标」，这里会按比例减弱摇摆（见 LOOK_SWAY_DAMP）
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
      // 睡眠：比发呆更塌，呼吸更慢更沉；越睡越沉（progress = 本次睡眠进度）
      const prog = B.duration > 0 ? Math.min(1, Math.max(0, 1 - B.remaining / B.duration)) : 0;
      const dz = dozePose(now / 1000, prog);
      o.scaleY *= dz.scaleY;
      o.scaleX *= dz.scaleX;
      o.dy += 2;                       // 微微下沉，像坐下来打盹
      // 睡着后偶尔冒呼噜（由 sleepTick 节流，这里只读标志）
      // 打呼不能抢用户的话：用户刚发言时（userSpokeAt 起 3s 内）或气泡正显示时，跳过这次呼噜。
      // —— 之前无条件覆盖，实测会把手动输入的话立刻顶掉（QUICK 套件的真实回归）。
      if (snorePending && pack.bubble.enabled) {
        const spokeRecently = userSpokeAt && (now - userSpokeAt) < 3000;
        const bubbleShowing = S.bubbleHideAt && now < S.bubbleHideAt;
        if (!spokeRecently && !bubbleShowing) {
          showBubble('Zzz…');
          S.bubbleTimer = pack.bubble.intervalSec;
        }
        snorePending = false;
      }
    } else if (B.state === 'pat') {
      // 兜底姿态：真正的"舒服"表现由下面的 pettingPose 叠加
      o.dy -= 3;
      o.scaleY *= 1.03;
      o.scaleX *= 0.985;
    } else if (B.state === 'walk') {
      const t2 = now / 1000;
      o.rot += Math.sin(t2 * 12) * 2.2 * B.walkDir;
    } else if (B.state === 'hop') {
      // 自己蹦一下：由 hopPose 给出确定的三段曲线（起跳 / 滞空 / 落地回弹）
      const hp = hopPose(B);
      if (hp) {
        o.dy -= Math.round(HOP_HEIGHT * hp.lift);   // 抬高
        o.scaleY *= hp.stretch * hp.squash;         // 滞空拉长 / 落地压扁
        o.scaleX *= 1 / Math.sqrt(hp.stretch * hp.squash);  // 体积感：压扁就变宽
      }
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
  // 「看向鼠标」：整体朝光标方向轻微倾斜+位移（幅度很小，像"瞄"着鼠标）
  // 只在非跳跃/非受击时叠加，避免动作打架；睡眠时不看（睡着了就不理你）
  if (lookEnabled && cursorScreen && behaviorEnabled && B.state !== 'hop' && B.state !== 'hit' && B.state !== 'doze') {
    const cx = S.body.x + W / 2, cy = S.body.y + H / 2;
    const lp = lookAtPose(cursorScreen.x - cx, cursorScreen.y - cy);
    // 先减弱「摇摆」这种自带倾斜，避免与注视方向叠加成乱晃（实测叠加后可达 3.1°）
    if (lp.lean > 0.05) o.rot *= LOOK_SWAY_DAMP;
    o.rot += lp.rot;
    o.dx += lp.dx;
    o.dy += lp.dy;
  }

  // 「被拎起来会挣扎」：拖着走时左右晃 + 上下轻摆，甩得越快晃得越厉害
  // 放在注视之后叠加：拖拽是用户直接操作，优先级更高
  if (S.dragging) {
    // 用已有采样点估速度：让"甩得猛"看起来更挣扎
    const v = drag ? estimateThrowVelocity(drag.samples) : { vx: 0, vy: 0 };
    const sp = Math.hypot(v.vx || 0, v.vy || 0);
    const st = strugglePose(now / 1000, sp);
    // 先压掉自带倾斜（呼吸摇摆 / 走路摆 / 注视），避免与挣扎叠加超出声明上限
    o.rot *= DRAG_ROT_DAMP;
    o.rot += st.rot;
    o.dx += st.dx;
    o.dy += st.dy;
    o.scaleX *= st.scaleX;
    o.scaleY *= st.scaleY;
  }

  // 记录本帧最终姿态（供调试钩子/自动化断言读取）
  lastPose.dx = o.dx; lastPose.dy = o.dy;
  lastPose.scaleX = o.scaleX; lastPose.scaleY = o.scaleY; lastPose.rot = o.rot;

  // 摸头的「舒服」姿态：轻缩 -> 下沉蹭 -> 左右摇摆 -> 回原样
  if (petStartAt) {
    const pp = (now - petStartAt) / PETTING_DURATION;
    if (pp >= 1) { petStartAt = 0; }
    else {
      const q = pettingPose(pp);
      o.scaleY *= q.squash;
      o.scaleX *= 1 / Math.sqrt(q.squash);   // 体积感：压扁一点就宽一点
      o.dy += q.sink;
      o.dx += q.sway;
      o.rot += q.tilt;
    }
  }

  return o;
}

/**
 * 多动作片段调度：到点就把 images/frameDurs 换成另一段的帧。
 *
 * 为什么直接换 images 而不是另建一套渲染路径：
 *   运行时其余逻辑（尺寸、命中、特效、物理）都是围绕 images/frameDurs 写的。
 *   换掉这两个数组即可让整条链路自动适配，改动面最小、风险最低。
 *   换完要重新算尺寸与 alpha 图 —— 不同片段的帧图片尺寸可能不同。
 */
function tickClips(dtMs) {
  if (!clipScheduler || !clipScheduler.hasClips()) return;
  const r = clipScheduler.tick(dtMs);
  if (!r.changed || !r.clip) return;
  const entry = clipImages.get(r.clip.id);
  if (!entry || !entry.images.length) return;
  images = entry.images;
  frameDurs = entry.durs;
  S.frameIdx = 0;
  S.frameT = 0;
  // 片段换了 -> 尺寸可能不同 -> 重算布局、alpha 图与落点
  setupGround();
  api.setSize(W, H);
  api.setPos(Math.round(S.body.x), Math.round(S.body.y));
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

// ---------------- 交互特效：手 / 拳头（贴图） ----------------
// 素材为「白底 + 黑线稿」的 JPG。渲染前做两步处理：
//   1) 抠白底：把亮度转成 alpha（白->透明，黑->不透明），抗锯齿灰阶按比例保留；
//   2) 裁到实际墨迹边界并做朝向矫正（手转 180°让手指朝下；拳转 -90°让拳峰朝左）。
// 处理是异步的，未就绪时当帧不画特效（不影响宠物本体）。
const ART_HAND_SRC = './assets/hand.jpg';
const ART_FIST_SRC = './assets/fist.jpg';
const artHand = { el: null, ready: false, w: 0, h: 0 };
const artFist = { el: null, ready: false, w: 0, h: 0 };

/**
 * 白底黑线稿 -> 透明底「彩色实心 + 深色描边」精灵（可旋转）
 *
 * 为什么要上色：原素材是纯黑线稿，抠掉白底后只剩黑线，
 * 在深色背景/深色桌面上几乎看不见（用户反馈"看不太出来"）。
 * 这里把线条围出的封闭区域填成肤色，线条本身留作描边。
 *
 * @param img 已解码的 <img>
 * @param maxSide 处理时限制的最长边（节省内存）
 * @param rotateDeg 0 | 180 | -90 | 90
 * @param opt.fill 填充色 [r,g,b]；opt.line 描边色 [r,g,b]；opt.close 封闭膨胀轮数
 */
function makeLineSprite(img, maxSide, rotateDeg, opt = {}) {
  const FILL = opt.fill || [252, 205, 166];    // 卡通肤色
  const LINE = opt.line || [92, 60, 40];       // 柔和深棕描边（比纯黑更自然）
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return null;
  const k = Math.min(1, maxSide / Math.max(iw, ih));
  const sw = Math.max(1, Math.round(iw * k));
  const sh = Math.max(1, Math.round(ih * k));

  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const scx = src.getContext('2d', { willReadFrequently: true });
  scx.drawImage(img, 0, 0, sw, sh);
  const d = scx.getImageData(0, 0, sw, sh);
  const px = d.data;

  // 1) 先求墨迹强度图：white(0) -> ink(1)
  const ink = new Uint8Array(sw * sh);
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x, q = i * 4;
    const lum = 0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2];
    const v = Math.max(0, Math.min(255, Math.round(255 - lum)));
    ink[i] = v;
    if (v > 18) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;             // 全白 / 无内容

  // 2) 判定「内部」：对墨迹做膨胀形成墙，再从四边洪水填充得到「外部」。
  //    线稿断口过大时单纯闭运算会漏，所以再用「水平扫描线回填」兜底：
  //    对每一行，位于左右两端墨迹之间的像素一律视为内部（实心）。
  const wall = new Uint8Array(sw * sh);
  for (let i = 0; i < wall.length; i++) wall[i] = ink[i] > 40 ? 1 : 0;
  const closePasses = Number.isFinite(opt.close) ? opt.close : 3;
  for (let pass = 0; pass < closePasses; pass++) {
    const next = wall.slice();
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (wall[i]) continue;
      if ((x > 0 && wall[i - 1]) || (x < sw - 1 && wall[i + 1]) ||
          (y > 0 && wall[i - sw]) || (y < sh - 1 && wall[i + sw])) next[i] = 1;
    }
    wall.set(next);
  }

  // 3) 从四边洪水填充 -> 外部
  const OUT = 1;
  const mark = new Uint8Array(sw * sh);
  const stack = [];
  const pushIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= sw || y >= sh) return;
    const i = y * sw + x;
    if (mark[i] || wall[i]) return;
    mark[i] = OUT; stack.push(i);
  };
  for (let x = 0; x < sw; x++) { pushIfBg(x, 0); pushIfBg(x, sh - 1); }
  for (let y = 0; y < sh; y++) { pushIfBg(0, y); pushIfBg(sw - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % sw, y = (i - x) / sw;
    pushIfBg(x - 1, y); pushIfBg(x + 1, y); pushIfBg(x, y - 1); pushIfBg(x, y + 1);
  }

  // 3b) 扫描线兜底：每行「最左墨迹」与「最右墨迹」之间的像素必属内部。
  //     这能补掉断口导致的镂空（拳头那种粗线条断口尤其明显）。
  const inside = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < sw; x++) if (ink[y * sw + x] > 40) { if (first < 0) first = x; last = x; }
    if (first < 0 || last <= first) continue;
    for (let x = first; x <= last; x++) inside[y * sw + x] = 1;
  }

  // 3c) 近似「墨迹深度」：多轮腐蚀，剩余轮数越多说明越是墨迹深处（大黑块）。
  const edgeDist = new Uint8Array(sw * sh);
  {
    let cur = new Uint8Array(sw * sh);
    for (let i = 0; i < cur.length; i++) cur[i] = ink[i] > 40 ? 1 : 0;
    for (let pass = 1; pass <= 4; pass++) {
      const next = new Uint8Array(sw * sh);
      let any = false;
      for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        if (!cur[i]) continue;
        if (cur[i - 1] && cur[i + 1] && cur[i - sw] && cur[i + sw]) { next[i] = 1; any = true; }
      }
      cur = next;
      if (!any) break;
      for (let i = 0; i < cur.length; i++) if (cur[i]) edgeDist[i] = pass;
    }
  }

  // 4) 上色：墨迹 -> 描边色；被墨迹包围的非外部区域 -> 填充色；外部 -> 透明
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x, q = i * 4;
    const v = ink[i];
    const isInk = v > 40;                             // 原始墨迹 -> 描边
    const isOutside = mark[i] === OUT;                // 外部背景 -> 透明

    if (!isInk && v <= 6) { px[q + 3] = 0; continue; }   // 纯白 -> 透明

    if (isInk) {
      // 描边 vs 实心块的区分：
      // 原素材里「指关节之间」是很大一块黑，若整块当描边会变成一坨黑。
      // 这里用「墨迹到非墨迹的距离」近似判断：靠近轮廓的薄层 = 描边；
      // 深处（被墨迹包住且周围也都是墨迹）= 大黑块 -> 改染填充色。
      const deep = edgeDist[i] >= 2;      // 距墨迹边缘 >=2px 视为"深部"
      const t = deep ? 0 : Math.min(1, v / 200);
      px[q]     = Math.round(FILL[0] + (LINE[0] - FILL[0]) * t);
      px[q + 1] = Math.round(FILL[1] + (LINE[1] - FILL[1]) * t);
      px[q + 2] = Math.round(FILL[2] + (LINE[2] - FILL[2]) * t);
      px[q + 3] = 255;
    } else if (!isOutside || inside[i]) {
      // 封闭区域内部（含扫描线兜底判定的内部）-> 实心填充，消除镂空
      px[q] = FILL[0]; px[q + 1] = FILL[1]; px[q + 2] = FILL[2];
      px[q + 3] = 255;
    } else {
      // 外部淡墨（抗锯齿过渡）-> 半透明描边
      px[q] = LINE[0]; px[q + 1] = LINE[1]; px[q + 2] = LINE[2];
      px[q + 3] = Math.min(255, Math.round(v * 3));
    }
  }
  scx.putImageData(d, 0, 0);

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const rot = ((rotateDeg % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const ow = swap ? bh : bw;
  const oh = swap ? bw : bh;

  const out = document.createElement('canvas');
  out.width = ow; out.height = oh;
  const ocx = out.getContext('2d');
  ocx.imageSmoothingQuality = 'high';
  ocx.save();
  ocx.translate(ow / 2, oh / 2);
  if (rot) ocx.rotate((rot * Math.PI) / 180);
  ocx.drawImage(src, x0, y0, bw, bh, -bw / 2, -bh / 2, bw, bh);
  ocx.restore();
  return { el: out, w: ow, h: oh };
}

/** 加载并处理两个特效素材（失败只告警，不影响桌宠本体） */
function loadArt() {
  const jobs = [
    // 手掌：肤色填充 + 深棕描边（深色桌面上也看得清）
    [ART_HAND_SRC, artHand, 320, 180, { fill: [252, 205, 166], line: [96, 62, 42], close: 3 }],
    // 拳头：略深一点的肤色，配暖棕描边，冲击感更明显
    [ART_FIST_SRC, artFist, 320, -90, { fill: [246, 190, 148], line: [120, 62, 44], close: 5 }],
  ];
  return Promise.all(jobs.map(([src, box, maxSide, deg, opt]) => new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      try {
        const sp = makeLineSprite(im, maxSide, deg, opt);
        if (sp) { box.el = sp.el; box.w = sp.w; box.h = sp.h; box.ready = true; }
      } catch (err) { console.warn('[pet] 特效素材处理失败: ' + err.message); }
      res();
    };
    im.onerror = () => { console.warn('[pet] 特效素材加载失败: ' + src); res(); };
    im.src = src;
  })));
}

/** 特效显示尺寸：按宠物大小自适应并限幅。
 *  availH：头顶到画布顶端的可用高度（手不能超过它，否则会被画布硬裁切）。 */
function artBoxSize(box, petW, availH, ratio) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.62;
  const target = Math.max(34, Math.min(200, (petW || 0) * r));
  const k = target / Math.max(box.w || 1, box.h || 1);
  let w = box.w * k, h = box.h * k;
  if (Number.isFinite(availH) && availH > 0 && h > availH - 4) {
    const k2 = Math.max(0.05, (availH - 4) / h);
    w *= k2; h *= k2;
  }
  return { w, h };
}

/** 气泡避让：摸头时手掌占据头顶上方空间（返回像素高度） */
function handLiftPx(petW, availH) {
  if (!artHand.ready) return 0;
  return artBoxSize(artHand, petW, availH, 0.62).h + 10;
}

// 坐标约定：虫子的位置一律用「相对宠物窗口左侧的偏移(px)」表示，
// 与 S.body.x（窗口左上角的屏幕坐标）处于同一套水平度量，可直接比较。
// 之前把「画布坐标」与「窗口坐标」混用，导致宠物与虫子双双卡在左边界、永远追不到。

/** 宠物身体中心在窗口内的水平偏移（相对窗口左边缘，px） */
function petCenterOffset() {
  const pos = frameCanvasPos[S.frameIdx], d = frameDraw[S.frameIdx];
  const base = (!pos || !d) ? W / 2 : pos.x + d.w / 2;
  return base + petOffset;
}

/** 在宠物两侧生成一只虫子（活动范围限定在宠物周围的可见区域内） */
function spawnBug() {
  const petX = petCenterOffset();
  const half = Math.max(34, W * 0.34);        // 昆虫活动半径：宠物左右各一小段
  const x0 = Math.max(6, petX - half);
  const x1 = Math.min(W - 6, petX + half);
  bug = createBug({ bounds: { x0, y0: 0, x1: Math.max(x0 + 12, x1), y1: 0 } });
  bugSpawnTimer = 10 + Math.random() * 12;
}

/** 推进虫子；返回仍可被追的虫子（否则 null） */
function tickBug(dtMs) {
  if (!bug || !bug.alive) {
    bugSpawnTimer -= dtMs / 1000;
    if (bugSpawnTimer <= 0) spawnBug();
    return null;
  }
  stepBug(bug, dtMs, petCenterOffset());
  if (!bug.alive) { bug = null; bugSpawnTimer = 8 + Math.random() * 10; return null; }
  return isBugActive(bug) ? bug : null;
}

/** 画桌面上爬动的小虫子（抓虫子玩法） */
function drawBug() {
  if (!bug || !bug.alive) return;
  const GROUND_Y = canvasCssH - 10;
  const appear = Math.min(1, bug.spawnT);
  const caught = bug.state === 'caught';
  if (caught && bug.caughtT >= 1) return;
  const k = caught ? Math.max(0.05, 1 - bug.caughtT) : 1;
  const size = 13 * appear * k;
  if (size < 0.6) return;
  // bug.x 是窗口内偏移；画布与窗口左边缘对齐（#stage 在最底部、left:0），可直接用
  const x = bug.x;
  const y = GROUND_Y - size * 0.5;

  ctx.save();
  ctx.globalAlpha = appear * (caught ? Math.max(0, 1 - bug.caughtT * 0.9) : 0.95);
  ctx.translate(x, y);
  ctx.scale(bug.dir >= 0 ? 1 : -1, 1);
  if (caught) ctx.rotate(bug.caughtT * 2.4);

  const body = "#5a4636";
  const dot = "#8b7057";
  // 三段身体
  ctx.fillStyle = body;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(-size * 0.55 + i * size * 0.52, Math.sin(i * 1.2) * size * 0.08,
      size * (0.40 - i * 0.05), size * (0.33 - i * 0.04), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 头
  ctx.beginPath();
  ctx.ellipse(size * 0.62, -size * 0.02, size * 0.34, size * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  // 触角
  ctx.strokeStyle = body;
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.lineCap = "round";
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(size * 0.72, -size * 0.16);
    ctx.quadraticCurveTo(size * (0.86 + 0.12 * d), -size * 0.52, size * (0.72 + 0.34 * d), -size * 0.62);
    ctx.stroke();
  }
  // 六条腿（随时间摆动，像真在爬）
  const tt = performance.now() / 90;
  ctx.lineWidth = Math.max(1, size * 0.075);
  for (let i = 0; i < 3; i++) {
    const lx = -size * 0.5 + i * size * 0.5;
    const sw = Math.sin(tt + i * 1.5) * size * 0.16;
    ctx.beginPath();
    ctx.moveTo(lx, size * 0.12);
    ctx.lineTo(lx + sw, size * 0.44);
    ctx.stroke();
  }
  // 眼睛
  for (const ex of [size * 0.70, size * 0.52]) {
    ctx.beginPath();
    ctx.arc(ex, -size * 0.10, size * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + size * 0.03, -size * 0.10, size * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = "#20180f"; ctx.fill();
  }
  // 背上斑点
  ctx.fillStyle = dot;
  for (const dx of [-size * 0.45, -size * 0.05]) {
    ctx.beginPath();
    ctx.arc(dx, -size * 0.10, size * 0.10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 抓住虫子后的庆祝：头顶冒爱心与小星星 */
function drawCatchCelebrate(now) {
  if (!catchCelebrateAt) return;
  const life = 900;
  const t = (now - catchCelebrateAt) / life;
  if (t >= 1) { catchCelebrateAt = 0; return; }
  const baseX = canvasCssW / 2 + petOffset;
  const baseY = canvasCssH - (frameDraw[S.frameIdx] ? frameDraw[S.frameIdx].h : 80) - 8;
  for (let i = 0; i < 4; i++) {
    const tt = (t - i * 0.12) / 0.7;
    if (tt <= 0 || tt >= 1) continue;
    const e = 1 - Math.pow(1 - tt, 2);
    const x = baseX + (i - 1.5) * 15 * (0.5 + e);
    const y = baseY - e * 34;
    const alpha = Math.min(1, tt * 3) * (1 - tt);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.95;
    ctx.translate(x, y);
    ctx.rotate((i - 1.5) * 0.3 + tt * 1.2);
    if (i % 2 === 0) {
      // 爱心
      ctx.scale(0.9, 0.9);
      ctx.beginPath();
      ctx.moveTo(0, 4.6);
      ctx.bezierCurveTo(-7.6, -1.4, -3.6, -8.4, 0, -4.2);
      ctx.bezierCurveTo(3.6, -8.4, 7.6, -1.4, 0, 4.6);
      ctx.closePath();
      ctx.fillStyle = "#ff8fa3";
      ctx.fill();
    } else {
      // 小星星
      ctx.beginPath();
      const R = 6, r = 2.4;
      for (let k = 0; k < 10; k++) {
        const ang = (Math.PI / 5) * k - Math.PI / 2;
        const rad = k % 2 === 0 ? R : r;
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#ffd75e";
      ctx.fill();
    }
    ctx.restore();
  }
}

/** 摸头时从宠物头顶飘出的小爱心 */
function drawHearts(now, petRect) {
  if (!petStartAt) return;
  const prog = (now - petStartAt) / PETTING_DURATION;
  if (prog < 0 || prog >= 1) return;
  const q = pettingPose(prog);
  if (q.bliss <= 0.05) return;

  const base = Math.max(10, Math.min(26, petRect.w * 0.20));
  const n = 3;
  for (let i = 0; i < n; i++) {
    // 每颗心错开时间飘出
    const t = (prog - i * 0.16) / 0.62;
    if (t <= 0 || t >= 1) continue;
    const e = 1 - Math.pow(1 - t, 2);                     // 先快后慢
    const x = petRect.cx + (i === 1 ? 12 : i === 2 ? -14 : 0) * (0.5 + t) + q.sway;
    const y = petRect.top - 6 - e * (base * 3.2);
    const alpha = Math.min(1, t * 3) * (1 - t) * q.bliss * 1.4;
    const size = base * (0.55 + 0.45 * e) * (i === 1 ? 0.8 : 1);
    const rot = (i - 1) * 0.22 + Math.sin(t * 5 + i) * 0.10;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 16, size / 16);
    // 心形路径（16x16 基准）
    ctx.beginPath();
    ctx.moveTo(0, 4.6);
    ctx.bezierCurveTo(-7.6, -1.4, -3.6, -8.4, 0, -4.2);
    ctx.bezierCurveTo(3.6, -8.4, 7.6, -1.4, 0, 4.6);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -7, 0, 6);
    g.addColorStop(0, "#ff9fb2");
    g.addColorStop(1, "#ff6f8f");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(214,74,110,.55)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // 高光
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.7;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-2.2, -2.4, 1.5, 1.0, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 画摸头的手：从上方伸下，指尖落在头顶 */
function drawHand(now, petRect) {
  if (!handStartAt || !artHand.ready || !artHand.el) return;
  const prog = (now - handStartAt) / HAND_DURATION;
  if (prog >= 1) { handStartAt = 0; return; }
  const st = handState(prog);
  if (!st.visible) return;

  const box = artBoxSize(artHand, petRect.w, petRect.top, 0.62);
  // 图片底边就是指尖 -> 以「底边中点」为落点，st.y=0 时正好触到头顶
  const tipX = petRect.cx;
  const tipY = petRect.top + st.y * petRect.h + 3;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(tipX, tipY);
  ctx.scale(st.scale, st.scale);
  ctx.drawImage(artHand.el, -box.w / 2, -box.h, box.w, box.h);
  ctx.restore();
}

/** 画挨拳击的拳头：从侧方冲入并落到身体上 */
function drawFist(now, petRect) {
  if (!fistStartAt || !artFist.ready || !artFist.el) return;
  const prog = (now - fistStartAt) / FIST_DURATION;
  if (prog >= 1) { fistStartAt = 0; return; }
  const st = fistState(prog, fistDir);
  if (!st.visible) return;

  const box = artBoxSize(artFist, petRect.w, Infinity, 0.44);
  const travel = petRect.w * 1.05 + box.w;         // st.x 的归一化行程
  // 拳峰朝身体：拳峰位于图左缘，落到身体近侧边缘
  const restX = petRect.cx + fistDir * (petRect.w * 0.5 - box.w * 0.32);
  const cx = restX + (box.w / 2) * fistDir + st.x * travel * fistDir;
  const cy = petRect.top + petRect.h * 0.42 + st.y * petRect.h;

  ctx.save();
  ctx.globalAlpha = st.alpha;
  ctx.translate(cx, cy);
  // 源图已矫正为「拳峰朝左」；从左边来时水平镜像，保证拳峰永远朝身体
  if (fistDir < 0) ctx.scale(-1, 1);
  ctx.rotate((st.rot * Math.PI) / 180);
  ctx.scale(st.scale, st.scale);

  ctx.drawImage(artFist.el, -box.w / 2, -box.h / 2, box.w, box.h);

  // 冲击特效：接触瞬间的星芒 + 冲击线（画在拳头前方）
  if (st.impact > 0.05) {
    const f = -1;                                   // 已矫正为朝左
    const size = box.w;
    ctx.save();
    ctx.globalAlpha = st.alpha * st.impact;
    ctx.strokeStyle = "#ffd45e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(f * size * 0.30, i * size * 0.16);
      ctx.lineTo(f * size * (0.62 + Math.abs(i) * 0.10), i * size * 0.30);
      ctx.stroke();
    }
    ctx.globalAlpha = st.alpha * st.impact * 0.9;
    ctx.fillStyle = "#fff4c2";
    ctx.beginPath();
    const spikes = 8, R = size * 0.30, r2 = size * 0.11;
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (Math.PI / spikes) * i;
      const rad = i % 2 === 0 ? R : r2;
      const qx = f * size * 0.28 + Math.cos(ang) * rad;
      const qy = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
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
  const cyp = pos.y + d.h + groundDy; // 以脚底为变换原点（含落点微调）

  ctx.save();
  ctx.translate(cxp, cyp);
  ctx.rotate((o.rot * Math.PI) / 180);
  ctx.scale(o.scaleX, o.scaleY);
  ctx.translate(0, o.dy);
  ctx.imageSmoothingQuality = 'high';
  // groundDy 让「真实不透明底边」而不是「图片底边」贴地（素材有透明留白时尤其明显）
  ctx.drawImage(images[i], -d.w / 2, -d.h + groundDy, d.w, d.h);
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
    cx: cxp + d.w * ((ct.x0 + ct.x1) / 2 - 0.5) * o.scaleX + petOffset,
    w: cw,
    h: ch,
    // 内容顶端在 canvas 中的 y（以脚底为原点缩放，再叠加 dy）
    top: cyp + o.scaleY * (o.dy - d.h * (1 - ct.y0)),   // cyp 已含 groundDy
    scaleY: o.scaleY,
  };
  drawBug();
  drawCatchCelebrate(now);
  drawHearts(now, petRect);
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
    tickClips(dtMs);
    advanceFrame(dtMs);
    if (!S.dragging && dt > 0) {
      // ---- 抓虫子：优先于普通待机行为 ----
      const chasing = (behaviorEnabled && bugChaseEnabled) ? tickBug(dtMs) : (bug = null, null);
      if (chasing) {
        // 追虫：宠物在「窗口内」横向挪过去靠近虫子（不移动整个窗口）。
        // 早先给窗口加速度的做法会卡在屏幕边缘（窗口仅 ~160px，贴边就无路可走）。
        const pos = frameCanvasPos[S.frameIdx], dd = frameDraw[S.frameIdx];
        const baseX = (!pos || !dd) ? W / 2 : pos.x + dd.w / 2;
        const petX = baseX + petOffset;
        const dx = bug.x - petX;
        if (canPounce(bug, petX)) {
          petOffset += dx * Math.min(1, dt * 8);
          if (catchBug(bug)) {
            bugCatchCount++;
            S.clickP = 1; S.clickAnim = 'jump';
            // 用户刚说过话就先不抢话（气泡是同一块 UI，会互相顶掉）
            catchCelebrateAt = performance.now();      // 冒爱心庆祝
            const quiet = (performance.now() - userSpokeAt) > 4000;
            if (pack.bubble.enabled && quiet) { showBubble('抓到啦！'); S.bubbleTimer = pack.bubble.intervalSec; }
          }
        } else {
          const step = Math.sign(dx) * 70 * dt;
          petOffset += step;
          const lim = Math.max(0, W / 2 - 8);
          petOffset = Math.max(-lim, Math.min(lim, petOffset));
        }
      } else if (behaviorEnabled) {
        // 没虫子时缓慢归位，避免宠物一直偏在一边
        petOffset += (0 - petOffset) * Math.min(1, dt * 1.5);
        // 行为状态机：决定当前想做什么（爬动会给出目标速度）
        tickBehavior(B, dtMs, { edgeHint: edgeInfo() });
        // 睡着后打呼：只触发一次（shouldSnore 按睡眠进度判定，避免一直冒气泡）
        if (B.state === 'doze') {
          const prog = B.duration > 0 ? 1 - B.remaining / B.duration : 0;
          if (shouldSnore(prog)) snorePending = true;
        } else {
          snorePending = false;
        }
      }
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
    handLift = Math.min(handLiftPx(d.w, canvasCssH - pos.y), canvasCssH - pos.y - 6);
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
  // 优先判定：点到虫子就直接抓走（比拖拽优先级高）
  if (bug && isBugActive(bug)) {
    // bug.x 是窗口内偏移；鼠标事件用 clientX（窗口坐标），二者同一套度量
    const cy = e.clientY;
    const gy = window.innerHeight - 10;
    const rad = 18;
    if (Math.hypot(e.clientX - bug.x, cy - (gy - 6)) <= rad) {
      if (catchBug(bug)) {
        bugCatchCount++;
        catchCelebrateAt = performance.now();
        const quiet = (performance.now() - userSpokeAt) > 4000;
        if (pack.bubble.enabled && quiet) { showBubble('抓到啦！'); S.bubbleTimer = pack.bubble.intervalSec; }
      }
      return;
    }
  }
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
    petStartAt = performance.now();
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

// ---------------- 缩放（显示大小） ----------------
// 允许 10% ~ 300%，每次调整直接重设窗口尺寸并按脚底对齐重新定位，
// 保证"脚不离地"，不会因为改尺寸而让宠物掉下去或飞出屏幕。
let userScale = 0;

function clampScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.6;
  return Math.min(3, Math.max(0.1, n));
}

/** 应用缩放：重算布局 -> 设窗口尺寸 -> 以脚底为锚点重新定位 */
async function applyScale(nextScale) {
  if (!pack) return;
  const k = clampScale(nextScale);
  if (Math.abs(k - userScale) < 1e-4) return;
  const bottom = S.body.y + H;             // 当前脚底（窗口底边）
  userScale = k;
  pack.render.scale = k;
  // scale 变了 -> 绘制高度变了 -> 落点微调也要重新收敛（否则脚会离地）
  setupGround();
  api.setSize(W, H);
  await new Promise((r) => setTimeout(r, 60));
  const b = await api.getBounds();
  if (b && b.height > 0) { H = b.height; W = b.width; }
  S.body.y = bottom - H;                   // 脚底不变
  clampIntoArea(S.body, { w: W, h: H }, area);
  api.setPos(Math.round(S.body.x), Math.round(S.body.y));
  placeBubble();
}

if (api.onQuickScale) api.onQuickScale((v) => { applyScale(v).catch(() => {}); });

// 鼠标滚轮在宠物上直接缩放
window.addEventListener('wheel', (e) => {
  if (!pack) return;
  e.preventDefault();
  const step = e.deltaY < 0 ? 0.06 : -0.06;
  applyScale((userScale || pack.render.scale) + step).catch(() => {});
}, { passive: false });

// ---- 快速模式指令（来自制作器窗口） ----
if (api.onQuickBugChase) api.onQuickBugChase((on) => {
  bugChaseEnabled = !!on;
  if (!bugChaseEnabled) { bug = null; }        // 关掉时清掉场上的虫子
});

if (api.onCursor) api.onCursor((p) => {
  if (cursorFrozen) return;   // 测试注入期间忽略真实推送，保证断言稳定
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) cursorScreen = p;
});

if (api.onQuickLook) api.onQuickLook((on) => { lookEnabled = !!on; });

if (api.onQuickHop) api.onQuickHop((on) => {
  hopEnabled = !!on;
  // 关闭跳跃时把权重清零：状态机不会选到 hop（而不是选到后不动）
  B.weights.hop = hopEnabled ? 0.16 : 0;
  if (!hopEnabled && B.state === 'hop') { B.state = 'idle'; B.remaining = 0; B.duration = 0; }
});

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
  petStartAt = performance.now();
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
  userSpokeAt = performance.now();   // 记下用户发言时间，期间不弹自动气泡
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
// 测试用：把行为切到跳跃，便于自动化断言渲染姿态（无副作用，仅状态机）
window.__forceHop = () => { try { enterState(B, 'hop'); return true; } catch { return false; } };

// 测试用：强制进入打瞌睡 / 注入光标坐标（便于自动化断言姿态，不依赖真实鼠标移动）
window.__forceDoze = () => { try { enterState(B, 'doze'); return true; } catch { return false; } };
// 测试用：强制醒来（让"注视"断言不受睡眠状态干扰）
window.__forceWake = () => {
  try {
    if (B.state === 'doze' || B.state === 'idle' || B.state === 'lookAround') enterState(B, 'walk');
    return B.state;
  } catch { return null; }
};
let cursorFrozen = false;   // 测试用：冻结光标，忽略主进程推送
// 测试用：直接进入/退出拖拽态并注入拖拽速度（真实鼠标事件在自动化里难以稳定驱动）
window.__forceDragForTest = (speed = 0) => {
  try {
    S.dragging = true;
    drag = {
      startSX: 0, startSY: 0, startX: S.body.x, startY: S.body.y,
      samples: [
        { t: performance.now() - 100, x: S.body.x, y: S.body.y },
        { t: performance.now(), x: S.body.x + speed * 0.1, y: S.body.y },
      ],
    };
    return true;
  } catch { return false; }
};
window.__endDragForTest = () => { try { S.dragging = false; drag = null; return true; } catch { return false; } };

window.__setCursorForTest = (p, freeze = true) => {
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    cursorScreen = { x: p.x, y: p.y };
    cursorFrozen = !!freeze;
    return true;
  }
  return false;
};
window.__unfreezeCursor = () => { cursorFrozen = false; return true; };

window.__petDebug = () => ({
  behavior: {
    state: B.state, walkDir: B.walkDir, enabled: behaviorEnabled,
    remaining: Math.round(B.remaining), duration: Math.round(B.duration || 0), hopEnabled,
    hitCount: B.hitCount, patCount: B.patCount,
    hop: hopPose(B),          // 跳跃姿态（非 hop 状态时为 null）
    hopWeight: B.weights.hop, // 跳跃权重（关掉后应为 0）
    lookEnabled,
    cursor: cursorScreen ? { x: cursorScreen.x, y: cursorScreen.y } : null,
    dragging: !!S.dragging,
    dragSpeed: (() => {
      if (!S.dragging || !drag) return 0;
      const v = estimateThrowVelocity(drag.samples);
      return Math.round(Math.hypot(v.vx || 0, v.vy || 0));
    })(),
  },
  // 最近一帧真实用于绘制的姿态：验证「跳跃确实抬高了」靠这个，而不是靠状态名
  pose: { ...lastPose },
  bug: bug ? { x: Math.round(bug.x), state: bug.state, alive: bug.alive } : null,
  bugCatchCount,
  bugChaseEnabled,
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

    // 多动作片段：包里带 clips 时，把每段的图片也加载进来。
    // 加载失败的片段直接丢弃（一个坏片段不能让整只宠物起不来）。
    if (Array.isArray(r.clips) && r.clips.length) {
      const loaded = [];
      for (const c of r.clips) {
        const fr = Array.isArray(c.frames) ? c.frames : [];
        if (!fr.length) continue;
        try {
          const ims = await Promise.all(fr.map((f) => loadImage(f.dataUrl)));
          clipImages.set(c.id, { images: ims, durs: fr.map((f) => f.durationMs || 110) });
          loaded.push({ id: c.id, name: c.name, frames: fr.map((f) => ({ file: f.file, durationMs: f.durationMs || 110 })), weight: c.weight });
        } catch (err) {
          console.warn('[pet] 动作片段加载失败，已跳过: ' + c.id + ' -> ' + (err && err.message));
        }
      }
      if (loaded.length) {
        // 调度参数：4~12 秒换一次动作，避免"刚换又换"或"半天不动"
        // 切换间隔：默认 4~12 秒（太短显得烦躁，太长又像没在动）。
        // 可由宠物包指定（animation.clipIntervalSec），方便用户调、也方便测试用极短间隔验证。
        const sec = Number(pack.animation && pack.animation.clipIntervalSec);
        const opt = Number.isFinite(sec) && sec > 0
          ? { minMs: sec * 1000, maxMs: sec * 1000 }
          : { minMs: 4000, maxMs: 12000 };
        clipScheduler = createClipScheduler(loaded, opt);
        console.log('[pet] 已加载 ' + loaded.length + ' 个动作片段，将随机切换');
      }
    }

    area = await api.workArea();
    workArea = area;
    try { const list = await api.allWorkAreas(); if (list && list.length) allAreas = list; } catch {}
    if (!allAreas.length) allAreas = [area];

    userScale = clampScale(pack.render.scale);
    bugChaseEnabled = !pack.behavior || pack.behavior.bugChase !== false;   // 默认开启
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
    // 关键：用真实窗口高度收敛落点（含底部预留），之后才进入渲染循环。
    // 放在渲染循环之前是刻意的 —— 在循环中途重建画布会导致尺寸错配（实测采样全透明）。
    setupGround();
    const b1 = await api.getBounds();
    if (b1 && b1.height > 0) { H = b1.height; W = b1.width; }

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

    // 特效素材异步加载并预处理（白底->透明、朝向矫正）；未就绪时当帧不画特效
    loadArt();

    console.log('PET_READY frames=' + images.length + ' physics=' + typeof stepBody);
    requestAnimationFrame(loop);
  } catch (err) {
    showErr(String(err && err.message ? err.message : err));
  }
})();