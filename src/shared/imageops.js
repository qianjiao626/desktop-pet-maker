// 纯图像算法（不依赖 canvas / DOM），可直接在 Node 中单元测试
// 约定：像素数据为 RGBA 连续数组，长度 = w*h*4

export function cloneData(data) { return new Uint8ClampedArray(data); }

/** 从四边采样背景色，量化后聚类，返回出现最多的若干种颜色 */
export function estimateBackgroundColors(data, w, h, maxColors = 4) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 200) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    let e = counts.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; counts.set(key, e); }
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }

  const list = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, maxColors);
  if (!list.length) return [[255, 255, 255]];
  return list.map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
}

function minColorDist(data, i, colors) {
  let best = Infinity;
  for (const c of colors) {
    const d = Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2]));
    if (d < best) best = d;
  }
  return best;
}

/** 可分离盒式模糊（两遍近似高斯），返回 0..1 浮点掩膜 */
export function blurMask(mask, w, h, radius) {
  if (radius <= 0) return Float32Array.from(mask);
  const r = Math.max(1, Math.round(radius));
  let src = Float32Array.from(mask);
  let tmp = new Float32Array(w * h);
  let dst = new Float32Array(w * h);

  for (let pass = 0; pass < 2; pass++) {
    // 横向: src -> tmp
    for (let y = 0; y < h; y++) {
      let sum = 0, cnt = 0;
      for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { sum += src[y * w + x]; cnt++; }
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / cnt;
        const out = x - r, inn = x + r + 1;
        if (out >= 0) { sum -= src[y * w + out]; cnt--; }
        if (inn < w) { sum += src[y * w + inn]; cnt++; }
      }
    }
    // 纵向: tmp -> dst
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let y = -r; y <= r; y++) if (y >= 0 && y < h) { sum += tmp[y * w + x]; cnt++; }
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / cnt;
        const out = y - r, inn = y + r + 1;
        if (out >= 0) { sum -= tmp[out * w + x]; cnt--; }
        if (inn < h) { sum += tmp[inn * w + x]; cnt++; }
      }
    }
    // 交换：下一轮读 dst，写入新的空缓冲
    const t = src; src = dst; dst = t;
  }
  return src;
}

