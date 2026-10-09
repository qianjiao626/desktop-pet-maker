import { ok } from './_harness.mjs';
import { bodyMetrics, limbPose, limbSequence, dominantColor, outlineOf, Q_MODES } from '../src/shared/qbody.js';

// ============ 身体比例 ============
{
  const m = bodyMetrics({ width: 128, height: 128 });
  ok('比例: 有头宽头高', m.headW > 0 && m.headH > 0);
  ok('比例: 腿比头短（Q 版）', m.legH < m.headH * 0.5, String(m.legH));
  ok('比例: 手足够圆润（Q 版特点）', m.armW >= m.legW * 0.9 && m.armH <= m.legH * 1.2, 'arm=' + m.armW.toFixed(1) + 'x' + m.armH.toFixed(1) + ' leg=' + m.legW.toFixed(1) + 'x' + m.legH.toFixed(1));
  ok('比例: 画布够宽（放得下双腿+间距）', m.canvasW >= m.headW + m.legW * 2);
  ok('比例: 画布够高（头+腿+浮动）', m.canvasH > m.headH + m.legH);
}
{
  const a = bodyMetrics({ width: 100, height: 100 }, { scale: 1 });
  const b = bodyMetrics({ width: 100, height: 100 }, { scale: 2 });
  ok('比例: scale 放大整体', b.canvasW > a.canvasW && b.legH > a.legH);
}
ok('比例: 非法输入不崩溃', bodyMetrics(null).headW > 0);
ok('比例: 超大 scale 被夹取', bodyMetrics({ width: 100, height: 100 }, { scale: 999 }).legH < 100 * 4);

// ============ 姿态 ============
for (const mode of Q_MODES) {
  const all = limbSequence({ mode, frames: 12 });
  ok(mode + ': 帧数正确', all.length === 12);
  ok(mode + ': 都是有限值', all.every((p) => Object.values(p).every((v) => Number.isFinite(v))));
  ok(mode + ': 有身体起伏', all.some((p) => p.bobY < -0.01), 'min=' + Math.min(...all.map((p) => p.bobY)).toFixed(3));
  ok(mode + ': 双腿交替摆动', all.some((p) => p.legL > 0.5 && p.legR < -0.5) && all.some((p) => p.legL < -0.5 && p.legR > 0.5));
  ok(mode + ': 摆动幅度受限(-1..1)', all.every((p) => Math.abs(p.legL) <= 1.0001 && Math.abs(p.legR) <= 1.0001));
  ok(mode + ': squash 为正', all.every((p) => p.squash > 0));
}
ok('爬动: 身体前倾（lean>0）', limbPose('crawl', 0.3).lean > 0);
ok('走路: 不前倾', limbPose('walk', 0.3).lean === 0);
// 爬动刻意用「对角步态 + 较小摆幅」：幅度比走路小是**有意设计**，
// 大幅摆动会让圆手掌上下位移过大、看起来像"两只手"（实测踩过）。
ok('爬动: 手脚同相（对角步态）', Math.sign(limbPose('crawl', 0.25).armL) === Math.sign(limbPose('crawl', 0.25).legR));
ok('爬动: 摆幅小于走路（避免重影）', Math.abs(limbPose('crawl', 0.25).armL) < Math.abs(limbPose('walk', 0.25).armL));

// ============ 姿态健壮性 ============
ok('姿态: 越界 t 被循环', JSON.stringify(limbPose('walk', 1.25)) === JSON.stringify(limbPose('walk', 0.25)));
ok('姿态: 负 t 被循环', JSON.stringify(limbPose('walk', -0.75)) === JSON.stringify(limbPose('walk', 0.25)));
ok('姿态: NaN 不崩溃', Number.isFinite(limbPose('walk', NaN).bobY));
ok('姿态: 未知 mode 回退走路', JSON.stringify(limbPose('bogus', 0.25)) === JSON.stringify(limbPose('walk', 0.25)));
ok('帧数被夹取(上限 48)', limbSequence({ frames: 999 }).length === 48);
ok('帧数被夹取(下限 2)', limbSequence({ frames: 0 }).length === 2);

// ============ 取色 ============
{
  // 造 8x8：左半红 右半蓝，红更多
  const w = 8, h = 8, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4;
    const red = x < 5;
    d[q] = red ? 220 : 40; d[q + 1] = red ? 40 : 60; d[q + 2] = red ? 40 : 230; d[q + 3] = 255;
  }
  const c = dominantColor(d, w, h);
  ok('取色: 取到占多数的红色', c[0] > 150 && c[1] < 100, c.join(','));
}
ok('取色: 空输入返回默认肤色', Array.isArray(dominantColor(null, 0, 0)) && dominantColor(null, 0, 0).length === 3);
ok('取色: 全透明输入返回默认', dominantColor(new Uint8ClampedArray(4 * 4 * 4), 4, 4).length === 3);

// ============ 描边色 ============
{
  const o = outlineOf([200, 100, 50]);
  ok('描边: 比主色更深', o[0] < 200 && o[1] < 100 && o[2] < 50, o.join(','));
  ok('描边: 非法输入有默认', outlineOf(null).length === 3);
}
