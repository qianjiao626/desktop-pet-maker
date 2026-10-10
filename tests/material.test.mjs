import { ok } from './_harness.mjs';
import { parseKeypoints } from '../src/shared/pose.js';
import { checkMaterial, MATERIAL_GUIDE, SEVERITY } from '../src/shared/material.js';

/** 造关键点：用「名字 -> (x,y,score)」表 */
function kps(spec) {
  const names = ['nose','leftEye','rightEye','leftEar','rightEar','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'];
  const r = new Array(51).fill(0);
  for (const [n, x, y, s] of spec) {
    const i = names.indexOf(n);
    if (i < 0) continue;
    r[i*3] = y; r[i*3+1] = x; r[i*3+2] = s;
  }
  return parseKeypoints(r);
}

/** 标准立绘：正面、四肢张开不重叠 */
const IDEAL = kps([
  ['nose',0.50,0.14,0.9],
  ['leftEye',0.52,0.12,0.9],['rightEye',0.48,0.12,0.9],
  ['leftEar',0.56,0.13,0.9],['rightEar',0.44,0.13,0.9],
  ['leftShoulder',0.40,0.30,0.9],['rightShoulder',0.60,0.30,0.9],
  ['leftElbow',0.26,0.42,0.9],['rightElbow',0.74,0.42,0.9],
  ['leftWrist',0.14,0.54,0.9],['rightWrist',0.86,0.54,0.9],
  ['leftHip',0.44,0.62,0.9],['rightHip',0.56,0.62,0.9],
  ['leftKnee',0.38,0.78,0.9],['rightKnee',0.62,0.78,0.9],
  ['leftAnkle',0.34,0.94,0.9],['rightAnkle',0.66,0.94,0.9],
]);

// ---------- 引导文案 ----------
ok('引导有若干条', MATERIAL_GUIDE.length >= 4, 'n=' + MATERIAL_GUIDE.length);
ok('每条引导都非空且是字符串', MATERIAL_GUIDE.every((x) => typeof x === 'string' && x.length > 4));
ok('引导里含"张开"这类关键动作提示', MATERIAL_GUIDE.join('').includes('张开'));
ok('引导里含"重叠/交叠"相关提示', /重叠|交叠|并拢|交叉/.test(MATERIAL_GUIDE.join('')));

// ---------- 标准立绘应当直接通过 ----------
{
  const c = checkMaterial(IDEAL);
  ok('标准立绘 ok=true', c.ok === true, c.summary);
  ok('标准立绘无 block 级问题', !c.issues.some((i) => i.level === SEVERITY.BLOCK), JSON.stringify(c.issues));
  ok('标准立绘识别到全部 6 个部位', c.parts.core && c.parts.head && c.parts.leftArm && c.parts.rightArm && c.parts.leftLeg && c.parts.rightLeg);
  ok('标准立绘摘要提到部位数', c.summary.includes('6') || c.summary.includes('标准'), c.summary);
}

// ---------- 缺躯干 -> 硬性阻止 ----------
ok('全空白 -> ok=false', checkMaterial(parseKeypoints(new Array(51).fill(0))).ok === false);
{
  const c = checkMaterial(parseKeypoints(new Array(51).fill(0)));
  ok('空白图有 block 级问题', c.issues.some((i) => i.level === SEVERITY.BLOCK));
  ok('空白图提示朝向/上半身', c.issues.some((i) => i.fix.includes('正面') || i.fix.includes('上半身')), JSON.stringify(c.issues.map((i)=>i.fix)));
}

// ---------- 手插兜（识别不到腿）-> 警告，但不阻止 ----------
{
  const spec = [];
  for (const [n,x,y,s] of [['nose',0.5,0.14,0.9],['leftShoulder',0.4,0.3,0.9],['rightShoulder',0.6,0.3,0.9],
    ['leftElbow',0.26,0.42,0.9],['rightElbow',0.74,0.42,0.9],['leftWrist',0.14,0.54,0.9],['rightWrist',0.86,0.54,0.9],
    ['leftHip',0.44,0.62,0.9],['rightHip',0.56,0.62,0.9]]) spec.push([n,x,y,s]);
  // 膝/踝 不可信
  spec.push(['leftKnee',0.38,0.78,0.05],['rightKnee',0.62,0.78,0.05],['leftAnkle',0.34,0.94,0.05],['rightAnkle',0.66,0.94,0.05]);
  const c = checkMaterial(kps(spec));
  ok('手插兜仍 ok=true（只损失腿部动作）', c.ok === true, c.summary);
  ok('会提示识别不到腿', c.issues.some((i) => i.msg.includes('腿')), JSON.stringify(c.issues.map((i)=>i.msg)));
  ok('提示里给出"插兜/背手"这类可执行建议', c.issues.some((i) => /插兜|背手|交叠|露/.test(i.fix)), JSON.stringify(c.issues.map((i)=>i.fix)));
  ok('腿部不可用被正确标注', c.parts.leftLeg === false && c.parts.rightLeg === false);
}

