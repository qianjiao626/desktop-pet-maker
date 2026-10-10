import { ok } from './_harness.mjs';
import {
  PERSONALITY_TEMPLATES, findTemplate, applyTemplate, templateFlags, matchTemplate,
} from '../src/shared/templates.js';

// ---------- 模板定义 ----------
ok('模板数量 >= 4', PERSONALITY_TEMPLATES.length >= 4, 'n=' + PERSONALITY_TEMPLATES.length);
ok('每个模板都有 id/name/emoji/desc', PERSONALITY_TEMPLATES.every(t => t.id && t.name && t.emoji && t.desc));
ok('模板 id 不重复', new Set(PERSONALITY_TEMPLATES.map(t => t.id)).size === PERSONALITY_TEMPLATES.length);
ok('每个模板都有 patch 与 flags', PERSONALITY_TEMPLATES.every(t => t.patch && t.flags));
ok('findTemplate 能取到', findTemplate('lively') !== null);
ok('findTemplate 未知 id 返回 null', findTemplate('nope') === null);
ok('findTemplate 无参安全', findTemplate() === null);

// ---------- 安全边界：不能动用户的图片 / 画布 / 外观 ----------
const userPack = {
  schema: 2,
  id: 'my-pet', name: '我的宠物', author: '我', createdAt: '2026-01-01',
  frames: [{ file: 'a.png', durationMs: 111 }, { file: 'b.png', durationMs: 222 }],
  canvas: { width: 321, height: 654 },
  render: { scale: 0.42, flip: true },
  animation: { clip: 'idle', idle: 'sway', idleSpeed: 2, fps: 30, click: 'spin', hover: 'none' },
  physics: { gravity: 3, bounce: 0.1, friction: 0.9, roam: false, roamSpeed: 0, throwScale: 3 },
  bubble: { enabled: false, lines: ['自定义台词'], intervalSec: 99, durationSec: 9 },
  behavior: { startCorner: 'center', keepAbove: false, bugChase: false },
};

const applied = applyTemplate(userPack, 'lively');
ok('不改 id', applied.id === 'my-pet');
ok('不改 name', applied.name === '我的宠物');
ok('不改作者', applied.author === '我');
ok('不改 createdAt', applied.createdAt === '2026-01-01');
ok('不改 frames（引用与内容都不动）', applied.frames === userPack.frames, 'same ref');
ok('不改 canvas', JSON.stringify(applied.canvas) === JSON.stringify(userPack.canvas), JSON.stringify(applied.canvas));
ok('不改 render（缩放/翻转保留）', applied.render === userPack.render);
ok('不改 clip', applied.animation.clip === 'idle');
ok('不改 behavior.startCorner', applied.behavior.startCorner === 'center');
ok('不改 behavior.keepAbove', applied.behavior.keepAbove === false);
ok('不改 bubble.lines（用户台词保留）', JSON.stringify(applied.bubble.lines) === JSON.stringify(['自定义台词']));

// ---------- 确实覆盖了性格字段 ----------
ok('覆盖了 idleSpeed', applied.animation.idleSpeed === 1.35, String(applied.animation.idleSpeed));
ok('覆盖了 click', applied.animation.click === 'jump');
ok('覆盖了 roam', applied.physics.roam === true);
ok('覆盖了 roamSpeed', applied.physics.roamSpeed === 1.6);
ok('覆盖了气泡间隔', applied.bubble.intervalSec === 9);
ok('覆盖了 bugChase', applied.behavior.bugChase === true);

// ---------- 纯函数：不改原对象 ----------
ok('原对象未被修改（纯函数）', userPack.animation.idleSpeed === 2 && userPack.physics.roam === false,
  `idleSpeed=${userPack.animation.idleSpeed} roam=${userPack.physics.roam}`);
ok('返回的是新对象', applied !== userPack);

// ---------- 缺失字段容错 ----------
const bare = { frames: [{ file: 'x.png' }] };
const bareApplied = applyTemplate(bare, 'gentle');
ok('缺 animation 也能套用', bareApplied.animation && bareApplied.animation.idleSpeed === 0.75);
ok('缺 physics 也能套用', bareApplied.physics && bareApplied.physics.roamSpeed === 0.55);
ok('缺 sections 时不崩', !!bareApplied.bubble && !!bareApplied.behavior);
ok('未知模板返回原包（不破坏）', applyTemplate(userPack, 'nope') === userPack);
ok('null 包安全', applyTemplate(null, 'lively') === null);

// ---------- flags（同步快速条开关）----------
const lf = templateFlags('lively');
ok('lively flags：会蹦会看会走', lf.hop === true && lf.look === true && lf.walk === true);
const sf = templateFlags('sleepy');
ok('sleepy flags：都不开', sf.hop === false && sf.look === false && sf.walk === false);
ok('未知模板 flags 为 null', templateFlags('nope') === null);

// ---------- 反查匹配 ----------
ok('套用后能反查回同一模板', matchTemplate(applied) === 'lively', String(matchTemplate(applied)));
ok('手工改过则不匹配', matchTemplate({ ...applied, physics: { ...applied.physics, roamSpeed: 9 } }) === null);
ok('null 安全', matchTemplate(null) === null);

// ---------- 每个模板都能互相切换（不残留上一个模板的特征）----------
{
  let p = userPack;
  for (const t of PERSONALITY_TEMPLATES) {
    p = applyTemplate(p, t.id);
    const m = matchTemplate(p);
    ok(`套用「${t.name}」后可反查一致`, m === t.id, `期望=${t.id} 实际=${m}`);
  }
}
// 休眠模板应当把「会蹦」关掉（性格差异必须真的体现出来）
{
  const a = applyTemplate(userPack, 'lively');
  const b = applyTemplate(userPack, 'quiet');
  ok('活泼与静默的漫游速度不同', a.physics.roamSpeed !== b.physics.roamSpeed, `${a.physics.roamSpeed} vs ${b.physics.roamSpeed}`);
  ok('静默模板关掉气泡', b.bubble.enabled === false);
  ok('活泼模板开启气泡', a.bubble.enabled === true);
  ok('静默模板不漫游', b.physics.roam === false);
}
