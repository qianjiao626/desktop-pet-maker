import fs from "node:fs";
// 托盘菜单逻辑测试：验证「宠物在跑 / 没跑」两种状态下菜单项与可用性正确
import { ok } from './_harness.mjs';
import { buildTrayMenuTemplate, trayTooltip } from '../src/main/tray.js';

const actions = [];
const click = (a) => actions.push(a);

// --- 场景 1：宠物在跑 + 制作器窗口开着 ---
const t1 = buildTrayMenuTemplate({ petAlive: true, makerAlive: true }, click);
const labels1 = t1.map((i) => i.label).filter((x) => typeof x === 'string');
ok('菜单含「退出桌宠」', labels1.includes('退出桌宠'));
ok('菜单含「隐藏 / 显示桌宠」', labels1.includes('隐藏 / 显示桌宠'));
ok('菜单含「显示制作器窗口」', labels1.includes('显示制作器窗口'));
ok('退出桌宠可点击', t1.find((i) => i.label === '退出桌宠').enabled === true);
ok('隐藏桌宠可点击', t1.find((i) => i.label === '隐藏 / 显示桌宠').enabled === true);
ok('标题项不可点击', t1[0].enabled === false);
ok('含「退出制作器」', labels1.includes('退出制作器'));
ok('含「宠物库文件夹」', labels1.includes('宠物库文件夹'));

// --- 场景 2：宠物没在跑 + 制作器也关了（用户最容易卡住的状态）---
const t2 = buildTrayMenuTemplate({ petAlive: false, makerAlive: false }, click);
const labels2 = t2.map((i) => i.label);
ok('无桌宠时显示「桌宠未运行」', labels2.includes('桌宠未运行'));
ok('无桌宠时退出项禁用', t2.find((i) => i.label === '桌宠未运行').enabled === false);
ok('无桌宠时隐藏项禁用', t2.find((i) => i.label === '（无桌宠可隐藏）').enabled === false);
ok('制作器关了显示「打开制作器」', labels2.includes('打开制作器'));
ok('「打开制作器」始终可点击', t2.find((i) => i.label === '打开制作器').enabled !== false);

// --- 场景 3：点击回调派发正确 ---
const t3 = buildTrayMenuTemplate({ petAlive: true, makerAlive: true }, click);
actions.length = 0;
t3.find((i) => i.label === '退出桌宠').click();
t3.find((i) => i.label === '隐藏 / 显示桌宠').click();
t3.find((i) => i.label === '显示制作器窗口').click();
t3.find((i) => i.label === '宠物库文件夹').click();
t3.find((i) => i.label === '退出制作器').click();
ok('五个动作按顺序派发', JSON.stringify(actions) === JSON.stringify(['quitPet', 'togglePetVisible', 'showMaker', 'openPetsDir', 'quitApp']), actions.join(','));

// --- 场景 4：tooltip 反映运行状态 ---
ok('运行中 tooltip 有提示', trayTooltip({ petAlive: true }).includes('桌宠运行中'));
ok('未运行 tooltip 简洁', trayTooltip({ petAlive: false }) === '桌宠制作器');

// --- 场景 5：菜单结构稳定（两个分隔符 + 预期条目数）---
ok('菜单项数量正确', t1.length === 9, 'n=' + t1.length);
ok('含 3 个分隔符（标题后 / 桌宠操作后 / 文件夹后）', t1.filter((i) => i.type === 'separator').length === 3, 'n=' + t1.filter((i) => i.type === 'separator').length);

// --- 场景 6：真实入口存在（防「退不出去」复发）---
ok('托盘提供退出桌宠入口', labels1.includes('退出桌宠') && t1.find((i) => i.label === '退出桌宠').enabled);

// ---------- 多宠物：逐只列出、可点名关掉 ----------
{
  const acts2 = [];
  const ck = (a) => acts2.push(a);
  const pets = [
    { id: 'a.petpack', name: '北极熊' },
    { id: 'b.petpack', name: '大胖鸡' },
    { id: 'c.petpack', name: '咚咚' },
  ];
  const t = buildTrayMenuTemplate({ petAlive: true, makerAlive: true, pets }, ck);
  const labels = t.map((x) => x.label).filter(Boolean);

  ok('标题显示在跑数量', labels.some((x) => x.includes('3 只在跑')), JSON.stringify(labels));
  ok('给了「关掉其中一只」引导行', labels.some((x) => x.includes('关掉其中一只')), JSON.stringify(labels));
  ok('逐只列出了三只的名字', labels.some((x) => x.includes('北极熊')) && labels.some((x) => x.includes('大胖鸡')) && labels.some((x) => x.includes('咚咚')), JSON.stringify(labels));
  ok('有「全部退出」并且带数量', labels.some((x) => x.includes('全部退出（3 只）')), JSON.stringify(labels));
  ok('多只时不再出现单只的「退出桌宠」', !labels.includes('退出桌宠'), JSON.stringify(labels));
  ok('有多只时的「隐藏 / 显示全部」', labels.some((x) => x.includes('隐藏 / 显示全部')), JSON.stringify(labels));

  // 点名关掉大胖鸡
  const row = t.find((x) => x.label && x.label.includes('大胖鸡'));
  ok('能取到那一只的菜单项', !!row);
  row.click();
  ok('点它会发 quitPetById:<id>', acts2.includes('quitPetById:b.petpack'), JSON.stringify(acts2));
}
{
  // 名字过长要截断（菜单放不下）
  const t = buildTrayMenuTemplate({ petAlive: true, pets: [{ id: 'x', name: '名'.repeat(40) }, { id: 'y', name: '短' }] }, () => {});
  const row = t.find((x) => x.label && x.label.includes('…'));
  ok('超长名字被截断', !!row, JSON.stringify(t.map((x) => x.label)));
  ok('截断后长度受控', row && Array.from(row.label).length <= 30, row && String(Array.from(row.label).length));
}
{
  // 兼容：不传 pets 时保持旧的单只菜单
  const t = buildTrayMenuTemplate({ petAlive: true, makerAlive: true }, () => {});
  const labels = t.map((x) => x.label).filter((x) => typeof x === 'string');
  ok('不传 pets 仍是单只菜单', labels.includes('退出桌宠') && !labels.some((x) => x.includes('只在跑')), JSON.stringify(labels));
}
{
  // 传了 pets 但只有 1 只：也应该走单只菜单（不给用户多余的选择）
  const t = buildTrayMenuTemplate({ petAlive: true, pets: [{ id: 'a', name: '唯一' }] }, () => {});
  const labels = t.map((x) => x.label).filter((x) => typeof x === 'string');
  ok('只有一只时仍是单只菜单', labels.includes('退出桌宠'), JSON.stringify(labels));
  ok('只有一只时不显示数量', !labels.some((x) => x.includes('只在跑')), JSON.stringify(labels));
}
{
  // 坏数据不能把菜单搞崩
  const t = buildTrayMenuTemplate({ petAlive: true, pets: [null, {}, { id: '' }, { id: 'ok', name: '' }] }, () => {});
  ok('坏 pets 数据被过滤后不崩', Array.isArray(t) && t.length > 0, String(t && t.length));
}
