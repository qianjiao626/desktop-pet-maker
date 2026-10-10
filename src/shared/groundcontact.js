// 落点对齐（纯逻辑，可单测）：让宠物的**脚底**真正踩在地面线上。
//
// 问题（实测存在）：
//   宠物帧是「整张图底对齐」画的。但素材四周常有透明留白 ——
//   例如人物只占图片下半部分，上部大片透明。整图底对齐后，
//   人物脚底距图片底边还有 `(1-content.y1) * drawH` 像素，
//   于是宠物看起来**浮在地面上方**（脚不沾地）。
//
// 修法：把绘制位置往下挪 `(1 - content.y1) * drawH`，
//   让"真实不透明底边"（脚底）落在同一根地面线上。
//
// 为什么用 content.y1 而不是重新识别：
//   pet.js 的 buildAlphaMaps 已经算出了每帧真实不透明边界
//   （content = {x0,y0,x1,y1}），直接复用即可，零额外开销。
//   用骨骼关键点也行，但那是"制作器"阶段才有信息；
//   运行时收到的宠物包可能来自任何人，不能假设有姿态数据。

/**
 * 计算一帧的垂直微调量（像素，正数 = 往下挪）。
 * @param {object} content  { y0, y1 } 真实不透明边界（归一化 0..1）
 * @param {number} drawH    该帧实际绘制高度（像素）
 * @returns {{dy:number, reason:string}}
 */
export function groundOffset(content, drawH) {
  if (!content || !(drawH > 0)) return { dy: 0, reason: '缺少内容边界信息' };
  const y1 = typeof content.y1 === 'number' && Number.isFinite(content.y1) ? content.y1 : 1;
  // y1 越小说明底部留白越多，需要往下挪得越多
  const bottomPad = Math.max(0, Math.min(1, 1 - y1));
  if (bottomPad <= 1e-4) return { dy: 0, reason: '脚底已贴边，无需调整' };
  return {
    dy: bottomPad * drawH,
    reason: '底部有 ' + (bottomPad * 100).toFixed(1) + '% 透明留白，往下挪 ' + (bottomPad * drawH).toFixed(1) + 'px 让脚沾地',
  };
}

/**
 * 取多帧的公共微调量。
 *
 * 为什么必须取公共值（而不是逐帧各自算）：
 *   逐帧各算会让"留白多的帧"往下挪得多、"留白少的帧"往上，
 *   播放时宠物会**上下抽搐**。统一取所有帧里需要下移最多的那个，
 *   保证整段动画相对稳定。（这个坑在"统一画布"那里踩过一次，同类问题。）
 *
 * @param {Array<{content:object}>} alphaMaps
 * @param {Array<number>} drawHeights 每帧绘制高度
 * @returns {{dy:number, perFrame:Array<number>, reason:string}}
 */
export function commonGroundOffset(alphaMaps, drawHeights) {
  const maps = Array.isArray(alphaMaps) ? alphaMaps : [];
  const heights = Array.isArray(drawHeights) ? drawHeights : [];
  if (!maps.length) return { dy: 0, perFrame: [], reason: '没有帧' };
  const perFrame = maps.map((m, i) => groundOffset(m && m.content, heights[i]).dy);
  const dy = perFrame.reduce((a, b) => Math.max(a, b), 0);
  const worst = perFrame.indexOf(dy);
  return {
    dy,
    perFrame,
    reason: dy > 0
      ? '按第 ' + (worst + 1) + ' 帧的留白统一下移 ' + dy.toFixed(1) + 'px（取公共值，避免逐帧抽搐）'
      : '所有帧都已贴边',
  };
}

/**
 * 「脚底贴地」后，宠物窗口/画布的底部是否还够放。
 * 若不够，需要把这部分高度补进画布，否则宠物会被裁掉一截。
 * @param {number} dy   需要下移的量
 * @param {number} margin 画布底部原本预留的边距
 */
export function neededBottomRoom(dy, margin) {
  const m = Number.isFinite(margin) ? margin : 0;
  const need = Math.max(0, dy - m);
  return { extra: need, ok: need <= 1e-6 };
}