/** 边缘漫水抠图：从四边向内扩散，只删除与边界连通的背景 */
export function floodCut(data, w, h, { tol = 38, feather = 18, bgColors, decontaminate = true, maskGrow = 2, decontaminateBlock = 64 } = {}) {
  const d = cloneData(data);
  const colors = bgColors && bgColors.length ? bgColors : estimateBackgroundColors(data, w, h);
  const mask = new Uint8Array(w * h);
  const stack = [];

  const test = (idx) => {
    if (mask[idx]) return;
    const i = idx * 4;
    if (d[i + 3] === 0) { mask[idx] = 1; stack.push(idx); return; }
    if (minColorDist(d, i, colors) <= tol) { mask[idx] = 1; stack.push(idx); }
  };

  for (let x = 0; x < w; x++) { test(x); test((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { test(y * w); test(y * w + w - 1); }

  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) test(idx - 1);
    if (x < w - 1) test(idx + 1);
    if (y > 0) test(idx - w);
    if (y < h - 1) test(idx + w);
  }

  // 羽化：默认把掩膜先向外扩 maskGrow 圈，让过渡带落在主体内侧，
  // 这样"边缘那一圈混了背景色的像素"会被压到接近全透明，再由去污染减掉残留背景色。
  const grown = feather > 0 && maskGrow > 0 ? dilateMask(mask, w, h, maskGrow) : mask;
  const soft = feather > 0 ? blurMask(Float32Array.from(grown), w, h, Math.max(1, Math.round(feather / 3))) : mask;
  for (let idx = 0; idx < w * h; idx++) {
    // ★ mask=1 的像素，颜色本身就落在背景色容差内 —— 它不携带任何前景信息，
    //   必须**彻底删掉**，而不是羽化成"半透明的背景色"。
    //   这一条是"深色壁纸上一圈白边"的根因修复：羽化会把边界内侧那一圈背景色
    //   压成 alpha≈128 的浅灰，叠在深色背景上就是肉眼可见的白圈。
    //   会不会误伤浅色部位（白毛/白肚）？—— 不会：mask 是**从图像四边漫水**得到的，
    //   浅色部位只有在与边界同色**且连通**时才会进 mask；正常立绘有描边隔断，
    //   实测兔耳、熊猫白耳、企鹅白肚、狐狸白尾尖全部保留。
    if (mask[idx]) { d[idx * 4 + 3] = 0; continue; }
    const m = soft[idx];
    if (m <= 0.02) continue;
    d[idx * 4 + 3] = Math.round(d[idx * 4 + 3] * (1 - Math.min(1, m)));
  }
  // 去污染：把半透明像素里混进去的背景色反解掉（否则深色背景上是一圈白边）
  const out = decontaminate ? decontaminateEdges(d, w, h, mask, { block: decontaminateBlock }) : d;
  return { data: out, width: w, height: h, mask };
}

/**
 * 掩膜外扩（膨胀）radius 圈。
 * 用途见 decontaminateEdges 的说明：把羽化带推进主体内侧，
 * 避免"背景色渗色"留在可见边缘上。
 */
export function dilateMask(mask, w, h, radius = 1) {
  let cur = mask;
  for (let k = 0; k < radius; k++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1])
          || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * 按块估计背景色（能跟上渐变/光照不均，而不是全图一个平均值）。
 *
 * 为什么不能只用一个全局背景色：AI 生成的"浅灰背景"实测左上角 (224,222,222)、
 * 右上角 (227,223,224) —— 有噪点还有渐变。用全局均值去污染，边缘会偏色。
 * 按 64px 分块统计真实背景像素的均值，无效块向邻块借色，就能逐点给出准确的 B。
 *
 * @param mask 背景掩膜（1 = 背景）
 * @returns { grid, gw, gh, block }
 */
export function estimateBackgroundGrid(data, mask, w, h, block = 64) {
  const gw = Math.ceil(w / block), gh = Math.ceil(h / block);
  const sum = new Float64Array(gw * gh * 3), cnt = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      const g = ((y / block) | 0) * gw + ((x / block) | 0);
      const i = idx * 4;
      sum[g * 3] += data[i]; sum[g * 3 + 1] += data[i + 1]; sum[g * 3 + 2] += data[i + 2];
      cnt[g]++;
    }
  }
  const grid = new Float32Array(gw * gh * 3);
  const valid = new Uint8Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) {
    if (cnt[g] > 4) {
      grid[g * 3] = sum[g * 3] / cnt[g];
      grid[g * 3 + 1] = sum[g * 3 + 1] / cnt[g];
      grid[g * 3 + 2] = sum[g * 3 + 2] / cnt[g];
      valid[g] = 1;
    }
  }
  // 无效块（整块都在主体上）向四邻借色，迭代到收敛
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (valid[g]) continue;
        let r = 0, gg = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const q = ny * gw + nx;
          if (!valid[q]) continue;
          r += grid[q * 3]; gg += grid[q * 3 + 1]; b += grid[q * 3 + 2]; n++;
        }
        if (n) { grid[g * 3] = r / n; grid[g * 3 + 1] = gg / n; grid[g * 3 + 2] = b / n; valid[g] = 1; changed++; }
      }
    }
    if (!changed) break;
  }
  return { grid, gw, gh, block };
}

/**
 * 背景色去污染（decontamination）：反解半透明像素里混进去的背景色。
 *
 * ★ 为什么必须做（实测踩到）：
 *   抠图后的边缘像素 = a * 前景 + (1-a) * 背景。AI 画的浅灰背景 (224,222,222)
 *   混在边缘上，放到深色壁纸/深色网页上就变成一圈**明显的白边**，
 *   放大 3 倍一眼可见（兔耳、熊猫白耳、企鹅白肚最明显）。
 *   单纯"把半透明清零"会把浅色部位一起吃掉（第一版就踩了这个坑：
 *   兔子的白尾巴、熊猫的白耳朵、狐狸的白尾尖全没了）。
 *   正确做法是**解方程**：F = (C - (1-a) * B) / a —— 保留 alpha 的柔和过渡，
 *   同时把混进来的背景色减掉。
 *
 * @param data 已经抠好的 RGBA
 * @param mask 背景掩膜（1 = 背景），用来采样真实背景色
 */
