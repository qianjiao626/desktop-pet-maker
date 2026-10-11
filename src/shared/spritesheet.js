// Sprite Sheet 导出（纯逻辑，可单测）。
//
// 场景：开发者想把这个桌宠用在自己的游戏/网页里。
// GIF 不好接（要解帧），逐帧 PNG 也麻烦（要自己算坐标）。
// 标准做法是 **一张 sprite sheet（多帧拼成网格）+ 一份 JSON 元数据**
// （每帧的坐标、时长、画布尺寸），引擎直接读 JSON 就能播。
//
// 需要做对的几件事：
//   1) 网格要**尽量接近正方形**，否则细长条很难被引擎/GPU 纹理友好地采样。
//   2) 元数据里的坐标是**像素**，不是归一化 —— 引擎按像素切图，归一化还要自己乘。
//   3) 帧时长要原样带上（每帧可能不同，比如 GIF 的原始延迟）。
//   4) 超出引擎惯例的巨大 sheet 要给出警告（有很多引擎对纹理尺寸有上限）。

/** 常见的纹理上限（很多引擎/GPU 是 2048 或 4096） */
export const SAFE_TEXTURE_EDGE = 4096;

/**
 * 规划网格：给定帧数与单帧尺寸，算出列数/行数与整图尺寸。
 * 目标是**接近正方形**（宽高比接近 1），避免细长条。
 * @returns {{cols, rows, width, height, count, oversized}}
 */
export function planSheet(frameCount, cellW, cellH, opt = {}) {
  const n = Math.max(1, Math.floor(Number(frameCount) || 1));
  const w = Math.max(1, Math.round(Number(cellW) || 1));
  const h = Math.max(1, Math.round(Number(cellH) || 1));
  const maxEdge = Math.max(16, Math.round(Number(opt.maxEdge) || SAFE_TEXTURE_EDGE));

  // 目标：cols*cellW ≈ rows*cellH 且 cols*rows >= n
  // 解 cols = sqrt(n * cellH / cellW)，再夹到 [1, n]
  const ideal = Math.sqrt((n * h) / w);
  let cols = Math.max(1, Math.min(n, Math.round(ideal)));
  let rows = Math.ceil(n / cols);
  // 微调：有时 cols+1 会让整体更接近正方形（比如 n=5 时 2x3 比 3x2 视比例而定）
  const score = (c, r) => Math.abs(c * w - r * h);
  if (cols < n) {
    const c2 = cols + 1, r2 = Math.ceil(n / c2);
    if (score(c2, r2) < score(cols, rows)) { cols = c2; rows = r2; }
  }
  if (cols > 1) {
    const c2 = cols - 1, r2 = Math.ceil(n / c2);
    if (score(c2, r2) < score(cols, rows)) { cols = c2; rows = r2; }
  }
  const width = cols * w, height = rows * h;
  return { cols, rows, width, height, count: n, oversized: width > maxEdge || height > maxEdge };
}

/**
 * 生成帧矩形列表（像素坐标）。
 * 引擎按 row-major（从左到右、从上到下）读取，这里保持一致。
 */
export function sheetFrames(frameCount, cellW, cellH, cols, rows) {
  const n = Math.max(0, Math.floor(Number(frameCount) || 0));
  const w = Math.max(1, Math.round(Number(cellW) || 1));
  const h = Math.max(1, Math.round(Number(cellH) || 1));
  const c = Math.max(1, Math.floor(Number(cols) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % c;
    const row = Math.floor(i / c);
    out.push({ index: i, x: col * w, y: row * h, w, h });
  }
  void rows;
  return out;
}

/**
 * 生成 JSON 元数据（引擎直接读）。
 *
 * 格式说明写进注释字段，让接手的人不看文档也能懂：
 *   frames 是行优先排列，每项 {x,y,w,h,ms} 单位都是**像素/毫秒**。
 */
export function sheetMetadata(frames, opt = {}) {
  const list = Array.isArray(frames) ? frames : [];
  // opt 可能是 null（调用方传了 null），不能直接读属性（实测崩在这里）
  const o = (opt && typeof opt === 'object') ? opt : {};
  const durations = Array.isArray(o.durations) ? o.durations : [];
  return {
    format: 'desktop-pet-maker/sprite-sheet@1',
    name: String(o.name || 'pet'),
    image: String(o.image || 'sheet.png'),
    sheet: {
      width: Math.max(0, Math.round(Number(o.sheetWidth) || 0)),
      height: Math.max(0, Math.round(Number(o.sheetHeight) || 0)),
      cols: Math.max(1, Math.round(Number(o.cols) || 1)),
      rows: Math.max(1, Math.round(Number(o.rows) || 1)),
    },
    cell: {
      width: list.length ? list[0].w : 0,
      height: list.length ? list[0].h : 0,
    },
    // 行优先：从左到右、从上到下
    frames: list.map((f, i) => ({
      x: f.x, y: f.y, w: f.w, h: f.h,
      ms: Math.max(16, Math.round(Number(durations[i]) || 100)),
    })),
    totalMs: list.reduce((s, _, i) => s + Math.max(16, Math.round(Number(durations[i]) || 100)), 0),
    note: 'frames 为行优先排列；x/y/w/h 单位为像素，ms 为毫秒。',
  };
}

/**
 * 给用户看的摘要（导出前告诉他"会得到多大的图、多少帧"）。
 */
export function sheetSummary(plan, opt = {}) {
  if (!plan || !plan.count) return '没有可导出的帧';
  const parts = [plan.count + ' 帧拼成 ' + plan.cols + '×' + plan.rows + ' 网格'];
  parts.push('图片 ' + plan.width + '×' + plan.height);
  if (plan.oversized) parts.push('⚠ 超过 ' + (opt.maxEdge || SAFE_TEXTURE_EDGE) + 'px，部分引擎可能不支持');
  return parts.join('，');
}
