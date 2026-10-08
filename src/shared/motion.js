// 程序化动画生成（纯算法，可单测）
// 从「单张静态图」合成一组循环动画帧，解决静态图只有 1 帧、动不起来的问题
//
// 关键质量点：采样使用「预乘 alpha」，避免透明边缘出现黑色/白色光晕
// （直接对 RGBA 线性插值会让透明像素的 RGB 污染边缘，产生脏边）

/** 双线性采样（预乘 alpha）。越界返回全透明。 */
function samplePremul(src, sw, sh, x, y) {
  if (x < -1 || y < -1 || x > sw || y > sh) return [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const sx = x0 + i, sy = y0 + j;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      if (wgt <= 0) continue;
      const k = (sy * sw + sx) * 4;
      const al = src[k + 3] / 255;
      r += src[k] * al * wgt;
      g += src[k + 1] * al * wgt;
      b += src[k + 2] * al * wgt;
      a += al * wgt;
    }
  }
  if (a <= 1e-6) return [0, 0, 0, 0];
  // 反预乘，还原直通颜色
  return [r / a, g / a, b / a, a];
}

function rotPt(x, y, deg) {
  if (!deg) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/**
 * 对单帧应用仿射变换（缩放/旋转/平移），输出到放大后的画布
 * @param anchor 'bottom' | 'center'  变换锚点
 * @param scaleX/scaleY 相对缩放
 * @param rotateDeg 旋转角度
 * @param offsetX/offsetY 像素位移（输出空间）
 */
export function transformFrame(src, sw, sh, dw, dh, opts = {}) {
  const { scaleX = 1, scaleY = 1, rotateDeg = 0, offsetX = 0, offsetY = 0, anchor = 'bottom' } = opts;
  const out = new Uint8ClampedArray(dw * dh * 4);

  // 源锚点（图像坐标系）
  const ax = sw / 2;
  const ay = anchor === 'bottom' ? sh : sh / 2;
  // 目标锚点：bottom 时底部留边距，center 时正中
  const tx = dw / 2 + offsetX;
  const ty = (anchor === 'bottom' ? dh - (dh - scaleY * sh) / 2 : dh / 2) + offsetY;

  // 逆变换：out -> src
  // v_src = S^-1 * R^-1 * (v_out - t_anchor) + s_anchor
  const invSx = scaleX !== 0 ? 1 / scaleX : 0;
  const invSy = scaleY !== 0 ? 1 / scaleY : 0;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let vx = x - tx;
      let vy = y - ty;
      // 逆旋转
      const [rx, ry] = rotPt(vx, vy, -rotateDeg);
      // 逆缩放
      const sx = rx * invSx + ax;
      const sy = ry * invSy + ay;

      // 快速剔除：远离源图则跳过
      if (sx < -1 || sy < -1 || sx > sw || sy > sh) continue;

      const [r, g, b, a] = samplePremul(src, sw, sh, sx, sy);
      if (a <= 1e-6) continue;
      const k = (y * dw + x) * 4;
      out[k] = Math.round(Math.max(0, Math.min(255, r)));
      out[k + 1] = Math.round(Math.max(0, Math.min(255, g)));
      out[k + 2] = Math.round(Math.max(0, Math.min(255, b)));
      out[k + 3] = Math.round(Math.max(0, Math.min(255, a * 255)));
    }
  }
  return { data: out, width: dw, height: dh };
}

/**
 * 每种运动在相位 t(0..1) 处的仿射参数
 * 位移/旋转均按图像尺寸缩放——用固定像素常数会让动作在大图上几乎不可见
 * amp 语义：0.01 极微弱 ~ 0.20 明显；默认 0.04
 */
