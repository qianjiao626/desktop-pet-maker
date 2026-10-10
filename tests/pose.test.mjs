import { ok } from './_harness.mjs';
import {
  KEYPOINTS, KEYPOINT_LABELS, SKELETON, SCORE_MIN, CORE_SCORE_MIN,
  parseKeypoints, kp, isReliable, midpoint, availableParts, canDance,
  bodyGeometry, toPixels, clampToImage, describeKeypoints,
} from '../src/shared/pose.js';

// ---------- 关键点定义必须与 MoveNet 输出顺序一致（改顺序会让所有点错位）----------
ok('共 17 个关键点', KEYPOINTS.length === 17, 'n=' + KEYPOINTS.length);
ok('首个是鼻子', KEYPOINTS[0] === 'nose');
ok('肩在 5/6 位', KEYPOINTS[5] === 'leftShoulder' && KEYPOINTS[6] === 'rightShoulder');
ok('腕在 9/10 位', KEYPOINTS[9] === 'leftWrist' && KEYPOINTS[10] === 'rightWrist');
ok('踝在 15/16 位', KEYPOINTS[15] === 'leftAnkle' && KEYPOINTS[16] === 'rightAnkle');
ok('关键点名不重复', new Set(KEYPOINTS).size === 17);
ok('每个关键点都有中文名', KEYPOINTS.every((n) => typeof KEYPOINT_LABELS[n] === 'string' && KEYPOINT_LABELS[n].length > 0));
ok('骨架连线引用的点都存在', SKELETON.every(([a, b]) => KEYPOINTS.includes(a) && KEYPOINTS.includes(b)));
ok('可信门槛 > 0 且 < 1', SCORE_MIN > 0 && SCORE_MIN < 1);
ok('躯干门槛 >= 普通门槛（躯干错了整体都歪）', CORE_SCORE_MIN >= SCORE_MIN);

// ---------- parseKeypoints：y/x/score 顺序极易搞反 ----------
const raw = new Array(51).fill(0);
const setK = (i, x, y, s) => { raw[i * 3] = y; raw[i * 3 + 1] = x; raw[i * 3 + 2] = s; };
setK(0, 0.5, 0.2, 0.9);
const k0 = parseKeypoints(raw);
ok('解析出 17 个点', k0.length === 17);
ok('第 0 个是 nose', k0[0].name === 'nose');
ok('y 取自索引 0、x 取自索引 1（不能反）', k0[0].x === 0.5 && k0[0].y === 0.2, `x=${k0[0].x} y=${k0[0].y}`);
ok('score 取自索引 2', k0[0].score === 0.9);
ok('NaN 被兜成 0（脏数据不崩）', (() => { const b = new Array(51).fill(NaN); return parseKeypoints(b).every((k) => k.x === 0 && k.y === 0 && k.score === 0); })());
ok('空输入安全', parseKeypoints([]).length === 17);

// ---------- kp / isReliable / midpoint ----------
{
  const ks = parseKeypoints(raw);
  ok('kp 能取到', kp(ks, 'nose').score === 0.9);
  ok('kp 取不存在的返回 null', kp(ks, 'nope') === null);
  ok('kp null 安全', kp(null, 'nose') === null);
  ok('isReliable 高分为 true', isReliable(ks, 'nose') === true);
  ok('isReliable 低分为 false', isReliable(ks, 'leftHip') === false);
  ok('isReliable 未知点为 false', isReliable(ks, 'zzz') === false);
  // midpoint 需要两个点都可信
  const r2 = new Array(51).fill(0);
  const s2 = (i, x, y, sc) => { r2[i * 3] = y; r2[i * 3 + 1] = x; r2[i * 3 + 2] = sc; };
  s2(0, 0.4, 0.2, 0.9); s2(1, 0.6, 0.4, 0.9);
  const ks2 = parseKeypoints(r2);
  const m = midpoint(ks2, 'nose', 'leftEye');
  ok('midpoint 取中点', Math.abs(m.x - 0.5) < 1e-9 && Math.abs(m.y - 0.3) < 1e-9);
  ok('midpoint 取较低分作为置信度', m.score === 0.9);
  ok('midpoint 有点不可信则 null', midpoint(ks2, 'nose', 'rightHip') === null);
}

