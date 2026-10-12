import { ok } from './_harness.mjs';
import { poseToCharacter, applyPoseToCharacter, limbRaise } from '../src/shared/posetochar.js';
import { normalizeCharacter, characterPlan, characterFrames, normProportions } from '../src/shared/charstudio.js';

// 「照着照片捏一个小人」：把识别到的关键点换算成可动小人的比例 + 基础姿势。
//
// ★ 这条路的正当性（必须锁死，防止以后被误解成"绕过了照片跳舞"）：
//   照片跳舞要**搬运像素**，而照片没有背面/关节内侧/被遮挡肢体的像素 —— 补不出来
//   （三条渲染路线实测全败，见 HANDOFF 已知坑第 23 条）。
//   这里做的是**换介质**：照片只当参照（提供比例与姿势），像素由我们**重新画**，
//   所以抬手后腋下长什么样我们知道。这正是专业 2D 骨骼动画的做法（绑骨 + 重绘）。

/** 造一组 MoveNet 风格的关键点：站立的人，手臂自然下垂 */
function standing(opt = {}) {
  const o = Object.assign({
    shoulderY: 0.30, hipY: 0.50, kneeY: 0.70, ankleY: 0.88,
    shoDx: 0.10, hipDx: 0.07,
    leftWristDx: -0.11, rightWristDx: 0.11, wristY: 0.62,
    noseY: 0.16, score: 0.9,
  }, opt);
  const S = o.score;
  const P = (x, y, score = S) => ({ x, y, score });
  const l = 0.5 - o.shoDx, r = 0.5 + o.shoDx;
  const lh = 0.5 - o.hipDx, rh = 0.5 + o.hipDx;
  return [
    { name: 'nose', ...P(0.5, o.noseY) },
    { name: 'leftShoulder', ...P(l, o.shoulderY) },
    { name: 'rightShoulder', ...P(r, o.shoulderY) },
    { name: 'leftHip', ...P(lh, o.hipY) },
    { name: 'rightHip', ...P(rh, o.hipY) },
    { name: 'leftElbow', ...P(l - 0.04, (o.shoulderY + o.wristY) / 2) },
    { name: 'rightElbow', ...P(r + 0.04, (o.shoulderY + o.wristY) / 2) },
    { name: 'leftWrist', ...P(0.5 + o.leftWristDx, o.wristY) },
    { name: 'rightWrist', ...P(0.5 + o.rightWristDx, o.wristY) },
    { name: 'leftKnee', ...P(lh, o.kneeY) },
    { name: 'rightKnee', ...P(rh, o.kneeY) },
    { name: 'leftAnkle', ...P(lh, o.ankleY) },
    { name: 'rightAnkle', ...P(rh, o.ankleY) },
  ];
}

