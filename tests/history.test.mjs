import { ok } from './_harness.mjs';
import { createHistory, estimateSnapshotBytes } from '../src/shared/history.js';

// ---------- 基本行为 ----------
{
  const h = createHistory();
  ok('初始为空，不能撤销/重做', h.size() === 0 && !h.canUndo() && !h.canRedo());
  ok('空栈 undo 返回 null（不崩）', h.undo() === null);
  ok('空栈 redo 返回 null', h.redo() === null);
  ok('空栈 current 为 null', h.current() === null);
}
{
  const h = createHistory();
  h.push('A');
  ok('只有一层时不能撤销（避免撤到"没有"）', !h.canUndo(), 'size=' + h.size());
  ok('只有一层时 current 是它', h.current() === 'A');
  h.push('B');
  ok('两层后可以撤销', h.canUndo());
  ok('撤销回到 A', h.undo() === 'A' && h.current() === 'A');
  ok('撤销后可以重做', h.canRedo());
  ok('重做回到 B', h.redo() === 'B' && !h.canRedo());
}

// ---------- 关键：从中间推入必须丢弃 redo 分支 ----------
// 这是撤销栈最容易写错的地方（不丢的话会出现"重做到了一个已经不存在的分支"）
{
  const h = createHistory();
  h.push(1); h.push(2); h.push(3);
  h.undo(); h.undo();                 // 回到 1，redo 分支是 2,3
  ok('撤销两次后 current=1', h.current() === 1);
  h.push(9);                           // 从 1 分叉
  ok('分叉后不能重做（redo 分支已被丢弃）', !h.canRedo(), 'size=' + h.size());
  ok('分叉后 current=9', h.current() === 9);
  ok('分叉后栈里没有旧分支（size 应为 2）', h.size() === 2, 'size=' + h.size());
  ok('撤销回到 1 而不是 2', h.undo() === 1);
}

// ---------- 层数上限 ----------
{
  const h = createHistory({ limit: 3 });
  for (const x of ['a', 'b', 'c', 'd', 'e']) h.push(x);
  ok('层数被限制在 3', h.size() === 3, 'size=' + h.size());
  ok('保留的是最新 3 个（current=e）', h.current() === 'e');
  const u1 = h.undo(), u2 = h.undo();
  ok('只能撤到 c（更旧的被丢弃）', u1 === 'd' && u2 === 'c', `${u1},${u2}`);
  ok('撤到底后不能再撤', !h.canUndo());
}
ok('limit 下限为 2（1 层没有意义）', (() => { const h = createHistory({ limit: 1 }); h.push(1); h.push(2); h.push(3); return h.size() === 2; })());
ok('limit 非法时用默认值', (() => { const h = createHistory({ limit: 0 }); return h.size() === 0; })());

// ---------- 字节上限（大图保护，这是加它的主要理由）----------
{
  // 每层 100 字节，上限 250 -> 最多留 2 层
  const h = createHistory({ limit: 99, maxBytes: 250, estimate: () => 100 });
  h.push('a'); h.push('b'); h.push('c');
  ok('字节上限生效（3 层 300 字节 > 250）', h.size() <= 2, 'size=' + h.size() + ' bytes=' + h.byteSize());
  ok('字节统计正确', h.byteSize() <= 250, 'bytes=' + h.byteSize());
  ok('保留的是最新的', h.current() === 'c');
}
ok('maxBytes=0 表示不限制', (() => { const h = createHistory({ limit: 99, maxBytes: 0, estimate: () => 1e9 }); h.push('a'); h.push('b'); return h.size() === 2; })());
ok('至少保留 1 层（哪怕超过字节上限）', (() => { const h = createHistory({ limit: 9, maxBytes: 1, estimate: () => 1e9 }); h.push('a'); return h.size() === 1; })());

// ---------- clear（换图/载入新包时调用）----------
{
  const h = createHistory();
  h.push(1); h.push(2);
  h.clear();
  ok('clear 后为空', h.size() === 0 && h.current() === null && !h.canUndo() && !h.canRedo());
  ok('clear 后字节归零', h.byteSize() === 0);
  h.push('x');
  ok('clear 后仍可正常使用', h.current() === 'x' && h.size() === 1);
}

// ---------- estimateSnapshotBytes ----------
{
  const snap = { frames: [{ data: new Uint8ClampedArray(400) }, { current: new Uint8ClampedArray(800) }] };
  ok('累加各帧字节数', estimateSnapshotBytes(snap) === 1200, String(estimateSnapshotBytes(snap)));
  ok('空快照为 0', estimateSnapshotBytes(null) === 0 && estimateSnapshotBytes({}) === 0);
  ok('帧缺数据算 0（不崩）', estimateSnapshotBytes({ frames: [{}, { data: null }] }) === 0);
  ok('frames 非数组算 0', estimateSnapshotBytes({ frames: 'x' }) === 0);
}
{
  // 真实规模的量级检查：1600x1600 RGBA ≈ 10MB/帧，20 层会爆内存 -> 必须靠 maxBytes 兜
  const oneFrame = new Uint8ClampedArray(1600 * 1600 * 4);
  const h = createHistory({ limit: 99, maxBytes: 32 * 1024 * 1024, estimate: estimateSnapshotBytes });
  for (let i = 0; i < 10; i++) h.push({ frames: [{ data: oneFrame }] });
  ok('大图场景下被字节上限挡住（不会无限涨）', h.byteSize() <= 32 * 1024 * 1024, 'bytes=' + h.byteSize());
  ok('大图场景仍能撤销', h.canUndo());
}
