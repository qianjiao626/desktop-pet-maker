// 用身体识别结果做「自动布局」（纯逻辑，可单测）。
//
// 为什么有用：用户上传的图各式各样 —— 有人物居中、有人物偏左、有人顶到边、
// 有人只占画面一小块。直接拿整张图当宠物，会出现：
//   · 宠物在桌面上占的面积一样，但"人"忽大忽小
//   · 半身照与全身照看起来尺寸完全不同
//   · 画面留白多少决定了宠物看起来有多大（其实取决于留白）
// 用关键点算出**人物实际占据的区域**，据此裁剪与缩放，就能让不同素材
// 在桌面上呈现出一致的视觉大小；顺便把"脚踩在地上"对齐到同一基准线。
//
// 本模块只算几何，不碰像素。

import { kp, SCORE_MIN, bodyGeometry, availableParts } from './pose.js';

/** 人体关键点覆盖不到的"边缘外扩"（头发、脚尖、衣角等） */
export const BODY_PAD = {
  top: 0.42,      // 头顶：鼻子往上还有额头与头发
  bottom: 0.10,   // 脚下：鞋底
  side: 0.22,     // 左右：肩宽之外的躯干/衣摆
};

/**
 * 从关键点估算人体的实际包围盒（归一化 0..1）。
 * 用「头部 + 肩 + 髋 + 四肢」的极值，再按 BODY_PAD 外扩，
 * 因为关键点只标出关节点，画面上的人比这些点更"胖"。
 *
 * @returns {{x,y,w,h,valid}|null} 有效关键点不足时返回 null
 */
export function bodyBounds(keypoints) {
  const P = (n) => {
    const k = kp(keypoints, n);
    return k && k.score >= SCORE_MIN ? k : null;
  };
  const pts = [];
  // 头：鼻子 + 双耳（耳朵比鼻子更靠外）
  for (const n of ['nose', 'leftEar', 'rightEar', 'leftEye', 'rightEye']) {
    const k = P(n); if (k) pts.push(k);
  }
  // 肩/肘/腕/髋/膝/踝
  for (const n of ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
                   'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
                   'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle']) {
    const k = P(n); if (k) pts.push(k);
  }
  // 至少要有躯干轮廓，否则估出来的是垃圾
  const g = bodyGeometry(keypoints);
  if (!pts.length || !g) return null;

  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // 外扩量按「躯干高度」当尺子（与图片绝对像素无关）
  const unit = g.torso;
  const padTop = unit * BODY_PAD.top;
  const padBottom = unit * BODY_PAD.bottom;
  const padSide = unit * BODY_PAD.side;

  let x = Math.max(0, minX - padSide);
  let y = Math.max(0, minY - padTop);
  let w = Math.min(1, maxX + padSide) - x;
  let h = Math.min(1, maxY + padBottom) - y;
  // 保底，避免退化成一个点
  if (!(w > 0.01)) w = 0.01;
  if (!(h > 0.01)) h = 0.01;
  return { x, y, w, h, valid: true, unit };
}

/**
 * 是否要建议裁剪。留白过多时，宠物在桌面上会显得很小、而且会浮在空中。
 */
export function shouldCrop(keypoints) {
  const b = bodyBounds(keypoints);
  if (!b) return { crop: false, reason: '没能确认身体范围' };
  const area = b.w * b.h;
  // 人物占画面不足 45% 面积 -> 建议裁剪（否则桌面上会显得很小）
  if (area < 0.45) {
    return { crop: true, reason: '画面留白较多（人物只占 ' + Math.round(area * 100) + '%），裁到身体范围会更好看' };
  }
  // 明显偏心 -> 也建议裁（不然宠物会贴着屏幕一边）
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.12) {
    return { crop: true, reason: '人物没有居中，裁到身体范围可以避免桌宠偏到屏幕一角' };
  }
  return { crop: false, reason: '画面范围合适' };
}

/**
 * 按「人物实际大小」推荐显示缩放，让不同素材在桌面上观感一致。
 *
 * 思路：把人物高度归一到一个目标像素高度。全身照与半身照因此看起来一样大。
 * @param {object} b        bodyBounds 结果
 * @param {number} canvasH  宠物画布高度（像素）
 * @param {number} targetBodyH 目标人物高度（画布高度的比例）
 */
export function suggestScale(b, canvasH, targetBodyH = 0.62) {
  if (!b || !b.valid || !(canvasH > 0)) return 0.3;
  // 裁剪后人物会占满画布，所以缩放只需按"目标比例"给
  const raw = targetBodyH;
  return Math.max(0.05, Math.min(2, Number(raw.toFixed(3))));
}

/**
 * 计算裁剪区域与对齐信息，供制作器「自动适配」按钮使用。
 * @returns {{ok, crop, scale, reason, bounds}|{ok:false, reason}}
 */
export function autoFit(keypoints, opt = {}) {
  const b = bodyBounds(keypoints);
  if (!b) return { ok: false, reason: '没能确认身体范围（需要先识别到躯干）' };
  const parts = availableParts(keypoints);
  const advice = shouldCrop(keypoints);
  const canvasH = Number(opt.canvasH) || 260;
  const scale = suggestScale(b, canvasH, opt.targetBodyH);
  // 缺腿时不要硬把"脚"对齐到底边（会对齐到膝盖，看起来悬空）
  const anchor = parts.leftLeg || parts.rightLeg ? 'feet' : 'hips';
  return {
    ok: true,
    bounds: b,
    crop: { x: b.x, y: b.y, w: b.w, h: b.h },
    scale,
    anchor,
    needCrop: advice.crop,
    reason: advice.reason + (anchor === 'hips' ? '；没有识别到腿，会按腰部对齐' : ''),
  };
}

/**
 * 把归一化坐标映射到裁剪后画布内的坐标（供绘制对照用）。
 */
export function mapToCrop(pt, crop) {
  if (!pt || !crop || !(crop.w > 0) || !(crop.h > 0)) return { x: 0, y: 0 };
  return {
    x: (pt.x - crop.x) / crop.w,
    y: (pt.y - crop.y) / crop.h,
  };
}
