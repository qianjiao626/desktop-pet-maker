import { ok } from './_harness.mjs';
import { formatCrash, installCrashGuard, defaultCrashLogPath } from '../src/main/crashguard.js';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 守护：主进程出现异常时**绝不弹原生错误框**。
//
// 背景（用户带截图报的真实问题）：Electron 默认会弹原生窗口
// 「A JavaScript error occurred in the main process / Uncaught Exception」，
// 直接跳到用户桌面上。用户明确抱怨过"窗口老是弹出来影响工作"。
// 处理原则：写日志 + 控制台，**不弹窗、不崩**。

// ---------- formatCrash：纯函数 ----------
{
  const line = formatCrash('UNCAUGHT', new Error('boom'), new Date('2026-01-02T03:04:05Z'));
  ok('含时间戳（ISO）', line.includes('2026-01-02T03:04:05'), line.slice(0, 40));
  ok('含标签', line.includes('UNCAUGHT'), line.slice(0, 40));
  ok('含错误信息', line.includes('boom'), line);
  ok('用 stack（便于定位）', line.includes('at '), line.slice(0, 80));
  ok('没有 err 也能格式化（不崩）', typeof formatCrash('X', null) === 'string', formatCrash('X', null));
  ok('字符串错误也能格式化', formatCrash('X', 'plain text').includes('plain text'), 'ok');
}

// ---------- installCrashGuard：真的装上了处理函数 ----------
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crashguard-'));
  const logPath = path.join(dir, 'crash.log');
  const seen = [];
  const fakeStream = { write() { /* 丢弃，避免污染测试输出 */ } };
  const guard = installCrashGuard({ logPath, stderr: fakeStream, onError: (tag, err) => seen.push(tag) });

  ok('返回 installed', guard.installed === true, String(guard.installed));
  ok('暴露了两个 handler', typeof guard.handlers.uncaught === 'function'
    && typeof guard.handlers.rejection === 'function', 'handlers');

  // 直接调 handler（不真的抛，避免影响测试进程）
  guard.handlers.uncaught(new Error('模拟未捕获异常'));
  guard.handlers.rejection(new Error('模拟未处理 rejection'));

  ok('异常被写进日志文件', existsSync(logPath), logPath);
  const text = readFileSync(logPath, 'utf8');
  ok('日志里有未捕获异常', text.includes('UNCAUGHT') && text.includes('模拟未捕获异常'), text.slice(0, 80));
  ok('日志里有未处理 rejection',
    text.includes('UNHANDLED_REJECTION') && text.includes('模拟未处理 rejection'), text.slice(0, 120));
  ok('onError 回调被调用（便于观察/上报）', seen.length === 2, JSON.stringify(seen));

  // ★ 关键：日志写不出去时也不能抛（日志本身不能成为新的崩溃源）
  let threw = false;
  try {
    installCrashGuard({ logPath: '/definitely/not/writable/x/y/crash.log', stderr: { write() { throw new Error('EPIPE'); } } })
      .handlers.uncaught(new Error('x'));
  } catch (e) { threw = true; }
  ok('日志写失败也不抛异常（不成为新的崩溃源）', !threw, 'threw=' + threw);

  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ---------- defaultCrashLogPath ----------
{
  ok('有 userData 时给出 crash.log 路径',
    String(defaultCrashLogPath('/tmp/ud')).endsWith('crash.log'), String(defaultCrashLogPath('/tmp/ud')));
  ok('没有 userData 时返回 null（不硬编码路径）', defaultCrashLogPath(null) === null, 'null');
}

// ---------- 静态守护：main.js 必须真的装了兜底、且不许有主动弹窗 ----------
{
  const main = readFileSync('src/main/main.js', 'utf8');
  ok('main.js 导入了 crashguard', main.includes("from './crashguard.js'"), 'import');
  ok('main.js 在早期就装了兜底', /installCrashGuard\(\{ logPath: null \}\)/.test(main), 'early');
  ok('app ready 后补上日志路径（能落盘）',
    /defaultCrashLogPath\(app\.getPath\('userData'\)\)/.test(main), 'logpath');

  // ★ 不许有主动弹窗（dialog.showErrorBox / showMessageBox）—— 这是用户最烦的
  const lines = main.split('\n');
  const offenders = [];
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');        // 去掉行尾注释
    if (/^\s*\/\//.test(l)) return;               // 整行注释不算
    if (/dialog\.showErrorBox\s*\(/.test(code) || /dialog\.showMessageBox\s*\(/.test(code)) {
      offenders.push((i + 1) + ': ' + l.trim());
    }
  });
  ok('main.js 里没有任何主动弹窗（错误只写日志）', offenders.length === 0, offenders.join(' | '));
}
