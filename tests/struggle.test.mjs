import { ok } from './_harness.mjs';
import { strugglePose, STRUGGLE_LIMITS } from '../src/shared/effects.js';

// ---------- 基本结构 ----------
const p = strugglePose(0.1, 0);
ok('返回全部姿态字段', ['rot','dx','dy','scaleX','scaleY'].every(k => Number.isFinite(p[k])), JSON.stringify(p));

// ---------- 会晃（不是静止） ----------
const vs = [];
for (let i = 0; i <= 40; i++) vs.push(strugglePose(i * 0.05, 0).rot);
const rotRange = Math.max(...vs) - Math.min(...vs);
ok('静止拎起时也会左右晃', rotRange > 4, 'Δrot=' + rotRange.toFixed(2));
ok('左右晃有正有负（真的在摆）', Math.min(...vs) < -1 && Math.max(...vs) > 1);

// ---------- 甩得快 -> 晃得更厉害 ----------
const slowPts = [], fastPts = [];
for (let i = 0; i <= 40; i++) {
  slowPts.push(Math.abs(strugglePose(i * 0.05, 0).rot));
  fastPts.push(Math.abs(strugglePose(i * 0.05, 2000).rot));
}
const slowMax = Math.max(...slowPts), fastMax = Math.max(...fastPts);
ok('甩得快时晃得更明显', fastMax > slowMax, `fast=${fastMax.toFixed(2)} > slow=${slowMax.toFixed(2)}`);

// ---------- 幅度受控（不能夸张到变形） ----------
ok('倾斜不超上限', Math.max(...fastPts) <= STRUGGLE_LIMITS.maxRot + 0.01, 'max=' + Math.max(...fastPts).toFixed(2));
const dxs = [], dys = [], sys = [];
for (let i = 0; i <= 60; i++) {
  const q = strugglePose(i * 0.05, 5000);
  dxs.push(Math.abs(q.dx)); dys.push(Math.abs(q.dy)); sys.push(q.scaleY);
}
ok('水平位移不超上限', Math.max(...dxs) <= STRUGGLE_LIMITS.maxDx + 0.01, 'max=' + Math.max(...dxs).toFixed(2));
ok('垂直位移不超上限', Math.max(...dys) <= STRUGGLE_LIMITS.maxDy + 0.01, 'max=' + Math.max(...dys).toFixed(2));
ok('纵向拉伸不超上限', Math.max(...sys) <= STRUGGLE_LIMITS.maxScaleY + 0.01, 'max=' + Math.max(...sys).toFixed(3));

// ---------- 被拎起来略微拉长，且保持体积感 ----------
const q = strugglePose(0, 0);
ok('被拎起来略微拉长（scaleY > 1）', q.scaleY > 1, 'sy=' + q.scaleY.toFixed(3));
ok('拉长时按体积感变窄（scaleX < 1）', q.scaleX < 1, 'sx=' + q.scaleX.toFixed(3));
ok('体积守恒近似（sx*sx*sy ≈ 1）', Math.abs(q.scaleX * q.scaleX * q.scaleY - 1) < 0.02,
  'sx²sy=' + (q.scaleX * q.scaleX * q.scaleY).toFixed(4));

// ---------- 上下轻摆与左右摇摆相位不同（避免像死板钟摆） ----------
const pairs = [];
for (let i = 0; i <= 30; i++) pairs.push([strugglePose(i * 0.05, 0).rot, strugglePose(i * 0.05, 0).dy]);
ok('上下摆动与左右摇摆不完全同相', (() => {
  let same = 0, tot = 0;
  for (const [r, d] of pairs) { if (Math.abs(r) > 0.5 && Math.abs(d) > 0.1) { tot++; if (Math.sign(r) === Math.sign(d)) same++; } }
  return tot === 0 || same / tot < 0.95;   // 不同相：同号比例不应接近 1
})(), '同相比例=' + (() => { let s=0,t=0; for (const [r,d] of pairs) if (Math.abs(r)>0.5&&Math.abs(d)>0.1){t++;if(Math.sign(r)===Math.sign(d))s++;} return t? (s/t).toFixed(2):'-'; })());

// ---------- 容错 ----------
ok('t 为 NaN 安全', Number.isFinite(strugglePose(NaN, 100).rot));
ok('speed 为 NaN 安全', Number.isFinite(strugglePose(1, NaN).rot));
ok('speed 为负安全', Number.isFinite(strugglePose(1, -100).rot));
ok('无参数安全', Number.isFinite(strugglePose().rot));
ok('极端速度不会爆炸', Math.abs(strugglePose(0.1, 1e9).rot) <= STRUGGLE_LIMITS.maxRot + 0.01,
  'rot=' + strugglePose(0.1, 1e9).rot.toFixed(2));

// ---------- 连续性：不能出现突跳 ----------
let maxJump = 0;
let prev = strugglePose(0, 400).rot;
for (let i = 1; i <= 100; i++) {
  const cur = strugglePose(i * 0.016, 400).rot;
  maxJump = Math.max(maxJump, Math.abs(cur - prev));
  prev = cur;
}
ok('摆动曲线连续（无突变）', maxJump < 2.5, 'maxΔ=' + maxJump.toFixed(3));
