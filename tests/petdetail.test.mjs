import { ok } from './_harness.mjs';
import { humanBytes, humanTime, detailRows, detailSummary } from '../src/shared/petdetail.js';

// ---------- humanBytes ----------
{
  ok('0 字节', humanBytes(0) === '0 B', humanBytes(0));
  ok('小于 1KB 显示 B', humanBytes(500) === '500 B', humanBytes(500));
  ok('KB 取整', humanBytes(1536) === '2 KB', humanBytes(1536));
  ok('MB 保留一位', humanBytes(1536000) === '1.5 MB', humanBytes(1536000));
  ok('大文件仍是 MB', /MB$/.test(humanBytes(500 * 1024 * 1024)), humanBytes(500 * 1024 * 1024));
  ok('非法值给占位符（不显示 NaN）', humanBytes(NaN) === '—' && humanBytes(-5) === '—' && humanBytes('x') === '—', 'bad');
}

// ---------- humanTime ----------
{
  ok('ISO 转人话（到分钟）', humanTime('2026-02-01T03:04:05.000Z') === '2026-02-01 03:04', humanTime('2026-02-01T03:04:05.000Z'));
  ok('时间戳可用', /2026-02-01/.test(humanTime(Date.parse('2026-02-01T00:00:00.000Z'))), humanTime(Date.parse('2026-02-01T00:00:00.000Z')));
  ok('空值返回空串', humanTime('') === '' && humanTime(null) === '', 'empty');
  ok('坏值返回空串（不显示 Invalid Date）', humanTime('not-a-date') === '', humanTime('not-a-date'));
}

// ---------- detailRows ----------
{
  const rows = detailRows({ name: '小猫', author: '我', frames: 12, size: 1536000, builtin: false });
  const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  ok('含名字', map['名字'] === '小猫', JSON.stringify(map));
  ok('含作者', map['作者'] === '我', JSON.stringify(map));
  ok('含帧数', map['帧数'] === '12 帧', JSON.stringify(map));
  ok('含文件大小（人话）', map['文件大小'] === '1.5 MB', JSON.stringify(map));
  ok('含来源（自己装的）', map['来源'] === '自己装的', JSON.stringify(map));
}
{
  // ★ 缺字段不能显示 undefined / 空行
  const rows = detailRows({ name: '只有名字' });
  ok('只给有值的行', rows.length === 2, JSON.stringify(rows));
  ok('没有 undefined 字样', !JSON.stringify(rows).includes('undefined'), JSON.stringify(rows));
  ok('没有 null 字样', !JSON.stringify(rows).includes('null'), JSON.stringify(rows));
  ok('每行都有 label 和 value', rows.every((r) => r.label && r.value), JSON.stringify(rows));
}
{
  // 内置宠物要标出来
  const rows = detailRows({ name: '内置猫', builtin: true, frames: 6, size: 1024 });
  const src = rows.find((r) => r.label === '来源');
  ok('内置宠物标为内置', src && src.value.includes('内置'), JSON.stringify(src));
}
{
  // 损坏的包要明确说清楚（而不是只显示名字）
  const rows = detailRows({ name: '坏包', broken: true, error: '缺少 pet.json' });
  const st = rows.find((r) => r.label === '状态');
  ok('损坏包有状态行', !!st && st.value.includes('损坏'), JSON.stringify(rows));
  ok('损坏状态是 warn 色调', st && st.tone === 'warn', JSON.stringify(st));
  ok('损坏包带出原因', rows.some((r) => r.label === '原因' && r.value === '缺少 pet.json'), JSON.stringify(rows));
}
{
  // 额外信息（版本 / 画布 / 片段 / 分组）
  const rows = detailRows({ name: 'x', frames: 3, size: 2048 }, {
    clips: 2, canvas: { width: 256, height: 128 }, version: '第 2 版', groups: ['工作', '表情包'],
  });
  const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  ok('含动作片段数', map['动作片段'] === '2 段', JSON.stringify(map));
  ok('含画布尺寸', map['画布'] === '256 × 128', JSON.stringify(map));
  ok('含版本', map['版本'] === '第 2 版', JSON.stringify(map));
  ok('含分组（顿号连接）', map['分组'] === '工作、表情包', JSON.stringify(map));
}
{
  // 边界：0 帧 / 0 片段 / 0 画布都不该显示（0 没有信息量）
  const rows = detailRows({ name: 'x', frames: 0, size: 100 }, { clips: 0, canvas: { width: 0, height: 0 } });
  ok('0 帧不显示', !rows.some((r) => r.label === '帧数'), JSON.stringify(rows));
  ok('0 片段不显示', !rows.some((r) => r.label === '动作片段'), JSON.stringify(rows));
  ok('0 画布不显示', !rows.some((r) => r.label === '画布'), JSON.stringify(rows));
}
{
  ok('null 不崩', Array.isArray(detailRows(null)), 'null');
  ok('字符串不崩', Array.isArray(detailRows('x')), 'str');
  ok('extra 为 null 不崩', Array.isArray(detailRows({ name: 'x' }, null)), 'extra');
  ok('空白名字不产生空行', !detailRows({ name: '   ' }).some((r) => r.label === '名字'), 'blank');
}

// ---------- detailSummary ----------
{
  const s = detailSummary({ frames: 12, size: 1536000, builtin: false }, { clips: 2 });
  ok('概括含帧数', s.includes('12 帧'), s);
  ok('概括含片段数', s.includes('2 段动作'), s);
  ok('概括含体积', s.includes('1.5 MB'), s);
  ok('概括用 · 连接', s.includes(' · '), s);
}
{
  ok('内置宠物概括里带"内置"', detailSummary({ frames: 6, size: 1024, builtin: true }).includes('内置'), detailSummary({ frames: 6, size: 1024, builtin: true }));
  ok('损坏宠物给明确说法', detailSummary({ broken: true }).includes('损坏'), detailSummary({ broken: true }));
  ok('什么都没有时给兜底文案', detailSummary({}).length > 0, detailSummary({}));
  ok('null 不崩', typeof detailSummary(null) === 'string' && detailSummary(null).length > 0, detailSummary(null));
}
