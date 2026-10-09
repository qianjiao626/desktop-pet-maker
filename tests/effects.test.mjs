import { ok } from './_harness.mjs';
import { handState, fistState, pettingPose, HAND_DURATION, FIST_DURATION, PETTING_DURATION } from '../src/shared/effects.js';

// 取一系列进度点
const samples = (fn, n = 21, ...rest) => Array.from({ length: n }, (_, i) => fn(i / (n - 1), ...rest));

// ============ 摸头的手 ============
{
  const s0 = handState(0);
  ok('手: 起始在上方（y 为负）', s0.y < -0.8, String(s0.y));
  ok('手: 起始不可见（alpha 低）', s0.alpha < 0.5, String(s0.alpha));

  const sMid = handState(0.4);
  ok('手: 中段贴住头顶(y≈0)', Math.abs(sMid.y) < 0.06, String(sMid.y));
  ok('手: 中段完全可见', sMid.alpha > 0.95, String(sMid.alpha));
  ok('手: 中段有按压力度', sMid.press > 0.3, String(sMid.press));

  const s1 = handState(1);
  ok('手: 结束时已收回上方', s1.y < -0.8, String(s1.y));
  ok('手: 结束时淡出', s1.alpha < 0.1, String(s1.alpha));
}
{
  const all = samples((t) => handState(t));
  ok('手: alpha 始终在 0..1', all.every((s) => s.alpha >= 0 && s.alpha <= 1));
  ok('手: press 始终在 0..1', all.every((s) => s.press >= 0 && s.press <= 1));
  ok('手: scale 为正', all.every((s) => s.scale > 0));
  ok('手: y 有上限（不会跑到宠物下方）', all.every((s) => s.y < 0.12), Math.max(...all.map((s) => s.y)).toFixed(3));
  // 中段存在可见帧
  ok('手: 存在完全可见的帧', all.some((s) => s.alpha > 0.99));
  // 至少一次贴到头顶
  ok('手: 至少一次贴到头顶', all.some((s) => Math.abs(s.y) < 0.05));
}
ok('手: 越界进度被夹取', handState(-1).y === handState(0).y && handState(2).y === handState(1).y);
ok('手: NaN 进度不崩溃', Number.isFinite(handState(NaN).y));
ok('手: 时长为正', HAND_DURATION > 0);

// ============ 挨拳击的拳头 ============
{
  const s0 = fistState(0, 1);
  ok('拳: 起始在画面外(x 大)', Math.abs(s0.x) > 1.0, String(s0.x));
  ok('拳: 起始淡入中', s0.alpha < 0.5, String(s0.alpha));

  const sImpact = fistState(0.28, 1);
  ok('拳: 撞击时贴住身体(|x| 小)', Math.abs(sImpact.x) < 0.1, String(sImpact.x));
  ok('拳: 撞击时完全可见', sImpact.alpha > 0.9, String(sImpact.alpha));
  ok('拳: 撞击时 impact=1', sImpact.impact > 0.9, String(sImpact.impact));

  const s1 = fistState(1, 1);
  ok('拳: 结束已弹回', Math.abs(s1.x) > 0.8, String(s1.x));
  ok('拳: 结束淡出', s1.alpha < 0.15, String(s1.alpha));
}
{
  // 方向：dir=1 从右侧来（x>0 起步）；dir=-1 从左侧来（x<0）
  ok('拳: dir=1 从右侧', fistState(0, 1).x > 1);
  ok('拳: dir=-1 从左侧', fistState(0, -1).x < -1);
  ok('拳: dir 影响旋转方向', Math.sign(fistState(0.05, 1).rot) !== Math.sign(fistState(0.05, -1).rot));
}
{
  const all = samples((t) => fistState(t, 1));
  ok('拳: alpha 在 0..1', all.every((s) => s.alpha >= 0 && s.alpha <= 1));
  ok('拳: impact 在 0..1', all.every((s) => s.impact >= 0 && s.impact <= 1));
  ok('拳: scale 为正', all.every((s) => s.scale > 0));
  ok('拳: 存在撞击帧', all.some((s) => s.impact > 0.99));
}
ok('拳: 越界进度被夹取', fistState(-1, 1).x === fistState(0, 1).x);
ok('拳: NaN 进度不崩溃', Number.isFinite(fistState(NaN, 1).x));
ok('拳: 时长为正', FIST_DURATION > 0);

