// 「无头」保证：跑 e2e 时**任何窗口都不要真的显示到用户屏幕上**。
//
// 背景（用户明确要求）：不要让桌宠制作器的窗口反复跳出来影响工作。
// 实测过：e2e 创建宠物窗口时，ready-to-show 里无条件 win.show()，
// 于是跑测试期间真的有窗口出现在用户桌面上（抓到标题为「桌宠制作器」的窗口）。
//
// 这里做两件事：
//   1) 断言 HEADLESS 判定在测试环境下一定为真（三重保险里至少中一条）；
//   2) 断言代码里没有"裸的 win.show()"绕过 safeShow（有的话立刻报出来）。
import { ok } from './_harness.mjs';
import { readFileSync } from 'node:fs';

{
  const src = readFileSync('src/main/main.js', 'utf8');

  ok('存在 safeShow 统一出口', src.includes('function safeShow('), 'safeShow');
  ok('存在 HEADLESS 判定', src.includes('const HEADLESS'), 'HEADLESS');
  ok('HEADLESS 认 PETMAKER_HEADLESS=1（e2e-all 会自动带上）', src.includes("PETMAKER_HEADLESS === '1'"), 'env1');
  ok('HEADLESS 认 PETMAKER_NO_LAUNCH=1（老开关）', src.includes("PETMAKER_NO_LAUNCH === '1'"), 'env2');
  ok('HEADLESS 兜底认 scripts/e2e-（忘了设环境变量也不会弹窗）', src.includes('e2e-') && src.includes('process.argv'), 'env3');

  // ★ 关键：不许有绕过 safeShow 的裸显示调用
  //   （win.show() / showInactive() 只允许出现在 safeShow 内部）
  const lines = src.split('\n');
  const safeShowStart = lines.findIndex((l) => l.includes('function safeShow('));
  ok('能找到 safeShow 定义行', safeShowStart >= 0, String(safeShowStart));
  const offenders = [];
  lines.forEach((l, i) => {
    if (l.trim().startsWith('//')) return;                 // 注释不算
    if (i >= safeShowStart && i <= safeShowStart + 12) return;  // safeShow 自己内部允许
    if (/\.show\(\)/.test(l) || /\.showInactive\(\)/.test(l)) offenders.push((i + 1) + ': ' + l.trim());
  });
  ok('没有绕过 safeShow 的裸显示调用', offenders.length === 0, offenders.join(' | '));

  // 制作器窗口必须在创建时就 show:false（否则一创建就弹出来）
  const makerIdx = src.indexOf('function createMakerWindow(');
  const seg = src.slice(makerIdx, makerIdx + 900);
  ok('制作器窗口创建时 show:false', /show:\s*false/.test(seg), 'maker-show-false');
  ok('制作器窗口在无头时不显示', seg.includes('if (!HEADLESS)'), 'maker-headless');

  // 无头模式下**只对宠物窗口**关掉后台节流（setBackgroundThrottling），
  // 而不是在创建参数里设 backgroundThrottling —— 后者会改掉全局帧率行为，
  // 实测让多个时序套件回归（睡一会儿/动一下的断言全废）。
  ok('无头时对单个窗口关节流（不是全局改行为）',
    src.includes('setBackgroundThrottling(false)') && !src.includes('backgroundThrottling: false'),
    'scoped-throttle');
  ok('无头判定只用来"不显示窗口"', /if \(HEADLESS\) return;/.test(src), 'headless-return');
}
