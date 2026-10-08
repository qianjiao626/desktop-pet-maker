// 纯物理（可单测）：重力 / 弹跳 / 摩擦 / 边界 / 漫游
export function createBody(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0, onGround: false, roamDir: 0, roamTimer: 1.5 + Math.random() * 2 };
}

/**
 * 推进一帧。直接修改 body。
 * env: { dt, gravity, bounce, friction, roamEnabled, roamSpeed, win:{w,h}, area:{x,y,width,height}, rng }
 */
export function stepBody(body, env) {
  const dt = Math.min(0.05, Math.max(0, env.dt || 0));
  if (dt <= 0) return body;
  const g = (env.gravity || 0) * 1600;
  const bounce = env.bounce ?? 0.55;
  const friction = env.friction ?? 0.985;
  const rng = env.rng || Math.random;
  const win = env.win, area = env.area;
  const groundY = area.y + area.height - win.h;

  if (env.roamEnabled && body.onGround) {
    body.roamTimer -= dt;
    if (body.roamTimer <= 0) {
      const r = rng();
      body.roamDir = r < 0.45 ? (rng() < 0.5 ? -1 : 1) : 0;
      body.roamTimer = 1.5 + rng() * 3.5;
    }
    const speed = (env.roamSpeed || 0) * 70;
    if (body.roamDir !== 0) body.vx += (body.roamDir * speed - body.vx) * Math.min(1, dt * 6);
    else body.vx *= Math.pow(0.9, dt * 60);
  }

  body.vy += g * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  if (body.onGround) body.vx *= Math.pow(friction, dt * 60);

  const left = area.x, right = area.x + area.width - win.w, top = area.y - 40;
  if (body.x < left) { body.x = left; body.vx = -body.vx * bounce; body.roamDir = 1; }
  if (body.x > right) { body.x = right; body.vx = -body.vx * bounce; body.roamDir = -1; }

  if (body.y >= groundY) {
    body.y = groundY;
    if (body.vy > 60) body.vy = -body.vy * bounce; else body.vy = 0;
    body.onGround = true;
  } else {
    body.onGround = false;
    if (body.y < top) { body.y = top; body.vy = Math.abs(body.vy) * bounce; }
  }

  if (body.onGround && Math.abs(body.vy) < 20) body.vy = 0;
  if (body.onGround && Math.abs(body.vx) < 3) body.vx = 0;

  return body;
}

export function clampIntoArea(body, win, area) {
  body.x = Math.min(Math.max(body.x, area.x), area.x + area.width - win.w);
  const groundY = area.y + area.height - win.h;
  body.y = Math.min(Math.max(body.y, area.y), groundY);
  if (body.y >= groundY) { body.onGround = true; }
  return body;
}

/** 从拖拽采样点估算甩出速度 */
export function estimateThrowVelocity(samples, { maxAgeMs = 120 } = {}) {
  if (!samples || samples.length < 2) return { vx: 0, vy: 0 };
  const now = samples[samples.length - 1].t;
  const recent = samples.filter((s) => now - s.t < maxAgeMs);
  const list = recent.length >= 2 ? recent : samples;
  const a = list[0], b = list[list.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}