// ---------- 少 3 个肢体 -> 升级为 block ----------
{
  const spec = [['nose',0.5,0.14,0.9],['leftShoulder',0.4,0.3,0.9],['rightShoulder',0.6,0.3,0.9],
    ['leftHip',0.44,0.62,0.9],['rightHip',0.56,0.62,0.9]];
  const c = checkMaterial(kps(spec));
  ok('几乎没四肢时 ok=false', c.ok === false, c.summary);
  ok('给出 block 级原因', c.issues.some((i) => i.level === SEVERITY.BLOCK && i.msg.includes('识别不到')));
}

// ---------- 肢体重叠 -> 警告 ----------
{
  // 两条腿完全并拢在中间（中心线重合）
  const c = checkMaterial(kps([
    ['nose',0.50,0.14,0.9],['leftShoulder',0.40,0.30,0.9],['rightShoulder',0.60,0.30,0.9],
    ['leftElbow',0.26,0.42,0.9],['rightElbow',0.74,0.42,0.9],['leftWrist',0.14,0.54,0.9],['rightWrist',0.86,0.54,0.9],
    ['leftHip',0.47,0.62,0.9],['rightHip',0.53,0.62,0.9],
    ['leftKnee',0.49,0.78,0.9],['rightKnee',0.51,0.78,0.9],
    ['leftAnkle',0.49,0.94,0.9],['rightAnkle',0.51,0.94,0.9],
  ]));
  ok('双腿并拢会被提示重叠', c.issues.some((i) => i.msg.includes('腿') && /重叠|挨/.test(i.msg)), JSON.stringify(c.issues.map((i)=>i.msg)));
  ok('重叠只算警告，不阻止', c.issues.filter((i) => i.msg.includes('腿') && /重叠|挨/.test(i.msg)).every((i) => i.level === SEVERITY.WARN));
}
{
  // 手臂贴着身体
  const c = checkMaterial(kps([
    ['nose',0.50,0.14,0.9],['leftShoulder',0.46,0.30,0.9],['rightShoulder',0.54,0.30,0.9],
    ['leftElbow',0.47,0.44,0.9],['rightElbow',0.53,0.44,0.9],['leftWrist',0.48,0.56,0.9],['rightWrist',0.52,0.56,0.9],
    ['leftHip',0.45,0.62,0.9],['rightHip',0.55,0.62,0.9],
    ['leftKnee',0.38,0.78,0.9],['rightKnee',0.62,0.78,0.9],['leftAnkle',0.34,0.94,0.9],['rightAnkle',0.66,0.94,0.9],
  ]));
  ok('手臂贴身会被提示', c.issues.some((i) => /臂/.test(i.msg) && /身体|重叠|挨/.test(i.msg)), JSON.stringify(c.issues.map((i)=>i.msg)));
}

// ---------- 人物太小 ----------
{
  const tiny = kps([
    ['nose',0.50,0.45,0.9],['leftShoulder',0.46,0.48,0.9],['rightShoulder',0.54,0.48,0.9],
    ['leftElbow',0.44,0.50,0.9],['rightElbow',0.56,0.50,0.9],['leftWrist',0.43,0.52,0.9],['rightWrist',0.57,0.52,0.9],
    ['leftHip',0.47,0.52,0.9],['rightHip',0.53,0.52,0.9],
    ['leftKnee',0.46,0.54,0.9],['rightKnee',0.54,0.54,0.9],['leftAnkle',0.45,0.56,0.9],['rightAnkle',0.55,0.56,0.9],
  ]);
  const c = checkMaterial(tiny);
  ok('人物过小会提示', c.issues.some((i) => i.msg.includes('太小')), JSON.stringify(c.issues.map((i)=>i.msg)));
  ok('提示里给了占比建议', c.issues.some((i) => i.fix.includes('2/3')), JSON.stringify(c.issues.map((i)=>i.fix)));
}

// ---------- 返回值结构稳定 ----------
{
  const c = checkMaterial(IDEAL);
  ok('返回 ok/issues/parts/summary', typeof c.ok === 'boolean' && Array.isArray(c.issues) && c.parts && typeof c.summary === 'string');
  ok('每个 issue 都有 level/msg/fix', c.issues.every((i) => i.level && i.msg && i.fix));
  ok('null 输入不崩', typeof checkMaterial(null).ok === 'boolean');
  ok('空数组不崩', typeof checkMaterial([]).ok === 'boolean');
}
