// 原创「小蓝机器人」v2：头部加大、面罩居中、四肢明显
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/shared/png.js";
import { zipCreate } from "../src/shared/zip.js";
import { normalizePack } from "../src/shared/petpack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW = path.resolve(__dirname, "_preview");
fs.mkdirSync(PREVIEW, { recursive: true });
const SIZE = 256;

const P = {
  dark:  [78, 98, 205],
  body:  [100, 124, 232],
  light: [124, 148, 244],
  visor: [26, 28, 52],
  rim:   [16, 18, 38],
  cyan:  [122, 228, 236],
};

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
  const y0 = Math.max(0, Math.floor(oy - ry - 1)), y1 = Math.min(SIZE - 1, Math.ceil(oy + ry + 1));
  const x0 = Math.max(0, Math.floor(ox - rx - 1)), x1 = Math.min(SIZE - 1, Math.ceil(ox + rx + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - ox) / rx, dy = (y - oy) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      const k = Math.min(1, (d - 1) * Math.min(rx, ry));
      if (k >= 1) continue;
      put(cv, x, y, col, alpha * (1 - k));
    } else put(cv, x, y, col, alpha);
  }
}

function rrect(cv, x, y, w, h, r, col, alpha = 255) {
  const x0 = Math.max(0, Math.floor(x - 1)), x1 = Math.min(SIZE - 1, Math.ceil(x + w + 1));
  const y0 = Math.max(0, Math.floor(y - 1)), y1 = Math.min(SIZE - 1, Math.ceil(y + h + 1));
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const cx = Math.min(Math.max(px, x + r), x + w - r);
    const cy2 = Math.min(Math.max(py, y + r), y + h - r);
    const d = Math.hypot(px - cx, py - cy2);
    if (d > r) continue;
    const aa = d > r - 1 ? (r - d) : 1;
    if (aa <= 0) continue;
    // 在矩形内部（非圆角区）d=0，直接实心
    const inside = px >= x + r && px <= x + w - r || py >= y + r && py <= y + h - r;
    put(cv, px, py, col, alpha * (inside ? 1 : Math.min(1, aa)));
  }
}

/** 粗线段（带圆形端点），用于画 ">" 和下划线 */
function seg(cv, x1, y1, x2, y2, th, col) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    ellipse(cv, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, th / 2, th / 2, col);
  }
}

function drawBot(o = {}) {
  const { squash = 1, bob = 0, arm = 0, blink = false, glow = 0, step = 0 } = o;
  const cv = makeCanvas();
  const cx = SIZE / 2;
  const cy = SIZE / 2 - 2 + bob;

  const headRx = SIZE * 0.255;
  const headRy = headRx * 0.94 * squash;
  const headCy = cy - SIZE * 0.145;

  const bodyRx = SIZE * 0.215;
  const bodyRy = SIZE * 0.185 * squash;
  const bodyCy = cy + SIZE * 0.185;

  // ===== 脚（先画，位于身体下方）=====
  const footY = bodyCy + bodyRy * 0.82;
  for (const s of [-1, 1]) {
    const fy = footY + (s > 0 ? step : -step) * 3;
    ellipse(cv, cx + s * bodyRx * 0.56, fy, bodyRx * 0.34, bodyRy * 0.40, P.dark);
    ellipse(cv, cx + s * bodyRx * 0.56, fy - 1, bodyRx * 0.30, bodyRy * 0.34, P.body);
  }

  // ===== 手臂（圆润短手，摆动）=====
  for (const s of [-1, 1]) {
    const ax = cx + s * (bodyRx * 0.94 + headRx * 0.16);
    const ay = bodyCy - bodyRy * 0.10 + arm * s * 5;
    ellipse(cv, ax, ay, bodyRx * 0.26, bodyRx * 0.28, P.dark);
    ellipse(cv, ax, ay - 1, bodyRx * 0.225, bodyRx * 0.245, P.body);
  }

  // ===== 身体 =====
  ellipse(cv, cx, bodyCy, bodyRx * 1.05, bodyRy * 1.05, P.dark);
  ellipse(cv, cx, bodyCy, bodyRx, bodyRy, P.body);
  ellipse(cv, cx - bodyRx * 0.22, bodyCy - bodyRy * 0.40, bodyRx * 0.52, bodyRy * 0.42, P.light, 90);

  // ===== 头（大圆，是主体）=====
  ellipse(cv, cx, headCy, headRx * 1.045, headRy * 1.045, P.dark);
  ellipse(cv, cx, headCy, headRx, headRy, P.body);
  ellipse(cv, cx - headRx * 0.26, headCy - headRy * 0.42, headRx * 0.58, headRy * 0.46, P.light, 110);

  // ===== 面罩（居中，占头宽 ~78%，带深色外沿）=====
  const vw = headRx * 1.45, vh = headRy * 0.90;
  const vx = cx - vw / 2, vy = headCy - vh * 0.44;
  rrect(cv, vx - 2.5, vy - 2.5, vw + 5, vh + 5, vh * 0.33, P.rim);
  rrect(cv, vx, vy, vw, vh, vh * 0.30, P.visor);

  // ===== ">_" 符号 =====
  const sh = vh * (0.40 + glow * 0.05);
  const sx = vx + vw * 0.17;
  const sy = vy + vh * 0.50;
  const stemW = sh * 0.72;
  seg(cv, sx, sy - sh * 0.44, sx + stemW, sy, sh * 0.30, P.cyan);
  seg(cv, sx, sy + sh * 0.44, sx + stemW, sy, sh * 0.30, P.cyan);
  seg(cv, sx + stemW * 1.28, sy + sh * 0.44, sx + stemW * 1.28 + sh * 0.72, sy + sh * 0.44, sh * 0.28, P.cyan);

  // ===== 眨眼：面罩里两条短横线 =====
  if (blink) {
    const by = vy + vh * 0.52;
    seg(cv, vx + vw * 0.20, by, vx + vw * 0.34, by, sh * 0.26, P.cyan);
    seg(cv, vx + vw * 0.62, by, vx + vw * 0.76, by, sh * 0.26, P.cyan);
  }
  return cv.px;
}

