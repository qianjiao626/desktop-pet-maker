// 主进程崩溃/异常的兜底：**任何情况下都不弹原生错误框**。
//
// 背景（用户带截图报的真实问题）：
//   Electron 默认会在主进程出现未捕获异常时弹一个原生窗口
//   「A JavaScript error occurred in the main process / Uncaught Exception: ...」，
//   直接跳到用户桌面上。用户明确抱怨过"窗口老是弹出来影响工作"。
//
// 处理原则：
//   ① **绝不用弹窗报告错误** —— 错误写日志文件 + 控制台留一行；
//   ② 未捕获异常本身不该让一个"桌面宠物"直接崩掉：
//      记下来、继续跑（宠物掉了可以再启动，但别弹窗打断用户）；
//   ③ 日志本身失败也不能成为新的崩溃源（文件不可写、管道断了都要吞）。
//
// 单独成模块的原因：可以**独立单测**（不用启动整个 Electron 应用）。

import fs from 'node:fs';
import path from 'node:path';

/** 错误行格式化（纯函数，可单测） */
export function formatCrash(tag, err, now = new Date()) {
  const t = now instanceof Date ? now.toISOString() : String(now);
  const body = err && err.stack ? err.stack : String(err);
  return '[' + t + '] ' + String(tag || 'ERROR') + ' ' + body;
}

// ★ 幂等：只注册一次 handler，之后调用只是**更新配置**。
//   为什么必须这样：main.js 会装两次 ——
//   ① 模块顶层（那时 userData 还没就绪，只能写 stderr）
//   ② app ready 之后（补上 crash.log 路径）
//   若每次都 process.on(...)，一次异常会被写两遍日志（实测确认）。
let registered = null;      // { uncaught, rejection }
let latest = { logLine: () => '' };   // 当前生效的输出配置（幂等重装时更新）

/**
 * 装兜底（可重复调用，幂等）。
 * @param opt { logPath, stderr, onError }
 *   logPath: 日志文件路径（null = 只写 stderr）
 *   stderr:  写入的流（默认 process.stderr）
 *   onError: 额外回调（便于测试观察）
 * @returns { installed, handlers: { uncaught, rejection }, logLine }
 */
export function installCrashGuard(opt = { }) {
  const logPath = opt.logPath === undefined ? null : opt.logPath;
  const out = opt.stderr || process.stderr;
  const onError = typeof opt.onError === 'function' ? opt.onError : null;

  // 把一行错误写出去。任何一步失败都吞掉 —— 报告错误的过程本身不能崩。
  function logLine(tag, err) {
    const line = formatCrash(tag, err);
    try { out.write(line + String.fromCharCode(10)); } catch { /* 管道断了 */ }
    try { if (logPath) fs.appendFileSync(logPath, line + String.fromCharCode(10)); } catch { /* 磁盘/权限问题 */ }
    try { if (onError) onError(tag, err); } catch { /* 观察者自己出错也不该影响 */ }
    return line;
  }

  // handler 内部通过 latest.logLine 取"当前配置"的输出函数 ——
  // 这样第二次 installCrashGuard 换了 logPath，旧 handler 也会写到新文件。
  const uncaught = (err) => { latest.logLine('UNCAUGHT', err); };
  const rejection = (reason) => { latest.logLine('UNHANDLED_REJECTION', reason); };

  latest = { logLine };
  if (!registered) {
    process.on('uncaughtException', uncaught);
    process.on('unhandledRejection', rejection);
    registered = { uncaught, rejection };
  }

  return { installed: true, handlers: registered, logLine };
}

/** 给 Electron 用的默认日志路径（userData/crash.log）；拿不到就返回 null */
export function defaultCrashLogPath(userDataDir) {
  if (!userDataDir) return null;
  try { return path.join(userDataDir, 'crash.log'); } catch { return null; }
}
