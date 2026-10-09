// 大头照 -> Q 版身体帧序列（浏览器端合成，用 canvas 绘制）
// 依赖 src/shared/qbody.js 给出的几何与姿态，只负责画。
import { bodyMetrics, limbSequence, dominantColor, outlineOf } from '../shared/qbody.js';

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
  try { color = dominantColor(ctx0.getImageData(0, 0, w, h).data, w, h); } catch { /* 取色失败用默认肤色 */ }
  const line = outlineOf(color);
  const lineStr = 'rgb(' + line.join(',') + ')';
  const colorStr = 'rgb(' + color.join(',') + ')';

  const m = bodyMetrics({ width: w, height: h });
  const CW = m.canvasW, CH = m.canvasH;
  const poses = limbSequence({ mode, frames });

  // 头在画布中的位置：水平居中，底部留出腿的位置
  const headX = Math.round((CW - w) / 2);
  const headY = Math.round(CH - m.legH * 1.6 - h);

  const out = [];
  for (const pose of poses) {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    const bob = pose.bobY * h;
    const cx = CW / 2;
    const hipY = headY + h + bob;          // 髋部（腿的起点）
    const shoulderY = headY + h * 0.62 + bob;  // 肩部（手的起点）

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
      // 小脚掌
      ctx.fillStyle = colorStr;
      ctx.beginPath();
      ctx.ellipse(tipX + side * m.legW * 0.18, hipY + m.legH * 0.58,
        m.legW * (mode === 'crawl' ? 0.50 : 0.62), m.legW * (mode === 'crawl' ? 0.33 : 0.40), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.legW * 0.13);
      ctx.stroke();
    }

    // ---- 头（先画，作为身体的"大头"）----
    ctx.save();
    ctx.translate(cx, headY + h / 2 + bob);
    if (pose.lean) ctx.rotate((pose.lean * Math.PI) / 180);
    ctx.scale(1 / Math.sqrt(pose.squash), pose.squash);   // 体积感
    ctx.drawImage(srcCanvas, -w / 2, -h / 2, w, h);
    ctx.restore();

    // ---- 手：最后画（否则会被头盖住，实测生成图里看不到手）----
    // 位置贴着头的两侧外缘，略低于中轴，像 Q 版小人举着两只圆手。
    for (const [side, swing] of [[-1, pose.armL], [1, pose.armR]]) {
      const rx = m.armW * 0.52;
      const ry = m.armH * 0.58;
      // 走路：手在头两侧自然张开（像小人摆手）
      // 爬动：手略高、更靠外，像撑在身体两侧 —— 不能太低，否则会和腿的圆脚掌叠在一起
      const spread = mode === 'crawl' ? 0.86 : 0.94;
      const drop = mode === 'crawl' ? 0.52 : 0.60;
      const ax = cx + side * (w / 2 * spread + rx * 0.50);
      const ay = headY + h * drop + bob + swing * m.armH * (mode === 'crawl' ? 0.30 : 0.42);
      // 手与身体之间的一小段手臂
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = m.armW * 0.42;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + side * (w / 2 * 0.78), ay - swing * m.armH * 0.10);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      // 圆手掌
      ctx.fillStyle = colorStr;
      ctx.beginPath();
      ctx.ellipse(ax, ay, rx, ry, side * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lineStr;
      ctx.lineWidth = Math.max(1, m.armW * 0.11);
      ctx.stroke();
    }

    out.push({ canvas: cv, durationMs: 110 });
  }

  return { frames: out, width: CW, height: CH };
}
