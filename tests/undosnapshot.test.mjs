import { ok } from './_harness.mjs';
import { readFileSync } from 'node:fs';

// 静态守护：每个「操作前记录」都必须配一个「操作后记录」。
//
// 背景（v0.9.36 实测踩到）：帧排序/删除/复制/拖拽这些走 applyFrameOp 的操作
// 只调了 recordUndo()（操作前），没调 recordUndoAfter()（操作后）。
// 后果不是"撤销坏了"，而是**重做跳到错误状态** ——
// 撤销看起来正常，一按重做顺序就乱了，比直接报错更难查。
//
// 快照栈要能双向走，必须同时有「操作前」和「操作后」两个状态：
//   撤销 = 回到操作前；重做 = 回到操作后。少一个，另一个方向就指向错的快照。
{
  const src = readFileSync('src/maker/maker.js', 'utf8');
  const lines = src.split(/\r?\n/);

  // 找每个 recordUndo() 调用点，看它后面（同一段逻辑内）有没有"操作后"记录。
  // 判定窗口 60 行：覆盖最长的处理函数（生成动画那段），又不至于跨函数误判。
  const WINDOW = 60;
  const missing = [];
  let sites = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/recordUndo\(\)\s*;/.test(lines[i])) continue;
    sites++;
    const seg = lines.slice(i, i + WINDOW).join('\n');
    // rebuildAll() 内部会调 recordUndoAfter()，所以走它的路径也算配齐
    if (/recordUndoAfter\(\)/.test(seg) || /rebuildAll\(\)/.test(seg)) continue;
    missing.push((i + 1) + ': ' + lines[i].trim());
  }
  ok('maker.js 里确实有 recordUndo 调用点', sites >= 8, 'n=' + sites);
  ok('每个 recordUndo() 都有配套的"操作后"记录（否则重做会跳错状态）',
    missing.length === 0, missing.join(' | '));
}

// 反向守护：applyFrameOp 是帧操作的共同出口，必须自己记"操作后"。
// （它不调 rebuildAll，所以上面那条窗口检测靠的是 recordUndoAfter。）
{
  const src = readFileSync('src/maker/maker.js', 'utf8');
  const m = src.match(/function applyFrameOp\(op\) \{[\s\S]*?\n\}/);
  ok('找到 applyFrameOp', !!m, 'missing');
  ok('applyFrameOp 内调了 recordUndoAfter', !!m && /recordUndoAfter\(\)/.test(m[0]), m ? m[0].slice(0, 400) : '');
}

// 守护：「清空所有帧」必须能重做 —— recordUndoAfter 不能因为"当前没帧"就早退。
{
  const src = readFileSync('src/maker/maker.js', 'utf8');
  const m = src.match(/function recordUndoAfter\(\) \{[\s\S]*?\n\}/);
  ok('找到 recordUndoAfter', !!m, 'missing');
  ok('recordUndoAfter 不因"当前没帧"而放弃记录（清空要能重做）',
    !!m && !/if \(!state\.frames\.length\) return;/.test(m[0]), m ? m[0] : '');
}

// 守护：makerkeys 的排序动作必须在 maker.js 里真的有 case（不能只写在纯函数里）
{
  const keys = readFileSync('src/shared/makerkeys.js', 'utf8');
  const maker = readFileSync('src/maker/maker.js', 'utf8');
  for (const a of ['moveFrameLeft', 'moveFrameRight']) {
    ok('makerkeys 定义了动作 ' + a, keys.includes("'" + a + "'"), 'keys');
    ok('maker.js 实现了 ' + a + ' 的 case', maker.includes("case '" + a + "':"), 'maker');
  }
}
