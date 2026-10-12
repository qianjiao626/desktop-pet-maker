import { ok } from './_harness.mjs';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CHARACTER, BODY_SHAPES, EAR_TYPES, EYE_TYPES, MOUTH_TYPES, PALETTES,
  normalizeCharacter, paletteOf, characterPlan, characterFrames, randomCharacter,
  DANCES, DANCE_IDS, danceOf, dancePose, rotatePoint, maxSafeAngle, FIGURE_TYPES,
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

// ============ 跳舞（v0.9.37）============
// ★ 这个功能成立的**唯一理由**（必须锁死，别哪天被"优化"掉）：
//   静态照片没有背面/关节内侧/被遮挡肢体的像素，任何"搬运像素"都补不出来
//   （HANDOFF 已知坑第 23 条，三条路线实测全败）。
//   而**程序化绘制的小人**里，像素是我们自己画的 —— 抬手后腋下是什么颜色、
//   肩膀内侧长什么样，我们**知道**，重新画一遍即可，不存在信息缺失。
//   所以"操控他跳舞"只对绘制角色成立，对照片不成立。
{
  ok('舞蹈列表非空', DANCES.length >= 4, String(DANCES.length));
  ok('舞蹈 id 与 DANCE_IDS 一致', DANCES.map((d) => d.id).join(',') === DANCE_IDS.join(','), DANCES.map((d) => d.id).join(','));
  ok('每个舞蹈都有 name/emoji/desc', DANCES.every((d) => d.name && d.emoji && d.desc), 'ok');
  ok('第一个是"不跳"（默认不能一上来就蹦迪）', DANCES[0].id === 'none', DANCES[0].id);
  ok('未知 id 退回"不跳"（不返回 undefined）', danceOf('nope').id === 'none', danceOf('nope').id);
  ok('none 的姿态是全零', JSON.stringify(dancePose('none', 0.3)) === JSON.stringify({ offsetY: 0, rotate: 0, scaleX: 1, scaleY: 1, armL: 0, armR: 0, legL: 0, legR: 0 }), JSON.stringify(dancePose('none', 0.3)));
}

// ---------- 每个舞蹈都必须"真的在动"，而且要动得能被看见 ----------
{
  const SAMPLES = 24;
  for (const d of DANCES) {
    if (d.id === 'none') continue;
    const poses = [];
    for (let i = 0; i < SAMPLES; i++) poses.push(dancePose(d.id, i / SAMPLES));

    // ① 手臂或身体必须真的摆起来（否则叫"跳舞"却纹丝不动）
    const armSpread = Math.max(...poses.map((p) => Math.abs(p.armL))) ;
    ok(`${d.name}：手臂真的摆起来了`, armSpread > 0.5, 'armL max=' + armSpread.toFixed(3));
    // ② 至少有一项在变（不是恒定姿态）
    const vary = (k) => Math.max(...poses.map((p) => p[k])) - Math.min(...poses.map((p) => p[k]));
    const total = vary('armL') + vary('armR') + vary('rotate') + vary('offsetY') + vary('legL') + vary('legR');
    ok(`${d.name}：姿态确实在变化（不是恒定姿势）`, total > 0.3, 'total=' + total.toFixed(3));

    // ③ 幅度必须被 clamp 住（防以后写错数值画出畸形/穿帮）。
    //    聚合成一条断言：逐采样点断言会把测试数量灌成几百条，噪音大。
    const bad = poses.filter((p) => Math.abs(p.offsetY) > 0.12 || Math.abs(p.rotate) > 0.45
      || Math.abs(p.armL) > 1.85 || Math.abs(p.armR) > 1.85
      || Math.abs(p.legL) > 0.75 || Math.abs(p.legR) > 0.75
      || p.scaleX < 0.85 || p.scaleX > 1.15 || p.scaleY < 0.85 || p.scaleY > 1.15);
    ok(`${d.name}：全程幅度都被 clamp 住（不穿帮）`, bad.length === 0, bad.length + ' 帧越界，例如 ' + JSON.stringify(bad[0]));
  }
}