export function decontaminateEdges(data, w, h, mask, { block = 64 } = {}) {
  const d = cloneData(data);
  const g = estimateBackgroundGrid(data, mask, w, h, block);
  for (let idx = 0; idx < w * h; idx++) {
    const a = d[idx * 4 + 3] / 255;
    if (a <= 0.01) { d[idx * 4 + 3] = 0; continue; }
    if (a >= 0.995) continue;
    const x = idx % w, y = (idx / w) | 0;
    const gi = (((y / g.block) | 0) * g.gw + ((x / g.block) | 0)) * 3;
    for (let k = 0; k < 3; k++) {
      const B = g.grid[gi + k];
      const F = (d[idx * 4 + k] - (1 - a) * B) / a;
      d[idx * 4 + k] = F < 0 ? 0 : F > 255 ? 255 : Math.round(F);
    }
  }
  return d;
}
/**
 * 自动挑抠图容差：在"背景去干净"和"浅色部位不被吃掉"之间取平衡。
 *
 * ★ 为什么必须自动挑（实测踩到的大坑）：
 *   AI 生成的浅灰背景 (224,222,222) 和角色身上的**白毛/白肚**颜色非常接近：
 *   白毛实测 (250,245,230)，与背景的最大通道差只有 26。
 *   而容差写死 38（历史默认值）时，漫水会顺着白毛一路吃进去 ——
 *   实测金毛犬的主体存活率从 99.4% 掉到 65.6%（整只狗的白毛全没了），
 *   兔子 99.5%→73.6%、熊猫 97.3%→83.0%。
 *   反过来容差太小，背景又抠不干净（边缘留一圈灰）。
 *
 *   实测各容差下的主体存活率（相对 tol=8 的保守基准）：
 *     tol  狗     兔     熊猫   狐狸   其他
 *     14   99.4%  99.5%  97.3%  99.4%  99%+
 *     20   98.7%  98.8%  96.8%  99.0%  98%+
 *     26   77.6%  76.5%  88.5%  96.6%  97%+   ← 白毛从这里开始崩
 *     38   65.6%  73.6%  83.0%  95.2%  96%+
 *
 *   判据选「主体存活率」而不是「背景残留率」，因为实测**背景残留率在所有容差下
 *   都是 0.00%**（背景是连通的，容差一大就整片消失），根本区分不出好坏；
 *   真正会出问题的是容差大到把浅色主体也一起吃进去。
 *
 * @param data RGBA
 * @param candidates 候选容差（从小到大）
 * @param minSurvival 允许的主体存活率下限（0.985 = 最多损失 1.5% 边缘像素）
 * @returns { tol, survival, baseline, tried }
 */
export function pickCutTolerance(data, w, h, {
  candidates = [10, 14, 18, 22, 26, 30, 34, 38],
  minSurvival = 0.985,
  alphaThreshold = 128,
  bgColors,
} = {}) {
  const list = (candidates || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return { tol: 38, survival: 1, baseline: 0, tried: [] };

  // 基准：最小容差下的主体（只删掉几乎完全等于背景的像素）—— 视为"完整主体"
  const base = floodCut(data, w, h, { tol: list[0], feather: 0, bgColors, decontaminate: false }).data;
  const N = w * h;
  let baseCount = 0;
  for (let i = 0; i < N; i++) if (base[i * 4 + 3] > alphaThreshold) baseCount++;
  if (!baseCount) return { tol: list[0], survival: 1, baseline: 0, tried: [] };

  const tried = [];
  let best = list[0], bestSurvival = 1;
  for (const tol of list) {
    const out = floodCut(data, w, h, { tol, feather: 0, bgColors, decontaminate: false }).data;
    let alive = 0;
    for (let i = 0; i < N; i++) {
      if (base[i * 4 + 3] > alphaThreshold && out[i * 4 + 3] > alphaThreshold) alive++;
    }
    const survival = alive / baseCount;
    tried.push({ tol, survival });
    if (survival >= minSurvival) { best = tol; bestSurvival = survival; }
  }
  return { tol: best, survival: bestSurvival, baseline: baseCount, tried };
}
/** 颜色阈值抠图：全局按背景色删除 */
export function colorKeyCut(data, w, h, { tol = 38, feather = 18, bgColors } = {}) {
  const d = cloneData(data);
  const colors = bgColors && bgColors.length ? bgColors : estimateBackgroundColors(data, w, h);
  const t0 = tol, t1 = tol + Math.max(1, feather);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const dist = minColorDist(d, i, colors);
    if (dist <= t0) d[i + 3] = 0;
    else if (dist < t1) d[i + 3] = Math.round(d[i + 3] * ((dist - t0) / (t1 - t0)));
  }
  return { data: d, width: w, height: h };
}

