// 制作器的键盘快捷键：把「这次按键该做什么」抽成纯函数，可单测。
//
// 为什么值得抽：快捷键最容易出的两个问题是
//   ① 用户在输入框里打字，快捷键把字吃了（比如按空格变播放、按方向键切帧）；
//   ② 和浏览器/系统的组合键打架（Ctrl+方向键、Alt+方向键等）。
// 这些判断逻辑放在纯函数里，就能穷举边界而不必真的按键。

/** 支持的动作 */
export const ACTIONS = [
  'undo', 'redo', 'prevFrame', 'nextFrame', 'togglePlay',
  'firstFrame', 'lastFrame', 'clearFrames', 'say',
];

/**
 * 输入焦点是否在「可输入元素」里。
 * @param tagName  元素 tagName（如 'INPUT'）
 * @param isEditable 是否 contenteditable
 * @param type     input 的 type（checkbox/range 这类不算文字输入）
 */
export function isTypingTarget(tagName, isEditable, type) {
  const tag = String(tagName || '').toUpperCase();
  if (isEditable) return true;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const t = String(type || 'text').toLowerCase();
  // checkbox / radio / range / button 这些不是"打字"，快捷键应该照常生效
  // （不然用户在区间滑块上按空格就什么都不会发生）
  const typing = ['text', 'search', 'email', 'password', 'url', 'tel', 'number', 'date', 'time'];
  return typing.includes(t);
}

/**
 * 把一次按键映射成动作。
 * @param opt.key    e.key
 * @param opt.ctrl   e.ctrlKey || e.metaKey
 * @param opt.shift  e.shiftKey
 * @param opt.alt    e.altKey
 * @param opt.typing 是否正在输入框里打字（见 isTypingTarget）
 * @param opt.hasFrames 当前有没有帧（没帧时切帧/播放没意义）
 * @returns { action } 或 null
 */
export function mapKey(opt = {}) {
  const key = String(opt.key || '');
  const k = key.toLowerCase();
  const ctrl = !!opt.ctrl;
  const shift = !!opt.shift;
  const alt = !!opt.alt;
  const typing = !!opt.typing;
  const hasFrames = opt.hasFrames !== false;

  // 撤销/重做：即使焦点在输入框也允许（用户在文本框里也能撤销自己的输入，
  // 这里不拦截、交给浏览器；只有不在输入框时才走我们的撤销）。
  if (ctrl && !alt && k === 'z' && !shift) return typing ? null : { action: 'undo' };
  if (ctrl && !alt && ((k === 'z' && shift) || k === 'y')) return typing ? null : { action: 'redo' };

  // 其余动作：一律要求"不在输入框"且"没有 Ctrl/Alt 组合键"
  // （空格/方向键在输入框里是刚需，绝不能抢）
  if (typing || ctrl || alt) return null;

  if (!hasFrames) return null;

  if (key === ' ') return { action: 'togglePlay' };
  if (key === 'ArrowLeft') return { action: 'prevFrame' };
  if (key === 'ArrowRight') return { action: 'nextFrame' };
  if (key === 'Home') return { action: 'firstFrame' };
  if (key === 'End') return { action: 'lastFrame' };
  if (k === 'delete' && shift) return { action: 'clearFrames' };
  if (k === 'enter' && shift) return { action: 'say' };
  return null;
}

/** 给界面上显示的提示文案（避免文档和实现脱节） */
export const SHORTCUT_HINTS = [
  { keys: '← →', desc: '上一帧 / 下一帧' },
  { keys: '空格', desc: '播放 / 暂停' },
  { keys: 'Home / End', desc: '跳到第一帧 / 最后一帧' },
  { keys: 'Ctrl+Z', desc: '撤销' },
  { keys: 'Ctrl+Shift+Z', desc: '重做' },
  { keys: 'Shift+Delete', desc: '清空所有帧' },
];
