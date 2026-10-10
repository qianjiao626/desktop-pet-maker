import { ok } from './_harness.mjs';
import { dozePose, shouldSnore, lookAtPose } from '../src/shared/behavior.js';

// ---------- dozePose：睡觉姿态 ----------
const d0 = dozePose(0, 0);
ok('返回 scaleX/scaleY', Number.isFinite(d0.scaleX) && Number.isFinite(d0.scaleY));
ok('睡着比醒着塌（scaleY < 1）', d0.scaleY < 1, 'sy=' + d0.scaleY.toFixed(3));
ok('塌下去时按体积感变宽（scaleX > 1）', d0.scaleX > 1, 'sx=' + d0.scaleX.toFixed(3));
ok('形变幅度温和（不夸张）', d0.scaleY > 0.85 && d0.scaleX < 1.20, `sy=${d0.scaleY.toFixed(3)} sx=${d0.scaleX.toFixed(3)}`);

// 越睡越沉
const p0 = dozePose(1.0, 0), p1 = dozePose(1.0, 1);
ok('越睡越沉（progress 越大越塌）', p1.scaleY < p0.scaleY, `${p1.scaleY.toFixed(4)} < ${p0.scaleY.toFixed(4)}`);

// 呼吸：时间变化会带来起伏
const samples = [0, 0.3, 0.6, 0.9, 1.2, 1.5].map(t => dozePose(t, 0.5).scaleY);
ok('呼吸造成周期起伏', Math.max(...samples) - Math.min(...samples) > 0.01, 'Δ=' + (Math.max(...samples) - Math.min(...samples)).toFixed(4));
ok('呼吸幅度克制（不超 ±5%）', Math.max(...samples) - Math.min(...samples) < 0.10);

// 容错
ok('progress 越界被夹取', dozePose(0, 99).scaleY === dozePose(0, 1).scaleY);
ok('progress 为 NaN 安全', Number.isFinite(dozePose(0, NaN).scaleY));
ok('t 为 NaN 安全', Number.isFinite(dozePose(NaN, 0.5).scaleY));
ok('全参数缺失安全', Number.isFinite(dozePose().scaleX));

// ---------- shouldSnore：打呼时机 ----------
ok('刚躺下不打呼', shouldSnore(0) === false);
ok('睡到 20% 仍不打呼', shouldSnore(0.2) === false);
ok('睡到 35% 开始打呼', shouldSnore(0.35) === true);
ok('睡熟后打呼', shouldSnore(0.9) === true);
ok('越界值安全（负数）', shouldSnore(-5) === false);
ok('越界值安全（超大）', shouldSnore(99) === true);
ok('NaN 安全', shouldSnore(NaN) === false);

// ---------- lookAtPose：看向鼠标 ----------
const neutral = lookAtPose(0, 0);
ok('鼠标在中心时不偏移', neutral.rot === 0 && neutral.dx === 0 && neutral.dy === 0);
ok('中心时 lean 为 0', neutral.lean === 0);

const right = lookAtPose(300, 0);
ok('鼠标在右侧 -> 向右倾（rot > 0）', right.rot > 0, 'rot=' + right.rot.toFixed(3));
ok('鼠标在右侧 -> 向右偏移', right.dx > 0, 'dx=' + right.dx.toFixed(3));
const left = lookAtPose(-300, 0);
ok('鼠标在左侧 -> 向左倾', left.rot < 0, 'rot=' + left.rot.toFixed(3));
ok('左右对称', Math.abs(right.rot + left.rot) < 1e-9, 'rot 对称');

const below = lookAtPose(0, 300);
ok('鼠标在下方 -> 向下偏移（dy > 0）', below.dy > 0, 'dy=' + below.dy.toFixed(3));
const above = lookAtPose(0, -300);
ok('鼠标在上方 -> 向上偏移', above.dy < 0);

// 幅度克制：不能做"追着鼠标跑"的效果
ok('倾斜幅度很小（不超 2°）', Math.abs(right.rot) <= 2, 'rot=' + right.rot.toFixed(3));
ok('水平位移很小（不超 4px）', Math.abs(right.dx) <= 4, 'dx=' + right.dx.toFixed(3));
ok('垂直位移更小（不超 3px）', Math.abs(below.dy) <= 3, 'dy=' + below.dy.toFixed(3));
ok('近距离时偏移较小（未饱和）', Math.abs(lookAtPose(40, 0).dx) < Math.abs(right.dx), 'near < far');

// 软饱和：极远时不超过上限
const far = lookAtPose(99999, 0);
ok('极远时饱和但仍在上限内', Math.abs(far.rot) <= 2 && Math.abs(far.dx) <= 4, `rot=${far.rot.toFixed(3)} dx=${far.dx.toFixed(3)}`);
ok('极远时 lean 达到 1', far.lean === 1);

// 对角线：两个方向都生效，但总位移不失控
const diag = lookAtPose(300, 300);
ok('对角方向同时生效', Math.abs(diag.rot) > 0 && Math.abs(diag.dy) > 0);
ok('对角位移不叠加失控', Math.hypot(diag.dx, diag.dy) <= 5, 'len=' + Math.hypot(diag.dx, diag.dy).toFixed(3));

// 容错
ok('NaN 输入安全', (() => { const r = lookAtPose(NaN, NaN); return r.rot === 0 && r.dx === 0; })());
ok('缺失参数安全', Number.isFinite(lookAtPose().rot));
ok('reach 非法时用默认值', Number.isFinite(lookAtPose(100, 0, 0).rot));
// 极微小的抖动不应触发（避免静止鼠标导致宠物一直微颤）
ok('极小偏移被忽略（防抖）', lookAtPose(0.2, 0.2).lean === 0, 'lean=' + lookAtPose(0.2, 0.2).lean);
