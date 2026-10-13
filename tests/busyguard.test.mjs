import { ok } from './_harness.mjs';
import { guardBusy, bindGuardedClick } from '../src/maker/busyguard.js';
import { readFileSync } from 'node:fs';

// ★ 守护：渲染进程的「生成/导出」按钮必须防重入。
//
// 背景（用户反复强调"不要让窗口重复在桌面跳出来影响我工作"）：
//   制作器里有一批生成/导出类按钮，点一下要做不少事（渲染几十帧、写文件）：
//     · 生成动画帧 —— 连点两次**帧数翻倍**（实测 8 帧变 16 帧）
//     · 一键存全部舞步 —— 连点会重复存一遍（还要重渲染 32 帧）
//   这些按钮**没有防重入**。用户连点很常见（渲染慢、界面像没反应）。
//
// 与托盘那批（同步动作）的区别：这里是**异步**动作，
// 所以"忙碌标记"式守卫是正确工具（标记持有到 Promise 结束）。

// ---------- guardBusy：同一时刻只跑一个 ----------
{
  let runs = 0;
  let resolveFirst = null;
  const g = guardBusy(async () => {
    runs++;
    if (runs === 1) await new Promise((r) => { resolveFirst = r; });
    return 'done' + runs;
  });

  ok('isBusy 初始为 false', g.isBusy() === false, String(g.isBusy()));
  const p1 = g();
  ok('调用后进入忙碌', g.isBusy() === true, String(g.isBusy()));

  // 忙碌期间再点：应被忽略（不执行、返回 undefined）
  const p2 = g();
  const p3 = g();
  ok('忙碌期间的重复调用立即返回 undefined', p2 === undefined && p3 === undefined, 'skipped');

  resolveFirst();
  const r1 = await p1;
  ok('第一次调用正常完成', r1 === 'done1', String(r1));
  ok('忙碌标记在完成后清掉', g.isBusy() === false, String(g.isBusy()));
  ok('函数体只执行了一次（连点被挡住）', runs === 1, String(runs));

  // 解锁后再点：应能正常执行（不是"一辈子只跑一次"）
  const r4 = await g();
  ok('解锁后可以再次执行', r4 === 'done2' && runs === 2, String(r4) + ' runs=' + runs);
}

// ---------- 异常必须解锁（否则按钮永久失效） ----------
{
  let runs = 0;
  const g = guardBusy(async () => { runs++; throw new Error('boom'); });
  let threw = false;
  try { await g(); } catch (e) { threw = true; }
  ok('动作抛错会冒泡出去（不吞异常）', threw === true, 'threw=' + threw);
  ok('抛错后忙碌标记被清掉（按钮没永久失效）', g.isBusy() === false, String(g.isBusy()));
  // 再调一次仍然能跑（说明确实解锁了）
  try { await g(); } catch (e) { /* 预期再抛一次 */ }
  ok('抛错后仍可再次执行', runs === 2, String(runs));
}

// ---------- onBusy：忙碌期间给用户反馈 ----------
{
  let busyHits = 0;
  let release = null;
  const g = guardBusy(() => new Promise((r) => { release = r; }), { onBusy: () => busyHits++ });
  const p = g();
  g(); g();
  ok('onBusy 被调用（可以给"正在处理"的反馈）', busyHits === 2, String(busyHits));
  release();
  await p;
}

// ---------- 参数与 this 要正确传递 ----------
{
  let got = null;
  const g = guardBusy(async function (a, b) { got = { a, b, self: this }; return a + b; });
  const ctx = { tag: 'me' };
  const r = await g.call(ctx, 1, 2);
  ok('参数正确传递', r === 3, String(r));
  ok('this 正确传递', got && got.self === ctx, JSON.stringify(got && got.self));
  ok('非函数入参报错（早失败）', (() => { try { guardBusy(null); return false; } catch { return true; } })(), 'throws');
}

// ---------- bindGuardedClick ----------
{
  const el = { onclick: null };
  let runs = 0;
  let release = null;
  const handler = bindGuardedClick(el, () => {
    runs++;
    return new Promise((r) => { release = r; });
  });
  ok('返回了处理函数', typeof handler === 'function', typeof handler);
  ok('挂到了 el.onclick', typeof el.onclick === 'function', typeof el.onclick);

  const p1 = el.onclick();
  const p2 = el.onclick();     // 连点
  ok('连点只执行一次', runs === 1, String(runs));
  ok('连点第二次立即返回 undefined', p2 === undefined, String(p2));
  release();
  await p1;

  // 元素为空时不崩
  ok('传 null 元素返回 null（不崩）', bindGuardedClick(null, async () => {}) === null, 'null');
}

// ---------- 静态守护：生成/导出类按钮必须防重入 ----------
{
  const maker = readFileSync('src/maker/maker.js', 'utf8');
  ok('maker.js 导入了 busyguard', maker.includes("from './busyguard.js'"), 'import');

  // 「生成动画帧」与「一键存全部舞步」这两个最重的生成动作必须走守卫
  ok('「生成动画帧」走了防重入',
    /bindGuardedClick\(\$\('#btnStAdd'\), async \(\) => \{/.test(maker), 'btnStAdd');
  ok('「一键存全部舞步」走了防重入',
    /bindGuardedClick\(\$\('#btnStAllClips'\), async \(\) => \{/.test(maker), 'btnStAllClips');

  // 这两个按钮不许再出现裸的 onclick 赋值（否则等于绕过守卫）
  const nakedAdd = /\$\('#btnStAdd'\)\.onclick\s*=/.test(maker);
  const nakedAll = /\$\('#btnStAllClips'\)\.onclick\s*=/.test(maker);
  ok('没有裸的 btnStAdd.onclick 赋值（必须走守卫）', !nakedAdd, 'naked-add');
  ok('没有裸的 btnStAllClips.onclick 赋值（必须走守卫）', !nakedAll, 'naked-all');

  // 守卫不该去碰 disabled（按钮可用性由 updateButtons 统一决定）
  const src = readFileSync('src/maker/busyguard.js', 'utf8');
  ok('守卫不碰 disabled（避免点亮本该灰的按钮）', !/\.disabled\s*=/.test(src), 'no-disabled');
}
