// 待机行为状态机（纯函数，可单测）
// 用途：让桌宠「自己有事做」——爬动 / 发呆 / 打瞌睡 / 摸头反应，
// 而不是只有单纯的重力落地。
//
// 设计要点：
// - 状态机与物理分离：这里只决定「想要往哪走、想持续多久」，物理负责实现
// - 随机会话（session）+ 确定性 rng：便于测试复现
// - 摸头（pat）是外部事件，立即打断当前状态并进入反应

export const BEHAVIORS = {
  idle:     { label: '发呆',  minMs: 1500, maxMs: 5000, walk: false },
  walk:     { label: '爬动',  minMs: 2500, maxMs: 7000, walk: true },
  lookAround: { label: '张望', minMs: 900, maxMs: 1600, walk: false },
  doze:     { label: '打瞌睡', minMs: 3000, maxMs: 6000, walk: false },
  pat:      { label: '摸头',  minMs: 700,  maxMs: 950, walk: false },
  hit:      { label: '挨拳击', minMs: 520, maxMs: 620, walk: false },   // 被拳击后的受击反应
};

export const BEHAVIOR_NAMES = Object.keys(BEHAVIORS);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * 创建行为状态
 * @param rng 可注入的随机源（默认 Math.random），便于测试
 */
export function createBehavior({ rng = Math.random, idleBias = 0.22, walkBias = 0.52, dozeBias = 0.05 } = {}) {
  return {
    rng,
    state: 'idle',
    remaining: 0,
    walkDir: 0,      // -1 左 / 0 停 / 1 右
    patCount: 0,
    hitCount: 0,
    // 权重（会被归一化），允许调用方定制性格
    weights: { idle: idleBias, walk: walkBias, lookAround: 0.18, doze: dozeBias },
    lastState: 'idle',
  };
}

/** 按权重挑选下一个状态（避免连续两次都是同一状态） */
export function pickNextState(b, { allowDoze = true } = {}) {
  const entries = Object.entries(b.weights)
    .filter(([k, w]) => w > 0 && (allowDoze || k !== 'doze'))
    .filter(([k]) => k !== b.lastState);
  if (!entries.length) return 'idle';
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = b.rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function durationFor(b, state) {
  const def = BEHAVIORS[state] || BEHAVIORS.idle;
  const t = b.rng();
  return Math.round(def.minMs + (def.maxMs - def.minMs) * clamp(t, 0, 1));
}

/**
 * 选择爬动方向。
 * hint.leftEdge / hint.rightEdge：告知当前是否贴边，
 * 避免宠物朝墙走导致「原地踏步」（用户会觉得它卡住了）。
 */
function chooseWalkDir(b, hint) {
  if (hint && hint.leftEdge && hint.rightEdge) return b.rng() < 0.5 ? -1 : 1;
  if (hint && hint.leftEdge) return 1;    // 贴左墙 -> 向右
  if (hint && hint.rightEdge) return -1;  // 贴右墙 -> 向左
  const r = b.rng();
  return r < 0.5 ? -1 : 1;
}

/** 进入某个状态（内部） */
export function enterState(b, state, hint) {
  b.lastState = b.state;
  b.state = state;
  b.remaining = durationFor(b, state);
  b.walkDir = (BEHAVIORS[state] && BEHAVIORS[state].walk) ? chooseWalkDir(b, hint) : 0;
  return b;
}

/**
 * 推进时间；到达结束则自动切到下一个状态
 * @returns 是否发生了状态切换
 */
export function tickBehavior(b, dtMs, { allowDoze = true, edgeHint } = {}) {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return false;
  b.remaining -= dtMs;
  if (b.remaining > 0) return false;
  enterState(b, pickNextState(b, { allowDoze }), edgeHint);
  return true;
}

/** 摸头事件：立即进入 pat 状态（可打断一切） */
export function pat(b) {
  b.patCount++;
  enterState(b, 'pat');
  return b;
}

/**
 * 挨拳击事件：进入受击状态。
 * 返回击退方向（由调用方决定位移），1=向右飞 / -1=向左飞。
 * @param fromDir 攻击来向：1 表示从右打来（应向左飞），-1 表示从左打来
 */
export function hit(b, fromDir) {
  b.hitCount++;
  enterState(b, 'hit');
  const d = fromDir === 0 ? (b.rng() < 0.5 ? -1 : 1) : -fromDir;
  b.knockDir = d;
  return d;
}

/** 是否处于受击/摸头等「被打断」状态（此时不应自主移动） */
export function isReacting(b) {
  return b.state === 'pat' || b.state === 'hit';
}

/** 当前是否应当移动 */
export function isWalking(b) { return b.state === 'walk' && b.walkDir !== 0; }

/** 当前状态标签（用于气泡/调试） */
export function stateLabel(b) {
  const d = BEHAVIORS[b.state];
  return d ? d.label : b.state;
}

/**
 * 目标水平速度（像素/秒），由物理层叠加到 vx
 * 爬动时朝 walkDir 匀速；摸头/发呆时为 0（原地）
 */
export function targetVelocityX(b, speed = 60) {
  if (!isWalking(b)) return 0;
  return b.walkDir * speed;
}