// ============ 静态守护：pet.js 用到的 effects 导出必须都 import 了 ============
// 背景：漏 import 时 node --check 通过、单测全绿，但渲染进程一跑到那行就抛
// ReferenceError 并中断渲染循环（实测：一摸头整个画面消失）。这里静态兜住。
{
  const { readFileSync } = await import('node:fs');
  const petSrc = readFileSync('src/pet/pet.js', 'utf8');
  const m = petSrc.match(/import \{([^}]+)\} from '\.\.\/shared\/effects\.js'/);
  ok('pet.js 有 effects 的 import', !!m);
  if (m) {
    const imported = m[1].split(',').map((x) => x.trim());
    for (const name of ['handState', 'fistState', 'pettingPose', 'HAND_DURATION', 'FIST_DURATION', 'PETTING_DURATION']) {
      const usedInBody = new RegExp('(^|[^\\w.])' + name + '\\s*[(+]|' + name + '\\b(?![\\w:])').test(petSrc.replace(m[0], ''));
      if (usedInBody) ok('pet.js 已导入 ' + name, imported.includes(name));
    }
  }
}

// ============ 静态守护（通用）：pet.js 用到的任何 shared 导出都必须已 import ============
// 背景：漏 import 时 node --check 通过、单测全绿，但渲染进程一跑到那行就抛
// ReferenceError 并中断渲染循环（已两次踩到：PETTING_DURATION、createBug）。
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const petSrc = readFileSync('src/pet/pet.js', 'utf8');
  const imported = new Set();
  for (const m of petSrc.matchAll(/import \{([^}]+)\} from '\.\.\/shared\/[^']+'/g)) {
    for (const name of m[1].split(',')) imported.add(name.trim().split(/\s+as\s+/)[0]);
  }
  const body = petSrc.replace(/^import[\s\S]*?;$/gm, '');
  const files = readdirSync('src/shared').filter((f) => f.endsWith('.js'));
  let checked = 0;
  for (const f of files) {
    const mod = readFileSync('src/shared/' + f, 'utf8');
    for (const m of mod.matchAll(/export (?:function|const|let|class)\s+(\w+)/g)) {
      const name = m[1];
      if (!new RegExp('(^|[^\\w.$])' + name + '\\b').test(body)) continue;
      checked++;
      if (!imported.has(name)) ok('pet.js 已导入 ' + name + '（来自 ' + f + '）', false, '漏 import 会在运行时抛 ReferenceError');
    }
  }
  ok('通用 import 守护已扫描 shared 导出', checked > 0, '检查了 ' + checked + ' 个被使用的导出');
}

// ============ 被摸头时的「舒服」姿态 ============
{
  const s0 = pettingPose(0);
  ok('摸: 起始接近静止', Math.abs(s0.sink) < 1.5 && Math.abs(s0.sway) < 0.5, JSON.stringify(s0));

  const sMid = pettingPose(0.6);
  ok('摸: 中段真的下沉了', sMid.sink > 2.5, String(sMid.sink));
  ok('摸: 中段有"舒服"强度', sMid.bliss > 0.9, String(sMid.bliss));

  const s1 = pettingPose(1);
  ok('摸: 结束回到原样(无下沉)', Math.abs(s1.sink) < 0.5, String(s1.sink));
  ok('摸: 结束 bliss 归零', s1.bliss < 0.05, String(s1.bliss));
}
{
  const all = samples((t) => pettingPose(t));
  ok('摸: squash 始终为正且不过分变形', all.every((s) => s.squash > 0.95 && s.squash < 1.2),
    'max=' + Math.max(...all.map((s) => s.squash)).toFixed(3));
  ok('摸: bliss 始终在 0..1', all.every((s) => s.bliss >= 0 && s.bliss <= 1));
  ok('摸: 期间出现过左右摆动', all.some((s) => s.sway > 1) && all.some((s) => s.sway < -1));
  ok('摸: 期间出现过歪头', all.some((s) => Math.abs(s.tilt) > 2));
  ok('摸: 数值都是有限值', all.every((s) => Object.values(s).every((v) => Number.isFinite(v))));
}
ok('摸: 越界进度被夹取', JSON.stringify(pettingPose(-5)) === JSON.stringify(pettingPose(0)));
ok('摸: NaN 不崩溃', Number.isFinite(pettingPose(NaN).sink));
ok('摸: 舒适动画时长比手部更长', PETTING_DURATION > HAND_DURATION);

// ============ 两者互不依赖 ============
ok('手与拳时长不同（避免视觉同质）', HAND_DURATION !== FIST_DURATION);