// ---------- limbRaise：抬起程度要能区分"垂手"和"举手"，且左右方向不能搞反 ----------
{
  const shoulder = { x: 0.4, y: 0.3 };
  // 垂手（往下）
  ok('垂手抬起程度接近 0', limbRaise(shoulder, { x: 0.4, y: 0.6 }, 'left') < 0.05,
    String(limbRaise(shoulder, { x: 0.4, y: 0.6 }, 'left')));
  // 左臂往左平举（x 变小）=> 抬到水平
  const lvl = limbRaise(shoulder, { x: 0.1, y: 0.3 }, 'left');
  ok('左臂平举接近 1', lvl > 0.9, String(lvl));
  // 右臂往右平举（x 变大）
  const rlvl = limbRaise({ x: 0.6, y: 0.3 }, { x: 0.9, y: 0.3 }, 'right');
  ok('右臂平举接近 1', rlvl > 0.9, String(rlvl));
  // ★ 方向不能反：左臂往**右**平举（穿过身体）不该算"抬起来"
  ok('左臂朝身体内侧不算抬起', limbRaise(shoulder, { x: 0.7, y: 0.3 }, 'left') === 0,
    String(limbRaise(shoulder, { x: 0.7, y: 0.3 }, 'left')));
  ok('抬起程度被限制在 0~1', (() => {
    for (const dx of [-1, -0.5, 0, 0.5, 1]) {
      for (const dy of [-1, -0.5, 0, 0.5, 1]) {
        for (const side of ['left', 'right']) {
          const v = limbRaise({ x: 0.5, y: 0.5 }, { x: 0.5 + dx, y: 0.5 + dy }, side);
          if (!(v >= 0 && v <= 1)) return false;
        }
      }
    }
    return true;
  })(), 'range');
  ok('零长度肢体不崩', limbRaise({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 'left') === 0);
  ok('缺关键点返回 0（不崩）', limbRaise(null, { x: 1, y: 1 }, 'left') === 0 && limbRaise({ x: 0, y: 0 }, null, 'left') === 0);
}

// ---------- poseToCharacter：躯干不可信时必须拒绝（不能拿垃圾点画出怪物） ----------
{
  ok('空输入返回 null', poseToCharacter([]) === null);
  ok('null 返回 null', poseToCharacter(null) === null);
  // 分数太低 -> bodyGeometry 返回 null
  ok('关键点不可信时返回 null', poseToCharacter(standing({ score: 0.05 })) === null);
  // 缺髋部 -> 拒绝
  const noHip = standing().filter((k) => !k.name.includes('Hip'));
  ok('缺髋部时返回 null', poseToCharacter(noHip) === null);
}

// ---------- 比例：必须落在"人样"范围内，且总和合理 ----------
{
  const r = poseToCharacter(standing());
  ok('站立照能算出比例', !!r, JSON.stringify(r && r.proportions));
  const p = r.proportions;
  ok('头比例在人样范围', p.head >= 0.20 && p.head <= 0.46, String(p.head));
  ok('躯干比例在人样范围', p.torso >= 0.24 && p.torso <= 0.55, String(p.torso));
  ok('腿比例在人样范围', p.leg >= 0.12 && p.leg <= 0.42, String(p.leg));
  ok('手臂比例在人样范围', p.arm >= 0.16 && p.arm <= 0.55, String(p.arm));
  ok('有可信度分数', r.confidence > 0 && r.confidence <= 1, String(r.confidence));
  ok('notes 是数组', Array.isArray(r.notes), typeof r.notes);

  // 腿更长的人应当给出更大的腿比例。
  // 注意：要用**还没顶到上限**的基准，否则两边都被 clamp 到同一个上限、看不出差别
  // （实测踩到：基准腿比例已经是 0.42 = 上限，再加长也没变化）。
  const shortLegs = poseToCharacter(standing({ kneeY: 0.62, ankleY: 0.74 }));
  const tall = poseToCharacter(standing({ kneeY: 0.74, ankleY: 0.95 }));
  ok('基准腿比例没顶到上限（测试才有区分度）', shortLegs.proportions.leg < 0.42,
    String(shortLegs.proportions.leg));
  ok('腿更长的人 -> 腿比例更大', tall.proportions.leg > shortLegs.proportions.leg,
    `${shortLegs.proportions.leg.toFixed(3)} -> ${tall.proportions.leg.toFixed(3)}`);
  // 头更大的人（鼻子离肩更远）应当给出更大的头比例
  const bigHead = poseToCharacter(standing({ noseY: 0.10 }));
  ok('头更大的人 -> 头比例更大', bigHead.proportions.head > p.head,
    `${p.head.toFixed(3)} -> ${bigHead.proportions.head.toFixed(3)}`);
}

// ---------- 基础姿势：照着他站的样子（举手要被识别出来） ----------
{
  const r = poseToCharacter(standing());
  ok('自然站立时两臂抬起程度都很小', r.basePose.armL < 0.3 && r.basePose.armR < 0.3,
    JSON.stringify(r.basePose));

  // 左臂举高（腕在肩的高度、且在左边）
  const raising = standing({ leftWristDx: -0.30, wristY: 0.30 });
  const rr = poseToCharacter(raising);
  ok('左臂举起被识别出来', rr.basePose.armL > r.basePose.armL + 0.4,
    `${r.basePose.armL.toFixed(2)} -> ${rr.basePose.armL.toFixed(2)}`);
  ok('基础姿势都在 0~1', ['armL', 'armR', 'legL', 'legR'].every((k) => rr.basePose[k] >= 0 && rr.basePose[k] <= 1),
    JSON.stringify(rr.basePose));
}

// ---------- applyPoseToCharacter：套进配置后必须是合法角色，且比例真的生效 ----------
{
  const base = normalizeCharacter({ paletteId: 'mint', eyeType: 'sparkle' });
  const derived = poseToCharacter(standing());
  const cfg = applyPoseToCharacter(base, derived);
  ok('套用后变成小人形体', cfg.figureType === 'human', cfg.figureType);
  ok('外观设置没被动（配色/眼睛保持）', cfg.paletteId === 'mint' && cfg.eyeType === 'sparkle', JSON.stringify([cfg.paletteId, cfg.eyeType]));
  const norm = normalizeCharacter(cfg);
  ok('套用后仍是合法配置（可归一化）', !!norm && norm.figureType === 'human', 'ok');
  ok('比例被保留', Math.abs(norm.proportions.leg - derived.proportions.leg) < 1e-9, JSON.stringify(norm.proportions));
  ok('基础姿势被保留', Math.abs(norm.basePose.armL - derived.basePose.armL) < 1e-9, JSON.stringify(norm.basePose));
  ok('applyPoseToCharacter 传 null 时原样返回', applyPoseToCharacter(base, null) === base, 'same');

  // 比例必须真的改变画出来的几何（否则等于没接上）
  const planDefault = characterPlan(normalizeCharacter({ figureType: 'human' }), { width: 256, height: 256 });
  const planDerived = characterPlan(norm, { width: 256, height: 256 });
  ok('套用后的头大小与默认不同（比例真的接上了几何）',
    Math.abs(planDefault.head.r - planDerived.head.r) > 0.01,
    `${planDefault.head.r.toFixed(2)} vs ${planDerived.head.r.toFixed(2)}`);
  ok('套用后整身仍在画布内', (() => {
    const top = planDerived.head.cy - planDerived.head.r;
    const bot = planDerived.feet.length ? Math.max(...planDerived.feet.map((f) => f.ey + f.r)) : planDerived.body.y + planDerived.body.h;
    return top >= -0.01 && bot <= 256.01;
  })(), 'in-canvas');
}

// ---------- 不跳舞时，小人的静止姿态就是他本来的站姿 ----------
{
  const derived = poseToCharacter(standing({ leftWristDx: -0.30, wristY: 0.30 }));
  const cfg = normalizeCharacter(applyPoseToCharacter(normalizeCharacter({}), derived));
  const still = characterFrames(cfg, 8);
  ok('不跳舞时帧里带的是基础姿势（不是一律垂手）',
    still.every((f) => Math.abs(f.armL - cfg.basePose.armL) < 1e-9), JSON.stringify(still.map((f) => f.armL)));
  ok('基础姿势的抬手确实被带进帧里', still[0].armL > 0.3, String(still[0].armL));
  // 跳舞时则回到"自然站立再跳"（否则舞蹈幅度会被基础姿势顶到画布外）
  const dancing = characterFrames(normalizeCharacter({ ...cfg, dance: 'party' }), 8);
  ok('跳舞时不再叠加基础姿势（避免幅度顶出画布）',
    dancing.some((f) => Math.abs(f.armL - cfg.basePose.armL) > 0.05), JSON.stringify(dancing.map((f) => +f.armL.toFixed(2))));
}

// ---------- 比例归一化：离谱输入不能画出怪物 ----------
{
  ok('全 0 比例回落到默认', JSON.stringify(normProportions({ head: 0, torso: 0, leg: 0, arm: 0 })) ===
    JSON.stringify({ head: 0.2, torso: 0.24, leg: 0.12, arm: 0.16 }),
    JSON.stringify(normProportions({ head: 0, torso: 0, leg: 0, arm: 0 })));
  ok('超大比例被压到上限', (() => { const p = normProportions({ head: 9, torso: 9, leg: 9, arm: 9 }); return p.head === 0.46 && p.torso === 0.55 && p.leg === 0.42 && p.arm === 0.55; })(), JSON.stringify(normProportions({ head: 9, torso: 9, leg: 9, arm: 9 })));
  ok('NaN 回落到默认', normProportions({ head: NaN }).head === 0.28, String(normProportions({ head: NaN }).head));
  ok('缺字段回落到默认', JSON.stringify(normProportions(null)) === JSON.stringify({ head: 0.28, torso: 0.38, leg: 0.24, arm: 0.42 }), JSON.stringify(normProportions(null)));
}
