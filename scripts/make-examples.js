// 生成示例宠物包（多帧动画，无外部依赖）
// 全部为原创卡通形象：圆滚身材 + 大眼睛 + 腮红 + 呼吸/眨眼/摆手动画。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'examples');
fs.mkdirSync(OUT, { recursive: true });

const SIZE = 256;

function makeCanvas() { return { px: new Uint8ClampedArray(SIZE * SIZE * 4) }; }

function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const na = a / 255, oa = cv.px[i + 3] / 255;
  const A = na + oa * (1 - na);
  if (A <= 0) return;
  cv.px[i] = Math.round((r * na + cv.px[i] * oa * (1 - na)) / A);
  cv.px[i + 1] = Math.round((g * na + cv.px[i + 1] * oa * (1 - na)) / A);
  cv.px[i + 2] = Math.round((b * na + cv.px[i + 2] * oa * (1 - na)) / A);
  cv.px[i + 3] = Math.round(A * 255);
}

function ellipse(cv, ox, oy, rx, ry, col, alpha = 255) {
  for (let y = Math.floor(oy - ry - 2); y <= oy + ry + 2; y++) {
    for (let x = Math.floor(ox - rx - 2); x <= ox + rx + 2; x++) {
      const d = Math.sqrt(((x - ox) / rx) ** 2 + ((y - oy) / ry) ** 2);
      if (d > 1.02) continue;
      const aa = d > 1 ? (1.02 - d) / 0.02 : 1;
      blend(cv, x, y, col[0], col[1], col[2], alpha * aa);
    }
  }
}

/** 圆角三角：用于耳朵 / 犄角 / 龙鳍 */
function triangle(cv, p1, p2, p3, col, alpha = 255) {
  const minX = Math.floor(Math.min(p1[0], p2[0], p3[0]) - 2);
  const maxX = Math.ceil(Math.max(p1[0], p2[0], p3[0]) + 2);
  const minY = Math.floor(Math.min(p1[1], p2[1], p3[1]) - 2);
  const maxY = Math.ceil(Math.max(p1[1], p2[1], p3[1]) + 2);
  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const pt = [x, y];
    const d1 = sign(pt, p1, p2), d2 = sign(pt, p2, p3), d3 = sign(pt, p3, p1);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (hasNeg && hasPos) continue;
    // 简化抗锯齿：边缘 1px 降一点透明度
    blend(cv, x, y, col[0], col[1], col[2], alpha * 0.97);
  }
}

function shade(col, k) { return [col[0] * k, col[1] * k, col[2] * k]; }

/**
 * 画一只原创 Q 版小宠
 * @param spec 角色外观定义
 * @param opts blink 眯眼 / squash 纵向挤压 / bob 上下浮动 / arm 摆手 / tail 尾巴摆动
 */
