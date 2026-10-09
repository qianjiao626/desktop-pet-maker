// 重做 6 只「小怪物」：圆润萌系（与萌系动物 / 小蓝机器人同一审美），纯程序化绘制
// 替换原来 Kenney 拼装的几何色块风格
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/shared/png.js";
import { zipCreate } from "../src/shared/zip.js";
import { normalizePack } from "../src/shared/petpack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "examples");
const SIZE = 256;
const PREVIEW = path.resolve(__dirname, "_preview");
fs.mkdirSync(PREVIEW, { recursive: true });

const sh = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function makeCanvas() { return { px: new Uint8ClampedArray(SIZE * SIZE * 4) }; }

function put(cv, x, y, col, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const na = a / 255, oa = cv.px[i + 3] / 255;
  const A = na + oa * (1 - na);
  if (A <= 0) return;
  cv.px[i]     = Math.round((col[0] * na + cv.px[i]     * oa * (1 - na)) / A);
  cv.px[i + 1] = Math.round((col[1] * na + cv.px[i + 1] * oa * (1 - na)) / A);
  cv.px[i + 2] = Math.round((col[2] * na + cv.px[i + 2] * oa * (1 - na)) / A);
  cv.px[i + 3] = Math.round(A * 255);
}

function ellipse(cv, ox, oy, rx, ry, col, alpha = 255) {
  if (rx <= 0 || ry <= 0) return;
  for (let y = Math.max(0, Math.floor(oy - ry - 1)); y <= Math.min(SIZE - 1, Math.ceil(oy + ry + 1)); y++)
    for (let x = Math.max(0, Math.floor(ox - rx - 1)); x <= Math.min(SIZE - 1, Math.ceil(ox + rx + 1)); x++) {
      const d = Math.hypot((x - ox) / rx, (y - oy) / ry);
      if (d > 1) { const k = Math.min(1, (d - 1) * Math.min(rx, ry)); if (k >= 1) continue; put(cv, x, y, col, alpha * (1 - k)); }
      else put(cv, x, y, col, alpha);
    }
}

/** 圆润三角形（耳朵/角），带抗锯齿 */
function tri(cv, p1, p2, p3, col, alpha = 255) {
  const minX = Math.floor(Math.min(p1[0], p2[0], p3[0]) - 2), maxX = Math.ceil(Math.max(p1[0], p2[0], p3[0]) + 2);
  const minY = Math.floor(Math.min(p1[1], p2[1], p3[1]) - 2), maxY = Math.ceil(Math.max(p1[1], p2[1], p3[1]) + 2);
  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const pt = [x, y];
    const d1 = sign(pt, p1, p2), d2 = sign(pt, p2, p3), d3 = sign(pt, p3, p1);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (neg && pos) continue;
    put(cv, x, y, col, alpha);
  }
}

/**
 * 画一只圆润小怪物
 * spec: { body, belly, accent, ears: 'horn'|'antenna'|'round'|'fin', tail }
 */
