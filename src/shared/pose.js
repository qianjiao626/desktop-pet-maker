// 人体姿态：关键点定义、骨架、以及「把关键点变成可操控的身体部件」的纯逻辑。
//
// 模型：MoveNet SinglePose Lightning（ONNX，本地 CPU 推理）
//   输入  int32 [1,192,192,3]  值域 0..255，通道顺序 RGB
//   输出  float32 [1,1,17,3]   17 个关键点，每个是 (y, x, score)，y/x 已归一化到 0..1
// 注意：**输入必须是 int32**，不是 float。用 float 喂会直接报
//   "Unexpected input data type. Actual: (tensor(float)), expected: (tensor(int32))"（实测）。
//
// 本模块不依赖 Electron / ONNX，纯数据变换，便于单测。

/** MoveNet 的 17 个关键点，顺序固定（改顺序会让模型输出对错位） */
export const KEYPOINTS = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

/** 中文名（界面提示用） */
export const KEYPOINT_LABELS = {
  nose: '鼻', leftEye: '左眼', rightEye: '右眼', leftEar: '左耳', rightEar: '右耳',
  leftShoulder: '左肩', rightShoulder: '右肩', leftElbow: '左肘', rightElbow: '右肘',
  leftWrist: '左腕', rightWrist: '右腕', leftHip: '左髋', rightHip: '右髋',
  leftKnee: '左膝', rightKnee: '右膝', leftAnkle: '左踝', rightAnkle: '右踝',
};

/** 骨架连线（画示意用 / 推断部件连通性） */
export const SKELETON = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
  ['nose', 'leftEye'], ['nose', 'rightEye'], ['leftEye', 'leftEar'], ['rightEye', 'rightEar'],
];

/** 关键点可信度门槛：低于它视为「没识别到」，不参与推理 */
export const SCORE_MIN = 0.30;
/** 躯干（左右肩/髋）要求更高——它们错了整个身体都会歪 */
export const CORE_SCORE_MIN = 0.35;

/**
 * 把模型原始输出 [17*3] 解析成关键点对象。
 * @param {ArrayLike<number>} raw  长度 51 的扁平数组，每 3 个是 (y, x, score)
 * @returns {Array<{name, x, y, score}>}  归一化坐标 0..1
 */
export function parseKeypoints(raw) {
  const out = [];
  for (let i = 0; i < KEYPOINTS.length; i++) {
    const y = Number(raw[i * 3]);
    const x = Number(raw[i * 3 + 1]);
    const score = Number(raw[i * 3 + 2]);
    out.push({
      name: KEYPOINTS[i],
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      score: Number.isFinite(score) ? score : 0,
    });
  }
  return out;
}

/** 取某个关键点（找不到返回 null） */
export function kp(keypoints, name) {
  return (keypoints || []).find((k) => k && k.name === name) || null;
}

/** 该关键点是否可信（识别到了且够自信） */
export function isReliable(keypoints, name, min = SCORE_MIN) {
  const k = kp(keypoints, name);
  return !!k && k.score >= min;
}

/** 中点（两关键点都不可信时返回 null） */
export function midpoint(keypoints, a, b, min = SCORE_MIN) {
  const ka = kp(keypoints, a), kb = kp(keypoints, b);
  if (!ka || !kb || ka.score < min || kb.score < min) return null;
  return { x: (ka.x + kb.x) / 2, y: (ka.y + kb.y) / 2, score: Math.min(ka.score, kb.score) };
}

/**
 * 判断这张图能支撑哪些动作部件。
 * 这是「缺部位不猜」原则的实现：识别到哪几个部位就只做哪几个，
 * 缺的明确告诉用户，而不是硬编一个位置糊上去。
 */
export function availableParts(keypoints) {
  const has = (n, min) => isReliable(keypoints, n, min);
  const core = has('leftShoulder', CORE_SCORE_MIN) && has('rightShoulder', CORE_SCORE_MIN)
    && has('leftHip', CORE_SCORE_MIN) && has('rightHip', CORE_SCORE_MIN);
  return {
    core,                                                        // 躯干（必需）
    head: has('nose') || (has('leftEye') && has('rightEye')),     // 头
    leftArm: has('leftShoulder') && (has('leftElbow') || has('leftWrist')),
    rightArm: has('rightShoulder') && (has('rightElbow') || has('rightWrist')),
    leftLeg: has('leftHip') && (has('leftKnee') || has('leftAnkle')),
    rightLeg: has('rightHip') && (has('rightKnee') || has('rightAnkle')),
  };
}

/**
 * 判定能否驱动跳舞。
 * 躯干是刚需：没有肩/髋就只能得到一堆飘浮的点，做出来的动作一定穿帮。
 * @returns {{ok:boolean, reason:string, parts:object}}
 */