function drawChar(spec, opts = {}) {
  const { blink = false, squash = 1, bob = 0, arm = 0, tail = 0, mouthOpen = 0 } = opts;
  const cv = makeCanvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 8 + bob;
  const rx = SIZE * 0.33;
  const ry = SIZE * 0.35 * squash;
  const body = spec.body;
  const dark = shade(body, 0.88);

  // ---- 尾巴 / 背鳍（画在身体后面）----
  if (spec.tail === 'dragon') {
    // 平滑渐细的尾巴：沿弧线密集采样，半径线性收细
    const t = tail * 8;
    for (let i = 0; i <= 26; i++) {
      const k = i / 26;
      const sway = Math.sin(k * Math.PI) * ry * 0.10;
      ellipse(cv,
        cx + rx * (0.80 + k * 0.80) + t * k,
        cy + ry * (0.30 - k * 0.62) + sway + t * k * 0.45,
        rx * (0.155 - k * 0.115), ry * (0.135 - k * 0.100), shade(body, 0.92));
    }
    // 尾鳍
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      ellipse(cv, cx + rx * 1.58 + t + k * rx * 0.10, cy - ry * 0.34 + t * 0.45 - k * ry * 0.14,
        rx * (0.10 - k * 0.04), ry * (0.09 - k * 0.035), spec.accent);
    }
  }
  if (spec.backFin) {
    // 背鳍：贴在身体右上侧的圆润小鳍（原来画在头顶会与角叠成"三根尖刺"）
    for (let i = 0; i <= 9; i++) {
      const k = i / 9;
      ellipse(cv,
        cx + rx * (0.52 + k * 0.30),
        cy - ry * (0.34 - k * 0.30),
        rx * (0.115 - k * 0.045), ry * (0.135 - k * 0.055), spec.accent);
    }
  }
  if (spec.shell) {
    ellipse(cv, cx, cy - ry * 0.02, rx * 0.92, ry * 0.92, shade(body, 0.82));
    ellipse(cv, cx, cy - ry * 0.05, rx * 0.72, ry * 0.74, shade(body, 0.95));
  }

  // ---- 耳朵 / 犄角 ----
  if (spec.ears === 'cat') {
    triangle(cv, [cx - rx * 0.74, cy - ry * 0.72], [cx - rx * 0.48, cy - ry * 1.28], [cx - rx * 0.18, cy - ry * 0.86], dark);
    triangle(cv, [cx + rx * 0.74, cy - ry * 0.72], [cx + rx * 0.48, cy - ry * 1.28], [cx + rx * 0.18, cy - ry * 0.86], dark);
    triangle(cv, [cx - rx * 0.62, cy - ry * 0.82], [cx - rx * 0.49, cy - ry * 1.12], [cx - rx * 0.32, cy - ry * 0.88], spec.accent);
    triangle(cv, [cx + rx * 0.62, cy - ry * 0.82], [cx + rx * 0.49, cy - ry * 1.12], [cx + rx * 0.32, cy - ry * 0.88], spec.accent);
  } else if (spec.ears === 'horn') {
    // 圆润小角：底部一段与脑袋相连，顶端收细，像小恐龙的角
    for (const sgn of [-1, 1]) {
      const bx = cx + sgn * rx * 0.40, by = cy - ry * 0.86;
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        ellipse(cv, bx + sgn * k * rx * 0.05, by - k * ry * 0.36,
          rx * (0.165 - k * 0.090), ry * (0.150 - k * 0.070), shade(spec.accent, 0.98));
      }
    }
  } else {
    ellipse(cv, cx - rx * 0.62, cy - ry * 0.88, rx * 0.20, ry * 0.27, shade(body, 0.92));
    ellipse(cv, cx + rx * 0.62, cy - ry * 0.88, rx * 0.20, ry * 0.27, shade(body, 0.92));
  }

  // ---- 手脚 ----
  ellipse(cv, cx - rx * 0.94, cy + ry * 0.20 + arm * 9, rx * 0.17, ry * 0.21, shade(body, 0.94));
  ellipse(cv, cx + rx * 0.94, cy + ry * 0.20 - arm * 9, rx * 0.17, ry * 0.21, shade(body, 0.94));
  ellipse(cv, cx - rx * 0.44, cy + ry * 0.95, rx * 0.26, ry * 0.16, dark);
  ellipse(cv, cx + rx * 0.44, cy + ry * 0.95, rx * 0.26, ry * 0.16, dark);

  // ---- 身体 ----
  ellipse(cv, cx, cy, rx, ry, body);
  // 肚皮（浅色高光）
  ellipse(cv, cx, cy + ry * 0.30, rx * 0.54, ry * 0.44, shade(spec.belly || body, 1.12));

  // ---- 眼睛 ----
  const eyeX = rx * 0.34, eyeY = cy - ry * 0.17;
  if (blink) {
    for (const s of [-1, 1]) {
      for (let x = -1; x <= 1; x++) ellipse(cv, cx + s * eyeX + x * 2, eyeY, rx * 0.095, ry * 0.024, [45, 38, 55]);
    }
  } else {
    for (const s of [-1, 1]) {
      ellipse(cv, cx + s * eyeX, eyeY, rx * 0.088, ry * 0.102, [30, 30, 40]);
      ellipse(cv, cx + s * eyeX - rx * 0.028, eyeY - ry * 0.040, rx * 0.032, ry * 0.038, [255, 255, 255]);
      ellipse(cv, cx + s * eyeX + rx * 0.026, eyeY + ry * 0.038, rx * 0.015, ry * 0.018, [255, 255, 255], 170);
    }
  }
  // ---- 腮红 ----
  ellipse(cv, cx - rx * 0.56, cy + ry * 0.10, rx * 0.135, ry * 0.078, spec.accent, 190);
  ellipse(cv, cx + rx * 0.56, cy + ry * 0.10, rx * 0.135, ry * 0.078, spec.accent, 190);

  // ---- 嘴 ----
  if (mouthOpen > 0) {
    ellipse(cv, cx, cy + ry * 0.16 + mouthOpen * 3, rx * 0.10, ry * 0.09, [150, 66, 78]);
    ellipse(cv, cx, cy + ry * 0.20 + mouthOpen * 3, rx * 0.06, ry * 0.04, [240, 130, 140]);
  } else {
    for (let x = -1; x <= 1; x++) {
      ellipse(cv, cx - rx * 0.07 + x, cy + ry * 0.15, rx * 0.035, ry * 0.03, [120, 70, 80], 200);
      ellipse(cv, cx + rx * 0.07 + x, cy + ry * 0.15, rx * 0.035, ry * 0.03, [120, 70, 80], 200);
    }
  }
  return cv.px;
}

