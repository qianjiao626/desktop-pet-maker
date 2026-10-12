import { ok } from './_harness.mjs';
import { ACTIONS, isTypingTarget, mapKey, SHORTCUT_HINTS } from '../src/shared/makerkeys.js';

// ---------- isTypingTarget ----------
{
  ok('DIV 不是打字目标', isTypingTarget('DIV', false) === false);
  ok('TEXTAREA 是', isTypingTarget('TEXTAREA', false) === true);
  ok('SELECT 是', isTypingTarget('SELECT', false) === true);
  ok('contenteditable 是', isTypingTarget('DIV', true) === true);
  ok('text input 是', isTypingTarget('INPUT', false, 'text') === true);
  ok('search input 是', isTypingTarget('INPUT', false, 'search') === true);
  ok('number input 是', isTypingTarget('INPUT', false, 'number') === true);
  ok('没有 type 的 input 当作 text', isTypingTarget('INPUT', false) === true);
  ok('input 大小写不敏感', isTypingTarget('input', false, 'TEXT') === true);
  // 这些不是"打字"，快捷键应该照常生效
  ok('checkbox 不是打字目标', isTypingTarget('INPUT', false, 'checkbox') === false);
  ok('radio 不是', isTypingTarget('INPUT', false, 'radio') === false);
  ok('range 不是（滑块上按空格应该能播放）', isTypingTarget('INPUT', false, 'range') === false);
  ok('button 不是', isTypingTarget('INPUT', false, 'button') === false);
  ok('null 不崩', isTypingTarget(null, null, null) === false);
}