function toPNG(px) { return encodePNG(SIZE, SIZE, Buffer.from(px.buffer, px.byteOffset, px.length)); }

const FRAMES = [
  { o: {}, dur: 180 },
  { o: { squash: 1.03, bob: -3, arm: 0.4 }, dur: 170 },
  { o: { squash: 1.05, bob: -5, arm: 0.7, glow: 1 }, dur: 170 },
  { o: { squash: 1.055, bob: -6, arm: 0.5, glow: 0.7, step: 1 }, dur: 170 },
  { o: { squash: 1.04, bob: -4, arm: 0.2, glow: 0.3, step: 1 }, dur: 170 },
  { o: { squash: 1.02, bob: -2, arm: -0.1 }, dur: 170 },
  { o: { squash: 1.0, bob: 0, arm: -0.35 }, dur: 170 },
  { o: { squash: 1.02, bob: -2, arm: -0.65, step: -1 }, dur: 170 },
  { o: { squash: 1.04, bob: -4, arm: -0.45, glow: 0.4, step: -1 }, dur: 170 },
  { o: { squash: 1.05, bob: -5, arm: -0.15, glow: 0.8 }, dur: 190 },
  { o: { squash: 1.035, bob: -3, arm: 0.1, blink: true }, dur: 280 },
  { o: { squash: 1.015, bob: -1, arm: 0.05 }, dur: 230 },
];


const files = FRAMES.map((f, i) => ({
  name: "frame_" + String(i).padStart(3, "0") + ".png",
  data: toPNG(drawBot(f.o)),
}));

const pack = normalizePack({
  id: "example-小蓝机器人",
  name: "小蓝机器人",
  author: "桌宠制作器",
  frames: files.map((f, i) => ({ file: f.name, durationMs: FRAMES[i].dur })),
  canvas: { width: SIZE, height: SIZE },
  render: { scale: 0.3 },
  animation: { idle: "play", idleSpeed: 1, fps: 6, click: "bounce", hover: "grow" },
  physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
  bubble: {
    enabled: true,
    lines: [">_ 我在待命～", "要一起写代码吗？", "点我一下试试！", "今天也顺利哦"],
  },
  behavior: { startCorner: "bottom-right", keepAbove: true, bugChase: true },
});

const out = path.resolve(__dirname, "..", "examples", "小蓝机器人.petpack");
fs.writeFileSync(out, zipCreate([
  { name: "pet.json", data: JSON.stringify(pack, null, 2) },
  ...files,
]));
console.log("已生成: " + out);

