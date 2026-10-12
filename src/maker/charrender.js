// 角色工坊的 canvas 渲染器：把 characterPlan 的绘制指令画成真实像素。
// 纯绘制，不含业务逻辑（几何计算都在 shared/charstudio.js，那边有单测）。
import { characterPlan, characterFrames, normalizeCharacter, rotatePoint } from '../shared/charstudio.js';

function pathBody(ctx, b) {
  ctx.beginPath();
  if (b.shape === 'square') {
    const r = Math.min(b.w, b.h) * 0.22;
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else if (b.shape === 'egg') {
    // 上窄下宽
    ctx.ellipse(b.x + b.w / 2, b.y + b.h * 0.56, b.w * 0.46, b.h * 0.50, 0, 0, Math.PI * 2);
  } else if (b.shape === 'bean') {
    ctx.ellipse(b.x + b.w / 2, b.y + b.h * 0.5, b.w * 0.5, b.h * 0.44, -0.12, 0, Math.PI * 2);
  } else {
    ctx.ellipse(b.x + b.w / 2, b.y + b.h * 0.5, b.w * 0.5, b.h * 0.5, 0, 0, Math.PI * 2);
  }
}

/**
 * 画一条「从关节到末端」的胶囊（圆头粗线 + 末端圆），并绕关节旋转。
 *
 * 为什么不用 ctx.rotate 而是自己算末端坐标：
 *   手/脚既要自己转，又要跟着身体整体转（两层旋转叠加）。
 *   自己算坐标后，两层旋转就是简单的角度相加，不必反复 save/restore，
 *   也便于单测断言"末端到底转到哪了"。
 * @param limb  { sx, sy, ex, ey, r, w } 关节起点 / 末端 / 末端半径 / 粗细
 * @param angle 绕关节的旋转角（弧度，正 = 顺时针）
 */
function drawLimb(ctx, limb, angle, color) {
  // 复用 shared 里的 rotatePoint：渲染和单测必须走同一个算法，
  // 否则"测试里的角度算对了、画面上是反的"这种自欺会一直存在。
  const p = rotatePoint(limb.sx, limb.sy, limb.ex, limb.ey, angle);
  const ex = p.x, ey = p.y;
  ctx.strokeStyle = color;
  ctx.lineWidth = limb.w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(limb.sx, limb.sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // 末端圆手/圆脚（盖住线头，看起来是圆润的爪子）
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(ex, ey, limb.r, 0, Math.PI * 2);
  ctx.fill();
  return { ex, ey };
}

function drawEar(ctx, e, pal) {
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  if (e.type === 'cat') {
    ctx.moveTo(e.x, e.y + e.h);
    ctx.lineTo(e.x + e.w / 2, e.y);
    ctx.lineTo(e.x + e.w, e.y + e.h);
    ctx.closePath();
  } else if (e.type === 'rabbit') {
    ctx.ellipse(e.x + e.w / 2, e.y + e.h * 0.5, e.w * 0.34, e.h * 0.72, 0, 0, Math.PI * 2);
  } else if (e.type === 'horn') {
    ctx.moveTo(e.x + e.w * 0.2, e.y + e.h);
    ctx.lineTo(e.x + e.w * 0.5, e.y);
    ctx.lineTo(e.x + e.w * 0.8, e.y + e.h);
    ctx.closePath();
  } else {
    ctx.arc(e.x + e.w / 2, e.y + e.h * 0.6, Math.min(e.w, e.h) * 0.5, 0, Math.PI * 2);
  }
  ctx.fill();
  // 内耳：兔耳/圆耳加一点浅色
  if (e.type === 'rabbit' || e.type === 'round') {
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.ellipse(e.x + e.w / 2, e.y + e.h * 0.62, e.w * 0.16, e.h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEye(ctx, e, pal, dark) {
  ctx.fillStyle = dark;
  if (e.type === 'sleepy') {
    // 闭眼：一条弧线
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1.5, e.r * 0.42);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(e.cx, e.cy + e.r * 0.3, e.r * 0.9, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(e.cx, e.cy, e.r, 0, Math.PI * 2);
  ctx.fill();
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(e.cx - e.r * 0.32, e.cy - e.r * 0.34, e.r * (e.type === 'sparkle' ? 0.36 : 0.26), 0, Math.PI * 2);
  ctx.fill();
  // 第二颗小高光（sparkle 更"亮眼"）
  if (e.type === 'sparkle') {
    ctx.beginPath();
    ctx.arc(e.cx + e.r * 0.30, e.cy + e.r * 0.28, e.r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  if (e.type === 'dot') {
    // 豆豆眼：不要高光太抢
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(e.cx - e.r * 0.3, e.cy - e.r * 0.3, e.r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMouth(ctx, m, dark) {
  ctx.strokeStyle = dark;
  ctx.fillStyle = dark;
  ctx.lineWidth = Math.max(1.5, m.h * 0.6);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (m.type === 'smile') {
    ctx.arc(m.cx, m.cy - m.h * 0.6, m.w * 0.6, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
  } else if (m.type === 'open') {
    ctx.ellipse(m.cx, m.cy, m.w * 0.42, m.h * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.type === 'cat') {
    // 猫嘴：两小段弧
    const r = m.w * 0.30;
    ctx.arc(m.cx - r, m.cy - m.h * 0.2, r, Math.PI * 0.05, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.cx + r, m.cy - m.h * 0.2, r, Math.PI * 0.15, Math.PI * 0.95);
    ctx.stroke();
  } else {
    ctx.moveTo(m.cx - m.w * 0.42, m.cy);
    ctx.lineTo(m.cx + m.w * 0.42, m.cy);
    ctx.stroke();
  }
}

/**
 * 渲染一帧角色到 canvas。
 * @param canvas 目标 canvas（会被改动尺寸）
 * @param cfg    角色配置（未归一化也行）
 * @param opt    { width, height, frame } frame 来自 characterFrames
 */
export function renderCharacter(canvas, cfg, opt = {}) {
  const W = Math.max(16, Math.round(Number(opt.width) || 256));
  const H = Math.max(16, Math.round(Number(opt.height) || 256));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);

  const plan = characterPlan(cfg, { width: W, height: H });
  const pal = plan.palette;
  const dark = pal.accent;

  ctx.save();
  // 帧动画：整体上下浮动 + 轻微挤压 + 整体旋转（跳舞时身体会左右扭）
  const f = opt.frame || null;
  if (f) {
    const pivotX = plan.body.x + plan.body.w / 2;
    const pivotY = plan.body.y + plan.body.h * 0.5;
    ctx.translate(W / 2, H / 2 + H * (f.offsetY || 0));
    ctx.scale(f.scaleX || 1, f.scaleY || 1);
    ctx.translate(-W / 2, -H / 2);
    if (f.rotate) {
      // 绕身体中心转，别绕画布中心（不然会甩出画面）
      ctx.translate(pivotX, pivotY);
      ctx.rotate(f.rotate);
      ctx.translate(-pivotX, -pivotY);
    }
  }

  // 尾巴（画在身体后面）
  if (plan.tail) {
    ctx.strokeStyle = pal.body;
    ctx.lineWidth = plan.tail.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(plan.tail.x1, plan.tail.y1);
    ctx.quadraticCurveTo((plan.tail.x1 + plan.tail.x2) / 2, plan.tail.y2 - plan.tail.w * 2.2, plan.tail.x2, plan.tail.y2);
    ctx.stroke();
  }

  // 手脚（在身体后面，看起来连在身上）。
  // 手绕肩、脚绕髋旋转 —— 旋转后是**重新画一遍**，所以不会出现
  // "照片转过去露出没画过的内侧"那种信息缺失（这正是绘制小人能跳舞的原因）。
  //
  // 帧里给的是「抬起程度 0~1」，真实角度 = 程度 × 该肢体的安全上限 × 方向。
  // 乘上限是为了让任何体型举手都不会伸出画布（实测踩过：写死 90° 会把手裁掉）。
  const limbAngle = (limb, frac) => {
    const k = Number(frac) || 0;
    return k * (limb.maxOut || 0) * (limb.dir || 1);
  };
  for (const h of plan.hands) drawLimb(ctx, h, limbAngle(h, f && (h.side === 'left' ? f.armL : f.armR)), pal.body);
  for (const ft of plan.feet) drawLimb(ctx, ft, limbAngle(ft, f && (ft.side === 'left' ? f.legL : f.legR)), pal.body);

  // 耳朵（宠物才有；小人没有兽耳）
  for (const e of plan.ears) drawEar(ctx, e, pal);

  // 身体
  ctx.fillStyle = pal.body;
  pathBody(ctx, plan.body);
  ctx.fill();

  // 肚皮 / 小人的衣服
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.ellipse(plan.belly.x, plan.belly.y, plan.belly.rx, plan.belly.ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // ★ 小人：头（画在身体之后，让脖子被头压住）+ 脖子
  if (plan.head) {
    // 脖子：一小段连在头和躯干之间，别让头"飘着"
    ctx.strokeStyle = pal.body;
    ctx.lineWidth = Math.max(2, plan.head.r * 0.34);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(plan.head.cx, plan.head.cy + plan.head.r * 0.55);
    ctx.lineTo(plan.head.cx, plan.body.y + plan.body.h * 0.10);
    ctx.stroke();
    // 头
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.arc(plan.head.cx, plan.head.cy, plan.head.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 腮红
  ctx.fillStyle = 'rgba(255,120,140,0.42)';
  for (const b of plan.blushes) { ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2); ctx.fill(); }

  // 眼睛 / 嘴
  for (const e of plan.eyes) drawEye(ctx, e, pal, dark);
  drawMouth(ctx, plan.mouth, dark);

  ctx.restore();
  return plan;
}

/**
 * 渲染整段动画，返回 [{canvas, durationMs}]。
 * 每帧都是**独立 canvas**：制作器后续要读像素（ImageData），共享 canvas 会互相覆盖。
 */
export function renderCharacterFrames(cfg, opt = {}) {
  const n = Math.max(2, Math.min(48, Math.round(Number(opt.frames) || 8)));
  const W = Math.max(16, Math.round(Number(opt.width) || 256));
  const H = Math.max(16, Math.round(Number(opt.height) || 256));
  const specs = characterFrames(cfg, n);
  const out = [];
  for (const spec of specs) {
    const cv = document.createElement('canvas');
    renderCharacter(cv, cfg, { width: W, height: H, frame: spec });
    out.push({ canvas: cv, durationMs: spec.durationMs });
  }
  return out;
}

export { normalizeCharacter };
