// 「照着照片捏一个小人」：把识别到的身体关键点换算成**可动小人的身体比例 + 基础姿势**。
//
// ★ 为什么这条路成立，而"让照片跳舞"不成立（必须说清楚，别被误解成偷懒）：
//   照片跳舞要**搬运像素**，但照片没有背面、没有关节内侧、没有被遮挡的肢体像素，
//   任何搬运都补不出来（三条渲染路线实测全败，见 HANDOFF 已知坑第 23 条）。
//   而这里做的是**换一种介质**：照片只当**参照**（提供比例与姿势），
//   像素由我们按参数**重新画**出来 —— 所以抬手后腋下长什么样我们知道，不存在信息缺失。
//   这也正是专业 2D 骨骼动画（Spine 等）的做法：绑骨、重绘，而不是扭曲照片。
//
// 纯逻辑、可单测：不碰 canvas，也不依赖 Electron。
import { kp, bodyGeometry, SCORE_MIN } from './pose.js';

/** 角度 → "抬起程度" 的参考上限：90° 视为完全抬起 */
const REF = Math.PI / 2;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 一条肢体相对"自然下垂"的抬起程度。
 * 约定：返回 0~1，1 = 抬到水平（90°）。
 * 左右要分开判断方向：图像坐标 y 向下，
 * 左臂往外抬 = x 变小，右臂往外抬 = x 变大。
 * @param from 近端关节（肩/髋）
 * @param to   远端（腕/踝）
 * @param side 'left' | 'right'
 */
export function limbRaise(from, to, side) {
  if (!from || !to) return 0;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6)) return 0;
  // 与"向下"的夹角（向下 = (0, 1)）。atan2(dx, dy)：dx<0 -> 负角
  const ang = Math.atan2(dx, dy);
  const out = side === 'left' ? -ang : ang;   // 往外抬为正
  return clamp01(out / REF);
}

/**
 * 关键点 → 小人配置 + 基础姿势。
 * @param keypoints 归一化关键点（MoveNet 输出）
 * @param box { width, height } 目标画布（只用于决定是否可行，不影响比例）
 * @returns null（躯干不可信）或 {
 *   proportions: { head, torso, leg, arm },   相对"整身高度"的比例
 *   basePose: { armL, armR, legL, legR },     抬起程度 0~1
 *   confidence, notes
 * }
 */
export function poseToCharacter(keypoints, box = {}) {
  const g = bodyGeometry(keypoints);
  if (!g) return null;

  const nose = kp(keypoints, 'nose');
  const ls = kp(keypoints, 'leftShoulder'), rs = kp(keypoints, 'rightShoulder');
  const lh = kp(keypoints, 'leftHip'), rh = kp(keypoints, 'rightHip');

  // ---- 比例：一切以躯干长度为基准，最后归一化成"占整身高度的比例" ----
  const torso = g.torso;

  // 头：鼻子到肩中点的距离，再按 Q 版习惯放大一点（真人的头身比太写实，做出来不好看）
  const noseToShoulder = (nose && nose.score >= SCORE_MIN)
    ? Math.hypot(nose.x - g.shoMid.x, nose.y - g.shoMid.y)
    : torso * 0.45;
  const headH = Math.max(torso * 0.45, noseToShoulder * 1.5);

  // 腿：优先用实测（大腿+小腿），缺失就按躯干比例兜底
  const legOf = (side) => {
    const thigh = g.thigh[side], shin = g.shin[side];
    const sum = (thigh || 0) + (shin || 0);
    return sum > 1e-6 ? sum : null;
  };
  const legMeasured = [legOf('left'), legOf('right')].filter((v) => v != null);
  const legH = legMeasured.length ? (legMeasured.reduce((a, b) => a + b, 0) / legMeasured.length) : torso * 1.05;

  // 臂：肩到腕
  const armOf = (side) => {
    const up = g.upperArm[side], fo = g.foreArm[side];
    const sum = (up || 0) + (fo || 0);
    return sum > 1e-6 ? sum : null;
  };
  const armMeasured = [armOf('left'), armOf('right')].filter((v) => v != null);
  const armLen = armMeasured.length ? (armMeasured.reduce((a, b) => a + b, 0) / armMeasured.length) : torso * 0.95;

  const total = headH + torso + legH;
  if (!(total > 1e-6)) return null;

  // 比例都要 clamp 到"人样"的范围：识别偶尔会给出离谱的肢体长度，
  // 直接照抄会画成怪物（宁可不像、也不能不像人）。
  const proportions = {
    head: Math.min(0.46, Math.max(0.20, headH / total)),
    torso: Math.min(0.55, Math.max(0.24, torso / total)),
    leg: Math.min(0.42, Math.max(0.12, legH / total)),
    arm: Math.min(0.55, Math.max(0.16, armLen / total)),
  };

  // ---- 基础姿势：照着他站/坐的样子 ----
  const basePose = {
    armL: limbRaise(ls, kp(keypoints, 'leftWrist') || kp(keypoints, 'leftElbow'), 'left'),
    armR: limbRaise(rs, kp(keypoints, 'rightWrist') || kp(keypoints, 'rightElbow'), 'right'),
    legL: limbRaise(lh, kp(keypoints, 'leftAnkle') || kp(keypoints, 'leftKnee'), 'left'),
    legR: limbRaise(rh, kp(keypoints, 'rightAnkle') || kp(keypoints, 'rightKnee'), 'right'),
  };

  // 可信度：躯干四个点齐全就算可用，四肢测得越多越准
  const measured = legMeasured.length + armMeasured.length;
  const confidence = Math.min(1, 0.55 + measured * 0.11);

  const notes = [];
  if (!legMeasured.length) notes.push('没识别到腿，按躯干比例估算');
  if (!armMeasured.length) notes.push('没识别到手臂，按躯干比例估算');
  if (proportions.head >= 0.46) notes.push('头身比偏大，已收窄到可爱范围');

  return { proportions, basePose, confidence, notes };
}

/**
 * 把比例与基础姿势套进一份角色配置。
 * @param cfg      现有角色配置（配色/五官等外观保持不变）
 * @param derived  poseToCharacter 的返回值
 */
export function applyPoseToCharacter(cfg, derived) {
  if (!derived) return cfg;
  return {
    ...cfg,
    figureType: 'human',                 // 只有小人能承载"头 + 身子 + 四肢"的比例
    proportions: derived.proportions,
    basePose: derived.basePose,
  };
}
