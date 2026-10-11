import { ok } from './_harness.mjs';
import { planSheet, sheetFrames, sheetMetadata, sheetSummary, SAFE_TEXTURE_EDGE } from '../src/shared/spritesheet.js';

// ---------- planSheet：网格必须装得下所有帧 ----------
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12, 22, 40, 100]) {
  const p = planSheet(n, 64, 64);
  ok(`${n} 帧：网格容量 >= 帧数`, p.cols * p.rows >= n, `${p.cols}x${p.rows}=${p.cols * p.rows} < ${n}`);
  ok(`${n} 帧：行数正确（末行不空行）`, p.rows === Math.ceil(n / p.cols), `rows=${p.rows} cols=${p.cols}`);
  ok(`${n} 帧：图片尺寸 = 网格 × 单元`, p.width === p.cols * 64 && p.height === p.rows * 64, JSON.stringify(p));
}
ok('单帧就是 1x1', (() => { const p = planSheet(1, 32, 32); return p.cols === 1 && p.rows === 1; })());
ok('2 帧排成 1x2（此时最接近方形）', (() => { const p = planSheet(2, 64, 64); return p.cols === 1 && p.rows === 2 && p.width === 64 && p.height === 128; })());
ok('4 帧排成 2x2', (() => { const p = planSheet(4, 64, 64); return p.cols === 2 && p.rows === 2; })());
ok('16 帧排成 4x4', (() => { const p = planSheet(16, 64, 64); return p.cols === 4 && p.rows === 4; })());
{
  // 关键：网格要**接近正方形**，不能是细长条（长条对纹理采样不友好）
  const bad = [];
  for (const n of [3, 4, 8, 9, 16, 22, 40]) {
    const p = planSheet(n, 64, 64);
    const ratio = p.width / p.height;
    // 允许 0.6~1.7：手算过几个值，这是"接近方形"的合理范围
    if (ratio < 0.6 || ratio > 1.7) bad.push(`${n}->${ratio.toFixed(2)}`);
  }
  ok('网格整体接近正方形（不是细长条）', bad.length === 0, bad.join(','));
}
ok('非正方形单元也按宽高比选网格', (() => {
  const p = planSheet(6, 128, 32);   // 很扁的单元
  return p.cols * p.rows >= 6 && p.width >= 128 && p.height >= 32;
})());
ok('0 帧按 1 帧算（不产生 0 尺寸图）', (() => { const p = planSheet(0, 32, 32); return p.cols >= 1 && p.rows >= 1 && p.count === 1; })());
ok('非法输入安全', (() => { const p = planSheet(null, null, null); return p.width >= 1 && p.height >= 1; })());
{
  // 超大图要能标记出来（很多引擎有纹理上限）
  const big = planSheet(400, 512, 512);
  ok('超大 sheet 被标记 oversized', big.oversized === true, JSON.stringify({ w: big.width, h: big.height }));
  const small = planSheet(4, 64, 64);
  ok('正常尺寸不标记', small.oversized === false);
}
ok('可自定义纹理上限', (() => { const p = planSheet(100, 64, 64, { maxEdge: 256 }); return p.oversized === true; })());

