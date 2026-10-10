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
  hop:      { label: '跳跃',  minMs: 620,  maxMs: 760, walk: false },   // 自己蹦一下
  pat:      { label: '摸头',  minMs: 700,  maxMs: 950, walk: false },
  hit:      { label: '挨拳击', minMs: 520, maxMs: 620, walk: false },   // 被拳击后的受击反应
};

export const BEHAVIOR_NAMES = Object.keys(BEHAVIORS);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * 创建行为状态
 * @param rng 可注入的随机源（默认 Math.random），便于测试
 */
export function createBehavior({ rng = Math.random, idleBias = 0.22, walkBias = 0.52, dozeBias = 0.05, hopBias = 0.16 } = {}) {
  return {
    rng,
    state: 'idle',
    remaining: 0,
    duration: 0,
    walkDir: 0,      // -1 左 / 0 停 / 1 右
    patCount: 0,
    hitCount: 0,
    // 权重（会被归一化），允许调用方定制性格
    weights: { idle: idleBias, walk: walkBias, lookAround: 0.18, doze: dozeBias, hop: hopBias },
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
  b.duration = b.remaining;                 // 本次状态总时长（跳跃进度要用）
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
/**
 * 跳跃进度与姿态。
 * 跳跃是「起跳 -> 滞空 -> 落地」三段的确定曲线，渲染层据此决定抬高多少、怎么挤压。
 * 用剩余时间反推进度，避免再引入一个计时器（状态机切走时自然归零）。
 *
 * @returns {null|{t:number, lift:number, squash:number, stretch:number}}
 *   t       0..1 本次跳跃的进度
 *   lift    0..1 抬升比例（渲染层乘以最大跳跃高度）
 *   squash  纵向挤压系数（落地时 < 1 表示压扁）
 *   stretch 纵向拉伸系数（起跳/滞空时 > 1 表示拉长）
 */
export function hopPose(b) {
  if (!b || b.state !== 'hop') return null;
  const total = b.duration > 0 ? b.duration : 0;
  if (!total) return null;
  const t = Math.min(1, Math.max(0, 1 - b.remaining / total));

  // 三段：起跳(0~0.18) 加速上抬；滞空(0.18~0.72) 抛物线；落地(0.72~1) 压缩回弹
  let lift, squash = 1, stretch = 1;
  if (t < 0.18) {
    const k = t / 0.18;
    lift = 0.55 * k * k;              // 起跳加速
    stretch = 1 + 0.10 * k;           // 拉长
  } else if (t < 0.72) {
    const k = (t - 0.18) / 0.54;
    lift = 0.55 + 0.45 * Math.sin(k * Math.PI);   // 滞空抛物线，最高点约 1.0
    stretch = 1 + 0.06 * (1 - Math.abs(k - 0.5) * 2);
  } else {
    const k = (t - 0.72) / 0.28;
    lift = 0.55 * (1 - k);            // 下落
    squash = 1 - 0.14 * Math.sin(k * Math.PI);     // 落地压扁再回弹
    stretch = 1;
  }
  return { t, lift: Math.max(0, Math.min(1, lift)), squash, stretch };
}

/**
 * 打瞌睡/睡着的姿态。
 * 与 doze 状态配套：比普通发呆更"塌下去"，并且呼吸节奏更慢更沉。
 * 纯函数，便于单测（渲染层只负责把它乘到 scaleX/scaleY 上）。
 *
 * @param t 秒（performance.now()/1000）
 * @param progress 0..1 本次睡眠已进行的比例（用于"越睡越沉"）
 */
export function dozePose(t, progress = 0) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  // 呼吸：比醒着慢（约 0.35Hz），幅度略大，像深呼吸
  const breathe = Math.sin((Number.isFinite(t) ? t : 0) * 2.2);
  // 越睡越沉：下沉量随进度增加（最多再多 2%）
  const sink = 0.96 - 0.02 * p;
  return {
    scaleY: sink + breathe * 0.022,
    scaleX: (1 / Math.sqrt(sink)) - breathe * 0.010,
    // 呼吸越深，纵向越"摊开"，配合 1/sqrt 的体积感
    breathe,
  };
}

/** 睡着时是否该打呼（按睡眠进度节流，避免一直冒） */
export function shouldSnore(progress) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  // 前 35% 不打呼（刚躺下还在酝酿），之后才出呼噜
  return p >= 0.35;
}

/**
 * 「看向鼠标」的姿态偏置。
 *
 * 设计取舍：桌宠窗口本身只有约 160px，做「追着鼠标跑」既不自然也容易烦人
 * （宠物会满屏乱窜）。这里只做**视线跟随的观感** —— 整体朝鼠标方向轻微倾斜 + 位移，
 * 幅度刻意很小（默认约 1.5° / 3px），像在"瞄"着你的鼠标，而不是追过去。
 *
 * @param dx 鼠标相对宠物中心的水平像素差（正 = 在右侧）
 * @param dy 鼠标相对宠物中心的垂直像素差（正 = 在下方）
 * @param reach 触发跟随的距离阈值（超出后按比例放大，直到饱和）
 * @returns {{rot:number, dx:number, dy:number, lean:number}} lean 为 -1..1 的归一化方向
 */
export function lookAtPose(dx, dy, reach = 260) {
  const rx = Number.isFinite(dx) ? dx : 0;
  const ry = Number.isFinite(dy) ? dy : 0;
  const R = Number.isFinite(reach) && reach > 0 ? reach : 260;

  const dist = Math.hypot(rx, ry);
  if (dist < 1) return { rot: 0, dx: 0, dy: 0, lean: 0 };

  // 归一化并做软饱和：近处线性、远处趋于 1（避免鼠标一远就夸张变形）
  const nx = rx / Math.max(dist, R);
  const ny = ry / Math.max(dist, R);
  const lean = Math.min(1, dist / R);

  return {
    rot: nx * 1.6 * lean,    // 最多约 1.6° 倾斜，只求"看了你一眼"的感觉
    dx: nx * 3 * lean,       // 水平最多 3px
    dy: ny * 2 * lean,       // 垂直最多 2px（上下跟随比左右更轻）
    lean,
  };
}
