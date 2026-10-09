// 大头照 -> Q 版身体（四肢 + 走路/爬动动画）纯逻辑，可单测
//
// 思路（不依赖 AI 生图，纯本地程序化合成）：
//   1) 把「大头照」当作宠物的头（保持原图，已抠好背景）
//   2) 按头宽按比例生成 Q 版四肢：两条小短腿 + 两只小圆手，配色取自头像的主色调
//   3) 生成多帧：走路（双腿交替 + 身体上下起伏）/ 爬动（手脚并用 + 身体前倾）
//
// 渲染由调用方用 canvas 完成；这里只输出「几何参数」与「逐帧姿态」，便于测试。

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function finite(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export const Q_MODES = ['walk', 'crawl'];

/**
 * 由头部尺寸推导 Q 版身体比例
 * @param head 头部像素尺寸 { width, height }
 * @param opt.scale 整体缩放
 */
export function bodyMetrics(head, opt = {}) {
  const hw = Math.max(8, finite(head && head.width, 128));
  const hh = Math.max(8, finite(head && head.height, 128));
  const s = clamp(finite(opt.scale, 1), 0.2, 4);

  const legW = hw * 0.24 * s;          // 腿宽（Q 版：粗短）
  const legH = hh * 0.26 * s;          // 腿长（再短一点）
  const armW = hw * 0.26 * s;          // 手宽（Q 版：圆润小手）
  const armH = hh * 0.26 * s;          // 手长
  const gap = hw * 0.22 * s;           // 两腿中心间距的一半

  return {
    headW: hw * s,
    headH: hh * s,
    legW, legH, armW, armH, gap,
    // 画布：头 + 腿 + 上下浮动余量
    canvasW: Math.round(Math.max(hw * 1.5, hw * s + legW * 2 + gap * 2 + 24)),
    canvasH: Math.round(hh * s + legH * 1.9 + armH * 0.6),
  };
}

/**
 * 单帧姿态
 * @param mode 'walk' | 'crawl'
 * @param t    0..1 循环进度
 * @returns 归一化姿态（相对头宽/头高）
 *   bobY    身体上下浮动（px，负=上）
 *   lean    前倾角度（度）
 *   legL/legR 两腿摆动（-1..1，正=向前）
 *   armL/armR 两手摆动
 *   squash  纵向挤压（1=不变）
 */
export function limbPose(mode, t) {
  const p = (Number.isFinite(t) ? ((t % 1) + 1) % 1 : 0);
  const w = p * Math.PI * 2;

  if (mode === 'crawl') {
    // 爬动：四足「对角步态」——左前手与右后腿同相，右前手与左后腿同相。
    // 摆幅刻意收小：之前手是 ±0.9 大幅上下摆，看起来像"两只手"（实测）。
    const swing = Math.sin(w);
    return {
      bobY: -Math.abs(swing) * 0.030,
      lean: 6,
      legL: swing * 0.55,
      legR: -swing * 0.55,
      // 对角步态：左前手与右后腿同相、右前手与左后腿同相。
      // legR = -swing，所以要取反号才能与 legR 同相。
      armL: -swing * 0.45,
      armR: swing * 0.45,
      squash: 1 + Math.abs(swing) * 0.02,
    };
  }

  // 走路（默认）：双腿交替、身体两步一个起伏
  const swing = Math.sin(w);
  const bob = Math.abs(Math.cos(w));
  return {
    bobY: -bob * 0.03,
    lean: 0,
    legL: swing,
    legR: -swing,
    armL: -swing * 0.6,
    armR: swing * 0.6,
    squash: 1 + bob * 0.02,
  };
}

/**
 * 逐帧姿态序列
 * @param opts.mode   'walk' | 'crawl'
 * @param opts.frames 帧数（建议 8~16）
 */
export function limbSequence({ mode = 'walk', frames = 12 } = {}) {
  const n = Math.max(2, Math.min(48, Math.round(finite(frames, 12))));
  const m = Q_MODES.includes(mode) ? mode : 'walk';
  const out = [];
  for (let i = 0; i < n; i++) out.push(limbPose(m, i / n));
  return out;
}

/**
 * 取头像的主色调（用于给四肢配色，避免手脚颜色和头完全不搭）
 * @param data RGBA 像素（Uint8ClampedArray）
 */
export function dominantColor(data, w, h, { alphaThreshold = 40 } = {}) {
  if (!data || !data.length) return [248, 205, 170];
  const bins = new Map();
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const q = i * 4;
    if (data[q + 3] < alphaThreshold) continue;
    const r = data[q] >> 4, g = data[q + 1] >> 4, b = data[q + 2] >> 4;   // 4bit 分箱
    const k = (r << 8) | (g << 4) | b;
    const cur = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += data[q]; cur.g += data[q + 1]; cur.b += data[q + 2];
    bins.set(k, cur);
  }
  let best = null;
  for (const v of bins.values()) if (!best || v.n > best.n) best = v;
  if (!best) return [248, 205, 170];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/** 由主色推导一个略深的描边色 */
export function outlineOf(rgb, k = 0.62) {
  const c = Array.isArray(rgb) && rgb.length >= 3 ? rgb : [248, 205, 170];
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}
