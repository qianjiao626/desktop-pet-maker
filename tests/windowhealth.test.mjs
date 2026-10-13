import { ok } from './_harness.mjs';
import { isBenignGoneReason, attachWindowHealth } from '../src/main/windowhealth.js';
import { readFileSync } from 'node:fs';

// ★ 守护：窗口/渲染进程出问题时，**别把残骸留在用户桌面上**。
//
// 背景（用户反复强调"不要让窗口重复在桌面跳出来影响工作"）：
//   项目里对渲染进程崩溃的处理写在 attachDebug 里，而它**只在 DEBUG 模式生效**。
//   正常模式下渲染进程一旦崩掉，窗口会留在桌面上但内容是空白/卡死，
//   点它也没反应 —— 用户看到一只"坏掉的宠物"或一个空白窗，还关不掉。

// ---------- isBenignGoneReason：正常关闭不该被当成故障 ----------
{
  ok('clean-exit 算正常', isBenignGoneReason('clean-exit') === true, 'clean-exit');
  ok('killed 算正常（用户自己结束的）', isBenignGoneReason('killed') === true, 'killed');
  ok('crashed 不算正常', isBenignGoneReason('crashed') === false, 'crashed');
  ok('oom 不算正常', isBenignGoneReason('oom') === false, 'oom');
  ok('大小写不敏感', isBenignGoneReason('CLEAN-EXIT') === true, 'upper');
  ok('空值不崩（按异常处理）', isBenignGoneReason(null) === false, 'null');
}

// ---------- 造一个假的 BrowserWindow / webContents 来驱动事件 ----------
function fakeWin() {
  const listeners = {};
  const destroyed = { v: false };
  return {
    _listeners: listeners,
    _destroyed: destroyed,
    destroyed: false,
    isDestroyed: () => destroyed.v,
    isClosable: () => true,
    destroy() { this.destroyed = true; destroyed.v = true; },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener(ev, fn) {
      if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn);
    },
    webContents: {
      _listeners: listeners,
      on(ev, fn) { (listeners['wc:' + ev] = listeners['wc:' + ev] || []).push(fn); },
      removeListener(ev, fn) {
        if (listeners['wc:' + ev]) listeners['wc:' + ev] = listeners['wc:' + ev].filter((f) => f !== fn);
      },
    },
    emit(ev, ...a) { for (const f of (listeners[ev] || [])) f({}, ...a); },
    emitWc(ev, ...a) { for (const f of (listeners['wc:' + ev] || [])) f({}, ...a); },
  };
}

// ---------- 崩溃 -> 关掉窗口 + 回调 onGone ----------
{
  const win = fakeWin();
  const gone = [];
  const logs = [];
  attachWindowHealth(win, { tag: 't', log: (m) => logs.push(m), onGone: (why) => gone.push(why) });
  win.emitWc('render-process-gone', { reason: 'crashed' });
  ok('渲染进程崩溃 -> 窗口被销毁（不留残骸）', win.destroyed === true, 'destroyed=' + win.destroyed);
  ok('崩溃 -> 调用了 onGone（清理状态/托盘）', gone.length === 1, JSON.stringify(gone));
  ok('崩溃 -> 写了日志（可排查）', logs.some((m) => /crashed/.test(m)), JSON.stringify(logs));
}

// ---------- 正常退出（clean-exit）-> 不动窗口 ----------
{
  const win = fakeWin();
  const gone = [];
  attachWindowHealth(win, { onGone: (w) => gone.push(w), log: () => {} });
  win.emitWc('render-process-gone', { reason: 'clean-exit' });
  ok('正常退出不销毁窗口（避免误伤）', win.destroyed === false, 'destroyed=' + win.destroyed);
  ok('正常退出不触发清理回调', gone.length === 0, JSON.stringify(gone));
}

// ---------- 加载失败 -> 清理；但 ERR_ABORTED(-3) 不算故障 ----------
{
  const win = fakeWin();
  attachWindowHealth(win, { log: () => {} });
  win.emitWc('did-fail-load', -3, 'ERR_ABORTED', 'x');
  ok('ERR_ABORTED 不算故障（页面主动跳转会带这个码）', win.destroyed === false, 'destroyed=' + win.destroyed);

  const win2 = fakeWin();
  attachWindowHealth(win2, { log: () => {} });
  win2.emitWc('did-fail-load', -6, 'ERR_FILE_NOT_FOUND', 'x');
  ok('真正的加载失败 -> 清理窗口', win2.destroyed === true, 'destroyed=' + win2.destroyed);
}

