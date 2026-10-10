import { ok } from './_harness.mjs';
import { parseKeypoints } from '../src/shared/pose.js';
import { bodyBounds } from '../src/shared/autofit.js';
import {
  LIMB_CHAIN, LIMB_LABELS, MOTIONS, DEFAULT_MOTION, MAX_AMPLITUDE,
  findMotion, zeroPose, motionSequence, amplitudeCheck, loopClosure,
  canAnimate, solveJoints, motionBounds,
} from '../src/shared/limb.js';

const NAMES = ['nose','leftEye','rightEye','leftEar','rightEar','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'];
function kps(spec) {
  const r = new Array(51).fill(0);
  for (const [n, x, y, s] of spec) { const i = NAMES.indexOf(n); if (i >= 0) { r[i*3]=y; r[i*3+1]=x; r[i*3+2]=s; } }
  return parseKeypoints(r);
}
/** 标准立绘：正面、四肢张开、互不重叠 */
const SPRITE = kps([
  ['nose',0.50,0.16,0.9],['leftEar',0.57,0.15,0.9],['rightEar',0.43,0.15,0.9],
  ['leftShoulder',0.58,0.31,0.9],['rightShoulder',0.42,0.31,0.9],
  ['leftElbow',0.75,0.45,0.9],['rightElbow',0.25,0.45,0.9],
  ['leftWrist',0.88,0.58,0.9],['rightWrist',0.12,0.58,0.9],
  ['leftHip',0.55,0.65,0.9],['rightHip',0.45,0.65,0.9],
  ['leftKnee',0.60,0.79,0.9],['rightKnee',0.40,0.79,0.9],
  ['leftAnkle',0.60,0.93,0.9],['rightAnkle',0.40,0.93,0.9],
]);

// ---------- 结构 ----------
ok('动作数 >= 4', MOTIONS.length >= 4, 'n=' + MOTIONS.length);
ok('每个动作有 id/name/emoji/desc/pose', MOTIONS.every((m) => m.id && m.name && m.emoji && m.desc && typeof m.pose === 'function'));
ok('动作 id 不重复', new Set(MOTIONS.map((m) => m.id)).size === MOTIONS.length);
ok('默认动作存在', findMotion(DEFAULT_MOTION) !== null, DEFAULT_MOTION);
ok('未知动作返回 null', findMotion('nope') === null);
ok('关节链定义了 8 段肢体', LIMB_CHAIN.length === 8, 'n=' + LIMB_CHAIN.length);
ok('关节链每项格式正确', LIMB_CHAIN.every((x) => Array.isArray(x) && x.length === 4));
ok('每段肢体都有中文名', LIMB_CHAIN.every(([n]) => typeof LIMB_LABELS[n] === 'string'));
ok('关节链引用的是真实关键点', LIMB_CHAIN.every(([, a, b]) => NAMES.includes(a) && NAMES.includes(b)));

// ---------- 核心约束：必须是微动作 ----------
// 大动作在静态素材上必然穿帮（上一轮三条路线实测失败），必须被测试拦住。
ok('幅度上限很小（<= 0.13 弧度 ≈ 7.5°）', MAX_AMPLITUDE <= 0.13, String(MAX_AMPLITUDE));
for (const m of MOTIONS) {
  const seq = motionSequence(m.id, { frames: 12 });
  const ac = amplitudeCheck(seq);
  ok(`「${m.name}」幅度在微动作范围内`, ac.ok, `最大 ${(ac.worst * 180 / Math.PI).toFixed(1)}° (${ac.field})`);
  ok(`「${m.name}」确实有动作`, ac.worst > 0.005, 'worst=' + ac.worst.toFixed(4));
  const lc = loopClosure(seq);
  ok(`「${m.name}」循环无跳变`, lc.ok, `跳变 ${(lc.worst * 180 / Math.PI).toFixed(2)}° (${lc.field})`);
}

