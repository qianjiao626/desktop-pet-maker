// 多显示器工作区选择（纯函数，可单测）
// 问题背景：宠物固定用主显示器工作区作物理边界时，被拖到副屏会被强行拉回主屏。
// 正确做法是按宠物当前所在位置，选择它实际所处显示器的工作区作为边界。

/** 矩形是否包含点 */
export function rectContains(r, x, y) {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** 点到一个矩形中心的距离平方 */
function centerDist2(r, x, y) {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  return (x - cx) ** 2 + (y - cy) ** 2;
}

/**
 * 依据窗口矩形，选出应当作为物理边界的工作区。
 * 判定顺序：包含窗口中心的显示器 -> 与窗口重叠面积最大的显示器 -> 中心最近 -> 第一个
 * @param bounds {x,y,width,height} 窗口位置尺寸
 * @param areas  [{x,y,width,height}] 各显示器工作区
 */
export function pickAreaForBounds(bounds, areas) {
  if (!Array.isArray(areas) || areas.length === 0) return null;
  if (areas.length === 1) return areas[0];

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  // 1) 中心落在哪个显示器内
  for (const a of areas) if (rectContains(a, cx, cy)) return a;

  // 2) 重叠面积最大
  let best = null, bestOverlap = 0;
  for (const a of areas) {
    const ox = Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x));
    const oy = Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y));
    const area = ox * oy;
    if (area > bestOverlap) { bestOverlap = area; best = a; }
  }
  if (best) return best;

  // 3) 中心最近
  let nearest = areas[0], nd = Infinity;
  for (const a of areas) {
    const d = centerDist2(a, cx, cy);
    if (d < nd) { nd = d; nearest = a; }
  }
  return nearest;
}

/** 工作区是否发生变化（用于判断是否需要重置边界） */
export function areaChanged(a, b) {
  if (!a || !b) return true;
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}