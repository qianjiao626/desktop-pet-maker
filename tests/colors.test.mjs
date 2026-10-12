import { ok } from './_harness.mjs';
import { dominantColor, paletteFromDominant, colorsFromImageData, rgbToHsl, hslToHex } from '../src/shared/colors.js';
import { normalizeCharacter, characterPlan, effectivePalette, normCustomPalette } from '../src/shared/charstudio.js';

// 从照片取主色，用来给"照着照片捏的小人"配上接近本人的颜色。
//
// ★ 为什么自己写而不是用现成库（GitHub 调研结论）：
//   最相关的是 ColorCube（614★，MIT）—— 只有 iOS/macOS/Python 实现；
//   其 JS 移植版许可证不清晰（NOASSERTION），不符合本项目"零依赖 + 许可明确"。
//   我们的场景比它窄得多：只要"一个主色 + 浅色 + 深色"，几十行纯逻辑即可。

/** 造一块纯色 RGBA */
function solid(r, g, b, n = 400, a = 255) {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { d[i*4] = r; d[i*4+1] = g; d[i*4+2] = b; d[i*4+3] = a; }
  return d;
}
/** 两块颜色按数量拼起来 */
function mix(c1, n1, c2, n2) {
  const d = new Uint8ClampedArray((n1 + n2) * 4);
  let k = 0;
  for (let i = 0; i < n1; i++) { d[k++] = c1[0]; d[k++] = c1[1]; d[k++] = c1[2]; d[k++] = 255; }
  for (let i = 0; i < n2; i++) { d[k++] = c2[0]; d[k++] = c2[1]; d[k++] = c2[2]; d[k++] = 255; }
  return d;
}