// ---------- zeroPose / motionSequence ----------
{
  const z = zeroPose();
  ok('零姿态全 0', Object.values(z).every((v) => v === 0));
  ok('零姿态含 torso', 'torso' in z);
  ok('零姿态含全部 8 段肢体', LIMB_CHAIN.every(([n]) => n in z));
}
{
  const seq = motionSequence('sway', { frames: 12 });
  ok('生成 12 帧', seq.length === 12, 'n=' + seq.length);
  const keys = Object.keys(zeroPose());
  ok('每帧字段补齐（缺字段会让渲染拿到 undefined）', seq.every((p) => keys.every((k) => typeof p[k] === 'number')));
  ok('所有值有限', seq.every((p) => keys.every((k) => Number.isFinite(p[k]))));
}
ok('未知动作退回默认', motionSequence('nope', { frames: 8 }).length === 8);
ok('帧数下限 4', motionSequence('idle', { frames: 1 }).length === 4);
ok('帧数上限 48', motionSequence('idle', { frames: 999 }).length === 48);

// ---------- amplitudeCheck 要能抓出大动作 ----------
{
  const ac = amplitudeCheck([{ ...zeroPose(), leftUpperArm: 2.0 }]);
  ok('能检出超限', ac.ok === false);
  ok('报出字段与数值', ac.field === 'leftUpperArm' && Math.abs(ac.worst - 2.0) < 1e-9);
  ok('等于上限算通过', amplitudeCheck([{ ...zeroPose(), torso: MAX_AMPLITUDE }]).ok === true);
  ok('空输入安全', amplitudeCheck([]).ok === true && amplitudeCheck(null).ok === true);
}
// ---------- loopClosure 要能抓出跳变 ----------
{
  const bad = [{ ...zeroPose(), torso: 0 }, { ...zeroPose(), torso: 0.5 }];
  const lc = loopClosure(bad);
  ok('能检出跳变', lc.ok === false);
  ok('报出字段', lc.field === 'torso', String(lc.field));
  ok('帧数不足安全', loopClosure([zeroPose()]).ok === false && loopClosure(null).ok === false);
}

// ---------- canAnimate：这是「闸门」，必须严格 ----------
{
  const g = canAnimate(SPRITE);
  ok('标准立绘通过闸门', g.ok === true, g.reason);
  ok('列出可驱动肢体', Array.isArray(g.available) && g.available.length === 8, 'n=' + g.available.length);
  ok('没有缺失', g.missing.length === 0);
}
{
  const g = canAnimate(parseKeypoints(new Array(51).fill(0)));
  ok('空白图被闸门拦住', g.ok === false);
  ok('拦下时给出原因', g.reason.length > 0, g.reason);
}
{
  // 只有双臂、没有髋 -> 躯干不确定 -> 拦住
  const noHip = kps([
    ['nose',0.50,0.16,0.9],['leftShoulder',0.58,0.31,0.9],['rightShoulder',0.42,0.31,0.9],
    ['leftElbow',0.75,0.45,0.9],['rightElbow',0.25,0.45,0.9],
    ['leftWrist',0.88,0.58,0.9],['rightWrist',0.12,0.58,0.9],
    ['leftHip',0.55,0.65,0.05],['rightHip',0.45,0.65,0.05],
  ]);
  const g = canAnimate(noHip);
  ok('缺髋被拦住（躯干是刚需）', g.ok === false, g.reason);
  ok('原因提到躯干', g.reason.includes('躯干'), g.reason);
}
{
  // 肢体太少 -> 拦住
  const few = kps([
    ['leftShoulder',0.58,0.31,0.9],['rightShoulder',0.42,0.31,0.9],
    ['leftHip',0.55,0.65,0.9],['rightHip',0.45,0.65,0.9],
  ]);
  const g = canAnimate(few);
  ok('可信肢体太少被拦住', g.ok === false, g.reason);
  ok('原因提到肢体数量', /肢体/.test(g.reason), g.reason);
}

