import { ok } from './_harness.mjs';
import { parseKeypoints } from '../src/shared/pose.js';
import { bodyBounds, shouldCrop, suggestScale, autoFit, mapToCrop, BODY_PAD } from '../src/shared/autofit.js';

function kps(spec) {
  const names = ['nose','leftEye','rightEye','leftEar','rightEar','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'];
  const r = new Array(51).fill(0);
  for (const [n, x, y, s] of spec) { const i = names.indexOf(n); if (i >= 0) { r[i*3]=y; r[i*3+1]=x; r[i*3+2]=s; } }
  return parseKeypoints(r);
}
/** 标准全身：居中、够大 */
const FULL = kps([
  ['nose',0.50,0.12,0.9],['leftEar',0.55,0.11,0.9],['rightEar',0.45,0.11,0.9],
  ['leftShoulder',0.40,0.28,0.9],['rightShoulder',0.60,0.28,0.9],
  ['leftElbow',0.28,0.42,0.9],['rightElbow',0.72,0.42,0.9],
  ['leftWrist',0.16,0.56,0.9],['rightWrist',0.84,0.56,0.9],
  ['leftHip',0.45,0.62,0.9],['rightHip',0.55,0.62,0.9],
  ['leftKnee',0.42,0.78,0.9],['rightKnee',0.58,0.78,0.9],
  ['leftAnkle',0.40,0.93,0.9],['rightAnkle',0.60,0.93,0.9],
]);

// ---------- 常量 ----------
ok('头部外扩比底部大（头顶还有头发）', BODY_PAD.top > BODY_PAD.bottom, `${BODY_PAD.top} vs ${BODY_PAD.bottom}`);
ok('外扩量都是正的小量', Object.values(BODY_PAD).every((v) => v > 0 && v < 1));

// ---------- bodyBounds ----------
{
  const b = bodyBounds(FULL);
  ok('能算出身体范围', !!b && b.valid === true);
  ok('范围在画面内', b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, JSON.stringify(b));
  ok('范围包含全部关键点', b.x <= 0.16 && b.x + b.w >= 0.84 && b.y <= 0.11 && b.y + b.h >= 0.93, JSON.stringify(b));
  ok('比关键点本身更大（做了外扩）', b.y < 0.11 && b.y + b.h > 0.93, `y=${b.y.toFixed(3)} bottom=${(b.y+b.h).toFixed(3)}`);
  ok('带出躯干单位（供外扩使用）', typeof b.unit === 'number' && b.unit > 0, String(b.unit));
}
ok('缺躯干时返回 null（估出来一定是垃圾）', bodyBounds(parseKeypoints(new Array(51).fill(0))) === null);
ok('空数组返回 null', bodyBounds([]) === null);
ok('null 返回 null', bodyBounds(null) === null);

// ---------- 只有上半身也能估（不能因为缺腿就放弃）----------
{
  const upper = kps([
    ['nose',0.50,0.20,0.9],['leftShoulder',0.40,0.35,0.9],['rightShoulder',0.60,0.35,0.9],
    ['leftElbow',0.28,0.48,0.9],['rightElbow',0.72,0.48,0.9],
    ['leftHip',0.45,0.68,0.9],['rightHip',0.55,0.68,0.9],
  ]);
  const b = bodyBounds(upper);
  ok('只有上半身也能算范围', !!b);
  ok('范围覆盖到肩与髋', b.y <= 0.20 && b.y + b.h >= 0.68, JSON.stringify(b));
}