export function canDance(keypoints) {
  const parts = availableParts(keypoints);
  if (!parts.core) {
    const missing = [];
    if (!isReliable(keypoints, 'leftShoulder', CORE_SCORE_MIN)) missing.push('左肩');
    if (!isReliable(keypoints, 'rightShoulder', CORE_SCORE_MIN)) missing.push('右肩');
    if (!isReliable(keypoints, 'leftHip', CORE_SCORE_MIN)) missing.push('左髋');
    if (!isReliable(keypoints, 'rightHip', CORE_SCORE_MIN)) missing.push('右髋');
    return { ok: false, parts, reason: '没能确认躯干（缺 ' + missing.join('、') + '），无法驱动跳舞' };
  }
  const limbs = [parts.leftArm, parts.rightArm, parts.leftLeg, parts.rightLeg].filter(Boolean).length;
  if (limbs === 0) return { ok: false, parts, reason: '只识别到躯干，没有任何可信的四肢' };
  return { ok: true, parts, reason: '识别到 ' + limbs + ' 个肢体可驱动' };
}

/**
 * 从关键点推身体各段的「几何信息」，供部件切分与骨骼动画使用。
 * 所有长度都以「躯干高度」为基准单位，这样不同大小的图能得到一致的动画幅度。
 * @returns {null | object} 躯干不可信时返回 null
 */
export function bodyGeometry(keypoints) {
  const ls = kp(keypoints, 'leftShoulder'), rs = kp(keypoints, 'rightShoulder');
  const lh = kp(keypoints, 'leftHip'), rh = kp(keypoints, 'rightHip');
  if (!ls || !rs || !lh || !rh) return null;
  if (ls.score < CORE_SCORE_MIN || rs.score < CORE_SCORE_MIN || lh.score < CORE_SCORE_MIN || rh.score < CORE_SCORE_MIN) return null;

  const shoMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  // 躯干高度：肩中点到髋中点。作为所有长度的基准单位。
  const torso = Math.hypot(hipMid.x - shoMid.x, hipMid.y - shoMid.y);
  if (!(torso > 1e-4)) return null;
  // 躯干朝向（弧度）：用于判断人是正的还是歪的
  const torsoAngle = Math.atan2(hipMid.y - shoMid.y, hipMid.x - shoMid.x);
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const hipWidth = Math.hypot(lh.x - rh.x, lh.y - rh.y);

  // 各肢体长度（可信才算）
  const seg = (a, b) => {
    const ka = kp(keypoints, a), kb = kp(keypoints, b);
    if (!ka || !kb || ka.score < SCORE_MIN || kb.score < SCORE_MIN) return null;
    return Math.hypot(kb.x - ka.x, kb.y - ka.y);
  };
  return {
    shoMid, hipMid, torso, torsoAngle, shoulderWidth, hipWidth,
    head: (() => {
      const n = kp(keypoints, 'nose');
      return n && n.score >= SCORE_MIN ? { x: n.x, y: n.y } : null;
    })(),
    upperArm: { left: seg('leftShoulder', 'leftElbow'), right: seg('rightShoulder', 'rightElbow') },
    foreArm: { left: seg('leftElbow', 'leftWrist'), right: seg('rightElbow', 'rightWrist') },
    thigh: { left: seg('leftHip', 'leftKnee'), right: seg('rightHip', 'rightKnee') },
    shin: { left: seg('leftKnee', 'leftAnkle'), right: seg('rightKnee', 'rightAnkle') },
  };
}

/**
 * 把归一化关键点换算成像素坐标（供 canvas 切图用）。
 * @param {Array} keypoints
 * @param {number} w  图片像素宽
 * @param {number} h  图片像素高
 */
export function toPixels(keypoints, w, h) {
  return (keypoints || []).map((k) => ({ ...k, px: k.x * w, py: k.y * h }));
}

/**
 * 安全检查：关键点是否落在画面内。
 * MoveNet 有时会把点甩到画面外（分数还很高），直接用会让部件飞到天外。
 */
export function clampToImage(keypoints) {
  return (keypoints || []).map((k) => ({
    ...k,
    x: Math.min(1, Math.max(0, k.x)),
    y: Math.min(1, Math.max(0, k.y)),
  }));
}

/**
 * 图形摘要：给人看的「识别结果」文字（界面提示用）。
 */
export function describeKeypoints(keypoints) {
  const parts = availableParts(keypoints);
  const names = [];
  if (parts.core) names.push('躯干');
  if (parts.head) names.push('头');
  if (parts.leftArm) names.push('左臂');
  if (parts.rightArm) names.push('右臂');
  if (parts.leftLeg) names.push('左腿');
  if (parts.rightLeg) names.push('右腿');
  const reliable = (keypoints || []).filter((k) => k.score >= SCORE_MIN).length;
  return { parts: names, reliable, total: KEYPOINTS.length };
}
