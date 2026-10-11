import { ok } from './_harness.mjs';
import {
  fitGifSize, unifyGifCanvas, pickFrames, planBulkGif, bulkGifSummary,
  GIF_MAX_EDGE, GIF_MAX_FRAMES, BULK_GIF_MAX_PETS,
} from '../src/shared/bulkgif.js';

const mk = (id, name, w, h, nf = 3, extra = {}) => ({ id, name, width: w, height: h, frames: Array.from({ length: nf }, (_, i) => i), ...extra });

// ---------- fitGifSize ----------
{
  const s = fitGifSize(1600, 900);
  ok('大图被缩到最长边上限', Math.max(s.w, s.h) === GIF_MAX_EDGE, JSON.stringify(s));
  ok('缩放过标记 scaled', s.scaled === true);
  ok('保持宽高比', Math.abs(s.w / s.h - 1600 / 900) < 0.05, JSON.stringify(s));
}
{
  const s = fitGifSize(100, 80);
  ok('小图不放大', s.w === 100 && s.h === 80);
  ok('未缩放时 scaled=false', s.scaled === false);
}
ok('竖图按最长边缩', (() => { const s = fitGifSize(300, 1500); return s.h === GIF_MAX_EDGE; })(), JSON.stringify(fitGifSize(300, 1500)));
ok('极端扁图不产生 0 尺寸', (() => { const s = fitGifSize(5000, 1); return s.w >= 1 && s.h >= 1; })());
ok('0 尺寸输入安全', (() => { const s = fitGifSize(0, 0); return s.w >= 1 && s.h >= 1; })());
ok('非法输入安全', fitGifSize(null, null).w >= 1 && fitGifSize('x', 'y').h >= 1);
ok('自定义上限生效', fitGifSize(1000, 500, 100).w === 100);
ok('上限过小被抬到 16（避免产出 0 尺寸）', fitGifSize(1000, 500, 1).w === 16);

// ---------- unifyGifCanvas：所有宠物必须同一画布 ----------
{
  const c = unifyGifCanvas([mk('a', 'A', 1600, 900), mk('b', 'B', 64, 64)]);
  ok('统一画布取各只缩放后的最大尺寸', c.w === 320 && c.h === 180, JSON.stringify(c));
  ok('统一画布自身不超上限', Math.max(c.w, c.h) <= GIF_MAX_EDGE);
}
{
  const c = unifyGifCanvas([mk('a', 'A', 64, 64), mk('b', 'B', 32, 32)]);
  ok('小图之间取最大者（不放大）', c.w === 64 && c.h === 64, JSON.stringify(c));
}
ok('空列表返回 1x1（不用 0 尺寸给 canvas）', (() => { const c = unifyGifCanvas([]); return c.w === 1 && c.h === 1; })());
ok('null 列表安全', unifyGifCanvas(null).w === 1);
ok('含非法项时不崩', typeof unifyGifCanvas([null, { }]).w === 'number');

// ---------- pickFrames：均匀抽稀而不是只取前 N ----------
{
  const src = Array.from({ length: 100 }, (_, i) => i);
  const got = pickFrames(src, 5);
  ok('抽稀后帧数正确', got.length === 5, 'n=' + got.length);
  ok('一定包含首帧', got[0] === 0, String(got[0]));
  ok('一定包含末帧（否则循环会跳）', got[got.length - 1] === 99, String(got[got.length - 1]));
  ok('是均匀采样而不是取前 5 个', got.join(',') !== '0,1,2,3,4', got.join(','));
  ok('结果单调递增（顺序不乱）', got.every((v, i) => i === 0 || v > got[i - 1]), got.join(','));
}
ok('帧数不超上限时原样返回', pickFrames([1, 2, 3], 10).length === 3);
ok('帧数正好等于上限时原样返回', pickFrames([1, 2, 3], 3).join(',') === '1,2,3');
ok('上限为 1 时安全（不除零）', (() => { const g = pickFrames([1, 2, 3, 4], 1); return g.length === 1 && g[0] === 1; })());
ok('空帧安全', pickFrames([], 5).length === 0 && pickFrames(null, 5).length === 0);
ok('单帧 + 大上限安全', pickFrames([9], 40).join(',') === '9');