/** 只保留最大连通主体，清除零散残留 */
export function keepLargestComponent(data, w, h, { alphaThreshold = 16 } = {}) {
  const d = cloneData(data);
  const seen = new Uint8Array(w * h);
  let best = null;
  const neighbors = (idx) => {
    const x = idx % w, y = (idx / w) | 0;
    const out = [];
    if (x > 0) out.push(idx - 1);
    if (x < w - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - w);
    if (y < h - 1) out.push(idx + w);
    return out;
  };
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    if (d[start * 4 + 3] <= alphaThreshold) { seen[start] = 1; continue; }
    const comp = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop();
      comp.push(idx);
      for (const n of neighbors(idx)) {
        if (!seen[n] && d[n * 4 + 3] > alphaThreshold) { seen[n] = 1; stack.push(n); }
      }
    }
    if (!best || comp.length > best.length) best = comp;
  }
  if (!best) return { data: d, width: w, height: h };
  const keep = new Uint8Array(w * h);
  for (const idx of best) keep[idx] = 1;
  for (let idx = 0; idx < w * h; idx++) if (!keep[idx]) d[idx * 4 + 3] = 0;
  return { data: d, width: w, height: h };
}

/** 计算不含透明像素的最小包围盒 */
export function trimBounds(data, w, h, { pad = 2, alphaThreshold = 8 } = {}) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function cropData(data, w, h, box) {
  const { x, y, w: cw, h: ch } = box;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const s = ((row + y) * w + x) * 4;
    out.set(data.subarray(s, s + cw * 4), row * cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

export function flipHorizontal(data, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const t = (y * w + (w - 1 - x)) * 4;
      out[t] = data[s]; out[t + 1] = data[s + 1]; out[t + 2] = data[s + 2]; out[t + 3] = data[s + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/** 统计非透明像素占比，用于质量提示 */
export function opaqueRatio(data, alphaThreshold = 16) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > alphaThreshold) n++;
  return n / (data.length / 4);
}

/** 边框残留检测：统计四边一圈的不透明像素比例 */
export function borderResidue(data, w, h, alphaThreshold = 16) {
  let n = 0, total = 0;
  const check = (x, y) => { total++; if (data[(y * w + x) * 4 + 3] > alphaThreshold) n++; };
  for (let x = 0; x < w; x++) { check(x, 0); check(x, h - 1); }
  for (let y = 0; y < h; y++) { check(0, y); check(w - 1, y); }
  return total ? n / total : 0;
}

/** 把 src 位图贴到 dst 的 (dx,dy)（不裁剪越界外，越界自动忽略） */
function blitRGBA(dst, dw, dh, src, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dw) continue;
      const si = (y * sw + x) * 4, ti = (ty * dw + tx) * 4;
      dst[ti] = src[si]; dst[ti + 1] = src[si + 1]; dst[ti + 2] = src[si + 2]; dst[ti + 3] = src[si + 3];
    }
  }
}

/** 非透明像素的质心（相对整图坐标） */
export function centroidOf(data, w, h, alphaThreshold = 16) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : { x: w / 2, y: h / 2, n: 0 };
}

/**
 * 多帧对齐：消除各帧主体位置差异导致的播放抖动
 * mode:
 *   'bottom'  —— 以非透明区域的「底部中心」对齐（适合站立的宠物，脚底固定）
 *   'center'  —— 以非透明区域的「中心」对齐（适合漂浮/飞行的主体）
 *   'centroid'—— 以像素质心对齐（对不对称肢体更稳）
 * 返回统一尺寸的帧数组
 */