function drawMonster(spec, o = {}) {
  const { squash = 1, bob = 0, arm = 0, blink = false, wobble = 0 } = o;
  const cv = makeCanvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 6 + bob;
  const rx = SIZE * 0.325;
  const ry = SIZE * 0.335 * squash;
  const dark = sh(spec.body, 0.84);

  // 尾巴 / 背鳍（画在最底层）
  if (spec.tail === 'fin') {
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      ellipse(cv, cx + rx * (0.62 + k * 0.42) + wobble * k * 3, cy - ry * (0.10 + k * 0.34),
        rx * (0.10 - k * 0.045), ry * (0.16 - k * 0.075), sh(spec.accent, 0.96));
    }
  }
  if (spec.tail === 'zap') {
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      ellipse(cv, cx + rx * (0.70 + k * 0.55) + wobble * k * 4, cy + ry * (0.12 - k * 0.30),
        rx * (0.085 - k * 0.04), ry * (0.085 - k * 0.04), spec.accent);
    }
  }

  // 耳朵 / 角 / 天线（在身体之后但贴着顶部）
  if (spec.ears === 'horn') {
    for (const s of [-1, 1]) {
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        ellipse(cv, cx + s * rx * (0.34 + k * 0.06), cy - ry * (0.86 + k * 0.38),
          rx * (0.135 - k * 0.075), ry * (0.135 - k * 0.070), spec.accent);
      }
    }
  } else if (spec.ears === 'antenna') {
    for (const s of [-1, 1]) {
      for (let i = 0; i <= 12; i++) {
        const k = i / 12;
        ellipse(cv, cx + s * rx * (0.34 + k * 0.20) + wobble * k * 3, cy - ry * (0.84 + k * 0.62),
          rx * (0.055 - k * 0.022), ry * (0.055 - k * 0.022), sh(spec.body, 0.92));
      }
      ellipse(cv, cx + s * rx * 0.54 + wobble * 3, cy - ry * 1.46, rx * 0.115, ry * 0.115, spec.accent);
    }
  } else if (spec.ears === 'fin') {
    for (const s of [-1, 1]) {
      tri(cv, [cx + s * rx * 0.30, cy - ry * 0.78], [cx + s * rx * 0.82, cy - ry * 1.16], [cx + s * rx * 0.92, cy - ry * 0.62], sh(spec.body, 0.90));
      tri(cv, [cx + s * rx * 0.40, cy - ry * 0.80], [cx + s * rx * 0.74, cy - ry * 1.04], [cx + s * rx * 0.80, cy - ry * 0.66], spec.accent);
    }
  } else {
    for (const s of [-1, 1]) {
      ellipse(cv, cx + s * rx * 0.62, cy - ry * 0.86, rx * 0.19, ry * 0.25, sh(spec.body, 0.92));
      ellipse(cv, cx + s * rx * 0.62, cy - ry * 0.86, rx * 0.11, ry * 0.15, sh(spec.accent, 1.0));
    }
  }

  // 手脚（先画，压在身体下）
  ellipse(cv, cx - rx * 0.96, cy + ry * 0.24 + arm * 8, rx * 0.175, ry * 0.20, dark);
  ellipse(cv, cx + rx * 0.96, cy + ry * 0.24 - arm * 8, rx * 0.175, ry * 0.20, dark);
  ellipse(cv, cx - rx * 0.42, cy + ry * 0.92, rx * 0.25, ry * 0.155, dark);
  ellipse(cv, cx + rx * 0.42, cy + ry * 0.92, rx * 0.25, ry * 0.155, dark);

  // 身体：外圈 + 主色 + 顶部高光
  ellipse(cv, cx, cy, rx * 1.045, ry * 1.045, dark);
  ellipse(cv, cx, cy, rx, ry, spec.body);
  ellipse(cv, cx - rx * 0.20, cy - ry * 0.34, rx * 0.60, ry * 0.50, sh(spec.body, 1.10), 120);
  // 肚皮
  ellipse(cv, cx, cy + ry * 0.30, rx * 0.54, ry * 0.42, spec.belly, 235);

  // 眼睛（大眼 + 双高光）
  const eyeX = rx * 0.33, eyeY = cy - ry * 0.16;
  if (blink) {
    for (const s of [-1, 1]) {
      for (let x = -1; x <= 1; x++) ellipse(cv, cx + s * eyeX + x * 2, eyeY, rx * 0.10, ry * 0.026, [42, 38, 52]);
    }
  } else {
    for (const s of [-1, 1]) {
      ellipse(cv, cx + s * eyeX, eyeY, rx * 0.093, ry * 0.108, [34, 32, 44]);
      ellipse(cv, cx + s * eyeX - rx * 0.030, eyeY - ry * 0.042, rx * 0.034, ry * 0.040, [255, 255, 255]);
      ellipse(cv, cx + s * eyeX + rx * 0.028, eyeY + ry * 0.040, rx * 0.016, ry * 0.019, [255, 255, 255], 175);
    }
  }

  // 腮红（用 accent 的柔化版）
  ellipse(cv, cx - rx * 0.58, cy + ry * 0.10, rx * 0.13, ry * 0.075, spec.accent, 165);
  ellipse(cv, cx + rx * 0.58, cy + ry * 0.10, rx * 0.13, ry * 0.075, spec.accent, 165);

  // 嘴（小 w 形）
  for (let x = -1; x <= 1; x++) {
    ellipse(cv, cx - rx * 0.075 + x, cy + ry * 0.15, rx * 0.036, ry * 0.030, [110, 68, 78], 205);
    ellipse(cv, cx + rx * 0.075 + x, cy + ry * 0.15, rx * 0.036, ry * 0.030, [110, 68, 78], 205);
  }
  return cv.px;
}

