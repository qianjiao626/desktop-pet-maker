// 大头照 -> Q 版身体帧序列（浏览器端合成，用 canvas 绘制）
// 依赖 src/shared/qbody.js 给出的几何与姿态，只负责画。
import { bodyMetrics, limbSequence, dominantColor, outlineOf, lowerBodyRatio } from '../shared/qbody.js';

/**
 * 把一张「已抠好背景的大头照」合成为带四肢的 Q 版帧序列
 * @param srcCanvas  含头像的 canvas（背景须已透明）
 * @param opts.mode   'walk' | 'crawl'
 * @param opts.frames 帧数
 * @returns { frames: [{canvas, durationMs}], width, height }
 */
export function composeQBody(srcCanvas, opts = {}) {
  const mode = opts.mode === 'crawl' ? 'crawl' : 'walk';
  const frames = Math.max(4, Math.min(24, Math.round(opts.frames || 12)));
  const ctx0 = srcCanvas.getContext('2d', { willReadFrequently: true });
  const w = srcCanvas.width, h = srcCanvas.height;

  // 取头像主色给四肢配色（避免手脚与头完全不搭）
  let color = [248, 205, 170];
  let lowRatio = 0;
  try {
    const px = ctx0.getImageData(0, 0, w, h);
    color = dominantColor(px.data, w, h);
    // 若底部已有大量不透明像素，说明素材自带身体/腿 -> 四肢要短，避免重叠
    lowRatio = lowerBodyRatio(px.data, w, h);
  } catch { /* 取色/检测失败用默认值 */ }
  const line = outlineOf(color);
  const lineStr = 'rgb(' + line.join(',') + ')';
  const colorStr = 'rgb(' + color.join(',') + ')';

  // crawl mode shrinks the head; otherwise hands can only poke out from inside it
  // lowRatio 高 = 素材已含身体 -> 缩短四肢、收紧位置
  const limbScale = lowRatio > 0.18 ? 0.55 : 1;
  const m = bodyMetrics({ width: w, height: h });
  m.legH *= limbScale;
  m.armH *= limbScale;
  m.handR *= limbScale > 0.8 ? 1 : 0.85;
  const hw = m.headW, hh = m.headH;   // scaled head size
  // 画布宽度必须容纳「最外侧手掌」：头半宽 + 手半径 + 余量。
  // 否则手掌会被画布裁掉，位置看起来全乱（爬动模式踩过这个坑）。
  const needW = Math.ceil((m.headW / 2) + m.handR * 2 + 16) * 2;
  const CW = Math.max(m.canvasW, needW), CH = m.canvasH;
  const poses = limbSequence({ mode, frames });

  // head position: horizontally centered, leave room for legs below (use scaled size)
  // headY 必须用「已按 limbScale 缩放后的 m.legH」计算，
  // 否则头的位置与腿的实际位置不一致，手和脚会挤在一起（爬动踩的坑）。
  const legSpace = m.legH;
  const headY = Math.round(CH - legSpace * 1.6 - hh);
  const out = [];
  for (const pose of poses) {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    const bob = pose.bobY * h;
    const cx = CW / 2;
    const hipY = headY + hh + bob;         // hip (leg origin)
    const shoulderY = headY + hh * 0.62 + bob;  // shoulder (arm origin)

    // ---- 腿：两条短腿，按姿态前后摆 ----
    for (const [side, swing] of [[-1, pose.legL], [1, pose.legR]]) {
      // 爬动：腿略靠内（四足动物的后腿更靠中线），走路：正常间距
      const lx = cx + side * (mode === 'crawl' ? m.gap * 0.82 : m.gap);
      const tipX = lx + swing * m.legW * 0.55;
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = m.legW * 1.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lx, hipY - m.legH * 0.35);
      ctx.lineTo(tipX, hipY + m.legH * 0.55);
      ctx.stroke();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.legW * 0.14);
      ctx.stroke();
      // 小脚掌（同样：先 beginPath 再画，避免把腿的描边叠加进来）
      ctx.beginPath();
      ctx.ellipse(tipX + side * m.legW * 0.18, hipY + m.legH * 0.58,
        m.legW * (mode === 'crawl' ? 0.50 : 0.62), m.legW * (mode === 'crawl' ? 0.33 : 0.40), 0, 0, Math.PI * 2);
      ctx.fillStyle = colorStr;
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.legW * 0.13);
      ctx.stroke();
    }

    // ---- 头（先画，作为身体的"大头"）----
    ctx.save();
    ctx.translate(cx, headY + hh / 2 + bob);
    if (pose.lean) ctx.rotate((pose.lean * Math.PI) / 180);
    ctx.scale(1 / Math.sqrt(pose.squash), pose.squash);   // 体积感
    ctx.drawImage(srcCanvas, -hw / 2, -hh / 2, hw, hh);
    ctx.restore();

    // ---- 手：最后画（否则会被头盖住，实测生成图里看不到手）----
    // 位置贴着头的两侧外缘，略低于中轴，像 Q 版小人举着两只圆手。
    for (const [side, swing] of [[-1, pose.armL], [1, pose.armR]]) {
      const rx = m.handR;
      const ry = m.handR * 0.92;
      // 走路：手在头两侧自然张开（像小人摆手）
      // 爬动：手略高、更靠外，像撑在身体两侧 —— 不能太低，否则会和腿的圆脚掌叠在一起
      // Arm origin must sit OUTSIDE the head edge. Using the scaled head width (hw)
      // means a smaller head in crawl mode naturally pushes hands outward.
      // 手掌只露在头外侧一点点：偏移 = 头半宽 + 手掌半径*0.55（再多就会像"第二个圆"）
      const spread = 1.0;
      // 手要明显高于脚：实测 drop=0.58 时手与脚只差 8px，视觉上糊成一片。
      const drop = mode === 'crawl' ? 0.44 : 0.58;
      const ax = cx + side * (hw / 2 * spread + rx * 0.55);
      const ay = headY + hh * drop + bob + swing * m.armH * (mode === 'crawl' ? 0.06 : 0.34);
      // 手与身体之间的一小段手臂
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = Math.max(2, m.handR * 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + side * (hw / 2 * 0.80), ay - swing * m.armH * 0.06);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      // 圆手掌（注意：必须重新 beginPath，否则描边路径会带上刚才那条手臂线，
      // 把手臂重复描一遍 —— 视觉上像多了个圆，实测爬动模式最明显）
      ctx.beginPath();
      ctx.ellipse(ax, ay, rx, ry, side * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = colorStr;
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.handR * 0.16);
      ctx.stroke();
    }

    out.push({ canvas: cv, durationMs: 110 });
  }

  return { frames: out, width: CW, height: CH };
}
