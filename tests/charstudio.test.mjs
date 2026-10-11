import { ok } from './_harness.mjs';
import {
  DEFAULT_CHARACTER, BODY_SHAPES, EAR_TYPES, EYE_TYPES, MOUTH_TYPES, PALETTES,
  normalizeCharacter, paletteOf, characterPlan, characterFrames, randomCharacter,
} from '../src/shared/charstudio.js';

// ---------- normalizeCharacter：用户输入什么都不能画出畸形角色 ----------
{
  const c = normalizeCharacter(null);
  ok('null 退化为默认', c.name === DEFAULT_CHARACTER.name && c.bodyShape === DEFAULT_CHARACTER.bodyShape);
  ok('空对象也得到完整字段', Object.keys(DEFAULT_CHARACTER).every((k) => k in c), Object.keys(c).join(','));
}
{
  const c = normalizeCharacter({ size: 999, eyeGap: -5, eyeSize: NaN });
  ok('size 被 clamp 到上限', c.size === 1, String(c.size));
  ok('eyeGap 被 clamp 到下限', c.eyeGap === 0.2, String(c.eyeGap));
  ok('NaN 退化为默认', c.eyeSize === DEFAULT_CHARACTER.eyeSize, String(c.eyeSize));
}
{
  const c = normalizeCharacter({ bodyShape: 'triangle', earType: 'wings', eyeType: 'x', mouthType: 'y', paletteId: 'nope' });
  ok('非法体型退化', c.bodyShape === DEFAULT_CHARACTER.bodyShape, c.bodyShape);
  ok('非法耳朵退化', c.earType === DEFAULT_CHARACTER.earType, c.earType);
  ok('非法眼睛退化', c.eyeType === DEFAULT_CHARACTER.eyeType, c.eyeType);
  ok('非法嘴退化', c.mouthType === DEFAULT_CHARACTER.mouthType, c.mouthType);
  ok('非法配色退化', c.paletteId === DEFAULT_CHARACTER.paletteId, c.paletteId);
}
{
  const c = normalizeCharacter({ name: '   ' });
  ok('空白名字被换掉', c.name === DEFAULT_CHARACTER.name, '[' + c.name + ']');
  const long = normalizeCharacter({ name: '字'.repeat(90) });
  ok('超长名字被截断', Array.from(long.name).length === 40, String(Array.from(long.name).length));
  const ctrl = normalizeCharacter({ name: 'a\u0000b\u001fc' });
  ok('控制字符被清掉', !/[\u0000-\u001f\u007f]/.test(ctrl.name), JSON.stringify(ctrl.name));
}
{
  const c = normalizeCharacter({ blush: 0, tail: '', arms: null, legs: 1 });
  ok('布尔开关被如实转换', c.blush === false && c.tail === false && c.arms === false && c.legs === true,
    JSON.stringify([c.blush, c.tail, c.arms, c.legs]));
}

// ---------- paletteOf ----------
{
  ok('有效配色返回自己', paletteOf('mint').id === 'mint', paletteOf('mint').id);
  ok('无效配色返回第一个（不返回 undefined）', !!paletteOf('zzz') && paletteOf('zzz').id === PALETTES[0].id);
  ok('每个配色都有 body/belly/accent', PALETTES.every((p) => p.body && p.belly && p.accent), 'ok');
  ok('配色 id 不重复', new Set(PALETTES.map((p) => p.id)).size === PALETTES.length, 'ok');
}