function toPNG(px) { return encodePNG(SIZE, SIZE, Buffer.from(px.buffer, px.byteOffset, px.length)); }

const FRAMES = [
  { o: {}, dur: 190 },
  { o: { squash: 1.045, bob: -3, arm: 0.5, wobble: 0.5 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, arm: 0.1, wobble: 0.15 }, dur: 190 },
  { o: { squash: 1.06, bob: -4, arm: -0.5, wobble: -0.5 }, dur: 190 },
  { o: { squash: 1.03, bob: -2, wobble: -0.2 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, blink: true, wobble: 0.1 }, dur: 300 },
];

// 6 只小怪物（配色明显区分，风格统一）
const MONS = [
  { name: '小绿怪', body: [116, 206, 132], belly: [206, 242, 200], accent: [255, 168, 176], ears: 'fin',   tail: 'fin' },
  { name: '小蓝怪', body: [118, 172, 240], belly: [208, 230, 255], accent: [255, 170, 180], ears: 'antenna', tail: 'zap' },
  { name: '小红怪', body: [245, 128, 138], belly: [255, 214, 214], accent: [255, 210, 130], ears: 'horn',  tail: 'zap' },
  { name: '小黄怪', body: [250, 205, 95],  belly: [255, 240, 190], accent: [255, 158, 150], ears: 'horn',  tail: 'fin' },
  { name: '小紫怪', body: [172, 142, 236], belly: [226, 214, 255], accent: [255, 176, 190], ears: 'antenna', tail: 'fin' },
  { name: '小白怪', body: [242, 240, 250], belly: [255, 255, 255], accent: [255, 168, 178], ears: 'round', tail: 'fin' },
];

const LINES = {
  '小绿怪': ['嗷呜～我是小绿怪！', '要不要一起玩？', '我今天也很乖'],
  '小蓝怪': ['噼里啪啦～', '我的天线会发光！', '抱抱我嘛'],
  '小红怪': ['哼！我不凶的', '不要怕我呀', '我超软的'],
  '小黄怪': ['嘿嘿嘿～', '我最喜欢晒太阳', '摸摸我的角'],
  '小紫怪': ['咕噜咕噜～', '我是紫紫小怪', '来陪我嘛'],
  '小白怪': ['白白软软的～', '我是小白怪', '一起睡觉吧'],
};

const made = [];
for (const spec of MONS) {
  const files = FRAMES.map((f, i) => ({ name: 'frame_' + String(i).padStart(3, '0') + '.png', data: toPNG(drawMonster(spec, f.o)) }));
  const pack = normalizePack({
    id: 'monster-' + spec.name,
    name: spec.name,
    author: '桌宠制作器',
    frames: files.map((f, i) => ({ file: f.name, durationMs: FRAMES[i].dur })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.3 },
    animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
    bubble: { enabled: true, lines: LINES[spec.name] },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });
  const file = path.join(OUT, spec.name + '.petpack');
  fs.writeFileSync(file, zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...files]));
  made.push(file);
  fs.writeFileSync(path.join(PREVIEW, spec.name + '.png'), toPNG(drawMonster(spec, FRAMES[3].o)));
}
console.log('已重做: ' + made.map(f => path.basename(f)).join(', '));
