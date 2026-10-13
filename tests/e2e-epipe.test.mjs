import { ok } from './_harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { safeWrite, makeLogger, installEpipeGuard, isSilenced } from '../scripts/lib-e2e-log.mjs';

// ★ 守护：e2e 脚本写日志必须对 EPIPE 免疫。
//
// 背景（用户报的真实问题，带截图）：
//   43 个 e2e 脚本都用 `process.stdout.write` 直接写日志。
//   当调用方的管道提前关闭时（例如 `electron xxx.mjs | Select-Object -Last 10`
//   这种"只看最后几行"的用法），再写 stdout 会抛 **EPIPE: broken pipe**。
//   异常没人 catch —— Electron 会弹出一个原生
//   「A JavaScript error occurred in the main process」错误框，
//   直接跳到用户桌面上。用户明确抱怨过"窗口老是弹出来影响工作"。
{
  // 1) 兜底函数本身要能吞掉 EPIPE
  ok('safeWrite 是函数', typeof safeWrite === 'function', typeof safeWrite);
  ok('makeLogger 返回函数', typeof makeLogger() === 'function', typeof makeLogger());
  ok('installEpipeGuard 是函数', typeof installEpipeGuard === 'function', typeof installEpipeGuard());
  ok('初始没有静默', isSilenced() === false, String(isSilenced()));

  // 直接写一个已经"坏掉"的流，必须不抛异常
  let threw = false;
  const orig = process.stdout.write;
  try {
    process.stdout.write = () => { const e = new Error('write EPIPE'); e.code = 'EPIPE'; throw e; };
    safeWrite('这行不该抛出去\n');
  } catch (e) {
    threw = true;
  } finally {
    process.stdout.write = orig;
  }
  ok('下游管道断了时不抛异常（这是弹窗的根源）', !threw, 'threw=' + threw);
  ok('断管之后进入静默（不再反复尝试写）', isSilenced() === true, String(isSilenced()));

  // 静默之后继续调用也不能抛
  let threw2 = false;
  try { safeWrite('静默后仍安全\n'); } catch (e) { threw2 = true; }
  ok('静默后继续调用仍安全', !threw2, 'threw=' + threw2);
}

// 2) 静态守护：所有 e2e 脚本都不许再直接写 stdout/stderr
{
  const files = readdirSync('scripts').filter((f) => /^e2e-.*\.mjs$/.test(f));
  ok('找到了 e2e 脚本', files.length >= 40, String(files.length));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync('scripts/' + f, 'utf8');
    // 允许 lib-e2e-log.mjs 自己写（它就是那个兜底层），e2e-*.mjs 一律不许
    if (/process\.stdout\.write\s*\(/.test(src)) offenders.push(f + ':stdout');
    if (/process\.stderr\.write\s*\(/.test(src)) offenders.push(f + ':stderr');
    if (!/installEpipeGuard\(\)/.test(src)) offenders.push(f + ':未装兜底');
  }
  ok('每个 e2e 都装了 EPIPE 兜底、且不再直接写 stdout/stderr',
    offenders.length === 0, offenders.slice(0, 8).join(', '));
}

// 3) 兜底层自己必须真的覆盖 stdout + stderr 的 error 事件与 uncaughtException
{
  const src = readFileSync('scripts/lib-e2e-log.mjs', 'utf8');
  ok('兜底监听 stdout 的 error', /process\.stdout/.test(src), 'stdout');
  ok('兜底监听 stderr 的 error', /process\.stderr/.test(src), 'stderr');
  ok('兜底处理 uncaughtException（EPIPE 静默、其它仍要暴露）',
    /uncaughtException/.test(src) && /process\.exit\(1\)/.test(src), 'uncaught');
  ok('只静默 EPIPE，不吞掉别的异常（否则会变成假绿）',
    /EPIPE/.test(src) && /swallow\(err\)\) return;/.test(src), 'only-epipe');
}