// ---------- shouldCrop ----------
{
  const c = shouldCrop(FULL);
  ok('占满画面时不建议裁', c.crop === false, c.reason);
  ok('给出理由文案', typeof c.reason === 'string' && c.reason.length > 0);
}
{
  // 人物很小（占画面中央一小块）-> 建议裁
  const tiny = kps([
    ['nose',0.50,0.44,0.9],['leftShoulder',0.47,0.49,0.9],['rightShoulder',0.53,0.49,0.9],
    ['leftElbow',0.45,0.52,0.9],['rightElbow',0.55,0.52,0.9],
    ['leftWrist',0.44,0.55,0.9],['rightWrist',0.56,0.55,0.9],
    ['leftHip',0.48,0.53,0.9],['rightHip',0.52,0.53,0.9],
    ['leftKnee',0.47,0.56,0.9],['rightKnee',0.53,0.56,0.9],
    ['leftAnkle',0.47,0.59,0.9],['rightAnkle',0.53,0.59,0.9],
  ]);
  const c = shouldCrop(tiny);
  ok('人物很小时建议裁', c.crop === true, c.reason);
  ok('理由里提到留白/占比', /留白|占/.test(c.reason), c.reason);
}
{
  // 人物明显偏左
  const left = kps([
    ['nose',0.20,0.30,0.9],['leftShoulder',0.10,0.45,0.9],['rightShoulder',0.30,0.45,0.9],
    ['leftElbow',0.02,0.58,0.9],['rightElbow',0.38,0.58,0.9],
    ['leftHip',0.15,0.70,0.9],['rightHip',0.25,0.70,0.9],
    ['leftKnee',0.12,0.85,0.9],['rightKnee',0.28,0.85,0.9],
    ['leftAnkle',0.10,0.97,0.9],['rightAnkle',0.30,0.97,0.9],
  ]);
  const c = shouldCrop(left);
  ok('人物偏心时建议裁', c.crop === true, c.reason);
  // 注意：这条用例的人物同时「偏左」且「占地不大」，会先命中面积检查。
  // 两种理由都正确，所以这里只断言「给出了可执行的理由」，不锁死具体哪一条。
  ok('理由可读且指向裁剪', c.reason.length > 0 && /留白|居中|偏/.test(c.reason), c.reason);
}
{
  // 够大（面积 > 45%）但明显偏心 -> 必须命中「居中」这条检查
  const bigLeft = kps([
    ['nose',0.14,0.10,0.9],['leftEar',0.20,0.09,0.9],['rightEar',0.08,0.09,0.9],
    ['leftShoulder',0.04,0.26,0.9],['rightShoulder',0.26,0.26,0.9],
    ['leftElbow',0.00,0.42,0.9],['rightElbow',0.34,0.42,0.9],
    ['leftWrist',0.00,0.58,0.9],['rightWrist',0.40,0.58,0.9],
    ['leftHip',0.10,0.60,0.9],['rightHip',0.22,0.60,0.9],
    ['leftKnee',0.06,0.78,0.9],['rightKnee',0.26,0.78,0.9],
    ['leftAnkle',0.04,0.96,0.9],['rightAnkle',0.28,0.96,0.9],
  ]);
  const c2 = shouldCrop(bigLeft);
  ok('够大但偏心也会建议裁', c2.crop === true, c2.reason);
  ok('偏心时理由提到居中/偏', /居中|偏/.test(c2.reason), c2.reason);
}
ok('null 输入安全', shouldCrop(null).crop === false);

// ---------- suggestScale ----------
{
  const b = bodyBounds(FULL);
  const s = suggestScale(b, 260, 0.62);
  ok('建议缩放落在合理区间', s > 0.05 && s <= 2, String(s));
  ok('目标比例可调', suggestScale(b, 260, 0.5) < s, `${suggestScale(b,260,0.5)} < ${s}`);
  ok('b 无效时给默认值', suggestScale(null, 260) === 0.3);
  ok('canvasH 为 0 时给默认值', suggestScale(b, 0) === 0.3);
}

// ---------- autoFit ----------
{
  const f = autoFit(FULL);
  ok('autoFit 成功', f.ok === true, f.reason);
  ok('带出裁剪区域', f.crop && f.crop.w > 0 && f.crop.h > 0);
  ok('带出缩放建议', typeof f.scale === 'number' && f.scale > 0);
  ok('有腿时按脚对齐', f.anchor === 'feet', f.anchor);
  ok('理由可读', typeof f.reason === 'string' && f.reason.length > 0);
  ok('带出是否需要裁剪', typeof f.needCrop === 'boolean');
}
{
  // 没有腿 -> 按髋对齐（否则脚会"悬空"）
  const noLegs = kps([
    ['nose',0.50,0.20,0.9],['leftShoulder',0.40,0.35,0.9],['rightShoulder',0.60,0.35,0.9],
    ['leftElbow',0.28,0.48,0.9],['rightElbow',0.72,0.48,0.9],
    ['leftWrist',0.16,0.60,0.9],['rightWrist',0.84,0.60,0.9],
    ['leftHip',0.45,0.68,0.9],['rightHip',0.55,0.68,0.9],
  ]);
  const f = autoFit(noLegs);
  ok('没腿时按髋对齐', f.anchor === 'hips', f.anchor);
  ok('理由里说明了按腰对齐', f.reason.includes('腰') || f.reason.includes('腿'), f.reason);
}
ok('autoFit 无躯干时 ok=false', autoFit(parseKeypoints(new Array(51).fill(0))).ok === false);
ok('autoFit 空输入不崩', autoFit(null).ok === false);

// ---------- mapToCrop ----------
{
  const crop = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };
  const m = mapToCrop({ x: 0.5, y: 0.5 }, crop);
  ok('中心映射到中心', Math.abs(m.x - 0.5) < 1e-9 && Math.abs(m.y - 0.5) < 1e-9, JSON.stringify(m));
  const tl = mapToCrop({ x: 0.2, y: 0.1 }, crop);
  ok('左上角映射到 0,0', Math.abs(tl.x) < 1e-9 && Math.abs(tl.y) < 1e-9);
  const br = mapToCrop({ x: 0.8, y: 0.9 }, crop);
  ok('右下角映射到 1,1', Math.abs(br.x - 1) < 1e-9 && Math.abs(br.y - 1) < 1e-9);
  ok('crop 退化时安全返回 0,0', mapToCrop({ x: 0.5, y: 0.5 }, { x: 0, y: 0, w: 0, h: 0 }).x === 0);
  ok('空输入安全', mapToCrop(null, crop).x === 0 && mapToCrop({ x: 0.5, y: 0.5 }, null).x === 0);
}