/** 造一个「完整站姿」的关键点集 */
function fullBodyRaw(score = 0.9) {
  const r = new Array(51).fill(0);
  const s = (i, x, y, sc) => { r[i * 3] = y; r[i * 3 + 1] = x; r[i * 3 + 2] = sc; };
  s(0, 0.50, 0.15, score);            // nose
  s(1, 0.48, 0.13, score); s(2, 0.52, 0.13, score);
  s(3, 0.46, 0.14, score); s(4, 0.54, 0.14, score);
  s(5, 0.42, 0.30, score); s(6, 0.58, 0.30, score);   // 肩
  s(7, 0.34, 0.45, score); s(8, 0.66, 0.45, score);   // 肘
  s(9, 0.30, 0.60, score); s(10, 0.70, 0.60, score);  // 腕
  s(11, 0.45, 0.65, score); s(12, 0.55, 0.65, score);// 髋
  s(13, 0.44, 0.82, score); s(14, 0.56, 0.82, score);// 膝
  s(15, 0.44, 0.97, score); s(16, 0.56, 0.97, score);// 踝
  return r;
}

// ---------- availableParts ----------
{
  const ks = parseKeypoints(fullBodyRaw());
  const p = availableParts(ks);
  ok('完整站姿：躯干可用', p.core === true);
  ok('完整站姿：头可用', p.head === true);
  ok('完整站姿：左右臂可用', p.leftArm === true && p.rightArm === true);
  ok('完整站姿：左右腿可用', p.leftLeg === true && p.rightLeg === true);
}

// ---------- 「缺部位不猜」：缺腿就只给上半身 ----------
{
  const r = fullBodyRaw();
  for (const i of [13, 14, 15, 16, 11, 12]) { r[i * 3 + 2] = 0.05; }   // 髋/膝/踝 全部压低
  const p = availableParts(parseKeypoints(r));
  ok('躯干缺了 -> core=false', p.core === false);
  ok('腿不可用', p.leftLeg === false && p.rightLeg === false);
  ok('手臂仍可用（不因缺腿而丢弃）', p.leftArm === true && p.rightArm === true);
}
{
  // 只有上半身：肩可信、髋不可信
  const r = fullBodyRaw();
  for (const i of [11, 12, 13, 14, 15, 16]) r[i * 3 + 2] = 0.05;
  const v = canDance(parseKeypoints(r));
  ok('只有上半身不能跳舞（躯干是刚需）', v.ok === false, v.reason);
  ok('拒因说清了缺什么', v.reason.includes('髋'), v.reason);
}
{
  const r = fullBodyRaw();
  for (const i of [7, 8, 9, 10, 13, 14, 15, 16]) r[i * 3 + 2] = 0.05;   // 去掉四肢
  const v = canDance(parseKeypoints(r));
  ok('只有躯干不能跳舞', v.ok === false, v.reason);
  ok('拒因提到没有四肢', v.reason.includes('四肢'), v.reason);
}
ok('完全没有识别结果时不能跳舞', canDance(parseKeypoints(new Array(51).fill(0))).ok === false);
ok('空数组也不能跳舞', canDance([]).ok === false);
{
  const v = canDance(parseKeypoints(fullBodyRaw()));
  ok('完整身体可以跳舞', v.ok === true);
  ok('说明里给出可驱动肢体数', v.reason.includes('4'), v.reason);
}

