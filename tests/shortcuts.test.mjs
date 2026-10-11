import { ok } from './_harness.mjs';
import { SHORTCUTS, shortcutOf, validateShortcuts, shortcutHint } from '../src/shared/shortcuts.js';

// ---------- 表本身的健康度 ----------
{
  ok('至少 4 个快捷键', SHORTCUTS.length >= 4, String(SHORTCUTS.length));
  ok('每个都有 id/accelerator/label/kbd', SHORTCUTS.every((s) => s.id && s.accelerator && s.label && s.kbd), 'fields');
  ok('每个 id 唯一', new Set(SHORTCUTS.map((s) => s.id)).size === SHORTCUTS.length, 'ids');
  ok('每个加速键唯一', new Set(SHORTCUTS.map((s) => s.accelerator)).size === SHORTCUTS.length, 'acc');
  ok('全部用 Ctrl+Alt+ 前缀（冲突概率最低）', SHORTCUTS.every((s) => s.accelerator.startsWith('Control+Alt+')), 'prefix');
  ok('都用 Electron 的 Control 写法（不是 Ctrl）', SHORTCUTS.every((s) => !s.accelerator.includes('Ctrl')), 'ctrl');
  ok('kbd 是给人看的 Ctrl+Alt+X', SHORTCUTS.every((s) => /^Ctrl\+Alt\+[A-Z]$/.test(s.kbd)), 'kbd');
}
{
  ok('包含显示/隐藏', !!shortcutOf('toggle'), 'toggle');
  ok('包含回中央', !!shortcutOf('center'), 'center');
  ok('包含说话', !!shortcutOf('say'), 'say');
  ok('包含强制退出（兜底不能丢）', !!shortcutOf('quit'), 'quit');
  ok('退出键确实是 Ctrl+Alt+Q（与文档一致）', shortcutOf('quit').accelerator === 'Control+Alt+Q', shortcutOf('quit').accelerator);
  ok('未知 id 返回 null', shortcutOf('nope') === null, 'null');
}

// ---------- validateShortcuts ----------
{
  const v = validateShortcuts();
  ok('默认表通过校验', v.ok === true, JSON.stringify(v.errors));
  const bad = validateShortcuts([{ id: 'a', accelerator: 'Control+Alt+X' }, { id: 'b', accelerator: 'Control+Alt+X' }]);
  ok('重复加速键被发现', bad.ok === false, JSON.stringify(bad.errors));
  ok('重复错误信息里有加速键', bad.errors.join(' ').includes('Control+Alt+X'), bad.errors.join(' '));
  const noAcc = validateShortcuts([{ id: 'a' }]);
  ok('缺 accelerator 被发现', noAcc.ok === false, JSON.stringify(noAcc.errors));
  const noId = validateShortcuts([{ accelerator: 'Control+Alt+Y' }]);
  ok('缺 id 被发现', noId.ok === false, JSON.stringify(noId.errors));
  ok('空表视为通过（没有冲突）', validateShortcuts([]).ok === true);
}
{
  const h = shortcutHint('toggle');
  ok('提示文本含标签', h.includes('显示 / 隐藏桌宠') || h.includes('显示'), h);
  ok('提示文本含按键', h.includes('Ctrl+Alt+P'), h);
  ok('未知 id 返回空串', shortcutHint('nope') === '', '[' + shortcutHint('nope') + ']');
}

// ---------- 守护：主进程必须按表注册（不能又写死一个键） ----------
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync('src/main/main.js', 'utf8');
  ok('主进程导入了快捷键表', main.includes('SHORTCUTS') && main.includes("shared/shortcuts.js"), 'import');
  ok('主进程用 validateShortcuts 校验', main.includes('validateShortcuts(SHORTCUTS)'), 'validate');
  ok('主进程遍历表注册（不是只写死一个）', /for \(const s of SHORTCUTS\)/.test(main), 'loop');
  for (const id of ['toggle', 'center', 'say', 'quit']) {
    ok('主进程有 ' + id + ' 对应的动作', new RegExp('\\b' + id + ':').test(main), 'action');
  }
}
