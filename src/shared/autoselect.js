// AI 抠图「自动选模型」的质量评估（纯逻辑，可单测，不依赖 Electron / ONNX）
//
// 背景与设计取舍（用户选定）：
//   - 用户要「全部跑一遍，选最好的」（方案 C），精确率优先，接受更慢。
//   - 所以这里不做「先跑快的、不够好再升级」的启发式，而是**对每个候选模型的结果
//     打一个客观分数**，谁高选谁。这样判据是统一的，不依赖「先跑哪个」的偶然性。
//   - 阈值滑块（threshold）当作**下限**：自动模式只在结果确实更好时才采纳，
//     且不会偷偷改用户的滑块值。
//
// 判据全部来自掩膜（0..1 浮点）与最终 alpha，不引入任何模型内部的不可靠量：
//   1) 覆盖率：太低 = 主体被抠没了；太高 = 背景没抠掉。
//   2) 贴边：主体明显顶到画布边缘 = 抠漏/裁切（真实主体通常留有余量）。
//   3) 碎片：前景应该是「一整块」，不该是撒胡椒面（连通块数量/碎块占比）。
//   4) 边缘锐度：掩膜在过渡带的陡峭程度，糊成一团说明模型没找准边界。
// 最后把这几项加权成一个 0..1 的分数，越大越好。

/** 期望的覆盖率区间（按桌宠素材的常见构图：主体居中、四周有留白） */
export const COVERAGE_MIN = 0.04;
export const COVERAGE_MAX = 0.92;

/** 覆盖率最舒服的区间中点（用于给分，不参与硬性淘汰） */
export const COVERAGE_IDEAL = 0.35;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * 把掩膜二值化并做 4 邻域连通块分析。
 * 用迭代式栈而不是递归，避免大图上爆栈（1600×1600 递归必崩）。
 */
export function analyzeMask(mask, w, h, threshold = 0.5) {
  const n = w * h;
  const bin = new Uint8Array(n);
  let fg = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] >= threshold) { bin[i] = 1; fg++; }
  }
  const coverage = n ? fg / n : 0;

  // ---- 连通块 ----
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);          // 预分配，避免频繁扩容
  let components = 0;
  let largest = 0;
  for (let start = 0; start < n; start++) {
    if (!bin[start] || seen[start]) continue;
    components++;
    let sp = 0, count = 0;
    stack[sp++] = start; seen[start] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      count++;
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0) { const k = idx - 1; if (bin[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; } }
      if (x < w - 1) { const k = idx + 1; if (bin[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; } }
      if (y > 0) { const k = idx - w; if (bin[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; } }
      if (y < h - 1) { const k = idx + w; if (bin[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; } }
    }
    if (count > largest) largest = count;
  }
  // 最大块占前景比例：1 = 干干净净一整块，趋近 0 = 全是碎屑
  const largestRatio = fg ? largest / fg : 0;

  // ---- 贴边：前景顶到四条边的程度 ----
  // 只统计「真的贴边」的像素，用 2% 边带，避免把正常留白算进去
  const bandX = Math.max(1, Math.round(w * 0.02));
  const bandY = Math.max(1, Math.round(h * 0.02));
  let edgeFg = 0, edgeTotal = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const near = x < bandX || x >= w - bandX || y < bandY || y >= h - bandY;
      if (!near) continue;
      edgeTotal++;
      if (bin[y * w + x]) edgeFg++;
    }
  }
  const edgeRatio = edgeTotal ? edgeFg / edgeTotal : 0;

  // ---- 边缘锐度：过渡带占前景的比例 ----
  // 过渡像素 = mask 在 (0.15, 0.85) 之间的像素。占比过高说明边界糊。
  let soft = 0;
  for (let i = 0; i < n; i++) {
    const v = mask[i];
    if (v > 0.15 && v < 0.85) soft++;
  }
  const softRatio = fg ? soft / Math.max(1, fg) : 1;

  // ---- 包围盒占比（主体是否被莫名裁掉）----
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const empty = fg === 0;
  const bbox = empty ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  return { coverage, components, largestRatio, edgeRatio, softRatio, bbox, empty };
}

