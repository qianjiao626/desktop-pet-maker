// 骨架微动作渲染（canvas）。
// 依赖 shared/limb.js 的关节解算，这里只做「把每个肢体绕关节转一点」的绘制。
//
// 与之前失败方案的根本区别：**只转很小的角度（≤7°）**。
// 小角度不需要补全任何像素——原图的肢体像素转一点点后，
// 关节处的缺口小到可以用一个圆形补丁完全盖住（补丁取原图同位置像素）。
// 这是纸片人偶技术在"手绘/真人立绘"上的标准用法，也是唯一被验证可用的做法。
//
// 前置条件（由 shared/limb.js 的 canAnimate 把关）：标准立绘，四肢不重叠。

/** 双线性采样（预乘 alpha），避免透明边缘脏色 */
function samplePremul(src, sw, sh, x, y) {
  if (x < -1 || y < -1 || x > sw || y > sh) return [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const sx = x0 + i, sy = y0 + j;
    if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
    const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
    if (wgt <= 0) continue;
    const k = (sy * sw + sx) * 4;
    const al = src[k + 3] / 255;
    r += src[k] * al * wgt; g += src[k + 1] * al * wgt; b += src[k + 2] * al * wgt; a += al * wgt;
  }
  if (a <= 1e-6) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, a];
}

/**
 * 画一个肢体：以 pivot 为中心把原图按 angle 旋转，并裁到「沿肢体的胶囊」内。
 * 这样只有该肢体区域参与旋转，其它部分保持原位。
 */
function drawLimb(ctx, src, limb, angle, piv, size, sw, sh) {
  if (!angle) return;
  const ax = limb.sourceA.x * size, ay = limb.sourceA.y * size;
  const bx = limb.sourceB.x * size, by = limb.sourceB.y * size;
  const px = piv.x * size, py = piv.y * size;
  const len = Math.hypot(bx - ax, by - ay);
  if (!(len > 1)) return;
  // 胶囊半径：按肢体重叠风险取保守值（略微超过肢体宽度即可，
  // 太大会把躯干卷进来，太小会在关节处留缝）
  const rad = Math.max(6, len * 0.55);
  const dirAng = Math.atan2(by - ay, bx - ax);

  ctx.save();
  // 裁剪：以「未旋转的肢体」为中心的胶囊
  ctx.translate(ax, ay);
  ctx.rotate(dirAng);
  ctx.beginPath();
  ctx.arc(0, 0, rad, Math.PI / 2, -Math.PI / 2);
  ctx.lineTo(len, -rad);
  ctx.arc(len, 0, rad, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.clip();
  ctx.rotate(-dirAng);
  ctx.translate(-ax, -ay);
  // 绕 pivot 旋转原图后画入
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.translate(-px, -py);
  // 源图 -> 画布（等比）
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, size, size);
  ctx.restore();
}

/** 关节补丁：盖住旋转产生的小缺口（取原图同位置的圆） */
function drawJoint(ctx, src, joint, radius, size, sw, sh) {
  if (!joint) return;
  const x = joint.x * size, y = joint.y * size;
  const r = Math.max(3, radius * size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, size, size);
  ctx.restore();
}

/**
 * 生成骨架微动作的帧序列。
 * @param {HTMLCanvasElement} srcCanvas 已抠好背景的标准立绘
 * @param {Array} keypoints 识别结果
 * @param {Array} seq       motionSequence 的角度序列
 * @param {Array} jointsPerFrame solveJoints 的结果（逐帧）
 * @param {object} bounds   motionBounds 的结果（统一画布）
 * @param {object} opt      { size, durationMs, padScale }
 */
export function renderLimbFrames(srcCanvas, keypoints, seq, jointsPerFrame, bounds, opt = {}) {
  const size = Math.round(opt.size || 320);
  const durationMs = Math.max(16, Math.round(opt.durationMs || 110));
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const padScale = opt.padScale || 1;
  const frames = [];
  for (let fi = 0; fi < jointsPerFrame.length; fi++) {
    const joints = jointsPerFrame[fi];
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 统一画布：所有帧共用 bounds（避免逐帧大小抖动）
    const span = Math.max(bounds.w, bounds.h);
    const scale = (1 / span) * padScale;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(
      (size / scale - bounds.w * size) / 2 - bounds.x * size,
      (size / scale - bounds.h * size) / 2 - bounds.y * size
    );
    // 先铺一张原始整图（作为底），再把各肢体旋转后盖上去
    ctx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, size, size);
    // 逐部件旋转（顺序：肢体先、靠近躯干的后画）
    for (const name of Object.keys(joints)) {
      const j = joints[name];
      const limb = { sourceA: j.sourceA, sourceB: j.sourceB };
      drawLimb(ctx, srcCanvas, { ...limb, sourceA: j.sourceA, sourceB: j.sourceB }, j.angle, j.pivot, size, sw, sh);
    }
    // 关节补丁
    for (const name of Object.keys(joints)) {
      const j = joints[name];
      drawJoint(ctx, srcCanvas, { x: j.sourceA.x, y: j.sourceA.y }, 0.035, size, sw, sh);
    }
    ctx.restore();
    frames.push({ canvas: cv, durationMs });
  }
  return { frames, width: size, height: size };
}