// ---------- 无缝循环：t=0 与 t->1 必须接得上（不然动画会"跳一下"） ----------
{
  for (const d of DANCES) {
    if (d.id === 'none') continue;
    const a = dancePose(d.id, 0);
    const b = dancePose(d.id, 1);
    const close = (x, y) => Math.abs(x - y) < 1e-6;
    ok(`${d.name}：首尾姿态接得上（无缝循环）`,
      close(a.armL, b.armL) && close(a.armR, b.armR) && close(a.offsetY, b.offsetY) && close(a.rotate, b.rotate),
      JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  }
}

// ---------- 非法输入不能画出畸形角色 ----------
{
  ok('t 是 NaN 不崩', Number.isFinite(dancePose('bounce', NaN).armL), String(dancePose('bounce', NaN).armL));
  ok('t 超范围也返回有限值', Number.isFinite(dancePose('bounce', 99).armL), String(dancePose('bounce', 99).armL));
  ok('dancePose 传空不崩', Number.isFinite(dancePose().offsetY), 'ok');
  // 人为塞一个坏 pose，验证兜底 clamp 真的在起作用
  const bad = DANCES.find((d) => d.id === 'bounce');
  const orig = bad.pose;
  bad.pose = () => ({ armL: 99, armR: -99, offsetY: 50, rotate: 9, scaleX: 99, legL: 99 });
  const p = dancePose('bounce', 0.25);
  bad.pose = orig;
  ok('坏数值被 clamp 住（手臂）', Math.abs(p.armL) <= 1.85 && Math.abs(p.armR) <= 1.85, `${p.armL}/${p.armR}`);
  ok('坏数值被 clamp 住（位移/旋转/缩放/腿）',
    Math.abs(p.offsetY) <= 0.12 && Math.abs(p.rotate) <= 0.45 && p.scaleX <= 1.15 && Math.abs(p.legL) <= 0.75,
    JSON.stringify(p));
}

// ---------- dance 必须存进配置并往返（否则存盘/载入会静默丢掉它） ----------
{
  ok('默认不跳舞', DEFAULT_CHARACTER.dance === 'none', DEFAULT_CHARACTER.dance);
  const c = normalizeCharacter({ dance: 'party' });
  ok('dance 被保留', c.dance === 'party', c.dance);
  ok('非法 dance 退回默认', normalizeCharacter({ dance: 'moonwalk' }).dance === 'none', normalizeCharacter({ dance: 'moonwalk' }).dance);
  ok('再归一化不变（稳定）', JSON.stringify(normalizeCharacter(c)) === JSON.stringify(c), 'stable');
  ok('随机角色也带合法 dance', DANCE_IDS.includes(randomCharacter(() => 0.9).dance), randomCharacter(() => 0.9).dance);
}

// ---------- characterFrames 必须把舞蹈采样进去 ----------
{
  const still = characterFrames({ dance: 'none' }, 8);
  ok('不跳舞时 rotate/arm 全为 0（外观与旧版一致）',
    still.every((f) => !f.rotate && !f.armL && !f.armR && !f.legL && !f.legR), JSON.stringify(still[0]));

  const dance = characterFrames({ dance: 'party' }, 12);
  ok('跳舞时帧数正确', dance.length === 12, String(dance.length));
  ok('跳舞时帧里带手臂角度', dance.some((f) => Math.abs(f.armL) > 0.5), 'ok');
  ok('跳舞时帧间隔更短（更跟拍）', dance[0].durationMs < still[0].durationMs, dance[0].durationMs + ' vs ' + still[0].durationMs);
  ok('跳舞时整体仍在合法范围', dance.every((f) => Math.abs(f.offsetY) <= 0.2 && Math.abs(f.rotate) <= 0.45), 'ok');
}

// ---------- 四肢几何：必须带关节（圆点转了看不出在动） ----------
{
  const plan = characterPlan({ arms: true, legs: true }, { width: 256, height: 256 });
  ok('手有 2 只', plan.hands.length === 2, String(plan.hands.length));
  for (const h of plan.hands) {
    ok('手有肩关节坐标', Number.isFinite(h.sx) && Number.isFinite(h.sy), JSON.stringify(h));
    ok('手有末端坐标', Number.isFinite(h.ex) && Number.isFinite(h.ey), JSON.stringify(h));
    ok('手有粗细与半径', h.w > 0 && h.r > 0, JSON.stringify(h));
    ok('肩与末端不重合（否则转起来看不出变化）', Math.hypot(h.ex - h.sx, h.ey - h.sy) > 1, JSON.stringify(h));
    ok('手有左右标记（渲染要按左/右取不同角度）', h.side === 'left' || h.side === 'right', h.side);
  }
  for (const ft of plan.feet) {
    ok('脚有髋关节坐标', Number.isFinite(ft.sx) && Number.isFinite(ft.sy), JSON.stringify(ft));
    ok('脚有末端坐标', Number.isFinite(ft.ex) && Number.isFinite(ft.ey), JSON.stringify(ft));
    ok('脚有左右标记', ft.side === 'left' || ft.side === 'right', ft.side);
  }
  const off = characterPlan({ arms: false, legs: false }, { width: 256, height: 256 });
  ok('手可关闭（仍然）', off.hands.length === 0);
  ok('脚可关闭（仍然）', off.feet.length === 0);
}

// ---------- 静态守护：渲染层真的绕关节转，不是画个静态圆 ----------
{
  const src = readFileSync('src/maker/charrender.js', 'utf8');
  ok('渲染层有绕关节的旋转逻辑', src.includes('drawLimb') && src.includes('rotatePoint'), 'render');
  ok('渲染复用 shared 的 rotatePoint（渲染与测试同一算法）', src.includes("import { characterPlan, characterFrames, normalizeCharacter, rotatePoint }"), 'shared-rotate');
  ok('手用 armL/armR、脚用 legL/legR（左右分开）', src.includes('f.armL') && src.includes('f.armR') && src.includes('f.legL') && src.includes('f.legR'), 'render');
  ok('渲染时把"抬起程度"乘上安全上限（否则会伸出画布）', src.includes('maxOut'), 'maxout');
  ok('整体旋转是绕身体中心而不是画布中心（否则会甩出画面）', src.includes('pivotX') && src.includes('pivotY'), 'pivot');
  const shared = readFileSync('src/shared/charstudio.js', 'utf8');
  ok('几何层导出四肢关节（sx/sy/ex/ey）', shared.includes('sx:') && shared.includes('ex:'), 'geom');
}

// ---------- 静态守护：UI 必须能选舞蹈，且选了会写进配置 ----------
{
  const html = readFileSync('src/maker/index.html', 'utf8');
  ok('工坊有舞蹈选择框', html.includes('id="stDance"'), 'html');
  for (const d of DANCE_IDS) {
    ok('舞蹈选项存在：' + d, html.includes('value="' + d + '"'), d);
  }
  const maker = readFileSync('src/maker/maker.js', 'utf8');
  ok('maker 读配置时带上 dance', /dance:\s*\$\('#stDance'\)/.test(maker), 'read');
  ok('maker 写配置时回填 dance', /\$\('#stDance'\)\.value = c\.dance/.test(maker), 'write');
  ok('预览会真的动起来（选了舞蹈就播动画）', maker.includes('stStartPreviewAnim') && maker.includes('requestAnimationFrame(step)'), 'anim');
  ok('离开工坊页会停掉预览动画（别白烧 CPU）', /stStartPreviewAnim[\s\S]{0,900}classList\.contains\('active'\)/.test(maker), 'stop');
}

// ---------- ★ 举手不能伸出画布（实测踩过：写死 90° 会被裁掉半截） ----------
{
  for (const size of [0.35, 0.6, 0.85, 1]) {
    const plan = characterPlan({ size, arms: true, legs: true }, { width: 256, height: 256 });
    for (const limb of [...plan.hands, ...plan.feet]) {
      ok(`size=${size} ${limb.side}${limb.side === 'left' ? '手' : '手'}有安全上限`, limb.maxOut >= 0, String(limb.maxOut));
      ok(`size=${size} 肢体带方向标记（决定往哪边抬）`, limb.dir === 1 || limb.dir === -1, String(limb.dir));
    }
    // 按安全上限抬到最大，末端必须仍在画布内
    const W = 256, H = 256;
    for (const limb of [...plan.hands, ...plan.feet]) {
      const p = rotatePoint(limb.sx, limb.sy, limb.ex, limb.ey, limb.maxOut * limb.dir);
      ok(`size=${size} 抬到上限仍在画布内（不会裁掉）`,
        p.x - limb.r >= -0.01 && p.x + limb.r <= W + 0.01 && p.y - limb.r >= -0.01 && p.y + limb.r <= H + 0.01,
        `x=${p.x.toFixed(1)} r=${limb.r.toFixed(1)} y=${p.y.toFixed(1)}`);
    }
  }
}
{
  // 任意舞蹈、任意帧、任意体型：抬起程度必须在 0~1，乘上限后一定不出界
  for (const d of DANCES) {
    if (d.id === 'none') continue;
    for (const size of [0.35, 0.7, 1]) {
      const cfg = normalizeCharacter({ dance: d.id, size });
      const plan = characterPlan(cfg, { width: 256, height: 256 });
      const frames = characterFrames(cfg, 16);
      let bad = null;
      for (const f of frames) {
        for (const limb of [...plan.hands, ...plan.feet]) {
          const frac = limb.side === 'left'
            ? (plan.hands.includes(limb) ? f.armL : f.legL)
            : (plan.hands.includes(limb) ? f.armR : f.legR);
          const p = rotatePoint(limb.sx, limb.sy, limb.ex, limb.ey, frac * limb.maxOut * limb.dir);
          if (p.x - limb.r < -0.01 || p.x + limb.r > 256.01 || p.y - limb.r < -0.01 || p.y + limb.r > 256.01) {
            bad = { d: d.id, size, frac, limb: limb.side, x: p.x, y: p.y, r: limb.r };
          }
        }
      }
      ok(`${d.name} size=${size}：全程四肢都在画布内`, !bad, JSON.stringify(bad));
    }
  }
}
{
  ok('抬起程度被限制在 0~1（不会超过安全上限）', (() => {
    for (const d of DANCES) {
      if (d.id === 'none') continue;
      for (let i = 0; i < 24; i++) {
        const p = dancePose(d.id, i / 24);
        for (const k of ['armL', 'armR', 'legL', 'legR']) if (p[k] < 0 || p[k] > 1) return false;
      }
    }
    return true;
  })(), 'range');
}

// ---------- ★ 工坊能存「动作片段」（否则捏的小人只能有一个舞步） ----------
// 背景：动作片段机制早就有了，但**只接在"照片微动作"上** ——
// 捏的小人存不了片段，于是上桌后永远重复同一个舞步（真缺口）。
{
  const html = readFileSync('src/maker/index.html', 'utf8');
  ok('工坊有「存为动作片段」按钮', html.includes('id="btnStAddClip"'), 'html');
  ok('按钮文案说明了可以多存几段', /存为动作片段（可多存几段）/.test(html), 'label');

  const maker = readFileSync('src/maker/maker.js', 'utf8');
  ok('maker 绑定了该按钮', maker.includes("$('#btnStAddClip').onclick"), 'bind');
  ok('存片段走的是 state.clips.push', /state\.clips\.push\(\{ id: cid, name: String\(clipName\)/.test(maker), 'push');
  ok('片段名用舞步名（用户能分辨，不是一串 id）', maker.includes('DANCES.find((d) => d.id === cfg.dance)'), 'name');
  ok('存片段会刷新片段列表', /state\.clips\.push[\s\S]{0,400}renderClipList\(\)/.test(maker), 'render');
  // 只取这个按钮自己的处理块（跨到下一个函数就会误判）
  const clipHandler = maker.match(/\$\('#btnStAddClip'\)\.onclick = \(\) => \{[\s\S]*?\n  \};/);
  ok('能找到「存为片段」的处理块', !!clipHandler, 'handler');
  ok('存片段不碰主帧（主帧不动）', !!clipHandler && !/state\.frames\s*=/.test(clipHandler[0]), clipHandler ? clipHandler[0].slice(0, 300) : '');
  ok('存片段走同一个渲染入口（预览与导出一致）', maker.includes('stRenderClipFrames') && /stRenderClipFrames[\s\S]{0,200}renderCharacterFrames/.test(maker), 'render-shared');

  // 撤销/重做的门槛不能只看"有没有帧" —— 否则"只存片段不生成主帧"时存不了/撤不了
  const snap = maker.match(/function recordUndo\(\) \{[\s\S]*?\n\}/);
  ok('recordUndo 允许"只有片段"时也记一步', !!snap && /!state\.frames\.length && !state\.clips\.length/.test(snap[0]), snap ? snap[0] : 'missing');
  const after = maker.match(/function recordUndoAfter\(\) \{[\s\S]*?\n\}/);
  ok('recordUndoAfter 同样考虑片段', !!after && /!state\.clips\.length/.test(after[0]), after ? after[0] : 'missing');
}

// ---------- 片段里的帧必须和"生成动画帧"一样是真像素 ----------
{
  // characterFrames 是两者的共同采样来源：段片段时也不能退化成静止帧
  for (const d of DANCES) {
    if (d.id === 'none') continue;
    const fs = characterFrames({ dance: d.id }, 8);
    const hashes = new Set(fs.map((f) => JSON.stringify([f.armL, f.armR, f.legL, f.legR, f.rotate, f.offsetY])));
    ok(`${d.name}：8 帧里姿态各不相同（片段不会是"静止的 8 张"）`, hashes.size >= 6, String(hashes.size));
  }
}

// ============ 小人形体（v0.9.39）============
// 背景：用户最初那句是「人人都可以绘制一个自己的**小人**」，
// 但工坊此前只能捏出圆滚滚的宠物 —— 捏不出人。这是真缺口。
// 人形 = 头 + 躯干分开（宠物是头身一体），五官画在头上、手脚挂在躯干上。
{
  ok('形体类型只有 pet/human', FIGURE_TYPES.join(',') === 'pet,human', FIGURE_TYPES.join(','));
  ok('默认仍是宠物（老配置不变形）', normalizeCharacter({}).figureType === 'pet', normalizeCharacter({}).figureType);
  ok('human 被保留', normalizeCharacter({ figureType: 'human' }).figureType === 'human');
  ok('非法形体退回默认', normalizeCharacter({ figureType: 'robot' }).figureType === 'pet');
  ok('再归一化稳定', (() => { const c = normalizeCharacter({ figureType: 'human' }); return JSON.stringify(normalizeCharacter(c)) === JSON.stringify(c); })());
}

// ---------- 人形必须有独立的头，且整身装进画布 ----------
{
  const pet = characterPlan({ figureType: 'pet' }, { width: 256, height: 256 });
  ok('宠物没有独立的头（头身一体）', pet.head === null, JSON.stringify(pet.head));

  for (const size of [0.35, 0.6, 0.85, 1]) {
    const p = characterPlan({ figureType: 'human', size, arms: true, legs: true }, { width: 256, height: 256 });
    ok(`size=${size} 小人有一个头`, !!p.head, JSON.stringify(p.head));
    ok(`size=${size} 头是圆的且半径为正`, p.head.r > 0, String(p.head && p.head.r));
    ok(`size=${size} 头不超出画布上沿`, p.head.cy - p.head.r >= -0.01, `top=${(p.head.cy - p.head.r).toFixed(1)}`);
    ok(`size=${size} 头不超出左右`, p.head.cx - p.head.r >= -0.01 && p.head.cx + p.head.r <= 256.01, `x=${p.head.cx.toFixed(1)} r=${p.head.r.toFixed(1)}`);
    ok(`size=${size} 头在躯干上方（不是头长在肚子上）`, p.head.cy < p.body.y, `${p.head.cy.toFixed(1)} < ${p.body.y.toFixed(1)}`);
    // 五官必须在头上（否则脸会跑到身子上）
    for (const e of p.eyes) {
      const d = Math.hypot(e.cx - p.head.cx, e.cy - p.head.cy);
      ok(`size=${size} 眼睛落在头内`, d + e.r <= p.head.r * 1.02, `d=${d.toFixed(1)} r=${e.r.toFixed(1)} headR=${p.head.r.toFixed(1)}`);
    }
    const dm = Math.hypot(p.mouth.cx - p.head.cx, p.mouth.cy - p.head.cy);
    ok(`size=${size} 嘴落在头内`, dm <= p.head.r * 1.02, `d=${dm.toFixed(1)}`);
    // 整身（头 + 躯干 + 腿）都要在画布内
    const legBot = p.feet.length ? Math.max(...p.feet.map((f) => f.ey + f.r)) : p.body.y + p.body.h;
    ok(`size=${size} 脚不超出画布下沿`, legBot <= 256.01, `bot=${legBot.toFixed(1)}`);
    ok(`size=${size} 头到脚都在画布内`, (p.head.cy - p.head.r) >= -0.01 && legBot <= 256.01, 'span');
  }
}

// ---------- 小人没有兽耳/尾巴（那是宠物特征） ----------
{
  const p = characterPlan({ figureType: 'human', earType: 'cat', tail: true }, { width: 256, height: 256 });
  ok('小人没有兽耳', p.ears.length === 0, String(p.ears.length));
  ok('小人没有尾巴', p.tail === null, JSON.stringify(p.tail));
  const pet = characterPlan({ figureType: 'pet', earType: 'cat', tail: true }, { width: 256, height: 256 });
  ok('宠物仍然有耳朵（没被误伤）', pet.ears.length === 2, String(pet.ears.length));
  ok('宠物仍然有尾巴（没被误伤）', !!pet.tail, JSON.stringify(pet.tail));
}

// ---------- ★ 手脚必须"长在身体上"（不能从侧面飘出来） ----------
// 实测踩过：躯干是椭圆时，上下两端比中间窄，
// 按身体框的固定比例放肩点会落到椭圆轮廓**之外** —— 渲染出来手臂与身体之间有一道缝。
{
  for (const shape of BODY_SHAPES) {
    for (const size of [0.4, 0.7, 1]) {
      const p = characterPlan({ figureType: 'human', bodyShape: shape, size, arms: true }, { width: 256, height: 256 });
      const t = (p.hands[0].sy - p.body.y) / p.body.h;      // 肩在身体高度上的位置
      const half = p.body.w * 0.5 * Math.sqrt(Math.max(0, 1 - ((Math.min(1, Math.max(0, t)) - 0.5) * 2) ** 2));
      const edgeL = p.body.x + p.body.w / 2 - half;
      const edgeR = p.body.x + p.body.w / 2 + half;
      const isSquare = shape === 'square';
      ok(`${shape} size=${size}：左肩不落在身体轮廓外（不飘）`,
        isSquare || p.hands[0].sx >= edgeL - 1, `sx=${p.hands[0].sx.toFixed(1)} edgeL=${edgeL.toFixed(1)}`);
      ok(`${shape} size=${size}：右肩不落在身体轮廓外（不飘）`,
        isSquare || p.hands[1].sx <= edgeR + 1, `sx=${p.hands[1].sx.toFixed(1)} edgeR=${edgeR.toFixed(1)}`);
      // 髋同理（脚不能从身体侧面飘出去）
      const tf = (p.feet[0].sy - p.body.y) / p.body.h;
      const halfF = p.body.w * 0.5 * Math.sqrt(Math.max(0, 1 - ((Math.min(1, Math.max(0, tf)) - 0.5) * 2) ** 2));
      ok(`${shape} size=${size}：左脚接在身体下缘内`, isSquare || Math.abs(p.feet[0].sx - p.body.x - p.body.w / 2) <= halfF + 1,
        `dx=${Math.abs(p.feet[0].sx - p.body.x - p.body.w / 2).toFixed(1)} half=${halfF.toFixed(1)}`);
    }
  }
}

// ---------- 小人也能跳舞（复用同一套舞蹈机制） ----------
{
  const cfg = normalizeCharacter({ figureType: 'human', dance: 'party' });
  const fs = characterFrames(cfg, 12);
  ok('小人跳舞也有 12 帧', fs.length === 12, String(fs.length));
  ok('小人跳舞时手臂真的摆起来', fs.some((f) => Math.abs(f.armL) > 0.4), JSON.stringify(fs.map((f) => +f.armL.toFixed(2))));
  const plan = characterPlan(cfg, { width: 256, height: 256 });
  let bad = null;
  for (const f of fs) {
    for (const limb of [...plan.hands, ...plan.feet]) {
      const isHand = plan.hands.includes(limb);
      const frac = isHand ? (limb.side === 'left' ? f.armL : f.armR) : (limb.side === 'left' ? f.legL : f.legR);
      const pt = rotatePoint(limb.sx, limb.sy, limb.ex, limb.ey, frac * limb.maxOut * limb.dir);
      if (pt.x - limb.r < -0.01 || pt.x + limb.r > 256.01 || pt.y - limb.r < -0.01 || pt.y + limb.r > 256.01) {
        bad = { side: limb.side, x: pt.x, y: pt.y, r: limb.r };
      }
    }
  }
  ok('小人跳舞时四肢全程不出画布', !bad, JSON.stringify(bad));
}

// ---------- 静态守护：UI 能选形体，且会写进配置 ----------
{
  const html = readFileSync('src/maker/index.html', 'utf8');
  ok('工坊有形体选择框', html.includes('id="stFigure"'), 'html');
  ok('有形体的两个选项', html.includes('value="pet"') && html.includes('value="human"'), 'opts');
  const maker = readFileSync('src/maker/maker.js', 'utf8');
  ok('maker 读配置时带上 figureType', /figureType:\s*\$\('#stFigure'\)/.test(maker), 'read');
  ok('maker 写配置时回填 figureType', /\$\('#stFigure'\)\.value = c\.figureType/.test(maker), 'write');
  ok('形体切换会触发重绘', /'stName', 'stFigure'/.test(maker), 'bind');
  const render = readFileSync('src/maker/charrender.js', 'utf8');
  ok('渲染层会画头（小人）', render.includes('plan.head') && render.includes('arc(plan.head.cx'), 'head');
  ok('渲染层画了脖子（头不飘着）', render.includes('脖子') || /moveTo\(plan\.head\.cx/.test(render), 'neck');
}