/**
 * 给一个模型的结果打分（0..1，越大越好）。
 * 各项权重是「对桌宠素材而言什么最要命」的排序：
 *   - 抠没了 / 抠漏了（覆盖率 + 贴边）权重最高
 *   - 碎屑（最大块占比）次之，因为碎屑会直接显示在桌面上
 *   - 边缘糊（锐度）再次之，羽化本身是可接受的
 */
export function scoreMask(mask, w, h, threshold = 0.5) {
  const a = analyzeMask(mask, w, h, threshold);
  if (a.empty) return { ...a, score: 0, reasons: ['掩膜为空：主体被完全抠掉'] };

  const reasons = [];

  // 1) 覆盖率分（越靠近理想区间中点越高）
  let covScore;
  if (a.coverage < COVERAGE_MIN) { covScore = 0; reasons.push('主体过小，可能被抠没了'); }
  else if (a.coverage > COVERAGE_MAX) { covScore = 0.05; reasons.push('覆盖率过高，背景可能没抠掉'); }
  else {
    const d = Math.abs(a.coverage - COVERAGE_IDEAL) / Math.max(COVERAGE_IDEAL, 1 - COVERAGE_IDEAL);
    covScore = clamp01(1 - d * 0.7);
  }

  // 2) 贴边分：贴边越多越可疑
  const edgeScore = clamp01(1 - a.edgeRatio * 4);
  if (a.edgeRatio > 0.25) reasons.push('主体顶到画布边缘，可能抠漏');

  // 3) 碎屑分：最大连通块占比越高越好
  const fragScore = clamp01((a.largestRatio - 0.2) / 0.8);
  if (a.components > 1 && a.largestRatio < 0.75) reasons.push('前景碎片较多（' + a.components + ' 块）');

  // 4) 锐度分：过渡带占比越低越干净
  const sharpScore = clamp01(1 - a.softRatio);

  const score = covScore * 0.34 + edgeScore * 0.26 + fragScore * 0.24 + sharpScore * 0.16;
  return { ...a, score: clamp01(score), reasons };
}

/**
 * 从多个候选里选最好的一个。
 * @param {Array<{id:string, mask:Float32Array, w:number, h:number}>} candidates
 * @returns {{ best: object|null, ranked: Array }}
 * ranked 已按分数从高到低排序，方便界面展示「为什么选它」。
 */
export function pickBest(candidates, threshold = 0.5) {
  const ranked = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !c.mask || !c.w || !c.h) continue;
    const s = scoreMask(c.mask, c.w, c.h, threshold);
    ranked.push({ id: c.id, score: s.score, reasons: s.reasons, coverage: s.coverage, components: s.components, largestRatio: s.largestRatio, edgeRatio: s.edgeRatio, softRatio: s.softRatio });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { best: ranked[0] || null, ranked };
}

/** 分数差小于这个值就认为「几乎一样好」，用于避免无意义的模型切换 */
export const TIE_EPSILON = 0.02;

/**
 * 自动选择的最终决定。
 * @param ranked  pickBest().ranked
 * @param hintId  用户在界面上手选的模型（可选）：平手时优先它，减少「结果在跳」的困惑
 * @returns {{ id, reason, improved }}
 */
export function decideChoice(ranked, hintId = null) {
  if (!Array.isArray(ranked) || !ranked.length) return { id: null, reason: '没有可用结果', improved: false };
  const top = ranked[0];
  // 平手时优先用户手选的那个（如果有且分数在 tie 范围内）
  const hint = hintId ? ranked.find((r) => r.id === hintId) : null;
  if (hint && top.score - hint.score <= TIE_EPSILON) {
    return { id: hint.id, reason: '多个模型几乎一样好，按你的选择用了「' + hint.id + '」', improved: hint.id !== top.id ? false : true };
  }
  const better = ranked.slice(1).some((r) => top.score - r.score > TIE_EPSILON);
  return {
    id: top.id,
    reason: better ? '在 ' + ranked.length + ' 个模型里表现最好' : '各模型结果接近，取了分数最高的一个',
    improved: true,
  };
}