// ---------- bodyGeometry：以躯干为基准单位 ----------
{
  const g = bodyGeometry(parseKeypoints(fullBodyRaw()));
  ok('几何信息可算出', !!g);
  ok('躯干高度 = 肩中到髋中', Math.abs(g.torso - 0.35) < 1e-6, 'torso=' + g.torso);
  ok('肩中点正确', Math.abs(g.shoMid.x - 0.5) < 1e-9 && Math.abs(g.shoMid.y - 0.30) < 1e-9);
  ok('髋中点正确', Math.abs(g.hipMid.x - 0.5) < 1e-9 && Math.abs(g.hipMid.y - 0.65) < 1e-9);
  ok('躯干是竖直的（角度 ~ pi/2）', Math.abs(g.torsoAngle - Math.PI / 2) < 1e-6, 'angle=' + g.torsoAngle);
  ok('肩宽算对', Math.abs(g.shoulderWidth - 0.16) < 1e-6, 'w=' + g.shoulderWidth);
  ok('上臂长算对（左右对称）', Math.abs(g.upperArm.left - g.upperArm.right) < 1e-9 && g.upperArm.left > 0);
  ok('小腿长算对', Math.abs(g.shin.left - 0.15) < 1e-6, 'shin=' + g.shin.left);
  ok('头位置取自鼻子', g.head && Math.abs(g.head.y - 0.15) < 1e-9);
}
ok('躯干不可信时 bodyGeometry 返回 null', bodyGeometry(parseKeypoints(new Array(51).fill(0))) === null);
{
  // 肩髋重合 -> 躯干高度 0，不能返回除零结果
  const r = new Array(51).fill(0);
  const s = (i, x, y, sc) => { r[i * 3] = y; r[i * 3 + 1] = x; r[i * 3 + 2] = sc; };
  s(5, 0.4, 0.5, 0.9); s(6, 0.6, 0.5, 0.9); s(11, 0.4, 0.5, 0.9); s(12, 0.6, 0.5, 0.9);
  ok('躯干高度为 0 时返回 null（不产生 Infinity）', bodyGeometry(parseKeypoints(r)) === null);
}

// ---------- clampToImage：MoveNet 会把点甩到画面外 ----------
{
  // 注意索引含义：raw[i*3] 是 y，raw[i*3+1] 是 x。
  // 这里让 nose 的 y=-0.5（跑到上方外）、x=1.7（跑到右侧外）。
  const ks = parseKeypoints((() => {
    const r = new Array(51).fill(0);
    r[0] = -0.5; r[1] = 1.7; r[2] = 0.9;
    return r;
  })());
  const c = clampToImage(ks);
  ok('负的 y 被夹到 0', c[0].y === 0, 'y=' + c[0].y);
  ok('超过 1 的 x 被夹到 1', c[0].x === 1, 'x=' + c[0].x);
  ok('其它点不受影响', c[1].x === 0 && c[1].y === 0);
  ok('clamp 不改分数', c[0].score === 0.9);
}

// ---------- toPixels ----------
{
  const ks = parseKeypoints(fullBodyRaw());
  const px = toPixels(ks, 200, 400);
  ok('像素换算正确', Math.abs(px[0].px - 100) < 1e-9 && Math.abs(px[0].py - 60) < 1e-9, `${px[0].px},${px[0].py}`);
  ok('保留归一化坐标', px[0].x === 0.5 && px[0].y === 0.15);
}

// ---------- describeKeypoints（界面提示）----------
{
  const d = describeKeypoints(parseKeypoints(fullBodyRaw()));
  ok('列出全部 6 个部位', d.parts.length === 6, d.parts.join('/'));
  ok('统计可信点数量', d.reliable === 17, 'reliable=' + d.reliable);
  ok('总数是 17', d.total === 17);
  const d2 = describeKeypoints(parseKeypoints(new Array(51).fill(0)));
  ok('全不可信时部位为空', d2.parts.length === 0);
  ok('全不可信时可信数为 0', d2.reliable === 0);
}
