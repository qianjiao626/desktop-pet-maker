import { ok } from './_harness.mjs';
import { planExport, exportReadme, formatBytes, BULK_LIMIT_BYTES } from '../src/shared/bulkexport.js';

const mk = (id, name, size = 1000, extra = {}) => ({ id, name, size, ...extra });

// ---------- planExport 基本 ----------
{
  const r = planExport([mk('a', '猫'), mk('b', '狗')]);
  ok('能导出普通宠物', r.ok === true && r.entries.length === 2, JSON.stringify(r.entries.map((e) => e.outName)));
  ok('输出名带 .petpack', r.entries.every((e) => e.outName.endsWith('.petpack')));
  ok('保留了来源 id（导出时要用它取文件）', r.entries.every((e) => typeof e.sourceId === 'string' && e.sourceId));
}
ok('空库给出明确原因', planExport([]).ok === false && planExport([]).reason.includes('没有可导出'));
ok('null 输入安全', planExport(null).ok === false && planExport(null).entries.length === 0);

// ---------- 内置宠物默认不导出（否则体积白涨）----------
{
  const items = [mk('a', '内置龙', 1000, { builtin: true }), mk('b', '我的猫')];
  const def = planExport(items);
  ok('默认跳过内置宠物', def.entries.length === 1 && def.entries[0].name === '我的猫', JSON.stringify(def.entries.map((e) => e.name)));
  ok('跳过项里说明了原因', def.skipped.some((s) => s.reason.includes('内置')), JSON.stringify(def.skipped));
  const all = planExport(items, { includeBuiltin: true });
  ok('勾选后可包含内置宠物', all.entries.length === 2, 'n=' + all.entries.length);
}

// ---------- 损坏的宠物要跳过（导出它没有意义）----------
{
  const r = planExport([mk('a', '好的'), mk('b', '坏的', 1000, { broken: true })]);
  ok('跳过损坏宠物', r.entries.length === 1 && r.entries[0].name === '好的');
  ok('跳过原因可读', r.skipped.some((s) => s.reason.includes('损坏')));
  ok('损坏宠物不影响整体导出', r.ok === true);
}

// ---------- 重名去重（不同目录可能有同名宠物）----------
{
  const r = planExport([mk('a', '同名'), mk('b', '同名'), mk('c', '同名')]);
  const names = r.entries.map((e) => e.outName);
  ok('重名自动加序号', new Set(names).size === 3, names.join(','));
  ok('首个保持原名', names[0] === '同名.petpack', names[0]);
  ok('后续带序号', names[1] === '同名_2.petpack' && names[2] === '同名_3.petpack', names.join(','));
}
{
  // 名字里的非法文件名要安全化（否则 zip 条目名会带路径分隔符）
  const r = planExport([mk('a', 'a/b:c*d')]);
  ok('输出名不含路径分隔符', !r.entries[0].outName.includes('/') && !r.entries[0].outName.includes('\\'), r.entries[0].outName);
  ok('输出名不含 Windows 非法字符', !/[<>:"|?*]/.test(r.entries[0].outName), r.entries[0].outName);
}
ok('缺 id 的条目被忽略', planExport([{ name: '无 id', size: 1 }, mk('ok', '好的')]).entries.length === 1);
ok('name 缺失时用 id 兜底', planExport([{ id: 'x.petpack', size: 1 }]).entries[0].outName.length > 0);

// ---------- 体积统计与上限 ----------
{
  const r = planExport([mk('a', '甲', 1000), mk('b', '乙', 2000)]);
  ok('总大小累加正确', r.totalBytes === 3000, String(r.totalBytes));
}
{
  const huge = planExport([mk('a', '巨大', BULK_LIMIT_BYTES + 1)]);
  ok('超过上限时不放行', huge.ok === false);
  ok('超限原因里给出实际体积', huge.reason.includes('MB'), huge.reason);
  ok('超限原因里给出建议（分批/取消内置）', /分批|内置/.test(huge.reason), huge.reason);
}
ok('恰好等于上限算通过（边界）', planExport([mk('a', '刚好', BULK_LIMIT_BYTES)]).ok === true);
ok('size 缺失按 0 算（不崩）', planExport([{ id: 'a', name: 'x' }]).totalBytes === 0);

// ---------- exportReadme ----------
{
  const entries = [{ name: '猫', outName: '猫.petpack' }, { name: '狗', outName: '狗.petpack' }];
  const txt = exportReadme(entries, { when: '2026-01-02 03:04:05' });
  ok('说明里写了数量', txt.includes('2 只'), txt.split('\n')[3]);
  ok('说明里写了时间', txt.includes('2026-01-02 03:04:05'));
  ok('说明里教了怎么用（拖进窗口）', txt.includes('拖进窗口'), '');
  ok('说明里列了每只宠物的文件名', txt.includes('猫.petpack') && txt.includes('狗.petpack'));
  ok('说明里给出安装入口（宠物库）', txt.includes('宠物库'));
}
ok('空列表也能生成说明（不崩）', typeof exportReadme([], {}) === 'string');
ok('null 列表安全', typeof exportReadme(null, {}) === 'string');
ok('缺 when 时用当前时间（不崩）', exportReadme([{ name: 'a', outName: 'a.petpack' }]).includes('导出时间'));

// ---------- formatBytes ----------
ok('B 级', formatBytes(512) === '512 B', formatBytes(512));
ok('KB 级', formatBytes(2048) === '2.0 KB', formatBytes(2048));
ok('MB 级', formatBytes(5 * 1048576) === '5.0 MB', formatBytes(5 * 1048576));
ok('GB 级', formatBytes(2 * 1073741824) === '2.00 GB', formatBytes(2 * 1073741824));
ok('0 安全', formatBytes(0) === '0 B');
ok('负数安全（不产出 -1 B）', formatBytes(-100) === '0 B');
ok('非法输入安全', formatBytes(null) === '0 B' && formatBytes('x') === '0 B');
