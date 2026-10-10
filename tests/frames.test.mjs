import { ok } from './_harness.mjs';
import { removeFrame, duplicateFrame, moveFrame, shiftFrame, uniqueFrameName } from '../src/shared/frames.js';

const F = ['a', 'b', 'c', 'd'].map((n) => ({ name: n }));
const names = (r) => r.frames.map((f) => f.name).join(',');

// ---------- removeFrame ----------
ok('删除中间帧', names(removeFrame(F, 0, 1)) === 'a,c,d', names(removeFrame(F, 0, 1)));
ok('删除首帧', names(removeFrame(F, 0, 0)) === 'b,c,d');
ok('删除末帧', names(removeFrame(F, 0, 3)) === 'a,b,c');
{
  // 删掉的帧在当前位置之前 -> 索引要前移，否则会"跳过一帧"
  const r = removeFrame(F, 2, 0);
  ok('删除当前帧之前的帧 -> 索引前移', r.activeIdx === 1, 'active=' + r.activeIdx);
  // 注意：必须用**返回的新数组**去索引。用旧数组 F 索引会读到别的帧（我一开始就这么写错了）。
  ok('前移后仍指向原来那帧（c）', r.frames[r.activeIdx].name === 'c', r.frames[r.activeIdx].name);
}
{
  // 删掉的正是当前帧 -> 停在原位置（后面那帧顶上来），不越界
  const r = removeFrame(F, 2, 2);
  ok('删除当前帧 -> 索引保持', r.activeIdx === 2, 'active=' + r.activeIdx);
  ok('停在顶上来那帧（d）', r.frames[r.activeIdx].name === 'd', r.frames[r.activeIdx].name);
}
{
  // 删最后一帧且当前是最后一帧 -> 索引要退回，不能越界（否则预览 undefined 白屏）
  const r = removeFrame(F, 3, 3);
  ok('删末帧后索引不越界', r.activeIdx === 2, 'active=' + r.activeIdx);
  ok('索引指向新的末帧', r.frames[r.activeIdx].name === 'c');
}
ok('删到只剩 0 帧时索引归零', removeFrame([{ name: 'x' }], 0, 0).activeIdx === 0);
ok('空数组安全', removeFrame([], 0, 0).frames.length === 0 && removeFrame(null, 0, 0).activeIdx === 0);
ok('越界下标被夹住（不崩）', names(removeFrame(F, 0, 99)) === 'a,b,c' && names(removeFrame(F, 0, -3)) === 'b,c,d');
ok('不改原数组（纯函数）', F.length === 4 && F[0].name === 'a');

// ---------- duplicateFrame ----------
{
  const r = duplicateFrame(F, 1, 1, (f) => ({ name: f.name + "'" }));
  ok('复制帧插在原帧后面', names(r) === "a,b,b',c,d", names(r));
  ok('复制后停在新帧上（便于立刻调整）', r.activeIdx === 2, 'active=' + r.activeIdx);
  ok('新帧确实是克隆（不是同一引用）', r.frames[1] !== r.frames[2]);
}
ok('不传 clone 时退化为共享引用（调用方可控）', (() => {
  const r = duplicateFrame(F, 0, 0);
  return r.frames[0] === r.frames[1];
})());
ok('复制末帧不越界', (() => { const r = duplicateFrame(F, 3, 3, (f) => ({ name: f.name })); return r.activeIdx === 4 && r.frames.length === 5; })());
ok('空数组复制安全', duplicateFrame([], 0, 0).frames.length === 0 && duplicateFrame(null, 0, 0).activeIdx === 0);
ok('复制不改原数组', F.length === 4);

