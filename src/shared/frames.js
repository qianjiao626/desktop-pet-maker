// 帧序列操作（纯逻辑，可单测）。
//
// 背景：制作器此前只能「添加帧（按文件名追加）」或「清空」——
// 没有删除单帧、复制帧、拖动排序。做多帧动画时这是硬伤：
//   少导一张、顺序错了、想在某帧后插一帧，都只能全部重来。
// 这些操作看起来只是数组操作，但有若干容易写错的边界（见每条注释），
// 所以抽成纯函数并配单测。

/**
 * 删除指定帧。
 * 边界：删完后 activeIdx 必须落在合法范围内（否则预览取到 undefined 白屏）。
 * @returns {{frames, activeIdx}}
 */
export function removeFrame(frames, activeIdx, index) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  if (!list.length) return { frames: list, activeIdx: 0 };
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0)));
  list.splice(i, 1);
  // 删掉的是当前帧或更前面的帧 -> 索引要往前挪，否则会"跳过一帧"
  let next = Math.floor(Number(activeIdx) || 0);
  if (i < next) next--;
  if (!list.length) next = 0;
  else next = Math.max(0, Math.min(list.length - 1, next));
  return { frames: list, activeIdx: next };
}

/**
 * 复制一帧并插到它后面（做"多停一帧"或"补一帧变体"时很有用）。
 * 边界：克隆的数据必须是**新数组**，否则改一帧会同时改另一帧。
 * @param clone (frame) => frame 深拷贝函数（由调用方提供，便于单测）
 */
export function duplicateFrame(frames, activeIdx, index, clone) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  if (!list.length) return { frames: list, activeIdx: 0 };
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0)));
  const copy = clone ? clone(list[i]) : list[i];
  list.splice(i + 1, 0, copy);
  // 复制后停在**新帧**上：用户立刻能看到并继续调整它
  return { frames: list, activeIdx: i + 1 };
}

/**
 * 移动一帧到新的位置（拖动排序 / 上移下移）。
 * 边界：目标下标要按"移除后"的数组算，否则向后移动会差一位（经典 off-by-one）。
 */
export function moveFrame(frames, activeIdx, from, to) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  if (list.length < 2) return { frames: list, activeIdx: Math.max(0, Math.floor(Number(activeIdx) || 0)) };
  const n = list.length;
  let f = Math.max(0, Math.min(n - 1, Math.floor(Number(from) || 0)));
  let t = Math.max(0, Math.min(n - 1, Math.floor(Number(to) || 0)));
  if (f === t) return { frames: list, activeIdx: Math.max(0, Math.min(n - 1, Math.floor(Number(activeIdx) || 0))) };
  const [item] = list.splice(f, 1);
  list.splice(t, 0, item);
  // 跟随移动的那一帧；其它帧的索引也要相应修正
  let next = Math.floor(Number(activeIdx) || 0);
  if (next === f) next = t;
  else {
    if (f < next) next--;
    if (t <= next) next++;
  }
  next = Math.max(0, Math.min(n - 1, next));
  return { frames: list, activeIdx: next };
}

/**
 * 交换相邻两帧（上移/下移按钮用）。
 * @param dir -1 = 往前移，+1 = 往后移
 */
export function shiftFrame(frames, activeIdx, index, dir) {
  const list = Array.isArray(frames) ? frames : [];
  const n = list.length;
  if (n < 2) return { frames: Array.isArray(frames) ? frames.slice() : [], activeIdx: 0 };
  const i = Math.max(0, Math.min(n - 1, Math.floor(Number(index) || 0)));
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= n) return { frames: list.slice(), activeIdx: Math.max(0, Math.min(n - 1, Math.floor(Number(activeIdx) || 0))) };
  return moveFrame(list, activeIdx, i, j);
}

/**
 * 生成「不重名的帧文件名」，避免多帧来自不同批次时重名覆盖。
 * 包内帧是按文件名寻址的，重名会导致后一帧覆盖前一帧（静默丢帧）。
 */
export function uniqueFrameName(existing, base = 'frame', ext = '.png') {
  const used = new Set((Array.isArray(existing) ? existing : []).map((f) => String((f && f.name) || '')));
  const stem = String(base || 'frame').replace(/\.[a-z0-9]+$/i, '');
  let i = 1;
  let name = stem + ext;
  while (used.has(name)) { i++; name = stem + '_' + i + ext; }
  return name;
}
