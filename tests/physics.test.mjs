import { ok } from './_harness.mjs';
import { createBody, stepBody, estimateThrowVelocity, clampIntoArea } from '../src/shared/physics.js';

const area = { x: 0, y: 0, width: 800, height: 600 }, win = { w: 200, h: 200 };
const env = { dt: 1 / 60, gravity: 1.2, bounce: 0.55, friction: 0.985, roamEnabled: false, roamSpeed: 1, win, area, rng: () => 0.9 };

let b = createBody(100, 0);
for (let i = 0; i < 600; i++) stepBody(b, env);
ok('自由落体停在底部', Math.abs(b.y - 400) < 1 && b.onGround, 'y=' + b.y.toFixed(1));

b = createBody(100, 400); b.onGround = true; b.vy = -600;
let maxUp = 400;
for (let i = 0; i < 40; i++) { stepBody(b, env); if (b.y < maxUp) maxUp = b.y; }
ok('向上速度使宠物弹起', maxUp < 380, 'minY=' + maxUp.toFixed(1));

b = createBody(100, 100);
for (let i = 0; i < 60; i++) stepBody(b, { ...env, gravity: 0 });
ok('重力为0保持高度', Math.abs(b.y - 100) < 1);

b = createBody(700, 400); b.onGround = true; b.vx = 800;
let bounced = false;
for (let i = 0; i < 60; i++) { stepBody(b, env); if (b.vx < 0) { bounced = true; break; } }
ok('右边界反弹', bounced && b.x <= 600.5, 'x=' + b.x.toFixed(1));

b = createBody(10, 400); b.onGround = true; b.vx = -800;
bounced = false;
for (let i = 0; i < 60; i++) { stepBody(b, env); if (b.vx > 0) { bounced = true; break; } }
ok('左边界反弹', bounced && b.x >= 0);

let i2 = 0; const seq = [0.1, 0.2, 0.9, 0.9];
b = createBody(400, 400); b.onGround = true;
const x0 = b.x;
for (let i = 0; i < 240; i++) stepBody(b, { ...env, roamEnabled: true, roamSpeed: 1, rng: () => seq[i2++ % 4] });
ok('漫游产生位移', Math.abs(b.x - x0) > 1, 'dx=' + (b.x - x0).toFixed(1));

const now = 1000;
const samples = [0, 1, 2, 3, 4].map((i) => ({ t: now - 80 + i * 20, x: i * 20, y: 0 }));
ok('甩出速度估算≈1000', Math.abs(estimateThrowVelocity(samples).vx - 1000) < 200);
ok('采样不足返回0', estimateThrowVelocity([{ t: 0, x: 0, y: 0 }]).vx === 0);

b = createBody(-500, -500); clampIntoArea(b, win, area);
ok('clamp 左上拉到(0,0)', b.x === 0 && b.y === 0);
b = createBody(99999, 99999); clampIntoArea(b, win, area);
ok('clamp 右下拉到地面', b.x === 600 && b.y === 400 && b.onGround);