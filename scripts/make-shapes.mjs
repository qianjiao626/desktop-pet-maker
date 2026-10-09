// 生成「形状小朋友」内置宠物（用 Kenney shape-characters 的 2D 零件拼装，CC0）
// 零件：身体（80x80，10 色 x 4 形状）+ 表情（faces）+ 手势（hands），按颜色配套。
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const SRC = path.join(process.env.TEMP, 'kenney-packs', 'shape-characters', 'PNG', 'Default');
const OUTDIR = path.resolve('examples');
const CANVAS = 200;
const BODY = 80;
const CX = CANVAS / 2;
const BODY_CY = CANVAS * 0.50;

function loadLayer(name) {
  const p = path.join(SRC, name + '.png');
  if (!fs.existsSync(p)) return null;
  const img = nativeImage.createFromPath(p);
  const sz = img.getSize();
  return { bmp: img.toBitmap(), w: sz.width, h: sz.height };
}

/** src-over 合成：以 (ax, ay) 为图层锚点放到 (dx, dy) */
function blit(dst, layer, dx, dy, ax = 0.5, ay = 0.5) {
  const { bmp, w, h } = layer;
  const ox = Math.round(dx - w * ax), oy = Math.round(dy - h * ay);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, a = bmp[s + 3] / 255;
    if (a <= 0) continue;
    const px = ox + x, py = oy + y;
    if (px < 0 || py < 0 || px >= CANVAS || py >= CANVAS) continue;
    const d = (py * CANVAS + px) * 4;
    const da = dst[d + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) continue;
    dst[d]     = Math.round((bmp[s + 2] * a + dst[d]     * da * (1 - a)) / oa);
    dst[d + 1] = Math.round((bmp[s + 1] * a + dst[d + 1] * da * (1 - a)) / oa);
    dst[d + 2] = Math.round((bmp[s]     * a + dst[d + 2] * da * (1 - a)) / oa);
    dst[d + 3] = Math.round(oa * 255);
  }
}

function compose(spec) {
  const cv = new Uint8ClampedArray(CANVAS * CANVAS * 4);
  const half = BODY / 2;
  // 双手：贴在身体左右两侧（手比身体小，锚点取手心）
  const hl = loadLayer(spec.color + '_hand_' + spec.handL);
  const hr = loadLayer(spec.color + '_hand_' + spec.handR);
  if (hl) blit(cv, hl, CX - half - 4, BODY_CY + 12, 0.5, 0.5);
  if (hr) blit(cv, hr, CX + half + 4, BODY_CY + 12, 0.5, 0.5);
  // 身体
  blit(cv, loadLayer(spec.color + '_body_' + spec.shape), CX, BODY_CY, 0.5, 0.5);
  // 表情：脸部素材自带位置偏移，居中略偏上
  const f = loadLayer('face_' + spec.face);
  if (f) blit(cv, f, CX, BODY_CY - 2, 0.5, 0.5);
  return cv;
}

/** 6 帧呼吸/摆动动画（脚底为锚点） */
function animate(base) {
  const motions = [
    { sy: 1.00, dy: 0 }, { sy: 1.045, dy: -3 }, { sy: 1.02, dy: -1 },
    { sy: 1.06, dy: -4 }, { sy: 1.03, dy: -2 }, { sy: 1.02, dy: -1 },
  ];
  const anchorY = CANVAS * 0.90;
  return motions.map((m) => {
    const out = new Uint8ClampedArray(CANVAS * CANVAS * 4);
    const kx = 1 / Math.sqrt(m.sy);
    for (let y = 0; y < CANVAS; y++) for (let x = 0; x < CANVAS; x++) {
      const s = (y * CANVAS + x) * 4, a = base[s + 3];
      if (!a) continue;
      const sx = Math.round((x - CX) / kx + CX);
      const sy = Math.round((y - anchorY) / m.sy + anchorY + m.dy);
      if (sx < 0 || sy < 0 || sx >= CANVAS || sy >= CANVAS) continue;
      const d = (sy * CANVAS + sx) * 4;
      if (out[d + 3] >= a) continue;
      out[d] = base[s]; out[d+1] = base[s+1]; out[d+2] = base[s+2]; out[d+3] = a;
    }
    return encodePNG(CANVAS, CANVAS, Buffer.from(out));
  });
}

// 8 只形状小朋友：颜色 + 形状 + 表情 + 手势组合（可爱优先）
// 颜色按实测渲染结果对应（Kenney 的文件名与视觉色不完全一致）：
//   blue->橙  green->绿  purple->品红  red->深蓝紫  pink->浅紫
const SHAPES = [
  { name:'小圆橙',   color:'blue',   shape:'circle',   face:'c', handL:'open',  handR:'open'  },
  { name:'小方绿',   color:'green',  shape:'squircle', face:'a', handL:'open',  handR:'peace' },
  { name:'小菱红',   color:'purple', shape:'rhombus',  face:'c', handL:'open',  handR:'open'  },
  { name:'小方正',   color:'red',    shape:'square',   face:'b', handL:'open',  handR:'open'  },
  { name:'小圆紫',   color:'pink',   shape:'circle',   face:'e', handL:'open',  handR:'thumb' },
];

app.whenReady().then(() => {
  if (!fs.existsSync(SRC)) { console.error('未找到零件目录: ' + SRC); app.quit(); return; }
  const made = [];
  for (const spec of SHAPES) {
    const need = [
      spec.color + '_body_' + spec.shape,
      'face_' + spec.face,
      spec.color + '_hand_' + spec.handL,
      spec.color + '_hand_' + spec.handR,
    ];
    const missing = need.filter(n => !fs.existsSync(path.join(SRC, n + '.png')));
    if (missing.length) { console.log('跳过 ' + spec.name + '（缺: ' + missing.join(', ') + '）'); continue; }
    const frames = animate(compose(spec));
    const files = frames.map((data, i) => ({ name: 'frame_' + String(i).padStart(3, '0') + '.png', data }));
    const pack = normalizePack({
      id: 'shape-' + spec.name, name: spec.name, author: 'Kenney.nl (CC0)',
      frames: files.map(f => ({ file: f.name, durationMs: 180 })),
      canvas: { width: CANVAS, height: CANVAS },
      render: { scale: 0.3 },
      animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
      physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
      bubble: { enabled: true, lines: ['我是' + spec.name + '！', '跳跳跳～', '你好呀～'] },
      behavior: { startCorner: 'bottom-right', keepAbove: true },
    });
    fs.writeFileSync(path.join(OUTDIR, spec.name + '.petpack'),
      zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...files]));
    made.push(spec.name);
  }
  console.log('生成形状小朋友: ' + made.join('、'));
  app.quit();
}).catch(e => { console.error('FATAL ' + e.message + '\n' + e.stack); app.quit(); });