// ---------- moveFrame（排序）----------
ok('把首帧移到末尾', names(moveFrame(F, 0, 0, 3)) === 'b,c,d,a', names(moveFrame(F, 0, 0, 3)));
ok('把末帧移到开头', names(moveFrame(F, 0, 3, 0)) === 'd,a,b,c');
ok('中间往前移', names(moveFrame(F, 0, 2, 1)) === 'a,c,b,d');
ok('中间往后移', names(moveFrame(F, 0, 1, 2)) === 'a,c,b,d');
ok('原地移动不变', names(moveFrame(F, 1, 2, 2)) === 'a,b,c,d' && moveFrame(F, 1, 2, 2).activeIdx === 1);
{
  // 被移动的帧是当前帧 -> 索引跟着它走
  const r = moveFrame(F, 0, 0, 2);
  ok('移动当前帧时索引跟随', r.activeIdx === 2, 'active=' + r.activeIdx);
  ok('跟随的确实是那一帧（a）', r.frames[r.activeIdx].name === 'a', r.frames[r.activeIdx].name);
}
{
  // 当前帧没被移动，但目标位置跨过了它 -> 索引要相应修正
  const r = moveFrame(F, 2, 3, 0);   // 当前是 c(2)，把 d(3) 移到最前
  ok('别的帧跨过当前帧时索引修正', r.frames[r.activeIdx].name === 'c', `active=${r.activeIdx} -> ${r.frames[r.activeIdx].name}`);
}
ok('单帧时移动安全', names(moveFrame([{ name: 'x' }], 0, 0, 0)) === 'x');
ok('空数组安全', moveFrame([], 0, 0, 1).frames.length === 0 && moveFrame(null, 0, 0, 1).activeIdx === 0);
ok('越界目标被夹住', names(moveFrame(F, 0, 0, 99)) === 'b,c,d,a');
ok('移动不改原数组', F.length === 4);
{
  // 移动后**不能丢帧也不能多帧**（最容易犯的错）
  for (let from = 0; from < 4; from++) {
    for (let to = 0; to < 4; to++) {
      const r = moveFrame(F, 0, from, to);
      if (r.frames.length !== 4) { ok(`移动 ${from}->${to} 不丢帧`, false, 'len=' + r.frames.length); }
      if (new Set(r.frames.map((f) => f.name)).size !== 4) { ok(`移动 ${from}->${to} 不重帧`, false, names(r)); }
    }
  }
  ok('所有 from/to 组合都不丢帧不重帧', true);
}

// ---------- shiftFrame（上移/下移按钮）----------
ok('下移一位', names(shiftFrame(F, 1, 1, 1)) === 'a,c,b,d');
ok('上移一位', names(shiftFrame(F, 1, 1, -1)) === 'b,a,c,d');
ok('首帧上移不动（越界保护）', names(shiftFrame(F, 0, 0, -1)) === 'a,b,c,d');
ok('末帧下移不动', names(shiftFrame(F, 3, 3, 1)) === 'a,b,c,d');
ok('shiftFrame 会跟随当前帧', shiftFrame(F, 1, 1, 1).activeIdx === 2);
ok('单帧 shift 安全', names(shiftFrame([{ name: 'x' }], 0, 0, 1)) === 'x');
ok('空数组 shift 安全', shiftFrame([], 0, 0, 1).frames.length === 0);

// ---------- uniqueFrameName ----------
ok('无冲突时用原名', uniqueFrameName([], 'frame', '.png') === 'frame.png');
ok('重名时自动加序号', uniqueFrameName([{ name: 'frame.png' }], 'frame', '.png') === 'frame_2.png');
ok('多个重名继续往后找', uniqueFrameName([{ name: 'frame.png' }, { name: 'frame_2.png' }], 'frame', '.png') === 'frame_3.png');
ok('带扩展名的 base 会被去掉再拼', uniqueFrameName([], 'photo.jpg', '.png') === 'photo.png');
ok('已有的空名字不影响（不崩）', uniqueFrameName([{ name: '' }, null], 'x', '.png') === 'x.png');
ok('非数组输入安全', uniqueFrameName(null, 'x', '.png') === 'x.png');
ok('同一批生成的多个名字互不相同', (() => {
  const used = [];
  for (let i = 0; i < 5; i++) { const n = uniqueFrameName(used.map((x) => ({ name: x })), 'f', '.png'); used.push(n); }
  return new Set(used).size === 5;
})(), '5 个名字应各不相同');
