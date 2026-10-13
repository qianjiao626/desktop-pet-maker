// 窗口健康守护：渲染进程崩溃/加载失败时，**别把残骸留在用户桌面上**。
//
// 背景（用户反复强调："不要让窗口重复在桌面跳出来影响工作"）：
//   项目里对渲染进程崩溃的处理写在 attachDebug 里，而它**只在 DEBUG 模式生效**
//   （`if (!DEBUG) return;`）。正常模式下渲染进程一旦崩掉：
//     · 窗口会**留在桌面上**，但内容是空白 / 卡死的旧画面；
//     · 用户看到的是一只"坏掉的宠物"或一个空白窗，还关不掉（点它没反应）；
//     · 宠物窗口崩了还占着位置，再启动一只又叠上去。
//
// 处理原则：
//   ① 崩溃/加载失败时**立刻清理**（关掉窗口、注销状态），不留残骸；
//   ② 一切失败都记日志，**不弹窗**；
//   ③ 兜底逻辑本身失败也不能抛（不能成为新的崩溃源）。
//
// 单独成模块的原因：可独立单测（不用启动 Electron）。

/** 崩溃原因里哪些是"正常关闭"（不该当成故障处理） */
export function isBenignGoneReason(reason) {
  const r = String(reason || '').toLowerCase();
  // clean-exit = 正常退出；killed = 被任务管理器/系统结束（用户自己的选择）
  return r === 'clean-exit' || r === 'killed';
}

/**
 * 装窗口健康守护。
 * @param win  BrowserWindow
 * @param opt  { tag, onGone, log, headless }
 *   tag:      日志前缀
 *   onGone:   窗口不可用时调用（用来清理状态/托盘）
 *   log:      日志函数（默认 console.warn，可注入便于测试）
 * @returns { detach } 解绑函数（测试用）
 */
export function attachWindowHealth(win, opt = {}) {
  const tag = String(opt.tag || 'win');
  const log = typeof opt.log === 'function' ? opt.log : (m) => { try { console.warn(m); } catch {} };
  const onGone = typeof opt.onGone === 'function' ? opt.onGone : null;

  if (!win || typeof win !== 'object') return () => {};

  const cleanup = (why) => {
    try { log('[' + tag + '] ' + why + ' -> 清理窗口（不留残骸）'); } catch {}
    try { if (onGone) onGone(why); } catch {}
    // 关掉窗口。已经销毁/已关闭就跳过。
    try {
      if (!(win.isDestroyed && win.isDestroyed())) {
        if (!(win.isClosable && !win.isClosable())) win.destroy();
      }
    } catch {}
  };

  const handlers = [];
  const on = (event, fn) => {
    try { win.on(event, fn); handlers.push([event, fn]); } catch {}
  };

  // 渲染进程没了：崩溃 / 被杀 / 正常退出
  try {
    if (win.webContents && typeof win.webContents.on === 'function') {
      const gone = (e, details) => {
        const reason = details && details.reason;
        // 正常关闭（clean-exit）不该触发"清理"，否则会把用户主动关掉的窗口又走一遍流程
        if (isBenignGoneReason(reason)) {
          try { log('[' + tag + '] render-process-gone: ' + reason + '（正常，忽略）'); } catch {}
          return;
        }
        cleanup('渲染进程异常退出（' + String(reason || 'unknown') + '）');
      };
      win.webContents.on('render-process-gone', gone);
      handlers.push(['webContents:render-process-gone', gone]);

      const failed = (e, code, desc, url) => {
        // -3 = ERR_ABORTED，页面被主动跳转/取消时会出现，不是故障
        if (Number(code) === -3) return;
        cleanup('页面加载失败（' + code + ' ' + desc + '）');
      };
      win.webContents.on('did-fail-load', failed);
      handlers.push(['webContents:did-fail-load', failed]);

      const preloadErr = (e, p, err) => {
        cleanup('preload 失败（' + String(err && err.message ? err.message : err) + '）');
      };
      win.webContents.on('preload-error', preloadErr);
      handlers.push(['webContents:preload-error', preloadErr]);
    }
  } catch {}

  // 窗口本身被关掉：交给 onGone 做状态清理（不 destroy，已经在关了）
  on('closed', () => {
    try { if (onGone) onGone('closed'); } catch {}
  });

  // 注意：'webContents:'.length === 12。
  // 早先写成 slice(13)（多切一位），解绑后事件照旧触发（被单测抓到）。
  const WC = 'webContents:';
  return function detach() {
    for (const [event, fn] of handlers) {
      try {
        if (event.startsWith(WC)) win.webContents.removeListener(event.slice(WC.length), fn);
        else win.removeListener(event, fn);
      } catch {}
    }
    handlers.length = 0;
  };
}