// ---------- solveJoints：关节链必须正确叠加 ----------
{
  const pose = { ...zeroPose(), leftUpperArm: 0.5, leftForeArm: 0.3 };
  const j = solveJoints(SPRITE, pose);
  ok('解算出全部 8 段肢体', Object.keys(j).length === 8, Object.keys(j).join(','));
  // 上臂角度 = 自身
  ok('上臂角度 = 自身角度', Math.abs(j.leftUpperArm.angle - 0.5) < 1e-9, String(j.leftUpperArm.angle));
  // 小臂角度 = 上臂 + 自身（关节链叠加，写错会让小臂脱节）
  ok('小臂角度 = 上臂 + 自身（关节链）', Math.abs(j.leftForeArm.angle - 0.8) < 1e-9, String(j.leftForeArm.angle));
  ok('每段都带 pivot 与 end', Object.values(j).every((x) => x.pivot && x.end && typeof x.angle === 'number'));
  ok('pivot 是近端关节位置', Math.abs(j.leftUpperArm.pivot.x - 0.58) < 1e-9 && Math.abs(j.leftUpperArm.pivot.y - 0.31) < 1e-9);
}
{
  // 角度为 0 时，端点必须等于原始关键点（不能有偏移）
  const j = solveJoints(SPRITE, zeroPose());
  const k = (n) => SPRITE.find((x) => x.name === n);
  ok('零角度时右腕位置不变', Math.abs(j.rightForeArm.end.x - k('rightWrist').x) < 1e-9 && Math.abs(j.rightForeArm.end.y - k('rightWrist').y) < 1e-9);
  ok('零角度时左脚位置不变', Math.abs(j.leftShin.end.x - k('leftAnkle').x) < 1e-9);
}
{
  // 旋转不改变段长（否则肢体被拉长）
  const j0 = solveJoints(SPRITE, zeroPose());
  const j1 = solveJoints(SPRITE, { ...zeroPose(), leftUpperArm: 0.1 });
  const len = (j) => Math.hypot(j.end.x - j.pivot.x, j.end.y - j.pivot.y);
  ok('旋转不改变肢体长度', Math.abs(len(j0.leftUpperArm) - len(j1.leftUpperArm)) < 1e-9, `${len(j0.leftUpperArm)} vs ${len(j1.leftUpperArm)}`);
}
ok('关键点缺失时对应肢体被跳过（不产生 NaN）', (() => {
  const partial = kps([['leftShoulder',0.58,0.31,0.9],['rightShoulder',0.42,0.31,0.9],['leftHip',0.55,0.65,0.9],['rightHip',0.45,0.65,0.9]]);
  const j = solveJoints(partial, zeroPose());
  return Object.values(j).every((x) => Number.isFinite(x.angle) && Number.isFinite(x.end.x));
})());
ok('solveJoints 空姿态不崩', typeof solveJoints(SPRITE, null) === 'object');

// ---------- motionBounds：必须把头脚算进去（踩过的坑）----------
{
  const seq = motionSequence('wave', { frames: 6 });
  const jpf = seq.map((p) => solveJoints(SPRITE, p));
  const bb = bodyBounds(SPRITE);
  const only = motionBounds(jpf);
  const withBody = motionBounds(jpf, bb);
  ok('只算关节的包围盒会漏掉头顶（这正是踩过的坑）', only.y > bb.y + 0.05, `only.y=${only.y.toFixed(3)} body.y=${bb.y.toFixed(3)}`);
  ok('并上 bodyBounds 后覆盖到头顶', withBody.y <= bb.y + 1e-9, `y=${withBody.y.toFixed(3)}`);
  ok('并上后覆盖到脚底', withBody.y + withBody.h >= bb.y + bb.h - 1e-9, `bottom=${(withBody.y + withBody.h).toFixed(3)}`);
  ok('包围盒在画面内', withBody.x >= 0 && withBody.y >= 0 && withBody.x + withBody.w <= 1.0001 && withBody.y + withBody.h <= 1.0001);
  ok('extra 为 null 时仍可用', motionBounds(jpf, null).w > 0);
  ok('空输入安全', motionBounds([]).w === 1 && motionBounds(null).w === 1);
}
