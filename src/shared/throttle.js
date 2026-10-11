// 桌宠的「省电节流」（纯逻辑，可单测）。
//
// 为什么需要：宠物窗口是**常驻**的，而且没有任何帧率上限 ——
// 一只静坐不动的桌宠也会以显示器刷新率（60/120/144Hz）全速重绘。
// 养 4 只就是 4 个渲染进程 × 144Hz 全速跑，笔记本电池掉得很快、
// 风扇也会转起来。而实际上：宠物发呆/打瞌睡时，画面**几秒才变一次**。
//
// 做法：按「当前状态的画面变化速度」决定目标帧率，而不是一刀切 60fps。
//   静止 / 打瞌睡 -> 10fps（省电为主）
//   走路 / 发呆   -> 30fps
//   被摸 / 被打 / 跳跃 / 拖拽 -> 满帧（跟手，不能卡）
//
// 关键：**降帧不能改变物理**。所以这里只决定"这一帧要不要真的画 / 推进"，
// 物理步进改用真实流逝时间（dt），与帧率解耦。

/** 每种状态的目标帧率（fps） */
export const STATE_FPS = {
  doze: 10,      // 打瞌睡：画面几乎不变
  idle: 20,      // 发呆：有轻微呼吸
  lookAround: 24,
  walk: 30,
  hop: 60,       // 跳跃要跟手
  hit: 60,
  pat: 60,       // 被摸要顺滑
};

/** 默认（未知状态）帧率 */
export const DEFAULT_FPS = 30;
/** 有这些情况时一律满帧 */
export const FULL_FPS = 60;

/**
 * 算这一帧的目标 fps。
 * @param opt.state       行为状态
 * @param opt.dragging    是否正在被拖动（拖动必须满帧，否则跟手很差）
 * @param opt.hasOverlay  是否有特效在播（手/拳/星星）
 * @param opt.moving      是否在移动（速度不为 0）
 * @param opt.walking     是否在走
 * @param opt.maxFps      设备上限（不给就用 60）
 */
export function targetFps(opt = {}) {
  const s = String(opt.state || '');

  // 1) 被拖动 / 有特效：必须满帧（这两个场景卡顿最明显）
  if (opt.dragging || opt.hasOverlay) return FULL_FPS;

  // 2) 打瞌睡优先：睡着就是省电（除非上面那两条）。
  //    不能因为"残余速度不为 0"就抬回满帧 —— 实测那会让省电完全失效。
  if (s === 'doze') return clampToMax(STATE_FPS.doze, opt);

  // 3) 有外力在推（惯性甩出 / 被撞飞）：需要满帧跟手。
  //    注意 walking（状态机在走）**不算外力** —— 走路的画面 30fps 足够，
  //    而走路时速度一直不为 0，如果按速度给满帧，省电就被彻底绕过了（实测踩到）。
  if (opt.moving) return FULL_FPS;

  // 4) 状态机在走路：至少给 30fps
  if (opt.walking) return clampToMax(Math.max(STATE_FPS.walk, 1), opt);

  // 5) 其余按状态查表
  const f = STATE_FPS[s];
  if (!Number.isFinite(f)) return clampToMax(DEFAULT_FPS, opt);
  return clampToMax(f, opt);
}

/** 把帧率钳到设备上限（上限非法时用满帧） */
function clampToMax(fps, opt) {
  const max = Number(opt && opt.maxFps);
  const cap = (Number.isFinite(max) && max > 0) ? max : FULL_FPS;
  return Math.min(fps, cap);
}

/**
 * 判断这一帧该不该真的推进（渲染 + 物理）。
 * 用「累计时间」而不是丢帧计数：否则帧率会随显示器刷新率漂移。
 * @param opt.now       当前时间戳（ms）
 * @param opt.lastDraw  上次真正绘制的时间戳（ms）
 * @param opt.fps       目标帧率
 * @returns { draw: boolean, dt: number } dt 是距上次真实绘制的毫秒数（给物理用）
 */
export function frameGate(opt = {}) {
  const now = Number(opt.now) || 0;
  const last = Number(opt.lastDraw) || 0;
  // fps 非法（0 / 负数 / NaN）时**退回默认**，而不是当成 1fps ——
  // 当成 1fps 会让画面一秒才动一次，看起来像卡死（实测这条断言抓到的）。
  const raw = Number(opt.fps);
  const fps = (Number.isFinite(raw) && raw > 0) ? Math.min(240, raw) : DEFAULT_FPS;
  const minGap = 1000 / fps;
  if (!last) return { draw: true, dt: 0 };
  const elapsed = now - last;
  // 如果已经超过两帧的时间，说明这一帧必须画（别把动画拖慢）
  if (elapsed >= minGap) return { draw: true, dt: elapsed };
  return { draw: false, dt: 0 };
}

/**
 * 把「省电」这件事按总开关算一下：用户可以在制作器里关掉节流。
 * @param opt.enabled 用户是否开启了省电（默认开）
 */
export function applyThrottle(opt = {}) {
  if (opt.enabled === false) return FULL_FPS;   // 用户关了省电 -> 一律满帧
  return targetFps(opt);
}
