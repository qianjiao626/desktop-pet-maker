import { ok } from './_harness.mjs';
import { safePart, unknownPlaceholders, expandTemplate, planNames, templateHelp, PLACEHOLDERS } from '../src/shared/nametemplate.js';

// ---------- safePart：文件名必须跨平台合法 ----------
{
  ok('空值给兜底', safePart('') === 'pet' && safePart(null) === 'pet', 'empty');
  ok('Windows 禁用字符被替换', !/[<>:"/\\|?*]/.test(safePart('a<b>c:d"e/f\\g|h?i*j')), safePart('a<b>c:d"e/f\\g|h?i*j'));
  ok('控制字符被清掉', !/[\u0000-\u001f]/.test(safePart('a\u0000b\u001fc')), JSON.stringify(safePart('a\u0000b\u001fc')));
  ok('首尾的点被去掉（Windows 不允许）', safePart('...name...') === 'name', safePart('...name...'));
  ok('首尾空格被去掉', safePart('  name  ') === 'name', JSON.stringify(safePart('  name  ')));
  ok('超长被截断', Array.from(safePart('字'.repeat(200), 20)).length === 20, String(Array.from(safePart('字'.repeat(200), 20)).length));
  ok('保留设备名被避开（CON）', safePart('CON') !== 'CON', safePart('CON'));
  ok('保留设备名大小写都避开', safePart('nul') !== 'nul' && safePart('Com1') !== 'Com1', safePart('Com1'));
  ok('普通名字不变', safePart('小蓝机器人') === '小蓝机器人', safePart('小蓝机器人'));
}

// ---------- unknownPlaceholders ----------
{
  ok('全部认识时返回空', unknownPlaceholders('{name}_{n}_{date}').length === 0, JSON.stringify(unknownPlaceholders('{name}_{n}_{date}')));
  ok('能找出拼错的', unknownPlaceholders('{nmae}').includes('nmae'), JSON.stringify(unknownPlaceholders('{nmae}')));
  ok('带格式的也能认（{n:03}）', unknownPlaceholders('{n:03}').length === 0, JSON.stringify(unknownPlaceholders('{n:03}')));
  ok('大小写不敏感', unknownPlaceholders('{NAME}').length === 0, JSON.stringify(unknownPlaceholders('{NAME}')));
  ok('去重', unknownPlaceholders('{zzz}_{zzz}').length === 1, JSON.stringify(unknownPlaceholders('{zzz}_{zzz}')));
  ok('没有占位符返回空', unknownPlaceholders('普通名字').length === 0, 'none');
  ok('null 不崩', Array.isArray(unknownPlaceholders(null)), 'null');
}

// ---------- expandTemplate ----------
{
  ok('{name} 展开', expandTemplate('{name}', { name: '小猫', ext: 'petpack' }) === '小猫.petpack', expandTemplate('{name}', { name: '小猫', ext: 'petpack' }));
  ok('{n} 从 1 开始', expandTemplate('{name}_{n}', { name: 'x', n: 1 }) === 'x_1.petpack', expandTemplate('{name}_{n}', { name: 'x', n: 1 }));
  ok('{n:03} 补零', expandTemplate('{n:03}', { name: 'x', n: 7 }) === '007.petpack', expandTemplate('{n:03}', { name: 'x', n: 7 }));
  ok('{n:02} 补零', expandTemplate('{name}_{n:02}', { name: 'x', n: 3 }) === 'x_03.petpack', expandTemplate('{name}_{n:02}', { name: 'x', n: 3 }));
  ok('补零宽度小于位数时不截断', expandTemplate('{n:02}', { name: 'x', n: 123 }) === '123.petpack', expandTemplate('{n:02}', { name: 'x', n: 123 }));
  ok('{date} 展开', expandTemplate('{date}_{name}', { name: 'x', date: '2026-10-12' }) === '2026-10-12_x.petpack', expandTemplate('{date}_{name}', { name: 'x', date: '2026-10-12' }));
  ok('{time} 展开', expandTemplate('{time}', { name: 'x', time: '09-30' }) === '09-30.petpack', expandTemplate('{time}', { name: 'x', time: '09-30' }));
  ok('{author} 展开', expandTemplate('{author}_{name}', { name: 'x', author: '阿梁' }) === '阿梁_x.petpack', expandTemplate('{author}_{name}', { name: 'x', author: '阿梁' }));
  ok('{ext} 可用', expandTemplate('{name}.{ext}', { name: 'x', ext: 'zip' }) === 'x.zip', expandTemplate('{name}.{ext}', { name: 'x', ext: 'zip' }));
}
{
  // ★ 不认识的占位符要原样保留（而不是静默变空）
  const r = expandTemplate('{name}_{nmae}', { name: 'x' });
  ok('未知占位符原样保留', r.includes('nmae'), r);
  ok('未知占位符不会变成空串', !r.startsWith('_'), r);
}
{
  ok('空模板退化为名字', expandTemplate('', { name: '小猫' }) === '小猫.petpack', expandTemplate('', { name: '小猫' }));
  ok('全空白模板也退化', expandTemplate('   ', { name: '小猫' }) === '小猫.petpack', expandTemplate('   ', { name: '小猫' }));
  ok('null 模板不崩', expandTemplate(null, { name: 'x' }) === 'x.petpack', expandTemplate(null, { name: 'x' }));
  ok('ctx 为 null 不崩', /petpack$/.test(expandTemplate('{name}', null)), expandTemplate('{name}', null));
}
{
  // 宠物名里的非法字符要被清理，但扩展名不能被误伤
  const r = expandTemplate('{name}', { name: 'a/b:c', ext: 'petpack' });
  ok('名字里的斜杠被清理', !r.includes('/'), r);
  ok('扩展名仍然是 petpack', r.endsWith('.petpack'), r);
  ok('没有产生双扩展名', (r.match(/\./g) || []).length === 1, r);
}
{
  // 扩展名本身非法时也要清理
  const r = expandTemplate('{name}', { name: 'x', ext: 'a/b' });
  ok('非法扩展名被清理', !r.includes('/'), r);
}
{
  // n 非法时的兜底（不能产生 NaN）
  ok('n 为 NaN 时用 1', expandTemplate('{n}', { name: 'x', n: NaN }) === '1.petpack', expandTemplate('{n}', { name: 'x', n: NaN }));
  ok('n 为负数时用 0 或 1（不产生负号）', !expandTemplate('{n}', { name: 'x', n: -5 }).includes('-'), expandTemplate('{n}', { name: 'x', n: -5 }));
}

// ---------- planNames ----------
{
  const r = planNames([{ name: '甲' }, { name: '乙' }, { name: '丙' }], '{n:02}_{name}');
  ok('三个都有文件名', r.length === 3, String(r.length));
  ok('序号递增', r[0].fileName.startsWith('01_') && r[2].fileName.startsWith('03_'), JSON.stringify(r.map((x) => x.fileName)));
  ok('文件名带宠物名', r[0].fileName.includes('甲'), r[0].fileName);
}
{
  // ★ 去重：同名宠物不能产生同一个文件名（包内按文件名寻址，重名会静默覆盖）
  const r = planNames([{ name: '猫' }, { name: '猫' }, { name: '猫' }], '{name}');
  const names = r.map((x) => x.fileName);
  ok('同名会被去重', new Set(names.map((s) => s.toLowerCase())).size === 3, JSON.stringify(names));
  ok('去重后仍保留名字', names.every((n) => n.startsWith('猫')), JSON.stringify(names));
  ok('去重不破坏扩展名', names.every((n) => n.endsWith('.petpack')), JSON.stringify(names));
}
{
  // 去重时大小写不敏感（Windows 文件系统不区分大小写）
  const r = planNames([{ name: 'Cat' }, { name: 'cat' }], '{name}');
  const names = r.map((x) => x.fileName.toLowerCase());
  ok('大小写不同也去重（Windows 不区分）', new Set(names).size === 2, JSON.stringify(r.map((x) => x.fileName)));
}
{
  const r = planNames([{ name: 'x' }, { name: 'y' }], '{name}', { startAt: 10 });
  ok('startAt 生效', r[0].fileName === 'x.petpack' && planNames([{ name: 'x' }], '{n}', { startAt: 10 })[0].fileName === '10.petpack', JSON.stringify(r.map((x) => x.fileName)));
  const r2 = planNames([{ name: 'x' }], '{name}', { ext: 'zip' });
  ok('ext 生效', r2[0].fileName === 'x.zip', r2[0].fileName);
  const r3 = planNames([{ name: 'x' }], '{date}_{name}', { date: '2026-10-12' });
  ok('date 生效', r3[0].fileName === '2026-10-12_x.petpack', r3[0].fileName);
}
{
  ok('空数组返回空', planNames([], '{name}').length === 0, 'empty');
  ok('非数组返回空', planNames(null, '{name}').length === 0, 'null');
  ok('坏元素不崩', planNames([null, {}, 'x'], '{name}').length === 3, 'bad');
  ok('每个结果都有 item 和 fileName', planNames([{ name: 'a' }], '{name}').every((x) => 'item' in x && x.fileName), 'shape');
}

// ---------- 说明文案 ----------
{
  const h = templateHelp();
  ok('说明里列出全部占位符', PLACEHOLDERS.every((p) => h.includes('{' + p + '}')), h);
  ok('说明里提到补零写法', h.includes('{n:03}'), h);
  ok('PLACEHOLDERS 与实现一致（都有 name/n/date/time/author/ext）',
    ['name', 'n', 'date', 'time', 'author', 'ext'].every((x) => PLACEHOLDERS.includes(x)), PLACEHOLDERS.join(','));
}
