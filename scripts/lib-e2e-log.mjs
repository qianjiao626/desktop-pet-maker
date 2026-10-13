// 统一的 e2e 日志输出：**对 EPIPE 免疫**。
//
// ★ 为什么必须做（用户报的真实问题）：
//   43 个 e2e 脚本都用 `process.stdout.write` 直接写日志。
//   当调用方的管道提前关闭时（例如 `node xxx.mjs | Select-Object -Last 10`
//   这种"只看最后几行"的用法，或者 shell 管道被中断），
//   再写 stdout 会抛 **EPIPE: broken pipe**。
//   这个异常发生在 write 里、没人 catch —— Electron 会弹出一个
//   **原生「A JavaScript error occurred in the main process」错误框**，
//   直接跳到用户桌面上（用户明确抱怨过"窗口老是弹出来影响工作"）。
//
// 做法：把日志收敛到一个安全函数；EPIPE 一旦发生就静默停止输出（并记住），
// 绝不让它冒泡成未捕获异常、更不会弹窗。
//
// 用法：
//   import { makeLogger, installEpipeGuard } from './lib-e2e-log.mjs';
//   installEpipeGuard();               // 建议在文件顶部调用一次
//   const log = makeLogger();

let silenced = false;

/** 是否已经因为管道断开而停止输出（供测试断言） */
export function isSilenced() { return silenced; }

/**
 * 安全写一行。管道断了就静默停（不抛异常）。
 * @param {string} m
 */
export function safeWrite(m) {
  if (silenced) return;
  try {
    process.stdout.write(String(m));
  } catch (err) {
    // EPIPE = 下游已经关了，这不是错误，只是没人听了
    if (err && (err.code === 'EPIPE' || /EPIPE|broken pipe/i.test(String(err.message)))) {
      silenced = true;
      return;
    }
    // 其它写失败也吞掉：日志失败绝不能拖垮测试进程
    silenced = true;
  }
}

/** 造一个 log 函数（与各 e2e 里 `const log = (m) => ...` 用法一致） */
export function makeLogger() {
  return (m) => safeWrite(String(m) + String.fromCharCode(10));
}

/**
 * 装全局兜底：
 *   1) stdout/stderr 的 'error' 事件吞掉 EPIPE（不吞就会变成未捕获异常）
 *   2) uncaughtException 里遇到 EPIPE 直接忽略
 * 建议在 e2e 脚本最顶部调用一次。
 */
export function installEpipeGuard() {
  const swallow = (err) => {
    if (err && (err.code === 'EPIPE' || /EPIPE|broken pipe/i.test(String(err.message)))) {
      silenced = true;
      return true;
    }
    return false;
  };
  for (const stream of [process.stdout, process.stderr]) {
    if (stream && typeof stream.on === 'function') {
      stream.on('error', (err) => { swallow(err); });
    }
  }
  process.on('uncaughtException', (err) => {
    if (swallow(err)) return;                 // 管道断了：静默
    // 其它异常仍然要暴露（否则会变成"假绿"）
    try { process.stderr.write('UNCAUGHT: ' + (err && err.stack ? err.stack : err) + String.fromCharCode(10)); } catch {}
    process.exit(1);
  });
}