// ---------- sheetFrames：坐标必须行优先且不重叠 ----------
{
  const p = planSheet(6, 64, 64);
  const fr = sheetFrames(6, 64, 64, p.cols, p.rows);
  ok('帧数正确', fr.length === 6, 'n=' + fr.length);
  ok('行优先排列（第 2 帧在第 1 帧右边）', fr[0].x === 0 && fr[1].x === 64, JSON.stringify(fr.slice(0, 2)));
  ok('换行时 x 归零、y 增加', fr[2].x === 0 && fr[2].y === 64, JSON.stringify(fr[2]));
  ok('每帧尺寸一致', fr.every((f) => f.w === 64 && f.h === 64));
  ok('没有越界（x+w <= 图宽）', fr.every((f) => f.x + f.w <= p.width), `maxX=${Math.max(...fr.map((f) => f.x + f.w))} width=${p.width}`);
  ok('没有越界（y+h <= 图高）', fr.every((f) => f.y + f.h <= p.height), `maxY=${Math.max(...fr.map((f) => f.y + f.h))} height=${p.height}`);
  // 关键：矩形互不重叠（否则拼图会互相覆盖）
  const seen = new Set();
  let dup = 0;
  for (const f of fr) { const k = f.x + ',' + f.y; if (seen.has(k)) dup++; seen.add(k); }
  ok('所有帧位置互不重叠', dup === 0, 'dup=' + dup);
}
ok('0 帧返回空列表', sheetFrames(0, 32, 32, 1, 1).length === 0);
ok('非法输入安全', sheetFrames(null, null, null, null, null).length === 0);

// ---------- sheetMetadata ----------
{
  const p = planSheet(3, 32, 48);
  const fr = sheetFrames(3, 32, 48, p.cols, p.rows);
  const meta = sheetMetadata(fr, {
    name: '小蓝机器人', image: 'sheet.png',
    sheetWidth: p.width, sheetHeight: p.height, cols: p.cols, rows: p.rows,
    durations: [100, 120, 200],
  });
  ok('带格式标识（引擎据此识别）', meta.format === 'desktop-pet-maker/sprite-sheet@1', meta.format);
  ok('带宠物名', meta.name === '小蓝机器人');
  ok('带图片文件名', meta.image === 'sheet.png');
  ok('带整图尺寸与网格', meta.sheet.width === p.width && meta.sheet.cols === p.cols, JSON.stringify(meta.sheet));
  ok('带单元尺寸', meta.cell.width === 32 && meta.cell.height === 48, JSON.stringify(meta.cell));
  ok('帧数正确', meta.frames.length === 3);
  ok('每帧带坐标与时长', meta.frames.every((f) => typeof f.x === 'number' && typeof f.ms === 'number'));
  ok('时长原样保留（每帧可不同）', meta.frames.map((f) => f.ms).join(',') === '100,120,200', meta.frames.map((f) => f.ms).join(','));
  ok('总时长累加正确', meta.totalMs === 420, 'total=' + meta.totalMs);
  ok('带使用说明（接手的人不看文档也能懂）', typeof meta.note === 'string' && meta.note.includes('像素'), meta.note);
}
ok('缺 durations 时给默认 100ms', (() => { const m = sheetMetadata([{ x: 0, y: 0, w: 8, h: 8 }], {}); return m.frames[0].ms === 100; })());
ok('时长非法时被兜到 >=16ms', (() => { const m = sheetMetadata([{ x: 0, y: 0, w: 8, h: 8 }], { durations: [0] }); return m.frames[0].ms >= 16; })());
ok('空帧列表安全', (() => { const m = sheetMetadata([], {}); return m.frames.length === 0 && m.totalMs === 0; })());
ok('null 安全', (() => { const m = sheetMetadata(null, null); return Array.isArray(m.frames) && m.frames.length === 0; })());

// ---------- sheetSummary（导出前给用户交代清楚）----------
{
  const p = planSheet(6, 64, 64);
  const s = sheetSummary(p);
  ok('摘要含帧数与网格', s.includes('6 帧') && s.includes('2×3'), s);
  ok('摘要含图片尺寸', s.includes('128×192'), s);
}
ok('超大时摘要给出警告', (() => { const p = planSheet(400, 512, 512); return sheetSummary(p).includes('超'); })(), sheetSummary(planSheet(400, 512, 512)));
ok('空计划摘要可读', sheetSummary(null).includes('没有'));
ok('纹理上限常量合理', SAFE_TEXTURE_EDGE >= 2048 && SAFE_TEXTURE_EDGE <= 8192, String(SAFE_TEXTURE_EDGE));