export function alignFrames(frames, { mode = 'bottom', alphaThreshold = 16 } = {}) {
  const list = (frames || []).filter(Boolean);
  if (!list.length) return { frames: [], canvas: { width: 0, height: 0 }, mode };

  const infos = list.map((f) => ({
    ...f,
    bbox: trimBounds(f.data, f.width, f.height, { pad: 0, alphaThreshold }),
  }));

  const cw = Math.max(...infos.map((i) => i.bbox.w));
  const ch = Math.max(...infos.map((i) => i.bbox.h));

  const out = infos.map((i) => {
    const cropped = cropData(i.data, i.width, i.height, i.bbox);
    const dst = new Uint8ClampedArray(cw * ch * 4);

    let ax, ay;  // 锚点在裁剪帧内的坐标
    if (mode === 'center') {
      ax = i.bbox.w / 2; ay = i.bbox.h / 2;
    } else if (mode === 'centroid' && i.bbox.w > 0) {
      const c = centroidOf(cropped.data, i.bbox.w, i.bbox.h, alphaThreshold);
      ax = c.x; ay = c.y;
    } else {
      ax = i.bbox.w / 2; ay = i.bbox.h;   // bottom
    }

    const tx = mode === 'bottom' ? cw / 2 : cw / 2;
    const ty = mode === 'bottom' ? ch : ch / 2;

    const dx = Math.round(tx - ax);
    const dy = Math.round(ty - ay);
    blitRGBA(dst, cw, ch, cropped.data, i.bbox.w, i.bbox.h, dx, dy);

    return { data: dst, width: cw, height: ch, name: i.name, durationMs: i.durationMs };
  });

  return { frames: out, canvas: { width: cw, height: ch }, mode };
}

/**
 * 判断一张图是否是「带纯色/渐变背景的照片」（可自动抠图）。
 *
 * 背景：之前只看「边缘采样相对首像素的平均色差」，阈值 36。
 * 实测该判据会把**浅色渐变**（墙面、天空、桌面 —— 普通用户最常拍的）误判为
 * "复杂背景"而跳过自动抠图，但这类图 floodCut 明明能处理好（实测透明率 67%）。
 *
 * 新判据：不看绝对色差，而看**相邻采样的颜色是否连续变化**。
 * - 纯色背景：相邻差 ≈ 0
 * - 渐变背景：相邻差很小且平滑（连续）
 * - 真实复杂背景（桌面杂物、人像场景）：相邻差大且跳变
 *
 * @returns {{ok:boolean, reason:string, stats:object}}
 */
export function looksLikeFlatBackground(data, w, h, { maxAdjacent = 14, maxSpan = 120, maxStep = 60 } = {}) {
  if (!data || !w || !h) return { ok: false, reason: 'no-data', stats: {} };

  // 沿四条边采样。关键：必须**按边分别采样**再各自算相邻差 ——
  // 否则「上边末 -> 下边首」这种跨边相接会把主体像素算进去，导致浅色渐变被误判为杂乱
  // （实测跨边拼接会让浅色渐变的 adjAvg 从 <10 飙到 40.7）。
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  const edges = [[], [], [], []];   // 上 / 下 / 左 / 右
  const read = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 40) return null;        // 透明像素不算背景色样本
    return [data[i], data[i + 1], data[i + 2]];
  };
  for (let x = 0; x < w; x += step) { const c = read(x, 0); if (c) edges[0].push(c); }
  for (let x = 0; x < w; x += step) { const c = read(x, h - 1); if (c) edges[1].push(c); }
  for (let y = 0; y < h; y += step) { const c = read(0, y); if (c) edges[2].push(c); }
  for (let y = 0; y < h; y += step) { const c = read(w - 1, y); if (c) edges[3].push(c); }

  const pts = edges.flat();
  if (pts.length < 8) return { ok: false, reason: 'too-few-samples', stats: { n: pts.length } };

  // 相邻差：只在同一条边内比较，衡量「颜色是否连续变化」
  let adjSum = 0, adjMax = 0, adjCnt = 0;
  for (const line of edges) {
    for (let i = 1; i < line.length; i++) {
      const d = Math.abs(line[i][0] - line[i-1][0]) + Math.abs(line[i][1] - line[i-1][1]) + Math.abs(line[i][2] - line[i-1][2]);
      adjSum += d; adjCnt++;
      if (d > adjMax) adjMax = d;
    }
  }
  const adjAvg = adjCnt ? adjSum / adjCnt : 0;

  // 总跨度：整体颜色范围（纯色小、渐变中、杂乱大）
  let minL = 255, maxL = 0;
  for (const p of pts) {
    const l = (p[0] + p[1] + p[2]) / 3;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  const span = maxL - minL;

  // 连续（相邻小）且总跨度不过分 -> 视为可抠的平坦/渐变背景。
  // 必须同时约束**平均值与最大值**：只看平均值时，少数强跳变会被大量平滑采样稀释
  // （实测"上下硬分界"用例 adjAvg 仅 2.5 却通过了，但局部跳变达 198）。
  const ok = adjAvg <= maxAdjacent && adjMax <= maxStep && span <= maxSpan;
  const reason = !ok
    ? (adjMax > maxStep ? 'hard-edge' : adjAvg > maxAdjacent ? 'busy-edges' : 'too-wide-span')
    : 'flat-or-gradient';
  return { ok, reason, stats: { n: pts.length, adjAvg: Math.round(adjAvg * 10) / 10, adjMax: Math.round(adjMax), span: Math.round(span) } };
}

