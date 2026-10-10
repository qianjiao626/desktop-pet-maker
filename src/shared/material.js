// 素材合格性检查：判断用户上传的图能不能驱动纸片人偶动作。
//
// 这是「方案 2」的核心 —— 用户要提供「标准立绘」（正面、张开手脚、四肢不重叠）。
// 与其让用户自己猜，不如**自动检查并明确告诉他哪里不合格**：
//   - 缺关键部位（比如手插兜 -> 识别不到膝/踝 -> 做不了腿部动作）
//   - 四肢被遮挡/重叠（这是纸片人偶的大忌：关节内侧像素不存在）
//   - 人物太小/太大、贴到画面边缘（切不出肢体）
//
// 纯逻辑，可单测。判据全部来自关键点，不引入主观判断。

import { kp, isReliable, availableParts, describeKeypoints, SCORE_MIN } from './pose.js';

/** 合格性问题的严重程度：block = 不能做；warn = 能做但效果受限 */
export const SEVERITY = { BLOCK: 'block', WARN: 'warn' };

/**
 * 关键点两两之间的「重叠判定」：两个肢体段若有明显交叠，
 * 说明它们在原图里是叠在一起画的 —— 切分会互相带出对方的像素。
 *
 * 用「线段到线段的最近距离」和「两段长度之和」的比值判断：
 * 比值越小说明两段越靠近甚至交叠。
 */
function segDist(p1, p2, p3, p4) {
  const d = (a, b, c) => {
    const vx = c.x - a.x, vy = c.y - a.y;
    const wx = b.x - a.x, wy = b.y - a.y;
    const len2 = wx * wx + wy * wy;
    let t = len2 > 1e-12 ? (vx * wx + vy * wy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(c.x - (a.x + t * wx), c.y - (a.y + t * wy));
  };
  // 四条端点距离取最小（足够判断"是否贴在一起"）
  return Math.min(d(p1, p2, p3), d(p1, p2, p4), d(p3, p4, p1), d(p3, p4, p2));
}

/**
 * 检查图里的人物是否适合驱动动作。
 * @param {Array} keypoints
 * @returns {{ok:boolean, issues:Array<{level,msg,fix}>, parts:object, summary:string}}
 */
export function checkMaterial(keypoints) {
  const issues = [];
  const parts = availableParts(keypoints);
  const P = (n) => (isReliable(keypoints, n) ? kp(keypoints, n) : null);

  // ---- 1) 躯干：硬性要求 ----
  if (!parts.core) {
    const miss = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip']
      .filter((n) => !isReliable(keypoints, n));
    issues.push({
      level: SEVERITY.BLOCK,
      msg: '没能确认躯干（缺 ' + miss.length + ' 个关键点）',
      fix: '请上传人物完整、正面朝向的图；上半身和腰部都要清晰可见',
    });
  }

  // ---- 2) 四个肢体：缺了就少一块动作能力，但不阻止 ----
  const limbNames = { leftArm: '左臂', rightArm: '右臂', leftLeg: '左腿', rightLeg: '右腿' };
  const missingLimbs = Object.keys(limbNames).filter((k) => !parts[k]);
  if (missingLimbs.length) {
    issues.push({
      level: missingLimbs.length >= 3 ? SEVERITY.BLOCK : SEVERITY.WARN,
      msg: '识别不到 ' + missingLimbs.map((k) => limbNames[k]).join('、'),
      fix: '让手和脚都露出来、不要在身前交叠，也不要插兜或背手',
    });
  }

  // ---- 3) 肢体重叠：纸片人偶的大忌 ----
  const seg = (a, b) => {
    const A = P(a), B = P(b);
    return A && B ? { A, B } : null;
  };
  const upperArms = [seg('leftShoulder', 'leftElbow'), seg('rightShoulder', 'rightElbow')];
  const thighs = [seg('leftHip', 'leftKnee'), seg('rightHip', 'rightKnee')];
  const overlapping = [];
  const checkPair = (s1, s2, label) => {
    if (!s1 || !s2) return;
    const d = segDist(s1.A, s1.B, s2.A, s2.B);
    const len = Math.min(
      Math.hypot(s1.B.x - s1.A.x, s1.B.y - s1.A.y),
      Math.hypot(s2.B.x - s2.A.x, s2.B.y - s2.A.y)
    );
    // 两段中心线距离小于较短段长度的一半 -> 视为贴在一起
    if (len > 1e-6 && d < len * 0.5) overlapping.push(label);
  };
  checkPair(upperArms[0], upperArms[1], '两只手臂');
  checkPair(thighs[0], thighs[1], '两条腿');
  // 手臂与躯干重叠（手贴身/抱胸）
  const torso = (P('leftShoulder') && P('rightShoulder') && P('leftHip') && P('rightHip'))
    ? { A: { x: (P('leftShoulder').x + P('rightShoulder').x) / 2, y: (P('leftShoulder').y + P('rightShoulder').y) / 2 },
        B: { x: (P('leftHip').x + P('rightHip').x) / 2, y: (P('leftHip').y + P('rightHip').y) / 2 } }
    : null;
  if (torso) {
    for (const [i, s] of upperArms.entries()) {
      if (!s) continue;
      const d = segDist(s.A, s.B, torso.A, torso.B);
      const len = Math.hypot(s.B.x - s.A.x, s.B.y - s.A.y);
      if (len > 1e-6 && d < len * 0.35) overlapping.push(i === 0 ? '左臂与身体' : '右臂与身体');
    }
  }
  if (overlapping.length) {
    issues.push({
      level: SEVERITY.WARN,
      msg: overlapping.join('、') + '挨在一起或重叠',
      fix: '把手臂和腿稍微张开，别贴着身体；分开得越清楚，动作越自然',
    });
  }

  // ---- 4) 人物在画面里的占比：太小/贴边都不好切 ----
  const reliable = (keypoints || []).filter((k) => k.score >= SCORE_MIN);
  if (reliable.length) {
    const xs = reliable.map((k) => k.x), ys = reliable.map((k) => k.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (h < 0.35) {
      issues.push({ level: SEVERITY.WARN, msg: '人物在画面里太小', fix: '让整个人占满画面的 2/3 左右，细节更清楚' });
    }
    if (h > 0.995 && w > 0.995) {
      issues.push({ level: SEVERITY.WARN, msg: '人物顶到了画面边缘', fix: '四周留一点空白，手脚不要被裁掉' });
    }
  }

  const blocked = issues.some((i) => i.level === SEVERITY.BLOCK);
  const d = describeKeypoints(keypoints);
  const summary = blocked
    ? '这张图还不能生成动作（' + issues.filter((i) => i.level === SEVERITY.BLOCK).length + ' 个问题）'
    : (issues.length ? '可以生成动作，但有 ' + issues.length + ' 处建议改进' : '素材很标准，识别到 ' + d.parts.length + ' 个部位');

  return { ok: !blocked, issues, parts, summary, describe: d };
}

/** 理想素材的说明文字（界面直接展示给用户） */
export const MATERIAL_GUIDE = [
  '🙆 正面站立，全身完整入镜',
  '🖐 手臂自然张开、不要贴身、不要交叉抱胸',
  '🦵 双腿分开，不要并拢、不要叠在一起',
  '🎽 衣服和背景颜色差别大一些（抠图更干净）',
  '📏 人物占画面约 2/3，四周留一点空白',
];