// ---------- mapKey：基本映射 ----------
{
  ok('空格 -> 播放', mapKey({ key: ' ' }).action === 'togglePlay', JSON.stringify(mapKey({ key: ' ' })));
  ok('← -> 上一帧', mapKey({ key: 'ArrowLeft' }).action === 'prevFrame');
  ok('→ -> 下一帧', mapKey({ key: 'ArrowRight' }).action === 'nextFrame');
  ok('Home -> 第一帧', mapKey({ key: 'Home' }).action === 'firstFrame');
  ok('End -> 最后一帧', mapKey({ key: 'End' }).action === 'lastFrame');
  ok('Shift+Delete -> 清空', mapKey({ key: 'Delete', shift: true }).action === 'clearFrames');
  ok('Shift+Enter -> 说一句', mapKey({ key: 'Enter', shift: true }).action === 'say');
  ok('Ctrl+Z -> 撤销', mapKey({ key: 'z', ctrl: true }).action === 'undo');
  ok('Ctrl+Shift+Z -> 重做', mapKey({ key: 'z', ctrl: true, shift: true }).action === 'redo');
  ok('Ctrl+Y -> 重做', mapKey({ key: 'y', ctrl: true }).action === 'redo');
}
{
  // 不认识的键不该有动作
  for (const k of ['a', 'q', 'F5', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', '=']) {
    ok('未绑定的键不产生动作：' + k, mapKey({ key: k }) === null, JSON.stringify(mapKey({ key: k })));
  }
}

// ---------- ★ 输入框里绝不能抢键 ----------
{
  const typing = true;
  ok('输入框里空格不触发播放（要能打空格）', mapKey({ key: ' ', typing }) === null, JSON.stringify(mapKey({ key: ' ', typing })));
  ok('输入框里 ← 不切帧（要能移动光标）', mapKey({ key: 'ArrowLeft', typing }) === null);
  ok('输入框里 → 不切帧', mapKey({ key: 'ArrowRight', typing }) === null);
  ok('输入框里 Home/End 不跳帧（要能跳到行首行尾）', mapKey({ key: 'Home', typing }) === null && mapKey({ key: 'End', typing }) === null);
  ok('输入框里 Shift+Delete 不完全清空帧', mapKey({ key: 'Delete', shift: true, typing }) === null);
  ok('输入框里 Ctrl+Z 交还给浏览器（不抢撤销）', mapKey({ key: 'z', ctrl: true, typing }) === null);
  ok('输入框里 Ctrl+Y 也不抢', mapKey({ key: 'y', ctrl: true, typing }) === null);
}
{
  // ★ 特例：Shift+Enter 在输入框里应该是"换行/发送"，不能被我们当成"说一句"
  ok('输入框里 Shift+Enter 不触发"说一句"', mapKey({ key: 'Enter', shift: true, typing: true }) === null,
    JSON.stringify(mapKey({ key: 'Enter', shift: true, typing: true })));
}

// ---------- 与系统/浏览器组合键不打架 ----------
{
  // ★ Ctrl+←/→ 不再是"切帧"，而是"移动当前帧"（键盘可访问的排序）
  ok('Ctrl+← 是移帧不是切帧', mapKey({ key: 'ArrowLeft', ctrl: true }).action === 'moveFrameLeft', JSON.stringify(mapKey({ key: 'ArrowLeft', ctrl: true })));
  ok('Ctrl+→ 是移帧不是切帧', mapKey({ key: 'ArrowRight', ctrl: true }).action === 'moveFrameRight', JSON.stringify(mapKey({ key: 'ArrowRight', ctrl: true })));
  ok('Ctrl+← 不会退化成 prevFrame', mapKey({ key: 'ArrowLeft', ctrl: true }).action !== 'prevFrame');
  ok('Alt+← 不切帧（浏览器后退）', mapKey({ key: 'ArrowLeft', alt: true }) === null);
  ok('Ctrl+空格 不播放', mapKey({ key: ' ', ctrl: true }) === null);
  ok('Alt+空格 不播放（系统窗口菜单）', mapKey({ key: ' ', alt: true }) === null);
  ok('Ctrl+Home 不跳帧', mapKey({ key: 'Home', ctrl: true }) === null);
}

// ---------- ★ 帧排序：Ctrl+←/→（键盘可访问） ----------
{
  ok('Ctrl+← -> 当前帧往前挪', mapKey({ key: 'ArrowLeft', ctrl: true }).action === 'moveFrameLeft');
  ok('Ctrl+→ -> 当前帧往后挪', mapKey({ key: 'ArrowRight', ctrl: true }).action === 'moveFrameRight');
  // metaKey（macOS 的 Cmd）走的是同一个 ctrl 参数，由调用方 || 合并；这里确认参数语义
  ok('带 shift 的 Ctrl+← 仍是移帧（不因 shift 变成别的）', mapKey({ key: 'ArrowLeft', ctrl: true, shift: true }).action === 'moveFrameLeft');
  ok('Alt+← 不是移帧（浏览器后退，必须让开）', mapKey({ key: 'ArrowLeft', alt: true }) === null);
  ok('Ctrl+Alt+← 不是移帧', mapKey({ key: 'ArrowLeft', ctrl: true, alt: true }) === null);
  // 输入框里绝不能抢：Ctrl+← 在文本框里是"按词移动光标"
  ok('输入框里 Ctrl+← 不移帧', mapKey({ key: 'ArrowLeft', ctrl: true, typing: true }) === null);
  ok('输入框里 Ctrl+→ 不移帧', mapKey({ key: 'ArrowRight', ctrl: true, typing: true }) === null);
  // 没帧时没什么可挪的
  ok('没帧时 Ctrl+← 不移帧', mapKey({ key: 'ArrowLeft', ctrl: true, hasFrames: false }) === null);
  ok('没帧时 Ctrl+→ 不移帧', mapKey({ key: 'ArrowRight', ctrl: true, hasFrames: false }) === null);
  // 上下方向键不参与（别顺手把浏览器滚动/其它快捷键抢了）
  ok('Ctrl+↑ 不产生动作', mapKey({ key: 'ArrowUp', ctrl: true }) === null);
  ok('Ctrl+↓ 不产生动作', mapKey({ key: 'ArrowDown', ctrl: true }) === null);
}

// ---------- 没有帧时不该有动作 ----------
{
  ok('没帧时空格不播放', mapKey({ key: ' ', hasFrames: false }) === null);
  ok('没帧时方向键不切帧', mapKey({ key: 'ArrowLeft', hasFrames: false }) === null);
  ok('没帧时 Home/End 不跳', mapKey({ key: 'Home', hasFrames: false }) === null && mapKey({ key: 'End', hasFrames: false }) === null);
  ok('没帧时 Shift+Delete 不清空', mapKey({ key: 'Delete', shift: true, hasFrames: false }) === null);
  // 但撤销不受"有没有帧"限制（可能刚清空，还要能撤销回来）
  ok('没帧时仍可撤销（刚清空要能救回来）', mapKey({ key: 'z', ctrl: true, hasFrames: false }).action === 'undo');
}
{
  // 容错
  ok('key 缺失不崩', mapKey({}) === null);
  ok('全空对象不崩', mapKey() === null);
  ok('key 是数字不崩', mapKey({ key: 5 }) === null);
}

// ---------- 文档与实现不能脱节 ----------
{
  ok('有快捷键提示列表', Array.isArray(SHORTCUT_HINTS) && SHORTCUT_HINTS.length >= 5, String(SHORTCUT_HINTS.length));
  ok('提示项都有 keys 和 desc', SHORTCUT_HINTS.every((h) => h.keys && h.desc), JSON.stringify(SHORTCUT_HINTS));
  ok('动作列表非空', Array.isArray(ACTIONS) && ACTIONS.length > 0, String(ACTIONS.length));
  // 提示里提到的每个动作名都要在 ACTIONS 里（防止写了提示却没实现）
  const hintText = SHORTCUT_HINTS.map((h) => h.keys + h.desc).join(' ');
  ok('提示文本提到方向键切帧', hintText.includes('上一帧'), hintText);
  ok('提示文本提到播放', hintText.includes('播放'), hintText);
  ok('提示文本提到帧排序（Ctrl+←/→）', hintText.includes('Ctrl+←') && hintText.includes('Ctrl+→'), hintText);
  // 新增动作必须同时出现在 ACTIONS 与提示里，防止"实现了但用户不知道"
  ok('ACTIONS 里有 moveFrameLeft/Right', ACTIONS.includes('moveFrameLeft') && ACTIONS.includes('moveFrameRight'), JSON.stringify(ACTIONS));
  ok('每个 ACTIONS 动作都能被某个按键映射出来（防写了动作没人触发）',
    ACTIONS.every((a) => [
      { key: 'z', ctrl: true }, { key: 'z', ctrl: true, shift: true },
      { key: 'ArrowLeft' }, { key: 'ArrowRight' }, { key: ' ' },
      { key: 'Home' }, { key: 'End' }, { key: 'Delete', shift: true }, { key: 'Enter', shift: true },
      { key: 'ArrowLeft', ctrl: true }, { key: 'ArrowRight', ctrl: true },
    ].some((k) => (mapKey(k) || {}).action === a)), JSON.stringify(ACTIONS));
}
