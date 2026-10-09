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
      const lx = cx + side * m.gap;
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
        m.legW * 0.62, m.legW * 0.40, 0, 0, Math.PI * 2);
      ctx.fillStyle = colorStr;
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.legW * 0.13);
      ctx.stroke();
    }

    // ---- 头（先画，作为身体的"大头"）----
    ctx.save();
    // 注意：不要用 rotate/位移做「前倾」——任何超出合成画布的绘制都会让
    // 后处理把画布撑大、主体缩小（实测 crawl 因此变成 636x487）。
    // 爬动完全靠 limbSequence 的四肢姿态区分，包围盒与走路一致。
    ctx.translate(cx, headY + hh / 2 + bob);
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
      const drop = 0.66;
      // 手掌往内收一点，与头部边缘重叠：确保手-臂-头是同一个连通块，
      // 否则会被「只保留最大主体」当成杂散块删掉（实测会丢一只手）。
      // 手掌中心：内侧缘压在头轮廓内（保证连通）、外侧缘露在头外（看得见）
      const ax = cx + side * (hw / 2 * spread + rx * 0.34);
      const ay = headY + hh * drop + bob + swing * m.armH * 0.34;
      // 手臂：从头内部连到手掌的实心形状（不用超粗圆头线，否则会撑大画布）。
      // 起点在头内部，保证手-臂-头是连通区域。
      const ax0 = cx + side * (hw / 2 * 0.50);
      const ay0 = ay - swing * m.armH * 0.06;
      const armW = Math.max(4, m.handR * 0.52);
      ctx.beginPath();
      ctx.moveTo(ax0, ay0 - armW / 2);
      ctx.lineTo(ax, ay - armW / 2);
      ctx.lineTo(ax, ay + armW / 2);
      ctx.lineTo(ax0, ay0 + armW / 2);
      ctx.closePath();
      ctx.fillStyle = colorStr;
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.handR * 0.14);
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
