// 纯算法：张量构建 / 掩膜应用 / 缩放（可单测，不依赖 Electron）
export const IMAGENET_MEAN = [0.485, 0.456, 0.406];
export const IMAGENET_STD = [0.229, 0.224, 0.225];

/** 找出 RGBA/BGRA 位图中的最大通道值（rembg 用图像最大值做缩放基准） */
export function maxChannelValue(bmp) {
  let mx = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
    if (r > mx) mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
  }
  return mx;
}

/**
 * Electron nativeImage 位图(BGRA) -> CHW float32 张量
 * 复刻 rembg BaseSession.normalize：
 *   im_ary = array / max(max(array), 1e-6)
 *   out[c] = (im_ary[c] - mean[c]) / std[c]
 * @param bmp   BGRA 位图（长度 w*h*4）
 * @param size  目标方形边长
 * @param mean  [3]
 * @param std   [3]
 * @param scaleByMax  是否除以图像最大值（rembg 默认 true）
 * @param maxVal 可预先算好的最大值；不传则内部计算
 */
export function bgraToTensor(bmp, w, h, size, { mean = IMAGENET_MEAN, std = IMAGENET_STD, divide = 255, maxVal } = {}) {
  const d = new Float32Array(3 * size * size);
  // divide: 'max' = 除以图像最大通道值；数字 = 除以该常数（1 = 不缩放）
  const denom = divide === 'max'
    ? Math.max(maxVal === undefined ? maxChannelValue(bmp) : maxVal, 1e-6)
    : (divide || 1);
  const sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    const syi = Math.min(h - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < size; x++) {
      const sxi = Math.min(w - 1, Math.floor((x + 0.5) * sx));
      const i = (syi * w + sxi) * 4;
      const o = y * size + x;
      const r = bmp[i + 2] / denom;
      const g = bmp[i + 1] / denom;
      const b = bmp[i] / denom;
      d[o] = (r - mean[0]) / std[0];
      d[size * size + o] = (g - mean[1]) / std[1];
      d[2 * size * size + o] = (b - mean[2]) / std[2];
    }
  }
  return d;
}

/** 双线性缩放单通道掩膜 */
export function resizeMaskBilinear(mask, mw, mh, dw, dh) {
  const out = new Float32Array(dw * dh);
  if (mw === dw && mh === dh) { out.set(mask); return out; }
  const sx = mw / dw, sy = mh / dh;
  for (let y = 0; y < dh; y++) {
    const fy0 = Math.min(mh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy0), y1 = Math.min(mh - 1, y0 + 1), wy = fy0 - y0;
    for (let x = 0; x < dw; x++) {
      const fx0 = Math.min(mw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx0), x1 = Math.min(mw - 1, x0 + 1), wx = fx0 - x0;
      const a = mask[y0 * mw + x0], b = mask[y0 * mw + x1];
      const c = mask[y1 * mw + x0], e = mask[y1 * mw + x1];
      out[y * dw + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + e * wx) * wy;
    }
  }
  return out;
}

/** rembg 后处理：把预测值 min-max 归一到 0..1 */
export function minMaxNormalize(pred) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pred.length; i++) { const v = pred[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn;
  const out = new Float32Array(pred.length);
  if (!(span > 1e-12)) { out.fill(span === 0 && mx > 0 ? 1 : 0); return out; }
  for (let i = 0; i < pred.length; i++) out[i] = (pred[i] - mn) / span;
  return out;
}

/**
 * 把掩膜乘到 BGRA 位图的 alpha 上
 * threshold 附近 feather 宽度内做线性过渡
 */
export function applyMaskToBgraAlpha(bmp, w, h, mask, mw, mh, { threshold = 0.5, feather = 0.12, invert = false } = {}) {
  const out = new Uint8ClampedArray(bmp);
  const lo = Math.max(0, threshold - feather);
  const hi = Math.min(1, threshold + feather);
  const span = Math.max(1e-6, hi - lo);
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor((y + 0.5) * mh / h));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mw - 1, Math.floor((x + 0.5) * mw / w));
      let v = mask[my * mw + mx];
      if (invert) v = 1 - v;
      let k = (v - lo) / span;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const i = (y * w + x) * 4 + 3;
      out[i] = Math.round(out[i] * k);
    }
  }
  return out;
}

/** 掩膜覆盖率，用于判断抠图是否过于激进/失败 */
export function maskCoverage(mask, threshold = 0.5) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= threshold) n++;
  return n / (mask.length || 1);
}
/**
 * 保持宽高比的 letterbox 版张量（对齐 anime-segmentation 官方前处理）
 * 返回 { data, box:{x,y,w,h} }，box 为原图内容在方形画布中的位置
 */
export function bgraToTensorLetterbox(bmp, w, h, size, { mean = [0,0,0], std = [1,1,1], divide = 255, maxVal } = {}) {
  const denom = divide === 'max'
    ? Math.max(maxVal === undefined ? maxChannelValue(bmp) : maxVal, 1e-6)
    : (divide || 1);
  const scale = size / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const ox = Math.floor((size - nw) / 2);
  const oy = Math.floor((size - nh) / 2);
  const d = new Float32Array(3 * size * size); // 填充 0
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const i = (sy * w + sx) * 4;
      const o = (y + oy) * size + (x + ox);
      d[o] = (bmp[i + 2] / denom - mean[0]) / std[0];
      d[size * size + o] = (bmp[i + 1] / denom - mean[1]) / std[1];
      d[2 * size * size + o] = (bmp[i] / denom - mean[2]) / std[2];
    }
  }
  return { data: d, box: { x: ox, y: oy, w: nw, h: nh } };
}

/** 从方形掩膜中裁出 letterbox 内容区，并缩放到原图尺寸 */
export function cropMaskFromLetterbox(mask, size, box, dw, dh) {
  const sub = new Float32Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      sub[y * box.w + x] = mask[(y + box.y) * size + (x + box.x)];
    }
  }
  return resizeMaskBilinear(sub, box.w, box.h, dw, dh);
}