/** 生成 6 帧小动画：呼吸 + 眨眼 + 摆手 / 摇尾 */
function buildPack(spec) {
  const frames = [
    { o: {}, dur: 190 },
    { o: { squash: 1.045, bob: -3, arm: 0.5, tail: 0.5 }, dur: 190 },
    { o: { squash: 1.02, bob: -1, arm: 0.1, tail: 0.15 }, dur: 190 },
    { o: { squash: 1.06, bob: -4, arm: -0.5, tail: -0.5 }, dur: 190 },
    { o: { squash: 1.03, bob: -2, tail: -0.2 }, dur: 190 },
    { o: { squash: 1.02, bob: -1, blink: true, mouthOpen: 1 }, dur: 300 },
  ];
  const files = frames.map((f, i) => ({
    name: 'frame_' + String(i).padStart(3, '0') + '.png',
    data: encodePNG(SIZE, SIZE, Buffer.from(drawChar(spec, f.o))),
  }));
  const pack = normalizePack({
    id: 'example-' + spec.name,
    name: spec.name,
    author: '桌宠制作器',
    frames: files.map((f, i) => ({ file: f.name, durationMs: frames[i].dur })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.3 },
    animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
    bubble: { enabled: true, lines: spec.lines },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });
  const file = path.join(OUT, spec.name + '.petpack');
  fs.writeFileSync(file, zipCreate([
    { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
    ...files,
  ]));
  return file;
}

// ============ 角色表（全部原创） ============
const CHARS = [
  {
    name: '小黄龙', body: [255, 214, 92], belly: [255, 240, 190], accent: [255, 148, 140],
    ears: 'horn', tail: 'dragon', backFin: true,
    lines: ['嗷呜～我是小黄龙！', '一起玩好不好呀？', '摸摸我的犄角嘛～', '我会飞哦（其实还不会）'],
  },
  {
    name: '奶团子', body: [255, 246, 232], belly: [255, 255, 255], accent: [255, 170, 175],
    ears: 'round',
    lines: ['我是奶团子，软乎乎～', '想被抱起来～', '呼…呼…困了'],
  },
  {
    name: '喵喵', body: [255, 196, 132], belly: [255, 235, 205], accent: [255, 150, 160],
    ears: 'cat',
    lines: ['喵～', '要不要摸摸我？', '本喵今天也很可爱'],
  },
  {
    name: '呱呱', body: [124, 209, 128], belly: [200, 240, 195], accent: [255, 160, 170],
    ears: 'round',
    lines: ['呱！', '我来啦～', '呱呱呱～'],
  },
  {
    name: '咚咚', body: [150, 190, 240], belly: [210, 232, 255], accent: [255, 160, 170],
    ears: 'round', shell: true,
    lines: ['咚咚咚…我走得慢', '壳里最舒服了', '慢慢来也没关系'],
  },
];

const made = CHARS.map((c) => buildPack(c));
for (const f of made) console.log('已生成: ' + f);
