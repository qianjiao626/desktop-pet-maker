// 生成示例宠物包（多帧动画，无外部依赖）
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

/** 画一只 Q 版小宠，blink 控制眯眼，squash 控制身体挤压 */
function drawPet(body, accent, { blink = false, squash = 1, bob = 0, arm = 0 } = {}) {
  const cv = makeCanvas();
  const cx = SIZE / 2, cy = SIZE / 2 + 6 + bob;
  const rx = SIZE * 0.32;
  const ry = SIZE * 0.34 * squash;
  const [br, bg, bb] = body;
  const [ar, ag, ab] = accent;

  // 耳朵
  ellipse(cv, cx - rx * 0.62, cy - ry * 0.9, rx * 0.2, ry * 0.26, [br * 0.92, bg * 0.92, bb * 0.92]);
  ellipse(cv, cx + rx * 0.62, cy - ry * 0.9, rx * 0.2, ry * 0.26, [br * 0.92, bg * 0.92, bb * 0.92]);
  // 手（arm: -1..1 摆动）
  ellipse(cv, cx - rx * 0.92, cy + ry * 0.18 + arm * 8, rx * 0.16, ry * 0.2, [br * 0.95, bg * 0.95, bb * 0.95]);
  ellipse(cv, cx + rx * 0.92, cy + ry * 0.18 - arm * 8, rx * 0.16, ry * 0.2, [br * 0.95, bg * 0.95, bb * 0.95]);
  // 脚
  ellipse(cv, cx - rx * 0.42, cy + ry * 0.94, rx * 0.24, ry * 0.15, [br * 0.9, bg * 0.9, bb * 0.9]);
  ellipse(cv, cx + rx * 0.42, cy + ry * 0.94, rx * 0.24, ry * 0.15, [br * 0.9, bg * 0.9, bb * 0.9]);
  // 身体
  ellipse(cv, cx, cy, rx, ry, [br, bg, bb]);
  // 肚皮
  ellipse(cv, cx, cy + ry * 0.3, rx * 0.5, ry * 0.42, [br + 28, bg + 28, bb + 28]);
  // 眼睛
  if (blink) {
    ellipse(cv, cx - rx * 0.34, cy - ry * 0.16, rx * 0.12, ry * 0.03, [40, 35, 50]);
    ellipse(cv, cx + rx * 0.34, cy - ry * 0.16, rx * 0.12, ry * 0.03, [40, 35, 50]);
  } else {
    ellipse(cv, cx - rx * 0.34, cy - ry * 0.18, rx * 0.115, ry * 0.135, [30, 30, 40]);
    ellipse(cv, cx + rx * 0.34, cy - ry * 0.18, rx * 0.115, ry * 0.135, [30, 30, 40]);
    ellipse(cv, cx - rx * 0.30, cy - ry * 0.25, rx * 0.042, ry * 0.05, [255, 255, 255]);
    ellipse(cv, cx + rx * 0.38, cy - ry * 0.25, rx * 0.042, ry * 0.05, [255, 255, 255]);
  }
  // 腮红
  ellipse(cv, cx - rx * 0.62, cy + ry * 0.12, rx * 0.14, ry * 0.085, [ar, ag, ab], 210);
  ellipse(cv, cx + rx * 0.62, cy + ry * 0.12, rx * 0.14, ry * 0.085, [ar, ag, ab], 210);
  // 嘴
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const mx = cx, my = cy + ry * 0.13;
    if (Math.hypot((x - mx) / (rx * 0.17), (y - my) / (ry * 0.1)) < 1 && y > my - ry * 0.02)
      blend(cv, x, y, 70, 45, 55, 230);
  }
  return cv.px;
}

function buildPack(name, body, accent, lines) {
  // 4 帧 breathing + 1 帧 blink，形成可循环的小动画
  const frames = [
    { px: drawPet(body, accent, { squash: 1.00, bob: 0, arm: 0 }), dur: 180 },
    { px: drawPet(body, accent, { squash: 1.05, bob: -3, arm: 0.4 }), dur: 180 },
    { px: drawPet(body, accent, { squash: 1.02, bob: -1, arm: 0 }), dur: 180 },
    { px: drawPet(body, accent, { squash: 1.06, bob: -4, arm: -0.4 }), dur: 180 },
    { px: drawPet(body, accent, { squash: 1.03, bob: -2, blink: true }), dur: 260 },
  ];
  const files = frames.map((f, i) => ({
    name: `frame_${String(i).padStart(3, '0')}.png`,
    data: encodePNG(SIZE, SIZE, Buffer.from(f.px)),
  }));
  const pack = normalizePack({
    id: 'example-' + name,
    name, author: '桌宠制作器',
    frames: files.map((f, i) => ({ file: f.name, durationMs: frames[i].dur })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.5 },
    animation: { idle: 'play', idleSpeed: 1, fps: 6, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
    bubble: { enabled: true, lines },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });
  const zip = zipCreate([
    { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
    ...files,
  ]);
  const file = path.join(OUT, name + '.petpack');
  fs.writeFileSync(file, zip);
  return file;
}

const made = [
  buildPack('小豆子', [96, 168, 255], [255, 150, 170], ['你好呀，我叫小豆子！', '今天也要元气满满哦～', '要不要摸摸我的头？']),
  buildPack('团子', [255, 176, 96], [255, 120, 120], ['团子来啦！', '有点困了…zzZ', '陪我玩一会儿嘛～']),
];
for (const f of made) console.log('已生成: ' + f);