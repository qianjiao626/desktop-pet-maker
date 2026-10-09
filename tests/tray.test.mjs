import fs from "node:fs";
// 托盘菜单逻辑测试：验证「宠物在跑 / 没跑」两种状态下菜单项与可用性正确
import { ok } from './_harness.mjs';
import { buildTrayMenuTemplate, trayTooltip } from '../src/main/tray.js';

const actions = [];
const click = (a) => actions.push(a);

// --- 场景 1：宠物在跑 + 制作器窗口开着 ---
const t1 = buildTrayMenuTemplate({ petAlive: true, makerAlive: true }, click);
const labels1 = t1.map((i) => i.label);
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
