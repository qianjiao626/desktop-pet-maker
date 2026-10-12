// 从照片里取「主色」，用来给"照着照片捏的小人"配上接近本人的颜色。
//
// ★ 为什么不用现成库：
//   GitHub 上最相关的是 ColorCube（614★，MIT）—— 但只有 iOS/macOS/Python 实现；
//   其 JS 移植版许可证不清晰（NOASSERTION），不符合本项目"零依赖 + 许可明确"的原则。
//   而我们的场景比它窄得多：只需要"一个主色 + 一个浅色 + 一个深色"，
//   几十行纯逻辑即可，还能单测穷举边界。
//
// 设计取舍：
//   - **不引入 k-means**：聚类对"宠物配色"是杀鸡用牛刀，且结果不稳定（每次略有不同）。
//     这里用"按色相分桶 + 按饱和度/亮度加权投票"，确定性强、可预测、可单测。
//   - 透明像素与近白/近黑像素**不参与投票**：抠图后的透明背景、
//     以及照片常见的白墙/黑影，都不该决定宠物颜色。
//   - 结果一定落在"能当宠物色"的范围：太暗会提亮、太灰会加饱和，
//     否则画出来是一只灰扑扑的泥巴怪。

/** 判断像素是否该参与投票（透明 / 近白 / 近黑 都排除） */
function isVotable(r, g, b, a) {
  if (a < 128) return false;                       // 透明背景
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (v > 0.96) return false;                      // 近白（白墙/过曝）
  if (v < 0.08) return false;                      // 近黑（阴影/纯黑）
  if (s < 0.08) return false;                      // 近灰（没有色彩信息，投了也没用）
  return true;
}

/** RGB -> HSL（h 0~360, s/l 0~1） */
export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** HSL -> RGB -> #rrggbb */
export function hslToHex(h, s, l) {
  const H = ((h % 360) + 360) % 360;
  const S = Math.min(1, Math.max(0, s));
  const L = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let r = 0, g = 0, b = 0;
  if (H < 60) { r = c; g = x; }
  else if (H < 120) { r = x; g = c; }
  else if (H < 180) { g = c; b = x; }
  else if (H < 240) { g = x; b = c; }
  else if (H < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v) => {
    const n = Math.round((v + m) * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };
  const hex = (v) => to(v).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

/**
 * 从 RGBA 像素里取主色。
 * @param data Uint8ClampedArray（RGBA）
 * @param opt { step } 采样步长（默认 4 像素取 1，够准又快）
 * @returns null（没有可用颜色）或 { h, s, l, hex, votes, total }
 */
export function dominantColor(data, opt = {}) {
  const d = data && data.length ? data : null;
  if (!d) return null;
  const step = Math.max(1, Math.floor(Number(opt.step) || 4));
  // 按 12 个色相桶投票：桶内累计"饱和度 × 亮度"作为权重，
  // 这样鲜艳的像素比灰暗的更有话语权（宠物该是鲜艳的）。
  const BUCKETS = 12;
  const acc = [];
  for (let i = 0; i < BUCKETS; i++) acc.push({ w: 0, n: 0, r: 0, g: 0, b: 0, h: 0, s: 0, l: 0 });
  let total = 0;
  const pxCount = Math.floor(d.length / 4);
  for (let p = 0; p < pxCount; p += step) {
    const i = p * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (!isVotable(r, g, b, a)) continue;
    const hsl = rgbToHsl(r, g, b);
    const bi = Math.min(BUCKETS - 1, Math.floor(hsl.h / (360 / BUCKETS)));
    const w = hsl.s * (0.4 + hsl.l);
    const A = acc[bi];
    A.w += w; A.n++;
    A.r += r; A.g += g; A.b += b;
    A.h += hsl.h; A.s += hsl.s; A.l += hsl.l;
    total += w;
  }
  let best = null;
  for (const A of acc) if (A.n && (!best || A.w > best.w)) best = A;
  if (!best || !best.n) return null;
  return {
    h: best.h / best.n, s: best.s / best.n, l: best.l / best.n,
    hex: '#' + [best.r / best.n, best.g / best.n, best.b / best.n]
      .map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''),
    votes: best.n, total,
  };
}

/**
 * 把主色变成一套可用的宠物配色（body / belly / accent）。
 * 关键：**一定要把结果收进"能当宠物色"的范围** ——
 * 照片的主色可能是很暗的深蓝（衣服）或很浅的粉（皮肤），
 * 直接拿来当身体色会画出一只灰扑扑或糊成一团的宠物。
 * @param dom dominantColor 的返回值（或 {h,s,l}）
 */
export function paletteFromDominant(dom) {
  if (!dom || !Number.isFinite(Number(dom.h))) return null;
  const h = Number(dom.h);
  // 身体色：饱和度抬到"可爱"区间，亮度收到中间偏亮
  const s = Math.min(0.72, Math.max(0.42, Number(dom.s) || 0.5));
  const l = Math.min(0.72, Math.max(0.48, Number(dom.l) || 0.6));
  return {
    body: hslToHex(h, s, l),
    belly: hslToHex(h, Math.max(0.18, s * 0.35), Math.min(0.94, l + 0.28)),   // 更浅：肚皮/衣服
    accent: hslToHex(h, Math.min(0.85, s + 0.18), Math.max(0.24, l - 0.26)),  // 更深：五官/描边
  };
}

/**
 * 一步到位：RGBA 像素 -> 宠物配色（没有可用颜色时返回 null，调用方保留原配色）。
 */
export function colorsFromImageData(data, opt = {}) {
  const dom = dominantColor(data, opt);
  if (!dom) return null;
  const pal = paletteFromDominant(dom);
  if (!pal) return null;
  return { ...pal, source: 'photo', dominantHex: dom.hex, votes: dom.votes };
}
