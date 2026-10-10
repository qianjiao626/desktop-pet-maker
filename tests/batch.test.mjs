import { ok } from './_harness.mjs';
import { petNameFromFile, planBatch, batchPackFor, summarizeBatch } from '../src/shared/batch.js';

// ---------- 从文件名推宠物名 ----------
ok('去扩展名', petNameFromFile('小黄龙.png') === '小黄龙', petNameFromFile('小黄龙.png'));
ok('去 sprite 序号', petNameFromFile('sprite_001.png') === 'sprite', petNameFromFile('sprite_001.png'));
ok('去 frame 序号', petNameFromFile('frame-12.jpg') === 'frame', petNameFromFile('frame-12.jpg'));
ok('去中文角色编号', petNameFromFile('角色_0003.png') === '角色', petNameFromFile('角色_0003.png'));
ok('保留名字里的数字（不是尾部序号）', petNameFromFile('小猫2号立绘.png').includes('号'), petNameFromFile('小猫2号立绘.png'));
ok('大写扩展名也去掉', !petNameFromFile('Cat.PNG').includes('.'), petNameFromFile('Cat.PNG'));
ok('带路径也安全', petNameFromFile('C:\\a\\b\\cat.png') === 'cat', petNameFromFile('C:\\a\\b\\cat.png'));
ok('空名兜底', petNameFromFile('') === '我的桌宠');
ok('纯序号也能兜底', petNameFromFile('001.png').length > 0, petNameFromFile('001.png'));
ok('null 安全', petNameFromFile(null) === '我的桌宠');
ok('超长名被截断', Array.from(petNameFromFile('龙'.repeat(99) + '.png')).length <= 40);

// ---------- planBatch ----------
{
  const imgs = [{ name: 'cat.png', dataUrl: 'd1' }, { name: 'dog.png', dataUrl: 'd2' }];
  const plan = planBatch(imgs);
  ok('每张图一条计划', plan.length === 2);
  ok('按文件名推名字', plan[0].name === 'cat' && plan[1].name === 'dog');
  ok('生成 .petpack 输出名', plan[0].outName === 'cat.petpack', plan[0].outName);
  ok('保留了原始 dataUrl 引用', plan[0].dataUrl === 'd1');
  ok('保留了 index 映射', plan[0].index === 0 && plan[1].index === 1);
}
{
  // 重名不互相覆盖（同一批里两个 cat 必须能共存）
  const plan = planBatch([{ name: 'cat.png' }, { name: 'cat.jpg' }, { name: 'cat.webp' }]);
  const names = plan.map((p) => p.name);
  ok('重名自动加序号区分', new Set(names).size === 3, names.join(' | '));
  ok('重名输出名也互不相同', new Set(plan.map((p) => p.outName)).size === 3, plan.map((p) => p.outName).join(' | '));
}
{
  const plan = planBatch([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }], { nameMode: 'prefix', prefix: '素材' });
  ok('prefix 模式用统一前缀', plan.every((p) => p.name.startsWith('素材')), plan.map((p) => p.name).join(','));
  ok('prefix 模式多图带序号', plan[0].name === '素材 1' && plan[2].name === '素材 3', plan.map((p) => p.name).join(','));
}
{
  const one = planBatch([{ name: 'a.png' }], { nameMode: 'prefix', prefix: '单个' });
  ok('prefix 模式单图不带序号', one[0].name === '单个', one[0].name);
}
ok('planBatch 空输入安全', planBatch([]).length === 0 && planBatch(null).length === 0);
{
  // 名字含非法文件名字符时，输出名必须被安全化
  const plan = planBatch([{ name: 'a/b:c*d.png' }]);
  ok('输出名不含路径分隔符', !plan[0].outName.includes('/') && !plan[0].outName.includes('\\'), plan[0].outName);
  ok('输出名不含 Windows 非法字符', !/[<>:"|?*]/.test(plan[0].outName), plan[0].outName);
}

// ---------- batchPackFor：每只都是单帧独立包 ----------
{
  const tpl = { render: { scale: 0.4 }, physics: { roam: false }, animation: { fps: 10 } };
  const p = batchPackFor('小猫', tpl, 'pet.png');
  ok('名字被写上', p.name === '小猫');
  ok('只有一帧（批量模式每只一张图）', p.frames.length === 1, 'n=' + p.frames.length);
  ok('帧文件名正确', p.frames[0].file === 'pet.png');
  ok('继承了外观模板', p.render.scale === 0.4, String(p.render.scale));
  ok('继承了物理模板', p.physics.roam === false);
  ok('继承了动画模板', p.animation.fps === 10);
  ok('id 非空（每只独立）', typeof p.id === 'string' && p.id.length > 0, p.id);
  ok('createdAt 已写', typeof p.createdAt === 'string' && p.createdAt.length > 0);
  // 两只宠物的 id 必须不同，否则会在宠物库里互相覆盖
  ok('不同实例 id 不同', batchPackFor('a', tpl).id !== batchPackFor('b', tpl).id);
}
ok('batchPackFor 无模板也能用', batchPackFor('x').frames.length === 1);

// ---------- summarizeBatch ----------
{
  const s = summarizeBatch([{ ok: true }, { ok: true }, { ok: false, name: 'x', error: 'e' }]);
  ok('统计成功数', s.ok === 2, String(s.ok));
  ok('统计失败数', s.failed === 1, String(s.failed));
  ok('总数正确', s.total === 3);
  ok('汇总文字可读', s.text.includes('成功 2') && s.text.includes('失败 1'), s.text);
  ok('给出失败明细', s.failures.length === 1 && s.failures[0].name === 'x');
}
{
  const s = summarizeBatch([{ ok: true }, { ok: false, canceled: true }, { ok: false, skipped: true }]);
  ok('取消不计入失败', s.failed === 0, 'failed=' + s.failed);
  ok('取消被单独统计', s.canceled === 1);
  ok('跳过被单独统计', s.skipped === 1);
}
ok('全失败时文字仍可读', summarizeBatch([{ ok: false, name: 'a', error: 'x' }]).text.includes('失败 1'));
ok('空结果安全', summarizeBatch([]).total === 0 && summarizeBatch(null).total === 0);
ok('失败明细最多 20 条（防止刷屏）', summarizeBatch(Array.from({ length: 50 }, (_, i) => ({ ok: false, name: 'p' + i, error: 'e' }))).failures.length === 20);
