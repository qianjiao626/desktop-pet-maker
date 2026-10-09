// 抓虫子玩法（纯逻辑，可单测）
//
// 设计：桌面上随机出现一只小虫子在跑；桌宠发现后会追过去，靠近就"扑"一下。
// 玩家也可以直接点掉虫子（点击优先级高于拖拽，交给 UI 层判定）。
// 这里只做位置/朝向/状态推进，渲染与物理在 pet.js 完成。
//
// 坐标全部是「相对宠物窗口画布」的像素值，由调用方给出可用范围。

export const BUG_STATES = {
  wander: { label: '爬来爬去' },
  flee:   { label: '被追赶' },
  tired:  { label: '跑累了' },
  caught: { label: '被抓住' },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function finite(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

/**
 * 创建一只虫子
 * @param opts.bounds  可活动范围 { x0, y0, x1, y1 }（画布像素）
 * @param opts.rng     可注入随机源（便于测试）
 */
export function createBug({ bounds = { x0: 0, y0: 0, x1: 100, y1: 100 }, rng = Math.random } = {}) {
  return {
    rng,
    bounds: { ...bounds },
    x: finite(bounds.x0, 0) + rng() * Math.max(1, finite(bounds.x1, 100) - finite(bounds.x0, 0)),
    y: 0,                 // 由调用方在构建时贴地
    dir: rng() < 0.5 ? -1 : 1,
    speed: 18 + rng() * 14,     // px/s
    state: 'wander',
    timer: 600 + rng() * 1400,  // 多久换一次方向
    caughtT: 0,                 // 被抓后的动画进度 0..1（600ms 走完）
    spawnT: 0,                  // 出现动画进度 0..1
    fleeMs: 0,                  // 已连续逃跑多久（用于"跑累了"）
    restMs: 0,                  // 还要休息多久（趴着不动）
    alive: true,
  };
}

/**
 * 推进虫子。返回本帧是否发生状态变化。
 * @param bug     createBug 的结果
 * @param dtMs    时间步（毫秒）
 * @param petX    宠物中心 x（用于"逃跑"倾向）
 */
export function stepBug(bug, dtMs, petX = null) {
  if (!bug || !bug.alive) return false;
  const dt = Math.max(0, Math.min(50, finite(dtMs, 0))) / 1000;
  if (dt <= 0) return false;

  // 出现动画
  if (bug.spawnT < 1) bug.spawnT = Math.min(1, bug.spawnT + dtMs / 320);

  if (bug.state === 'caught') {
    bug.caughtT = Math.min(1, bug.caughtT + dtMs / 600);
    if (bug.caughtT >= 1) bug.alive = false;
    return false;
  }

  // 「跑累了」：连续逃跑超过 1.2~2s 就趴下休息一段时间。
  // 没有这个机制的话，虫子会一直逃并贴到边界卡死，宠物永远扑不到（实测 bug）。
  if (bug.restMs > 0) {
    bug.restMs -= dtMs;
    bug.state = 'tired';
    // 休息时原地不动
    bug.timer = Math.max(bug.timer, 200);
    return true;
  }

  // 被宠物靠近就逃跑（朝远离宠物的方向跑）
  if (petX != null && Number.isFinite(petX)) {
    const d = bug.x - petX;
    if (Math.abs(d) < 70) {
      bug.state = 'flee';
      bug.fleeMs += dtMs;
      bug.dir = d === 0 ? (bug.rng() < 0.5 ? -1 : 1) : (d > 0 ? 1 : -1);
      bug.timer = 420;
      if (bug.fleeMs > 1200 + bug.rng() * 800) {
        bug.restMs = 900 + bug.rng() * 1300;   // 趴下歇一会儿，给宠物扑到的机会
        bug.fleeMs = 0;
      }
    } else if (bug.state === 'flee') {
      bug.state = 'wander';
      bug.fleeMs = 0;
      bug.timer = 500 + bug.rng() * 900;
    }
  }

  bug.timer -= dtMs;
  if (bug.timer <= 0) {
    bug.dir = bug.rng() < 0.5 ? -1 : 1;
    bug.timer = 600 + bug.rng() * 1600;
  }

  const sp = bug.speed * (bug.state === 'flee' ? 1.9 : 1);
  bug.x += bug.dir * sp * dt;

  // 撞到边界就掉头
  const x0 = finite(bug.bounds.x0, 0), x1 = finite(bug.bounds.x1, 100);
  if (bug.x < x0) { bug.x = x0; bug.dir = 1; }
  if (bug.x > x1) { bug.x = x1; bug.dir = -1; }
  return true;
}

/** 把虫子标记为被抓（播放"扑住"动画后消失） */
export function catchBug(bug) {
  if (!bug || !bug.alive || bug.state === 'caught') return false;
  bug.state = 'caught';
  bug.caughtT = 0;
  return true;
}

/** 虫子是否还能被追（活着且未被抓） */
export function isBugActive(bug) {
  return !!(bug && bug.alive && bug.state !== 'caught');
}

/**
 * 宠物是否够近，可以扑虫子
 * @param reactDist 触发距离（px）
 */
export function canPounce(bug, petX, reactDist = 34) {
  if (!isBugActive(bug)) return false;
  if (!Number.isFinite(petX)) return false;
  return Math.abs(bug.x - petX) <= reactDist;
}