export const MOTIONS = {
  breathe: (t, amp) => {
    const s = Math.sin(t * Math.PI * 2);
    return { scaleX: 1 - s * amp * 1.0, scaleY: 1 + s * amp * 1.6, rotateDeg: 0, offsetX: 0, offsetY: 0 };
  },
  sway: (t, amp) => {
    const s = Math.sin(t * Math.PI * 2);
    return { scaleX: 1, scaleY: 1, rotateDeg: s * amp * 55, offsetX: 0, offsetY: 0 };
  },
  float: (t, amp, d) => {
    const s = Math.sin(t * Math.PI * 2);
    return { scaleX: 1, scaleY: 1, rotateDeg: 0, offsetX: 0, offsetY: -s * amp * d.h * 1.6 };
  },
  nod: (t, amp) => {
    const s = Math.sin(t * Math.PI * 2);
    return { scaleX: 1 + s * amp * 1.2, scaleY: 1 - s * amp * 1.8, rotateDeg: s * amp * 16, offsetX: 0, offsetY: 0 };
  },
  bounce: (t, amp, d) => {
    // 相位前半起跳、后半落地挤压；|sin| 在半周期处达峰
    const ph = t * Math.PI * 2;
    const lift = Math.max(0, Math.sin(ph));
    const squash = Math.max(0, -Math.sin(ph));
    return {
      scaleX: 1 + squash * amp * 2.2,
      scaleY: 1 - squash * amp * 2.2,
      rotateDeg: 0,
      offsetX: 0,
      offsetY: -lift * amp * d.h * 2.4,
    };
  },
  rock: (t, amp, d) => {
    const s = Math.sin(t * Math.PI * 2);
    return { scaleX: 1, scaleY: 1, rotateDeg: s * amp * 80, offsetX: s * amp * d.w * 0.9, offsetY: 0 };
  },
};

export const MOTION_NAMES = Object.keys(MOTIONS);

/** 某运动在整个周期内需要的画布安全外扩像素（取全周期最大值） */
export function safePadding(w, h, motion, amp) {
  const fn = MOTIONS[motion];
  if (!fn) return 8;
  const d = { w, h };
  let maxScale = 0, maxRot = 0, maxOff = 0;
  const STEPS = 48;
  for (let i = 0; i < STEPS; i++) {
    const p = fn(i / STEPS, amp, d) || {};
    maxScale = Math.max(maxScale, Math.abs((p.scaleX || 1) - 1) * w, Math.abs((p.scaleY || 1) - 1) * h);
    maxRot = Math.max(maxRot, Math.abs(p.rotateDeg || 0));
    maxOff = Math.max(maxOff, Math.abs(p.offsetX || 0), Math.abs(p.offsetY || 0));
  }
  // 旋转外扩：半对角线 * sin(角度)
  const rotPad = maxRot > 0 ? (Math.hypot(w, h) / 2) * Math.sin((maxRot * Math.PI) / 180) : 0;
  return Math.ceil(Math.max(maxScale, rotPad, maxOff) + 6);
}

/**
 * 从单帧合成一组无缝循环的动画帧
 * 相位取 i/N，使第 N 帧接回第 0 帧时连续（无缝循环）
 */
/** 预先算出合成后的画布尺寸（不生成帧，用于内存预算） */
export function motionCanvasSize(w, h, motion, amplitude = 0.04) {
  const amp = Math.max(0, Math.min(0.5, amplitude));
  const pad = safePadding(w, h, motion, amp);
  return { width: w + pad * 2, height: h + pad * 2, pad };
}

export function synthesizeMotion(src, sw, sh, { motion = 'breathe', frames = 12, amplitude = 0.04, timeScale = 1 } = {}) {
  const fn = MOTIONS[motion];
  if (!fn) throw new Error('未知运动类型: ' + motion);
  const n = Math.max(2, Math.min(60, Math.round(frames)));
  const amp = Math.max(0, Math.min(0.5, amplitude));
  const pad = safePadding(sw, sh, motion, amp);
  const dw = sw + pad * 2;
  const dh = sh + pad * 2;

  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * (timeScale || 1);
    const p = fn(t, amp, { w: sw, h: sh });
    const r = transformFrame(src, sw, sh, dw, dh, { ...p, anchor: 'bottom' });
    out.push(r);
  }
  return { frames: out, canvas: { width: dw, height: dh }, motion, amplitude: amp };
}