/**
 * 抠图质量评估（给「上传后一眼看出扣得干不干净」用）。
 *
 * 为什么需要：透明背景在制作器里显示为棋盘格，残留的浅色光晕/半透明边缘
 * 在深色 UI 上并不明显 —— 用户很难判断扣干净了没有，往往到桌面上才发现。
 *
 * 这里不猜「好不好看」，只给出三个可测量的事实：
 * - coverage   主体占比（太小说明主体被扣掉了 / 太大说明背景没扣）
 * - edgeHalo   主体外圈「半透明」像素比例（抠图不干净最典型的信号）
 * - empty      几乎全透明（主体被扣没了）
 *
 * @param data RGBA
 * @param w,h  尺寸
 * @returns {{coverage:number, edgeHalo:number, empty:boolean, verdict:string}}
 *   verdict 取值：'ok' | 'no-cut' | 'halo' | 'empty' | 'unknown'
 */
export function assessCut(data, w, h, { alphaThreshold = 16 } = {}) {
  if (!data || !w || !h) return { coverage: 0, halo: 0, empty: false, verdict: 'unknown' };
  const total = w * h;

  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > alphaThreshold) opaque++;
  const coverage = opaque / total;
  const empty = coverage < 0.005;

  // 边缘残留（halo）用「外层亮度 vs 内层亮度」衡量。
  //
  // 为什么不看透明度：实测默认 feather=14 的正常羽化带就有 ~10.6% 半透明像素
  // （alpha 从 32 平滑升到 255），那是正确行为，用透明度会误报。
  //
  // 为什么用亮度差：把不透明像素按「距主体质心的距离」分成内外两层，
  // 残留（背景色混在边缘，通常偏亮/偏灰）会显著抬高外层亮度。
  // 实测：干净抠图 外层-内层 = 0.0；带 7px 光晕 = +35.0 —— 信号明确且稳定。
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] > alphaThreshold) { sx += x; sy += y; n++; }
  }
  let halo = 0;
  if (n > 0) {
    const cx = sx / n, cy = sy / n;
    // 亮度比较只用「较实心」像素：羽化带（半透明）天然偏亮，
    // 把它算进来会让正常抠图误报（实测 alphaMin=16 时正常图 diff=42.7，alphaMin=128 时为 0.0）。
    const SOLID = 128;
    // 以「不透明像素到质心的最大距离」为基准，外层取外侧 25% 的壳
    let maxD = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= SOLID) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > maxD) maxD = d;
    }
    let outerSum = 0, outerN = 0, innerSum = 0, innerN = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= SOLID) continue;
      const d = Math.hypot(x - cx, y - cy);
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (d >= maxD * 0.75) { outerSum += lum; outerN++; }
      else if (d <= maxD * 0.5) { innerSum += lum; innerN++; }
    }
    if (outerN > 0 && innerN > 0) {
      const diff = (outerSum / outerN) - (innerSum / innerN);
      halo = diff > 0 ? diff / 255 : 0;          // 归一化到 0..1
    }
  }

  let verdict = 'ok';
  if (empty) verdict = 'empty';
  else if (coverage > 0.97) verdict = 'no-cut';
  else if (halo > 0.09) verdict = 'halo';        // 外层明显更亮 = 有亮边残留
  return {
    coverage: Math.round(coverage * 1000) / 1000,
    halo: Math.round(halo * 1000) / 1000,
    empty,
    verdict,
  };
}

export function cutAdvice(a) {
  if (!a || a.verdict === 'unknown') return { level: 'info', text: '' };
  switch (a.verdict) {
    case 'empty':
      return { level: 'warn', text: '主体几乎被扣没了，把「抠图」强度调小试试' };
    case 'no-cut':
      return { level: 'warn', text: '背景好像还在，把「抠图」强度调大试试' };
    case 'halo':
      return { level: 'warn', text: '边缘还有残留（发灰/半透明），把「抠图」强度稍微调大' };
    default:
      return { level: 'ok', text: '背景已扣干净' };
  }
}
