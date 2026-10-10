// 撤销 / 重做（纯逻辑，可单测）。
//
// 为什么需要：制作器里每个操作都是**破坏性**的 —— 抠图、裁边、水平翻转、
// 从静态图生成动画、按身体适配…全都会直接覆盖 state.frames。
// 用户点错一次就得从头拖图。这是"制作性/可操作性"上最卡人的一处。
//
// 设计取舍：
//   - 用**快照栈**而不是"逆操作"。逆操作要为每个功能写一遍反向逻辑，
//     而且裁剪/生成这类操作根本不可逆（丢掉的信息找不回来）。
//     快照简单、可靠、对任何未来新增的操作都自动生效。
//   - 只存"帧数据 + 关键界面参数"，不存整个 DOM 状态（那样太大且易错）。
//   - 深度上限 + 大图保护：帧是 ImageData，一张 1600x1600 约 10MB，
//     必须限制层数，否则内存会涨得很凶。
//
// 本模块只管栈的规则，不碰 ImageData 的内容（便于单测）。

/**
 * @param {object} opt
 *   limit: 最多保留多少层（含当前状态）
 *   maxBytes: 估算总字节上限（超过就丢最旧的）
 *   estimate: (snapshot) => number 估算单个快照的字节数
 */
export function createHistory(opt = {}) {
  const limit = Math.max(2, Math.floor(opt.limit || 20));
  const maxBytes = Math.max(0, Number(opt.maxBytes) || 0);
  const estimate = typeof opt.estimate === 'function' ? opt.estimate : () => 0;
  let stack = [];        // [0] 最旧 ... [len-1] 最新（当前）
  let index = -1;        // 指向当前状态
  let bytes = [];
  let total = 0;

  function trim() {
    // 从最旧的一端丢弃，直到满足层数与字节两个上限
    while (stack.length > limit && stack.length > 1) {
      const b = bytes.shift();
      stack.shift();
      total -= b;
      index--;
    }
    while (maxBytes > 0 && total > maxBytes && stack.length > 1) {
      const b = bytes.shift();
      stack.shift();
      total -= b;
      index--;
    }
    if (index < 0) index = 0;
  }

  return {
    /** 推入一个新状态（会丢弃"当前"之后的 redo 分支） */
    push(snapshot) {
      stack = stack.slice(0, index + 1);
      bytes = bytes.slice(0, index + 1);
      total = bytes.reduce((s, b) => s + b, 0);
      stack.push(snapshot);
      const b = Math.max(0, estimate(snapshot));
      bytes.push(b);
      total += b;
      index = stack.length - 1;
      trim();
      return index;
    },
    /** 能否撤销 / 重做 */
    canUndo() { return index > 0; },
    canRedo() { return index >= 0 && index < stack.length - 1; },
    /** 撤销：返回上一个状态（不改变栈） */
    undo() { if (!this.canUndo()) return null; index--; return stack[index]; },
    /** 重做：返回下一个状态 */
    redo() { if (!this.canRedo()) return null; index++; return stack[index]; },
    /** 当前状态 */
    current() { return index >= 0 ? stack[index] : null; },
    /** 状态数量与位置（用于界面与测试） */
    size() { return stack.length; },
    position() { return index; },
    byteSize() { return total; },
    /** 清空（换图/载入新包时用） */
    clear() { stack = []; bytes = []; index = -1; total = 0; },
  };
}

/**
 * 估算快照占用的字节数。
 * 只按帧的像素数据算（其余字段很小），用于内存保护。
 * @param {object} snap { frames: [{ data: Uint8ClampedArray }] }
 */
export function estimateSnapshotBytes(snap) {
  if (!snap || !Array.isArray(snap.frames)) return 0;
  let n = 0;
  for (const f of snap.frames) {
    const d = f && (f.data || f.current);
    n += d && d.length ? d.length : 0;
  }
  return n;
}
