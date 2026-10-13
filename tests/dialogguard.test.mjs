import { ok } from './_harness.mjs';
import { pickParentWindow, withParent, showDialog } from '../src/main/dialogguard.js';
import { readFileSync } from 'node:fs';

// ★ 守护：所有系统对话框都必须**挂到主窗口上**（不出现脱离主窗口的飘窗）。
//
// 背景（用户反复强调"不要让窗口重复在桌面跳出来影响我工作"）：
//   项目里有 16 处 dialog.showOpenDialog / showSaveDialog，**全都没传 parent**。
//   不传 parent 时，Electron 的对话框在部分平台会脱离主窗口飘到屏幕中央
//   （看起来像"莫名弹出一个窗口"），或者跑到主窗口后面
//   （用户以为没反应、再点一次 -> 又弹一个）。

// ---------- pickParentWindow ----------
{
  const alive = { isDestroyed: () => false };
  ok('有可用窗口时返回它', pickParentWindow(() => alive) === alive, 'alive');
  ok('窗口已销毁时返回 null', pickParentWindow(() => ({ isDestroyed: () => true })) === null, 'destroyed');
  ok('没有窗口时返回 null', pickParentWindow(() => null) === null, 'null');
  ok('没传取值函数时不崩', pickParentWindow() === null, 'undefined');
  ok('取值函数抛错时返回 null（不成为新的崩溃源）',
    pickParentWindow(() => { throw new Error('boom'); }) === null, 'throw');
  ok('窗口没有 isDestroyed 方法也能用（容错）',
    pickParentWindow(() => ({ id: 1 })) !== null, 'no-isDestroyed');
}

// ---------- withParent ----------
{
  const p = { id: 'win' };
  const a = withParent({ title: 'x' }, p);
  ok('补上 parent', a.parent === p, 'parent');
  ok('保留原有字段', a.title === 'x', 'title');
  ok('不修改传入对象（纯函数）',
    (() => { const src = { title: 'x' }; withParent(src, p); return src.parent === undefined; })(), 'pure');
  ok('parent 为 null 时不硬塞 parent 字段',
    withParent({ title: 'x' }, null).parent === undefined, 'no-parent');
  ok('opt 为 null 也不崩', typeof withParent(null, p) === 'object', 'null-opt');
}

// ---------- showDialog：真的把 parent 传下去了 ----------
{
  const calls = [];
  const fakeDialog = {
    showOpenDialog: async (o) => { calls.push(['open', o]); return { canceled: true, filePaths: [] }; },
    showSaveDialog: async (o) => { calls.push(['save', o]); return { canceled: true }; },
  };
  const win = { isDestroyed: () => false };
  await showDialog(fakeDialog, 'open', { title: 'a' }, () => win);
  await showDialog(fakeDialog, 'save', { title: 'b' }, () => win);
  ok('open 走了 showOpenDialog', calls[0] && calls[0][0] === 'open', JSON.stringify(calls[0] && calls[0][0]));
  ok('open 带上了 parent', calls[0] && calls[0][1].parent === win, 'open-parent');
  ok('save 走了 showSaveDialog', calls[1] && calls[1][0] === 'save', JSON.stringify(calls[1] && calls[1][0]));
  ok('save 带上了 parent', calls[1] && calls[1][1].parent === win, 'save-parent');

  // 没有父窗口时仍能正常调用（不抛错）
  calls.length = 0;
  let threw = false;
  try { await showDialog(fakeDialog, 'open', { title: 'c' }, () => null); } catch (e) { threw = true; }
  ok('没有父窗口时不抛错（退化为普通对话框）', !threw, 'threw=' + threw);
  ok('没有父窗口时不塞 parent', calls[0] && calls[0][1].parent === undefined, 'no-parent');
}

// ---------- 静态守护：main.js 里不许再出现裸的 dialog.showXxxDialog ----------
{
  const main = readFileSync('src/main/main.js', 'utf8');
  ok('main.js 导入了 dialogguard', main.includes("from './dialogguard.js'"), 'import');
  const lines = main.split('\n');
  const offenders = [];
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;                       // 整行注释不算
    const code = l.replace(/\/\/.*$/, '');
    if (/dialog\.showOpenDialog\s*\(/.test(code) || /dialog\.showSaveDialog\s*\(/.test(code)) {
      offenders.push((i + 1) + ': ' + l.trim());
    }
  });
  ok('没有裸的 dialog.showXxxDialog（必须走 showDialog 带上 parent）',
    offenders.length === 0, offenders.slice(0, 5).join(' | '));

  // 每处 showDialog 都要把 getMakerWindow 传进去（否则等于没带 parent）
  const total = (main.match(/await showDialog\(/g) || []).length;
  const withWin = (main.match(/await showDialog\([\s\S]*?getMakerWindow\)/g) || []).length;
  ok('至少有 10 处对话框调用', total >= 10, String(total));
  ok('每处都传了 getMakerWindow（真的带上父窗口）', total === withWin,
    withWin + '/' + total);
}
