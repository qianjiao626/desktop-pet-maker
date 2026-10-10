import { ok } from './_harness.mjs';
import {
  normalizeTemplateName, templateFromPack, normalizeTemplate, normalizeTemplateList,
  addTemplate, removeTemplate, renameTemplate, templateFileName,
  applyCustomTemplate, matchCustomTemplate, TEMPLATABLE_SECTIONS, CUSTOM_TEMPLATE_MAX,
} from '../src/shared/mytemplates.js';

// ---------- 名字归一化 ----------
ok('去首尾空白', normalizeTemplateName('  我的  ') === '我的');
ok('换行转空格', !normalizeTemplateName('a\nb').includes('\n'));
ok('空名走兜底', normalizeTemplateName('') === '我的模板');
ok('null 走兜底', normalizeTemplateName(null) === '我的模板');
ok('限长 24（按码点）', Array.from(normalizeTemplateName('龙'.repeat(99))).length === 24);

// ---------- 从宠物包抽模板：只抽性格，不带图片/画布 ----------
const pack = {
  id: 'p1', name: '我的宠物', author: '我', createdAt: '2026-01-01',
  frames: [{ file: 'a.png', durationMs: 111 }],
  canvas: { width: 321, height: 654 },
  render: { scale: 0.42, flip: true },
  animation: { idle: 'sway', idleSpeed: 2, fps: 30 },
  physics: { gravity: 3, roam: false },
  bubble: { enabled: false, lines: ['自定义'], intervalSec: 99 },
  behavior: { bugChase: false },
};
const t = templateFromPack(pack, ' 测试模板 ', { flags: { hop: true, walk: false } });
ok('模板有 id', !!t.id);
ok('模板名已归一化', t.name === '测试模板', t.name);
ok('模板只含可模板化段落', Object.keys(t.patch).every((k) => TEMPLATABLE_SECTIONS.includes(k)), Object.keys(t.patch).join(','));
ok('不带 frames', !('frames' in t.patch), JSON.stringify(Object.keys(t.patch)));
ok('不带 canvas', !('canvas' in t.patch));
ok('不带 render（外观不污染）', !('render' in t.patch));
ok('不带 name/author', !('name' in t.patch) && !('author' in t.patch));
ok('性格字段被带上了', t.patch.animation.fps === 30 && t.patch.physics.roam === false);
ok('flags 单独带着走', t.flags.hop === true && t.flags.walk === false);
ok('builtin 标记为 false', t.builtin === false);

// ---------- 归一化容错 ----------
ok('坏数据返回 null', normalizeTemplate(null) === null && normalizeTemplate('x') === null && normalizeTemplate(42) === null);
ok('空 patch 返回 null', normalizeTemplate({ name: 'x' }) === null);
ok('只有可模板化段落才被保留', (() => {
  const n = normalizeTemplate({ name: 'x', patch: { animation: { fps: 5 }, frames: [1, 2], canvas: { width: 9 } } });
  return n && n.patch.animation.fps === 5 && !('frames' in n.patch) && !('canvas' in n.patch);
})());
ok('列表归一化丢弃坏项', normalizeTemplateList([null, { name: 'ok', patch: { animation: { fps: 1 } } }, 'bad']).length === 1);
ok('列表去重（同 id 只留一个）', (() => {
  const a = { id: 'same', name: 'a', patch: { animation: { fps: 1 } } };
  const b = { id: 'same', name: 'b', patch: { animation: { fps: 2 } } };
  const l = normalizeTemplateList([a, b]);
  return l.length === 1 && l[0].name === 'a';
})());
ok('列表限数量', (() => {
  const many = Array.from({ length: 99 }, (_, i) => ({ id: 'i' + i, name: 'n' + i, patch: { animation: { fps: i } } }));
  return normalizeTemplateList(many).length === CUSTOM_TEMPLATE_MAX;
})());
ok('非数组输入安全', normalizeTemplateList(null).length === 0);

// ---------- 增删改 ----------
{
  let list = [];
  list = addTemplate(list, templateFromPack(pack, 'A'));
  list = addTemplate(list, templateFromPack(pack, 'B'));
  ok('新增两个', list.length === 2);
  ok('新增的排在前面', list[0].name === 'B', list.map((x) => x.name).join(','));
  const idA = list.find((x) => x.name === 'A').id;
  list = renameTemplate(list, idA, '  A2  ');
  ok('重命名生效', list.find((x) => x.id === idA).name === 'A2');
  list = removeTemplate(list, idA);
  ok('删除生效', list.length === 1 && !list.some((x) => x.id === idA));
  ok('删除不存在的 id 不崩', removeTemplate(list, 'nope').length === 1);
  ok('重命名不存在的 id 不崩', renameTemplate(list, 'nope', 'x').length === 1);
  ok('坏模板不会被加进去', addTemplate(list, { name: '空' }).length === 1);
}

// ---------- 文件名 ----------
ok('文件名带 .pettpl', templateFileName('我的模板').endsWith('.pettpl'), templateFileName('我的模板'));
ok('文件名安全化', !templateFileName('a/b:c').includes('/'));
ok('空名兜底', templateFileName('').endsWith('.pettpl'));

// ---------- 套用：不碰图片/画布，纯函数 ----------
{
  const tpl = templateFromPack({ animation: { fps: 24, idle: 'sway' }, physics: { roam: false } }, 'X');
  const applied = applyCustomTemplate(pack, tpl);
  ok('不改 frames（引用相同）', applied.frames === pack.frames);
  ok('不改 canvas', JSON.stringify(applied.canvas) === JSON.stringify(pack.canvas));
  ok('不改 render', applied.render === pack.render);
  ok('不改 name/author', applied.name === '我的宠物' && applied.author === '我');
  ok('确实覆盖了 fps', applied.animation.fps === 24);
  ok('原对象未被修改（纯函数）', pack.animation.fps === 30, 'fps=' + pack.animation.fps);
  ok('返回新对象', applied !== pack);
  ok('null 包安全', applyCustomTemplate(null, tpl) === null);
  ok('坏模板返回原包', applyCustomTemplate(pack, { name: 'x' }) === pack);
}

// ---------- 反查（用于高亮）----------
{
  const tpl = templateFromPack(pack, 'Y');
  const applied = applyCustomTemplate(pack, tpl);
  ok('套用后能反查成功', matchCustomTemplate(applied, tpl) === true);
  ok('改过字段就反查失败', matchCustomTemplate({ ...applied, animation: { ...applied.animation, fps: 7 } }, tpl) === false);
  ok('null 安全（match）', matchCustomTemplate(null, tpl) === false && matchCustomTemplate(pack, null) === false);
}