// ---------- characterPlan：几何必须落在画布内 ----------
{
  const plan = characterPlan(DEFAULT_CHARACTER, { width: 256, height: 256 });
  ok('画布尺寸如实返回', plan.width === 256 && plan.height === 256, `${plan.width}x${plan.height}`);
  ok('身体有正宽高', plan.body.w > 0 && plan.body.h > 0, `${plan.body.w}x${plan.body.h}`);
  ok('身体水平居中', Math.abs((plan.body.x + plan.body.w / 2) - 128) <= 1, String(plan.body.x + plan.body.w / 2));
  ok('身体不超出画布宽度', plan.body.x >= 0 && plan.body.x + plan.body.w <= 256,
    `${plan.body.x}..${plan.body.x + plan.body.w}`);
  ok('两只眼睛', plan.eyes.length === 2, String(plan.eyes.length));
  ok('左眼在右眼左边', plan.eyes[0].cx < plan.eyes[1].cx, `${plan.eyes[0].cx} < ${plan.eyes[1].cx}`);
  ok('双眼关于中心对称', Math.abs((plan.eyes[0].cx + plan.eyes[1].cx) / 2 - 128) <= 1, 'ok');
  ok('嘴在眼睛下方', plan.mouth.cy > plan.eyes[0].cy, `${plan.mouth.cy} > ${plan.eyes[0].cy}`);
}
{
  // 极端 size / eyeGap：眼睛不能跑到身体外面，也不能重叠
  for (const size of [0.35, 0.7, 1]) {
    for (const gap of [0.2, 0.6, 1]) {
      const p = characterPlan({ size, eyeGap: gap, eyeSize: 1 }, { width: 256, height: 256 });
      const [l, r] = p.eyes;
      ok(`size=${size} gap=${gap} 时两眼不重叠`, l.cx + l.r < r.cx - r.r, `${l.cx + l.r} < ${r.cx - r.r}`);
      ok(`size=${size} gap=${gap} 时眼睛不出右边界`, r.cx + r.r <= 256, String(r.cx + r.r));
      ok(`size=${size} gap=${gap} 时眼睛不出左边界`, l.cx - l.r >= 0, String(l.cx - l.r));
    }
  }
}
{
  const p = characterPlan({ earType: 'none' }, { width: 256, height: 256 });
  ok('耳朵可关闭', p.ears.length === 0, String(p.ears.length));
  const p2 = characterPlan({ earType: 'cat' }, { width: 256, height: 256 });
  ok('猫耳有两只', p2.ears.length === 2);
  ok('耳朵在身体上方', p2.ears[0].y < p2.body.y + p2.body.h * 0.2, `${p2.ears[0].y} vs ${p2.body.y}`);
}
{
  const p = characterPlan({ blush: false, tail: false, arms: false, legs: false }, { width: 256, height: 256 });
  ok('腮红可关闭', p.blushes.length === 0);
  ok('尾巴可关闭', p.tail === null);
  ok('手可关闭', p.hands.length === 0);
  ok('脚可关闭', p.feet.length === 0);
  const p2 = characterPlan({ blush: true, tail: true, arms: true, legs: true }, { width: 256, height: 256 });
  ok('腮红有左右两块', p2.blushes.length === 2);
  ok('尾巴有坐标', !!p2.tail && p2.tail.x2 > p2.body.x + p2.body.w, String(p2.tail && p2.tail.x2));
  ok('手有两只', p2.hands.length === 2);
  ok('脚有两只', p2.feet.length === 2);
}
{
  // 每种体型都要给出能画的身体框
  for (const shape of BODY_SHAPES) {
    const p = characterPlan({ bodyShape: shape }, { width: 200, height: 200 });
    ok(`体型 ${shape} 有正的身体框`, p.body.w > 0 && p.body.h > 0, `${p.body.w}x${p.body.h}`);
  }
  for (const t of EAR_TYPES) ok(`耳型 ${t} 可规划`, characterPlan({ earType: t }, {}).ears.length === (t === 'none' ? 0 : 2));
  for (const t of EYE_TYPES) ok(`眼型 ${t} 可规划`, characterPlan({ eyeType: t }, {}).eyes[0].type === t, t);
  for (const t of MOUTH_TYPES) ok(`嘴型 ${t} 可规划`, characterPlan({ mouthType: t }, {}).mouth.type === t, t);
}
{
  const p = characterPlan({}, { width: 8, height: 8 });
  ok('极小画布被抬到最小尺寸', p.width >= 16 && p.height >= 16, `${p.width}x${p.height}`);
  const p2 = characterPlan({}, {});
  ok('缺省画布有默认尺寸', p2.width === 256 && p2.height === 256, `${p2.width}x${p2.height}`);
}
{
  const p = characterPlan({ paletteId: 'coal' }, {});
  ok('配色被带进 plan', p.palette.id === 'coal', p.palette.id);
  ok('plan 里带着归一化后的 cfg', p.cfg.paletteId === 'coal');
}

// ---------- characterFrames：动画必须无缝循环 ----------
{
  const fs = characterFrames({}, 8);
  ok('帧数正确', fs.length === 8, String(fs.length));
  ok('每帧有时长', fs.every((f) => f.durationMs > 0), 'ok');
  ok('首帧与末帧的浮动不重复（无缝循环靠回到起点）',
    Math.abs(fs[0].offsetY - Math.sin(0)) < 1e-9, String(fs[0].offsetY));
  ok('浮动有正有负（真的在动）', fs.some((f) => f.offsetY > 0) && fs.some((f) => f.offsetY < 0), 'ok');
  ok('缩放围绕 1 摆动', fs.every((f) => Math.abs(f.scaleX - 1) <= 0.05 && Math.abs(f.scaleY - 1) <= 0.05), 'ok');
}
{
  const a = characterFrames({}, 4);
  ok('帧数下限（1 变成 >= 2）', characterFrames({}, 1).length === 2, String(characterFrames({}, 1).length));
  ok('帧数上限（999 变成 <= 48）', characterFrames({}, 999).length === 48, String(characterFrames({}, 999).length));
  ok('4 帧合法', a.length === 4);
  ok('两帧时首帧 offsetY 为 0', Math.abs(characterFrames({}, 2)[0].offsetY) < 1e-9);
}

// ---------- randomCharacter：随机也必须产出合法配置 ----------
{
  // 用固定序列喂进去，验证"随机不能产生非法值"
  let i = 0;
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.6, 0.4, 0.05, 0.95, 0.35];
  const rng = () => seq[i++ % seq.length];
  for (let k = 0; k < 30; k++) {
    const c = randomCharacter(rng);
    const again = normalizeCharacter(c);
    ok(`随机 #${k} 是合法体型`, BODY_SHAPES.includes(c.bodyShape), c.bodyShape);
    ok(`随机 #${k} 是合法配色`, PALETTES.some((p) => p.id === c.paletteId), c.paletteId);
    ok(`随机 #${k} 已经归一化（再归一化不变）`, JSON.stringify(again) === JSON.stringify(c), 'stable');
    const p = characterPlan(c, { width: 256, height: 256 });
    ok(`随机 #${k} 的身体在画布内`, p.body.x >= -1 && p.body.x + p.body.w <= 257, String(p.body.x));
  }
}
{
  const c = randomCharacter(null);
  ok('rng 传 null 也能用（退回 Math.random）', BODY_SHAPES.includes(c.bodyShape), c.bodyShape);
}
