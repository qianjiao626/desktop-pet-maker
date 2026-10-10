import { ok } from './_harness.mjs';
import { groundOffset, commonGroundOffset, neededBottomRoom } from '../src/shared/groundcontact.js';
import { computeLayout, computeFramePlacement, MARGIN, OVER } from '../src/shared/layout.js';

// ---------- groundOffset ----------
ok('无留白不下移', groundOffset({ y0: 0, y1: 1 }, 200).dy === 0);
ok('底部 30% 留白 -> 下移 60px', Math.abs(groundOffset({ y0: 0, y1: 0.7 }, 200).dy - 60) < 1e-6, String(groundOffset({ y0: 0, y1: 0.7 }, 200).dy));
ok('下移量线性于绘制高度', Math.abs(groundOffset({ y1: 0.5 }, 300).dy - 150) < 1e-6);
ok('下移量带可读原因', groundOffset({ y1: 0.8 }, 200).reason.includes('透明留白'), groundOffset({ y1: 0.8 }, 200).reason);
ok('恰好贴边不下移', groundOffset({ y1: 1 }, 200).dy === 0);
ok('y1 为 0（全透明）-> 下移满高', Math.abs(groundOffset({ y1: 0 }, 200).dy - 200) < 1e-6);
ok('y1 越界不产生负位移', groundOffset({ y1: 1.5 }, 200).dy === 0);
ok('y0 缺失也安全（只依赖 y1）', groundOffset({ y1: 0.5 }, 100).dy === 50);
ok('content 为 null 安全', groundOffset(null, 200).dy === 0);
ok('content 为空对象：y1 兜底为 1 不下移', groundOffset({}, 200).dy === 0);
ok('drawH 为 0 安全', groundOffset({ y1: 0.5 }, 0).dy === 0);
ok('drawH 为负安全', groundOffset({ y1: 0.5 }, -10).dy === 0);
ok('y1 为 NaN 时兜底不下移', groundOffset({ y1: NaN }, 200).dy === 0);
ok('y1 为字符串时兜底不下移', groundOffset({ y1: 'x' }, 200).dy === 0);

// ---------- commonGroundOffset（多帧必须取公共值）----------
{
  const r = commonGroundOffset([{ content: { y1: 1 } }, { content: { y1: 0.5 } }], [100, 100]);
  ok('多帧取公共值（=最大）', Math.abs(r.dy - 50) < 1e-6, String(r.dy));
  ok('公共值等于各帧最大值', Math.abs(r.dy - Math.max(...r.perFrame)) < 1e-9);
  ok('给出逐帧明细', r.perFrame.length === 2 && r.perFrame[0] === 0);
  ok('原因里点出是公共值（防抽搐）', r.reason.includes('公共'), r.reason);
}
{
  const r = commonGroundOffset([{ content: { y1: 1 } }, { content: { y1: 1 } }], [100, 100]);
  ok('全贴边时不下移且说明清楚', r.dy === 0 && r.reason.includes('贴边'), r.reason);
}
ok('单帧可用', Math.abs(commonGroundOffset([{ content: { y1: 0.75 } }], [200]).dy - 50) < 1e-6);
ok('空数组安全', commonGroundOffset([], []).dy === 0 && commonGroundOffset(null, null).dy === 0);
ok('帧数不匹配也安全（高度缺失按 0 算）', commonGroundOffset([{ content: { y1: 0.5 } }], []).dy === 0);
ok('含坏帧时不崩', commonGroundOffset([null, { content: { y1: 0.5 } }], [100, 100]).dy === 50);

// ---------- neededBottomRoom ----------
ok('下移量小于已有边距 -> 够用', neededBottomRoom(10, 24).ok === true);
ok('下移量大于已有边距 -> 需要补空间', neededBottomRoom(40, 12).extra === 28 && neededBottomRoom(40, 12).ok === false);
ok('边界：刚好相等算够', neededBottomRoom(24, 24).extra === 0 && neededBottomRoom(24, 24).ok === true);
ok('margin 缺失按 0 算', neededBottomRoom(10, undefined).extra === 10);

