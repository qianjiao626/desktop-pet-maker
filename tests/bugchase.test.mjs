import { ok } from './_harness.mjs';
import { createBug, stepBug, catchBug, isBugActive, canPounce, BUG_STATES } from '../src/shared/bugchase.js';

// 确定性随机源
const seq = (vals) => { let i = 0; return () => vals[(i++) % vals.length]; };
const B = { x0: 0, y0: 0, x1: 200, y1: 100 };

// ============ 创建 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5, 0.3, 0.5]) });
  ok('虫子初始存活', bug.alive === true);
  ok('虫子初始在活动范围内', bug.x >= B.x0 && bug.x <= B.x1, String(bug.x));
  ok('虫子初始状态为 wander', bug.state === 'wander');
  ok('虫子有正速度', bug.speed > 0);
  ok('虫子有朝向', bug.dir === 1 || bug.dir === -1);
}
ok('缺少参数不崩溃', createBug && createBug({}).alive === true);

// ============ 移动 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  const x0 = bug.x;
  stepBug(bug, 200, null);
  ok('虫子会移动', bug.x !== x0, x0.toFixed(2) + ' -> ' + bug.x.toFixed(2));
}
{
  // 撞到右边界应掉头
  const bug = createBug({ bounds: { x0: 0, y0: 0, x1: 100, y1: 10 }, rng: seq([0.99]) });
  bug.x = 99.5; bug.dir = 1; bug.timer = 9999;
  stepBug(bug, 500, null);
  ok('虫子撞右边界后掉头', bug.dir === -1 && bug.x <= 100, 'dir=' + bug.dir + ' x=' + bug.x.toFixed(1));
}
{
  const bug = createBug({ bounds: B, rng: seq([0.01]) });
  bug.x = 0.5; bug.dir = -1; bug.timer = 9999;
  stepBug(bug, 500, null);
  ok('虫子撞左边界后掉头', bug.dir === 1 && bug.x >= 0, 'dir=' + bug.dir);
}

// ============ 逃跑 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  bug.x = 100;
  stepBug(bug, 16, 90);          // 宠物在虫子左边很近
  ok('宠物靠近时进入逃跑', bug.state === 'flee', bug.state);
  ok('逃跑方向背离宠物', bug.dir === 1, 'dir=' + bug.dir);
}
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  bug.x = 100;
  stepBug(bug, 16, 160);         // 宠物在虫子右边
  ok('从另一侧靠近也正确逃跑', bug.dir === -1, 'dir=' + bug.dir);
}
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  bug.state = 'flee';
  stepBug(bug, 16, 400);         // 宠物很远
  ok('宠物远离后恢复 wander', bug.state === 'wander', bug.state);
}

// ============ 抓取 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  ok('初始可抓', isBugActive(bug) === true);
  ok('抓取成功返回 true', catchBug(bug) === true);
  ok('抓后状态为 caught', bug.state === 'caught');
  ok('抓后不可再抓', catchBug(bug) === false);
  ok('抓后 isBugActive=false', isBugActive(bug) === false);
  // 播放完动画后消失
  for (let i = 0; i < 40; i++) stepBug(bug, 50, null);
  ok('动画播完虫子消失', bug.alive === false);
}
ok('抓 null 不崩溃', catchBug(null) === false);
ok('isBugActive(null)=false', isBugActive(null) === false);

// ============ 扑击判定 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  bug.x = 100;
  ok('够近可扑', canPounce(bug, 110) === true);
  ok('太远不可扑', canPounce(bug, 200) === false);
  catchBug(bug);
  ok('抓后不可扑', canPounce(bug, 100) === false);
}
ok('NaN 宠物位置不可扑', canPounce(createBug({ rng: seq([0.5]) }), NaN) === false);

// ============ 健壮性 ============
{
  const bug = createBug({ bounds: B, rng: seq([0.5]) });
  const x0 = bug.x;
  stepBug(bug, NaN, null);
  stepBug(bug, -100, null);
  ok('非法 dt 不移动', bug.x === x0, String(bug.x));
  ok('超长 dt 被夹取（不会瞬移）', (() => {
    const b2 = createBug({ bounds: B, rng: seq([0.5]) });
    b2.timer = 9999; b2.dir = 1; b2.x = 0;
    stepBug(b2, 100000, null);
    return b2.x <= B.x1;
  })());
}
ok('状态表包含三种状态', BUG_STATES.wander && BUG_STATES.flee && BUG_STATES.caught);
