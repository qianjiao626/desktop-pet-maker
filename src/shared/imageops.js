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
export function floodCut(data, w, h, { tol = 38, feather = 18, bgColors } = {}) {
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

  const soft = feather > 0 ? blurMask(Float32Array.from(mask), w, h, Math.max(1, Math.round(feather / 3))) : mask;
  for (let idx = 0; idx < w * h; idx++) {
    const m = soft[idx];
    if (m <= 0.02) continue;
    d[idx * 4 + 3] = Math.round(d[idx * 4 + 3] * (1 - Math.min(1, m)));
  }
  return { data: d, width: w, height: h };
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