// ---------- layout 的 bottomReserve（这是本轮修复的核心）----------
{
  const sizes = [{ w: 120, h: 200 }];
  const base = computeLayout({ render: { scale: 0.5 }, bubble: { enabled: false } }, sizes);
  const res = computeLayout({ render: { scale: 0.5 }, bubble: { enabled: false } }, sizes, { bottomReserve: 40 });
  ok('bottomReserve 把画布加高对应像素', res.canvasCssH === base.canvasCssH + 40, `${base.canvasCssH} -> ${res.canvasCssH}`);
  ok('bottomReserve 不影响宽度', res.canvasCssW === base.canvasCssW);
  ok('bottomReserve 不影响 topPad', res.topPad === base.topPad);
  ok('返回值里带回 bottomReserve（便于调试）', res.bottomReserve === 40);
  ok('负的 bottomReserve 被夹为 0', computeLayout({ render: { scale: 0.5 } }, sizes, { bottomReserve: -50 }).canvasCssH === base.canvasCssH);
  ok('缺省 bottomReserve 为 0（向后兼容）', computeLayout({ render: { scale: 0.5 } }, sizes).canvasCssH === base.canvasCssH);

  // 关键不变量：加了 reserve 之后，绘制**基线**不能跟着下移，
  // 否则会和 groundDy 叠加成双倍位移，把精灵顶部推出画布（踩过的坑）。
  const p0 = computeFramePlacement(sizes, 0.5, base.canvasCssW, base.canvasCssH, 0);
  const p1 = computeFramePlacement(sizes, 0.5, res.canvasCssW, res.canvasCssH, 40);
  ok('加了 reserve 后绘制底边位置不变（否则会双倍位移）',
    Math.abs((p0.pos[0].y + p0.draw[0].h) - (p1.pos[0].y + p1.draw[0].h)) < 1e-9,
    `${p0.pos[0].y + p0.draw[0].h} vs ${p1.pos[0].y + p1.draw[0].h}`);
  ok('reserve 与 groundDy 叠加后正好落在画布内',
    (p1.pos[0].y + p1.draw[0].h + 40) <= res.canvasCssH,
    `内容底 ${p1.pos[0].y + p1.draw[0].h + 40} <= 画布 ${res.canvasCssH}`);
  ok('drawH 不受 reserve 影响', Math.abs(p0.draw[0].h - p1.draw[0].h) < 1e-9);
}
// ---------- 关键不变量：reserve 应该恰好等于 groundDy ----------
// 推导：基线 = 原画布高 - MARGIN/2 - drawH，内容底边 = 基线 + groundDy，
// 画布高 = 原画布高 + reserve。要让内容底边距画布底恰为 MARGIN/2，
// 解得 reserve = groundDy。写成测试防止以后又"凭感觉"改成 dy - MARGIN/2
// （那会让内容贴到画布最边缘，实测被 e2e 抓出来过）。
{
  const sizes = [{ w: 120, h: 200 }];
  const scale = 0.5;
  const base = computeLayout({ render: { scale }, bubble: { enabled: false } }, sizes);
  const p0 = computeFramePlacement(sizes, scale, base.canvasCssW, base.canvasCssH, 0);
  const drawH = p0.draw[0].h;
  const dy = 40;                                  // 底部 40% 留白 × drawH=100
  const R = dy;
  const L = computeLayout({ render: { scale }, bubble: { enabled: false } }, sizes, { bottomReserve: R });
  const p = computeFramePlacement(sizes, scale, L.canvasCssW, L.canvasCssH, R);
  const contentBottom = p.pos[0].y + drawH + dy;
  const gap = (L.canvasCssH - 1) - contentBottom;
  ok('预留量 = 下移量时，内容底边距画布底恰好约为 MARGIN/2',
    Math.abs(gap - MARGIN * 0.5) <= 1,
    `gap=${gap}，期望 ${MARGIN * 0.5}`);
  ok('内容底边没有超出画布（不被裁）', contentBottom <= L.canvasCssH - 1,
    `内容底 ${contentBottom} vs 画布底 ${L.canvasCssH - 1}`);
  ok('内容顶边仍在画布内', p.pos[0].y >= 0, `顶 ${p.pos[0].y}`);
  // 反例：reserve = dy - MARGIN/2 会让内容贴到最边缘（gap 变成 0 左右）
  const Rbad = dy - MARGIN * 0.5;
  const Lbad = computeLayout({ render: { scale }, bubble: { enabled: false } }, sizes, { bottomReserve: Rbad });
  const pbad = computeFramePlacement(sizes, scale, Lbad.canvasCssW, Lbad.canvasCssH, Rbad);
  const gapBad = (Lbad.canvasCssH - 1) - (pbad.pos[0].y + drawH + dy);
  ok('反例：少留 MARGIN/2 时内容会贴到画布边缘（gap 更小）',
    gapBad < gap, `错误写法 gap=${gapBad} < 正确 ${gap}`);
}

ok('computeFramePlacement 缺省 reserve 行为不变（向后兼容）', (() => {
  const sizes = [{ w: 100, h: 100 }];
  const a = computeFramePlacement(sizes, 1, 200, 200);
  const b = computeFramePlacement(sizes, 1, 200, 200, 0);
  return Math.abs(a.pos[0].y - b.pos[0].y) < 1e-9;
})());
