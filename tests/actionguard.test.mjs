import { ok } from './_harness.mjs';
import { readFileSync } from 'node:fs';

// ★ 守护：托盘菜单的**破坏性动作**必须幂等（连点两次不该做两遍）。
//
// 背景（用户反复强调"不要让窗口重复在桌面跳出来影响我工作"）：
//   托盘菜单里「退出桌宠」这类动作本身没有防重入 ——
//   用户连点两次（很常见，菜单响应有时延迟）会重复执行副作用：
//   stopCursorFeed() / setCurrentScale(null) 各跑两遍，
//   逐只退出时 removePet 重复触发、托盘反复重建。
//
// 语义要点：quitPetNow 是**同步**的，第一次调用结束时已经清干净了，
// 所以"忙碌标记"式守卫没用（第二次调用时标记早清了）。
// 正确做法是**按当前状态判断**："没有在跑的宠物就什么都不做"。

// ---------- 复刻实现，验证连点只做一遍副作用 ----------
function makeQuitPetNow() {
  let petWindow = { destroyed: false, isDestroyed() { return this.destroyed; }, close() { this.destroyed = true; } };
  let petHidden = false;
  const calls = { cursorStops: 0, scaleClears: 0, setPetWindow: 0 };
  function getPetWindow() { return petWindow && !petWindow.destroyed ? petWindow : null; }
  function quitPetNow() {
    const w = getPetWindow();
    if (!w || w.isDestroyed()) {
      if (petWindow === null && !petHidden) return false;
    }
    if (w && !w.isDestroyed()) w.close();
    calls.setPetWindow++;
    petWindow = null;
    calls.cursorStops++;
    calls.scaleClears++;
    petHidden = false;
    return true;
  }
  return { quitPetNow, calls, state: () => ({ petWindow, petHidden }) };
}

{
  const t = makeQuitPetNow();
  const r1 = t.quitPetNow();
  const r2 = t.quitPetNow();
  const r3 = t.quitPetNow();
  ok('第一次退出真的执行了', r1 === true, String(r1));
  ok('第二次退出被跳过（返回 false）', r2 === false, String(r2));
  ok('第三次退出也被跳过', r3 === false, String(r3));
  ok('stopCursorFeed 只执行一次', t.calls.cursorStops === 1, String(t.calls.cursorStops));
  ok('setCurrentScale(null) 只执行一次', t.calls.scaleClears === 1, String(t.calls.scaleClears));
  ok('setPetWindow 只执行一次', t.calls.setPetWindow === 1, String(t.calls.setPetWindow));
}

// ---------- 没有宠物时调用也不该报错/产生副作用 ----------
{
  const t = makeQuitPetNow();
  t.quitPetNow();          // 先退掉
  const before = JSON.stringify(t.calls);
  t.quitPetNow();
  t.quitPetNow();
  ok('已退出后重复调用不产生新副作用', JSON.stringify(t.calls) === before, before + ' -> ' + JSON.stringify(t.calls));
}

// ---------- 静态守护：main.js 里 quitPetNow / quitPetById 必须带状态判断 ----------
{
  const main = readFileSync('src/main/main.js', 'utf8');

  const quitNow = main.match(/function quitPetNow\(\) \{[\s\S]*?\n\}/);
  ok('找到 quitPetNow', !!quitNow, 'missing');
  ok('quitPetNow 有"没有在跑的宠物就返回"的状态判断（连点不会做两遍）',
    !!quitNow && /if \(!w \|\| w\.isDestroyed\(\)\)/.test(quitNow[0])
    && /return false;/.test(quitNow[0]), quitNow ? quitNow[0].slice(0, 200) : '');

  const quitById = main.match(/function quitPetById\(id\) \{[\s\S]*?\n\}/);
  ok('找到 quitPetById', !!quitById, 'missing');
  ok('quitPetById 先查记录还在不在（连点第二次查不到就直接返回）',
    !!quitById && /const rec = getPet\(id\);/.test(quitById[0])
    && /if \(!rec \|\| !rec\.win \|\| rec\.win\.isDestroyed\(\)\) return false;/.test(quitById[0]),
    quitById ? quitById[0].slice(0, 200) : '');

  // 逐只退出必须"按 id 各自判断"，不能被一个全局忙碌标记挡住（否则同时退两只时第二只退不掉）
  ok('quitPetById 没有全局忙碌标记（同时退多只不受影响）',
    !!quitById && !/isRunning|busy|guardOnce/.test(quitById[0]), 'no-global-guard');

  // createTray 本身必须幂等（重复调用不该产生两个托盘图标）
  const tray = main.match(/export function createTray\(\) \{[\s\S]*?\n\}/);
  ok('找到 createTray', !!tray, 'missing');
  ok('createTray 幂等（已存在就返回，不再建一个托盘）',
    !!tray && /if \(tray && !tray\.isDestroyed\(\)\) return tray;/.test(tray[0]),
    tray ? tray[0].slice(0, 160) : '');
}