// ---------- 色相换算：来回转换必须稳定 ----------
{
  ok('纯红 -> h=0', Math.abs(rgbToHsl(255, 0, 0).h - 0) < 1e-6, String(rgbToHsl(255, 0, 0).h));
  ok('纯绿 -> h=120', Math.abs(rgbToHsl(0, 255, 0).h - 120) < 1e-6, String(rgbToHsl(0, 255, 0).h));
  ok('纯蓝 -> h=240', Math.abs(rgbToHsl(0, 0, 255).h - 240) < 1e-6, String(rgbToHsl(0, 0, 255).h));
  ok('灰色饱和度为 0', rgbToHsl(128, 128, 128).s === 0, String(rgbToHsl(128, 128, 128).s));
  ok('HSL 往返稳定（红）', hslToHex(0, 1, 0.5) === '#ff0000', hslToHex(0, 1, 0.5));
  ok('HSL 往返稳定（蓝）', hslToHex(240, 1, 0.5) === '#0000ff', hslToHex(240, 1, 0.5));
  ok('负色相被归一化', hslToHex(-120, 1, 0.5) === hslToHex(240, 1, 0.5), hslToHex(-120, 1, 0.5));
  ok('输出永远是合法 #rrggbb', (() => {
    for (const h of [0, 45, 90, 180, 270, 359]) {
      for (const s of [0, 0.5, 1]) {
        for (const l of [0, 0.5, 1]) {
          if (!/^#[0-9a-f]{6}$/.test(hslToHex(h, s, l))) return false;
        }
      }
    }
    return true;
  })(), 'hex');
}

// ---------- dominantColor：该投的投、不该投的不投 ----------
{
  ok('空输入返回 null', dominantColor(null) === null && dominantColor(new Uint8ClampedArray(0)) === null);
  ok('全透明返回 null（抠图后的透明背景不能决定配色）', dominantColor(solid(255, 0, 0, 100, 0)) === null);
  ok('纯白返回 null（白墙不该当宠物色）', dominantColor(solid(255, 255, 255)) === null);
  ok('纯黑返回 null（阴影不该当宠物色）', dominantColor(solid(0, 0, 0)) === null);
  ok('纯灰返回 null（没有色彩信息）', dominantColor(solid(128, 128, 128)) === null);

  const red = dominantColor(solid(220, 40, 40));
  ok('纯红能取到主色', !!red, JSON.stringify(red));
  ok('主色色相接近 0（红）', red.h < 12 || red.h > 348, String(red.h));
  ok('返回合法的 hex', /^#[0-9a-f]{6}$/.test(red.hex), red.hex);
  ok('票数大于 0', red.votes > 0, String(red.votes));
}

// ---------- 多数决：颜色多的那个该赢（而不是先出现的那个） ----------
{
  const d = mix([220, 40, 40], 100, [40, 80, 220], 500);
  const dom = dominantColor(d);
  const h = rgbToHsl(40, 80, 220).h;
  ok('蓝色占多数时取到蓝色', Math.abs(dom.h - h) < 20, `got=${dom.h.toFixed(1)} want=${h.toFixed(1)}`);
  // 反过来
  const d2 = mix([220, 40, 40], 500, [40, 80, 220], 100);
  const dom2 = dominantColor(d2);
  ok('红色占多数时取到红色', dom2.h < 20 || dom2.h > 340, String(dom2.h.toFixed(1)));
}

// ---------- ★ 白墙/阴影不能压倒主体色 ----------
{
  // 主体是橙色小人，但四周是大片白墙 + 一块黑影
  const d = new Uint8ClampedArray((300 + 600 + 300) * 4);
  let k = 0;
  const put = (c, n) => { for (let i = 0; i < n; i++) { d[k++] = c[0]; d[k++] = c[1]; d[k++] = c[2]; d[k++] = 255; } };
  put([255, 255, 255], 600);   // 白墙最多
  put([10, 10, 10], 300);      // 阴影
  put([240, 150, 60], 300);    // 真正的主体（橙色）
  const dom = dominantColor(d);
  const want = rgbToHsl(240, 150, 60).h;
  ok('白墙与阴影被排除，取到主体橙色', !!dom && Math.abs(dom.h - want) < 25,
    dom ? `got=${dom.h.toFixed(1)} want=${want.toFixed(1)}` : 'null');
}

// ---------- paletteFromDominant：结果必须能当宠物色 ----------
{
  ok('null 返回 null', paletteFromDominant(null) === null);
  ok('没有色相返回 null', paletteFromDominant({ s: 0.5, l: 0.5 }) === null);

  // 极暗的深蓝（衣服色）也要被提亮到能看清
  const dark = paletteFromDominant({ h: 240, s: 0.9, l: 0.10 });
  ok('极暗主色被提亮', (() => {
    const { l } = rgbToHsl(...hexToRgb(dark.body));
    return l >= 0.45;
  })(), dark.body);
  // 极灰的色也要加饱和
  const gray = paletteFromDominant({ h: 200, s: 0.02, l: 0.7 });
  ok('极灰主色被加饱和', (() => {
    const { s } = rgbToHsl(...hexToRgb(gray.body));
    return s >= 0.4;
  })(), gray.body);

  const p = paletteFromDominant({ h: 120, s: 0.6, l: 0.55 });
  ok('三个颜色都是合法 hex', ['body','belly','accent'].every((k) => /^#[0-9a-f]{6}$/.test(p[k])), JSON.stringify(p));
  ok('肚皮比身体浅', (() => {
    const b = rgbToHsl(...hexToRgb(p.body)).l, y = rgbToHsl(...hexToRgb(p.belly)).l;
    return y > b;
  })(), JSON.stringify(p));
  ok('强调色比身体深', (() => {
    const b = rgbToHsl(...hexToRgb(p.body)).l, a = rgbToHsl(...hexToRgb(p.accent)).l;
    return a < b;
  })(), JSON.stringify(p));
  ok('非法色相不崩', paletteFromDominant({ h: NaN, s: 0.5, l: 0.5 }) === null);
}
function hexToRgb(h) {
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
}

// ---------- colorsFromImageData：一步到位 ----------
{
  const r = colorsFromImageData(solid(230, 120, 60));
  ok('能从像素一步取到配色', !!r && /^#[0-9a-f]{6}$/.test(r.body), JSON.stringify(r));
  ok('带上来源与主色（便于界面提示）', r.source === 'photo' && /^#[0-9a-f]{6}$/.test(r.dominantHex), JSON.stringify(r));
  ok('没有可用颜色时返回 null（调用方保留原配色）', colorsFromImageData(solid(255,255,255)) === null);
}

// ---------- 接进角色配置：自定义配色必须真的改变画出来的颜色 ----------
{
  ok('非法自定义配色被拒绝', normCustomPalette({ body: 'red' }) === null && normCustomPalette(null) === null);
  ok('合法自定义配色被保留', !!normCustomPalette({ body: '#112233', belly: '#445566', accent: '#778899' }), 'ok');
  ok('缺一项就整套作废（不要半套脏色）', normCustomPalette({ body: '#112233', belly: '#445566' }) === null);

  const custom = colorsFromImageData(solid(230, 120, 60));
  const cfg = normalizeCharacter({ customPalette: custom });
  ok('自定义配色被归一化保留', !!cfg.customPalette, JSON.stringify(cfg.customPalette));
  ok('effectivePalette 优先用自定义色', effectivePalette(cfg).id === 'custom', effectivePalette(cfg).id);
  ok('没有自定义色时用预设', effectivePalette(normalizeCharacter({ paletteId: 'mint' })).id === 'mint');

  const plan = characterPlan(cfg, { width: 256, height: 256 });
  ok('画出来的调色板就是自定义色', plan.palette.body === custom.body, `${plan.palette.body} vs ${custom.body}`);
  const planDefault = characterPlan(normalizeCharacter({ paletteId: 'sky' }), { width: 256, height: 256 });
  ok('与默认配色确实不同（真的生效了）', plan.palette.body !== planDefault.palette.body,
    `${plan.palette.body} vs ${planDefault.palette.body}`);
}