// ---------- preload 失败 -> 清理 ----------
{
  const win = fakeWin();
  attachWindowHealth(win, { log: () => {} });
  win.emitWc('preload-error', 'p', new Error('boom'));
  ok('preload 失败 -> 清理窗口', win.destroyed === true, 'destroyed=' + win.destroyed);
}

// ---------- closed -> 只回调，不重复 destroy ----------
{
  const win = fakeWin();
  const gone = [];
  attachWindowHealth(win, { onGone: (w) => gone.push(w), log: () => {} });
  win.emit('closed');
  ok('窗口关闭 -> 回调 onGone', gone.length === 1, JSON.stringify(gone));
  ok('窗口关闭 -> 不重复 destroy', win.destroyed === false, 'destroyed=' + win.destroyed);
}

// ---------- 容错：坏输入 / 回调抛错都不许崩 ----------
{
  let threw = false;
  try { attachWindowHealth(null); attachWindowHealth(undefined); attachWindowHealth({}); } catch (e) { threw = true; }
  ok('坏窗口输入不抛异常', !threw, 'threw=' + threw);

  const win = fakeWin();
  let threw2 = false;
  try {
    attachWindowHealth(win, { onGone: () => { throw new Error('回调炸了'); }, log: () => { throw new Error('日志炸了'); } });
    win.emitWc('render-process-gone', { reason: 'crashed' });
  } catch (e) { threw2 = true; }
  ok('onGone / log 抛错也不影响清理（不成为新的崩溃源）', !threw2 && win.destroyed === true,
    'threw=' + threw2 + ' destroyed=' + win.destroyed);
}

// ---------- detach：解绑后事件不再触发 ----------
{
  const win = fakeWin();
  const gone = [];
  const detach = attachWindowHealth(win, { onGone: (w) => gone.push(w), log: () => {} });
  detach();
  win.emitWc('render-process-gone', { reason: 'crashed' });
  ok('解绑后不再处理事件', gone.length === 0 && win.destroyed === false,
    'gone=' + gone.length + ' destroyed=' + win.destroyed);
}

// ---------- 静态守护：两个窗口都要装健康守护，且不许只放在 DEBUG 里 ----------
{
  const main = readFileSync('src/main/main.js', 'utf8');
  ok('main.js 导入了 windowhealth', main.includes("from './windowhealth.js'"), 'import');
  const count = (main.match(/attachWindowHealth\(/g) || []).length;
  ok('制作器窗口与宠物窗口都装了守护（>=2 处）', count >= 2, String(count));
  ok('制作器窗口那处传了 onGone（要清理状态）',
    /attachWindowHealth\(win, \{\s*tag: 'maker'[\s\S]{0,200}onGone/.test(main), 'maker-onGone');
  ok('宠物窗口那处传了 onGone（要把这只摘掉）',
    /attachWindowHealth\(win, \{\s*tag: 'pet'[\s\S]{0,300}onGone/.test(main), 'pet-onGone');
  // ★ 关键：健康守护不能挂在 attachDebug 里（那会导致"只在 DEBUG 模式生效"）
  const dbg = main.match(/function attachDebug\(win, tag\) \{[\s\S]*?\n\}/);
  ok('attachDebug 里不含 windowhealth（否则正常模式就没人管了）',
    !!dbg && !/attachWindowHealth/.test(dbg[0]), 'not-in-debug');

  // ★ 更狠的一条：每处 attachWindowHealth **前面不许有条件判断**。
  //   原始 bug 就是"只在 DEBUG 模式生效"（`if (!DEBUG) return;` 包着整段）。
  //   光看"函数在不在"抓不到，必须看它**是不是无条件执行**。
  const lines = main.split('\n');
  const guarded = [];
  lines.forEach((l, i) => {
    if (!/attachWindowHealth\(/.test(l)) return;
    // 往前看 3 行，找有没有 if (...) 把它包起来（同一行或上一行）
    const prev = [lines[i - 1] || '', lines[i - 2] || ''].join(' ');
    if (/\bif\s*\(/.test(l) || /\bif\s*\([^)]*\)\s*$/.test(prev)) {
      guarded.push((i + 1) + ': ' + l.trim());
    }
  });
  ok('每处 attachWindowHealth 都是无条件执行（不许只在 DEBUG 模式生效）',
    guarded.length === 0, guarded.join(' | '));
  // 注释里提到"没有 win.__petId 这种东西"是合理的说明，所以只检查**代码行**。
  const codeLines = main.split('\n').filter((l) => !/^\s*\/\//.test(l));
  const code = codeLines.join('\n');
  ok('宠物窗口清理用 petByWindow 反查（不是凭空假设的 win.__petId）',
    code.includes('petByWindow(win)') && !/win\.__petId/.test(code), 'reverse-lookup');
}
