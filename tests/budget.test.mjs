import { ok } from './_harness.mjs';
import { estimateFramesBytes, maxFramesFor, fitFrameLimit, fmtBytes, planRuntimeFrames, DEFAULT_BUDGET_BYTES } from '../src/shared/budget.js';

// ---- estimateFramesBytes ----
ok('单帧 1600x1600 两份 ≈ 19.5MB',
  Math.abs(estimateFramesBytes(1600, 1600, 1, 2) / 1048576 - 19.53) < 0.1,
  (estimateFramesBytes(1600, 1600, 1, 2) / 1048576).toFixed(2));
ok('帧数倍增线性', estimateFramesBytes(100, 100, 10, 2) === estimateFramesBytes(100, 100, 5, 2) * 2);
ok('copies 参数生效', estimateFramesBytes(10, 10, 1, 1) * 2 === estimateFramesBytes(10, 10, 1, 2));
ok('0 帧为 0 字节', estimateFramesBytes(10, 10, 0, 2) === 0);
ok('非法尺寸不报错', Number.isFinite(estimateFramesBytes(0, 0, 5, 2)));

// ---- maxFramesFor ----
ok('512MB 下 1600x1600 约 26 帧',
  Math.abs(maxFramesFor(1600, 1600) - 26) <= 1, String(maxFramesFor(1600, 1600)));
ok('512MB 下 512x512 可放很多帧', maxFramesFor(512, 512) > 200, String(maxFramesFor(512, 512)));
ok('小图不限制到 1 帧以下', maxFramesFor(4, 4) > 1);
ok('预算越大帧数越多', maxFramesFor(800, 800, 1024 * 1024 * 1024) > maxFramesFor(800, 800, 128 * 1024 * 1024));

// ---- fitFrameLimit ----
{
  const r = fitFrameLimit(1600, 1600, 300);
  ok('大图 300 帧被限制', r.clamped === true, 'frames=' + r.frames);
  ok('限制后字节在预算内', r.bytes <= DEFAULT_BUDGET_BYTES, (r.bytes / 1048576).toFixed(1) + 'MB');
  ok('给出限制原因', typeof r.limitReason === 'string' && r.limitReason.length > 0, r.limitReason);
  ok('报告允许上限', r.maxAllowed === r.frames, `max=${r.maxAllowed} frames=${r.frames}`);
}
{
  const r = fitFrameLimit(256, 256, 20);
  ok('小图小帧数不被限制', r.clamped === false && r.frames === 20, JSON.stringify({ f: r.frames, c: r.clamped }));
  ok('未限制时无原因文案', r.limitReason === '');
  ok('未限制时字节很小', r.bytes < 20 * 1024 * 1024, (r.bytes / 1048576).toFixed(1) + 'MB');
}
{
  const r = fitFrameLimit(1024, 1024, 1);
  ok('至少保留 1 帧', r.frames >= 1, String(r.frames));
}
{
  const r = fitFrameLimit(512, 512, 0);
  ok('请求 0 帧被规整为至少 1', r.frames >= 1, String(r.frames));
}
{
  const r = fitFrameLimit(1600, 1600, 300, { budgetBytes: 32 * 1024 * 1024 });
  ok('自定义预算生效', r.frames <= 2 && r.bytes <= 32 * 1024 * 1024, `frames=${r.frames} bytes=${(r.bytes / 1048576).toFixed(1)}MB`);
}
// 关键回归：最坏情况不得再超过预算
{
  const worst = fitFrameLimit(1600, 1600, 300);
  ok('最坏情况内存不再爆炸(<512MB)', worst.bytes < 512 * 1024 * 1024, (worst.bytes / 1048576).toFixed(1) + 'MB');
}

// ---- fmtBytes ----
ok('fmtBytes B', fmtBytes(512) === '512 B');
ok('fmtBytes KB', fmtBytes(2048) === '2 KB');
ok('fmtBytes MB', fmtBytes(3 * 1048576) === '3.0 MB');
ok('fmtBytes GB', fmtBytes(2 * 1073741824) === '2.00 GB');
ok('fmtBytes 非法值安全', fmtBytes(NaN) === '?' && fmtBytes(-1) === '?');

// ---- planRuntimeFrames：运行时内存防护 ----
// 运行时加载的 petpack 可能来自他人分享，是不可信输入
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ file: `f${i}.png`, durationMs: 100 }));

  // 小包不裁剪
  const small = planRuntimeFrames(mk(20), 256, 256);
  ok("运行时: 小包不裁剪", small.clamped === false && small.frames.length === 20, String(small.frames.length));
  ok("运行时: 小包 dropped=0", small.dropped === 0);

  // 大包必须被裁剪（240 帧 x 1600x1600 约 3GB）
  const big = planRuntimeFrames(mk(240), 1600, 1600);
  ok("运行时: 超大包被裁剪", big.clamped === true, `frames=${big.frames.length} dropped=${big.dropped}`);
  ok("运行时: 裁剪后字节在预算内", big.bytes <= DEFAULT_BUDGET_BYTES, (big.bytes / 1048576).toFixed(1) + "MB");
  ok("运行时: 报告丢弃数量", big.dropped === 240 - big.frames.length, String(big.dropped));

  // 均匀抽样：首末帧必须保留（保证动画首尾不被砍）
  const kept = big.frames;
  ok("运行时: 保留首帧", kept[0].file === mk(240)[0].file, kept[0].file);
  ok("运行时: 保留末帧", kept[kept.length - 1].file === mk(240)[239].file, kept[kept.length - 1].file);
  ok("运行时: 抽样无重复", new Set(kept.map((f) => f.file)).size === kept.length, String(new Set(kept.map((f) => f.file)).size));

  // 边界
  ok("运行时: 空数组安全", planRuntimeFrames([], 100, 100).frames.length === 0);
  ok("运行时: null 安全", planRuntimeFrames(null, 100, 100).frames.length === 0);
  ok("运行时: 至少保留 1 帧", planRuntimeFrames(mk(50), 4000, 4000).frames.length >= 1, String(planRuntimeFrames(mk(50), 4000, 4000).frames.length));
  ok("运行时: 极端尺寸不崩", Number.isFinite(planRuntimeFrames(mk(10), 100000, 100000).bytes));
  // 关键回归：无论输入多大，字节都受控
  let worst = 0;
  for (const n of [100, 240, 1000]) for (const sz of [256, 1024, 1600]) {
    worst = Math.max(worst, planRuntimeFrames(mk(n), sz, sz).bytes);
  }
  ok("运行时: 任意输入都不超预算", worst <= DEFAULT_BUDGET_BYTES, (worst / 1048576).toFixed(1) + "MB");
}