// ---------- planBulkGif ----------
{
  const plan = planBulkGif([mk('a', '猫', 1600, 900, 3), mk('b', '狗', 64, 64, 2)]);
  ok('可导出', plan.ok === true);
  ok('每只宠物一个 GIF', plan.entries.length === 2, 'n=' + plan.entries.length);
  ok('输出名带 .gif', plan.entries.every((e) => e.outName.endsWith('.gif')));
  ok('带出统一画布', plan.canvas.w > 0 && plan.canvas.h > 0, JSON.stringify(plan.canvas));
  ok('统计总帧数', plan.totalFrames === 5, 'n=' + plan.totalFrames);
}
{
  const plan = planBulkGif([mk('a', '内置', 64, 64, 2, { builtin: true }), mk('b', '我的', 64, 64, 2)]);
  ok('默认跳过内置', plan.entries.length === 1 && plan.entries[0].name === '我的');
  ok('跳过项说明原因', plan.skipped.some((s) => s.reason.includes('内置')));
  const all = planBulkGif([mk('a', '内置', 64, 64, 2, { builtin: true }), mk('b', '我的', 64, 64, 2)], { includeBuiltin: true });
  ok('勾选后可含内置', all.entries.length === 2);
}
ok('损坏的被跳过', (() => { const p = planBulkGif([mk('a', '好', 64, 64), mk('b', '坏', 64, 64, 1, { broken: true })]); return p.entries.length === 1 && p.skipped.some((s) => s.reason.includes('损坏')); })());
ok('没有帧的被跳过', (() => { const p = planBulkGif([mk('a', '空', 64, 64, 0)]); return p.ok === false; })());
ok('空列表给出原因', planBulkGif([]).ok === false && planBulkGif([]).reason.includes('没有可导出'));
ok('null 输入安全', planBulkGif(null).ok === false);
{
  // 重名去重（zip/目录里不能互相覆盖）
  const p = planBulkGif([mk('a', '同名', 64, 64), mk('b', '同名', 64, 64), mk('c', '同名', 64, 64)]);
  const names = p.entries.map((e) => e.outName);
  ok('同名自动加序号', new Set(names).size === 3, names.join(','));
  ok('首个保持原名', names[0] === '同名.gif', names[0]);
}
{
  // 文件名非法字符要被清理（否则写盘会失败或越界）
  const p = planBulkGif([mk('a', 'a/b:c*d?e', 64, 64)]);
  ok('输出名不含路径分隔符', !p.entries[0].outName.includes('/') && !p.entries[0].outName.includes('\\'), p.entries[0].outName);
  ok('输出名不含非法字符', !/[<>:"|?*]/.test(p.entries[0].outName), p.entries[0].outName);
}
{
  // 帧数超限 -> 均匀抽稀，并标记 sampled
  const p = planBulkGif([mk('a', '长动画', 64, 64, 300)]);
  ok('帧数被限制到上限', p.entries[0].frameCount === GIF_MAX_FRAMES, 'n=' + p.entries[0].frameCount);
  ok('标记了已抽稀', p.entries[0].sampled === true);
  ok('保留了原始帧数（供界面说明）', p.entries[0].sourceFrames === 300);
}
{
  // 数量上限
  const many = Array.from({ length: BULK_GIF_MAX_PETS + 10 }, (_, i) => mk('p' + i, 'P' + i, 32, 32, 2));
  const p = planBulkGif(many);
  ok('一次导出数量被限制', p.entries.length === BULK_GIF_MAX_PETS, 'n=' + p.entries.length);
}
ok('缺 id 的条目被忽略', planBulkGif([{ name: '无id', width: 8, height: 8, frames: [1] }, mk('ok', '好的', 8, 8, 1)]).entries.length === 1);
ok('name 缺失时用 id 兜底', planBulkGif([{ id: 'zz', width: 8, height: 8, frames: [1] }]).entries[0].outName.startsWith('zz'));

// ---------- bulkGifSummary ----------
{
  const p = planBulkGif([mk('a', '猫', 1600, 900, 3), mk('b', '狗', 64, 64, 300)]);
  const s = bulkGifSummary(p);
  ok('摘要含宠物数量', s.includes('2 只'), s);
  ok('摘要含统一画布尺寸', s.includes('320×180'), s);
  ok('摘要含总帧数', /合计 \d+ 帧/.test(s), s);
  ok('有抽稀时摘要说明', s.includes('抽稀'), s);
}
ok('失败计划的摘要返回原因', bulkGifSummary({ ok: false, reason: '没有可导出的宠物' }) === '没有可导出的宠物');
ok('空输入摘要安全', typeof bulkGifSummary(null) === 'string');
