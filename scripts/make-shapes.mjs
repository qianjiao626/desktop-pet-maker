// 重做 5 只「形状小朋友」：圆润萌系（与萌系动物 / 小怪物 / 小蓝机器人同一审美）
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

function shape(cv, kind, cx, cy, rx, ry, col, alpha = 255) {
  for (let y = Math.max(0, Math.floor(cy - ry - 1)); y <= Math.min(SIZE - 1, Math.ceil(cy + ry + 1)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx - 1)); x <= Math.min(SIZE - 1, Math.ceil(cx + rx + 1)); x++) {
      let d;
      const ux = (x - cx) / rx, uy = (y - cy) / ry;
      if (kind === 'circle') d = Math.hypot(ux, uy);
      else if (kind === 'square') d = Math.max(Math.abs(ux), Math.abs(uy));
      else if (kind === 'squircle') d = Math.pow(Math.abs(ux) ** 4 + Math.abs(uy) ** 4, 1 / 4);
      else d = Math.abs(ux) + Math.abs(uy); // rhombus
      if (d > 1) { const k = Math.min(1, (d - 1) * Math.min(rx, ry)); if (k >= 1) continue; put(cv, x, y, col, alpha * (1 - k)); }
      else put(cv, x, y, col, alpha);
    }
}

function drawShape(spec, o = {}) {
  const { squash = 1, bob = 0, arm = 0, blink = false, wobble = 0 } = o;
  const cv = makeCanvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 6 + bob;
  const rx = SIZE * 0.305;
  const ry = SIZE * 0.315 * squash;
  const dark = sh(spec.body, 0.84);
  const kind = spec.kind;

  // 小手小脚
  for (const s of [-1, 1]) {
    shape(cv, 'circle', cx + s * (rx * 1.02), cy + ry * 0.22 + s * arm * 7 * -1, rx * 0.175, ry * 0.19, dark);
  }
  shape(cv, 'circle', cx - rx * 0.40, cy + ry * 0.90, rx * 0.24, ry * 0.15, dark);
  shape(cv, 'circle', cx + rx * 0.40, cy + ry * 0.90, rx * 0.24, ry * 0.15, dark);

  // 头顶装饰（小揪揪 / 叶子 / 星星）
  if (spec.topper === 'sprout') {
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      shape(cv, 'circle', cx + wobble * k * 3, cy - ry * (0.92 + k * 0.30), rx * (0.05 - k * 0.02), ry * (0.05 - k * 0.02), sh(spec.body, 0.92));
    }
    shape(cv, 'circle', cx - rx * 0.10, cy - ry * 1.30, rx * 0.14, ry * 0.13, spec.accent);
    shape(cv, 'circle', cx + rx * 0.12, cy - ry * 1.32, rx * 0.14, ry * 0.13, sh(spec.accent, 0.94));
  } else if (spec.topper === 'star') {
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      put(cv, Math.round(cx + Math.sin(k * Math.PI) * 0), Math.round(cy - ry * (1.0 + k * 0.45)), spec.accent, 255);
    }
    shape(cv, 'circle', cx, cy - ry * 1.30, rx * 0.15, ry * 0.15, spec.accent);
  }

  // 主体
  shape(cv, kind, cx, cy, rx * 1.045, ry * 1.045, dark);
  shape(cv, kind, cx, cy, rx, ry, spec.body);
  shape(cv, 'circle', cx - rx * 0.20, cy - ry * 0.34, rx * 0.56, ry * 0.46, sh(spec.body, 1.12), 110);

  // 眼睛
  const eyeX = rx * 0.31, eyeY = cy - ry * 0.14;
  if (blink) {
    for (const s of [-1, 1]) for (let x = -1; x <= 1; x++) shape(cv, 'circle', cx + s * eyeX + x * 2, eyeY, rx * 0.10, ry * 0.026, [42, 38, 52]);
  } else {
    for (const s of [-1, 1]) {
      shape(cv, 'circle', cx + s * eyeX, eyeY, rx * 0.092, ry * 0.107, [34, 32, 44]);
      shape(cv, 'circle', cx + s * eyeX - rx * 0.030, eyeY - ry * 0.042, rx * 0.034, ry * 0.040, [255, 255, 255]);
      shape(cv, 'circle', cx + s * eyeX + rx * 0.028, eyeY + ry * 0.040, rx * 0.016, ry * 0.019, [255, 255, 255], 175);
    }
  }

  // 腮红 + 嘴
  shape(cv, 'circle', cx - rx * 0.58, cy + ry * 0.12, rx * 0.13, ry * 0.075, spec.accent, 165);
  shape(cv, 'circle', cx + rx * 0.58, cy + ry * 0.12, rx * 0.13, ry * 0.075, spec.accent, 165);
  for (let x = -1; x <= 1; x++) {
    shape(cv, 'circle', cx - rx * 0.075 + x, cy + ry * 0.16, rx * 0.036, ry * 0.030, [110, 68, 78], 205);
    shape(cv, 'circle', cx + rx * 0.075 + x, cy + ry * 0.16, rx * 0.036, ry * 0.030, [110, 68, 78], 205);
  }
  return cv.px;
}

const toPNG = (px) => encodePNG(SIZE, SIZE, Buffer.from(px.buffer, px.byteOffset, px.length));

const FRAMES = [
  { o: {}, dur: 190 },
  { o: { squash: 1.045, bob: -3, arm: 0.5, wobble: 0.5 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, arm: 0.1, wobble: 0.15 }, dur: 190 },
  { o: { squash: 1.06, bob: -4, arm: -0.5, wobble: -0.5 }, dur: 190 },
  { o: { squash: 1.03, bob: -2, wobble: -0.2 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, blink: true, wobble: 0.1 }, dur: 300 },
];

const SHAPES = [
  { name: '小圆橙', kind: 'circle',   body: [250, 176, 96],  accent: [255, 150, 130], topper: 'sprout' },
  { name: '小方绿', kind: 'squircle', body: [132, 206, 130], accent: [255, 172, 160], topper: 'sprout' },
  { name: '小菱红', kind: 'rhombus',  body: [240, 122, 132], accent: [255, 214, 138], topper: 'star' },
  { name: '小方正', kind: 'square',   body: [124, 176, 242], accent: [255, 168, 178], topper: 'star' },
  { name: '小圆紫', kind: 'circle',   body: [176, 148, 238], accent: [255, 172, 188], topper: 'sprout' },
];

const LINES = {
  '小圆橙': ['圆滚滚～', '我是小圆橙！', '抱一下好不好'],
  '小方绿': ['我是小方绿～', '方方的也很可爱吧', '一起玩嘛'],
  '小菱红': ['菱形也很可爱的！', '我是小菱红～', '看我转圈圈'],
  '小方正': ['方方正正最可靠！', '我是小方正', '来搭积木吧'],
  '小圆紫': ['紫色的我～', '我是小圆紫', '今天想被摸摸'],
};

const made = [];
for (const spec of SHAPES) {
  const files = FRAMES.map((f, i) => ({ name: 'frame_' + String(i).padStart(3, '0') + '.png', data: toPNG(drawShape(spec, f.o)) }));
  const pack = normalizePack({
    id: 'shape-' + spec.name,
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
  made.push(path.basename(file));
  fs.writeFileSync(path.join(PREVIEW, spec.name + '.png'), toPNG(drawShape(spec, FRAMES[3].o)));
}
console.log('已重做: ' + made.join(', '));
