// 生成「小怪物」内置宠物（用 Kenney monster-builder-pack 的 2D 零件拼装，CC0）
// 零件是「整条肢体」：手臂自带肩部圆头、腿自带胯部圆头，必须贴合身体边缘摆放。
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const SRC = path.join(process.env.TEMP, 'kenney-packs', 'monster-builder-pack', 'PNG', 'Default');
const OUTDIR = path.resolve('examples');
const CANVAS = 300;
const BODY = 165;                 // 身体原始尺寸
const CX = CANVAS / 2;
const BODY_CY = CANVAS * 0.50;    // 身体中心

function loadLayer(name) {
  const p = path.join(SRC, name + '.png');
  if (!fs.existsSync(p)) return null;
  const img = nativeImage.createFromPath(p);
  const sz = img.getSize();
  return { bmp: img.toBitmap(), w: sz.width, h: sz.height };
}

/** src-over 合成：以 (ax, ay) 为图层锚点，放到画布 (dx, dy) */
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

/** 拼装一只小怪物 */
function compose(spec) {
  const cv = new Uint8ClampedArray(CANVAS * CANVAS * 4);
  const half = BODY / 2;

  // 腿：从身体两侧下方伸出（锚点取零件顶部中心 = 胯部）
  for (const l of spec.legs) {
    const ly = loadLayer(l.layer);
    if (ly) blit(cv, ly, CX + l.dx, BODY_CY + half * 0.92, 0.5, 0.04);
  }
  // 手臂：从身体两侧伸出（锚点取零件顶部中心 = 肩部）
  for (const a of spec.arms) {
    const al = loadLayer(a.layer);
    if (al) blit(cv, al, CX + a.dx, BODY_CY - half * 0.28, 0.5, 0.04);
  }
  // 身体
  blit(cv, loadLayer(spec.body), CX, BODY_CY, 0.5, 0.5);

  // 眼睛
  for (const e of spec.eyes) {
    const el = loadLayer(e.layer);
    if (el) blit(cv, el, CX + e.dx, BODY_CY + e.dy, 0.5, 0.5);
  }
  // 嘴
  if (spec.mouth) {
    const m = loadLayer(spec.mouth);
    if (m) blit(cv, m, CX, BODY_CY + (spec.mouthDy || 34), 0.5, 0.5);
  }
  return cv;
}

/** 生成 6 帧呼吸 / 摆动动画（以脚底为锚点，压扁不下沉） */
function animate(base) {
  const motions = [
    { sy: 1.00, dy: 0 }, { sy: 1.04, dy: -3 }, { sy: 1.02, dy: -1 },
    { sy: 1.05, dy: -4 }, { sy: 1.03, dy: -2 }, { sy: 1.02, dy: -1 },
  ];
  const anchorY = CANVAS * 0.95;
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

// 6 只小怪物：圆润身体 + 大眼 + 开心嘴（可爱优先）
const MONSTERS = [
  { name:'小黄怪', body:'body_yellowA',
    eyes:[{layer:'eye_cute_light',dx:-30,dy:-16},{layer:'eye_cute_light',dx:30,dy:-16}],
    mouth:'mouth_closed_happy', mouthDy:36,
    arms:[{layer:'arm_yellowA',dx:-88},{layer:'arm_yellowC',dx:88}],
    legs:[{layer:'leg_yellowB',dx:-36},{layer:'leg_yellowB',dx:36}] },
  { name:'小绿怪', body:'body_greenA',
    eyes:[{layer:'eye_cute_light',dx:-30,dy:-16},{layer:'eye_cute_light',dx:30,dy:-16}],
    mouth:'mouth_closed_happy', mouthDy:36,
    arms:[{layer:'arm_greenA',dx:-88},{layer:'arm_greenC',dx:88}],
    legs:[{layer:'leg_greenB',dx:-36},{layer:'leg_greenB',dx:36}] },
  { name:'小蓝怪', body:'body_blueA',
    eyes:[{layer:'eye_human_blue',dx:-30,dy:-16},{layer:'eye_human_blue',dx:30,dy:-16}],
    mouth:'mouth_closed_happy', mouthDy:36,
    arms:[{layer:'arm_blueA',dx:-88},{layer:'arm_blueC',dx:88}],
    legs:[{layer:'leg_blueB',dx:-36},{layer:'leg_blueB',dx:36}] },
  { name:'小红怪', body:'body_redA',
    eyes:[{layer:'eye_cute_light',dx:-30,dy:-16},{layer:'eye_cute_light',dx:30,dy:-16}],
    mouth:'mouth_closed_happy', mouthDy:36,
    arms:[{layer:'arm_redA',dx:-88},{layer:'arm_redC',dx:88}],
    legs:[{layer:'leg_redB',dx:-36},{layer:'leg_redB',dx:36}] },
  { name:'小白怪', body:'body_whiteA',
    eyes:[{layer:'eye_human',dx:-30,dy:-16},{layer:'eye_human',dx:30,dy:-16}],
    mouth:'mouth_closed_teeth', mouthDy:36,
    arms:[{layer:'arm_whiteA',dx:-88},{layer:'arm_whiteC',dx:88}],
    legs:[{layer:'leg_whiteB',dx:-36},{layer:'leg_whiteB',dx:36}] },
  { name:'小紫怪', body:'body_darkA',
    eyes:[{layer:'eye_cute_light',dx:-30,dy:-16},{layer:'eye_cute_light',dx:30,dy:-16}],
    mouth:'mouth_closed_happy', mouthDy:36,
    arms:[{layer:'arm_darkA',dx:-88},{layer:'arm_darkC',dx:88}],
    legs:[{layer:'leg_darkB',dx:-36},{layer:'leg_darkB',dx:36}] },
];

app.whenReady().then(() => {
  if (!fs.existsSync(SRC)) { console.error('未找到零件目录: ' + SRC); app.quit(); return; }
  const made = [];
  for (const spec of MONSTERS) {
    const need = [spec.body, ...spec.eyes.map(e => e.layer), spec.mouth,
      ...(spec.arms || []).map(a => a.layer), ...(spec.legs || []).map(l => l.layer)];
    const missing = need.filter(n => n && !fs.existsSync(path.join(SRC, n + '.png')));
    if (missing.length) { console.log('跳过 ' + spec.name + '（缺零件: ' + missing.join(', ') + '）'); continue; }

    const base = compose(spec);
    const frames = animate(base);
    const files = frames.map((data, i) => ({ name: 'frame_' + String(i).padStart(3, '0') + '.png', data }));
    const pack = normalizePack({
      id: 'monster-' + spec.name, name: spec.name, author: 'Kenney.nl (CC0)',
      frames: files.map(f => ({ file: f.name, durationMs: 180 })),
      canvas: { width: CANVAS, height: CANVAS },
      render: { scale: 0.3 },
      animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
      physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
      bubble: { enabled: true, lines: ['咕噜咕噜～', '我是' + spec.name + '！', '陪我玩嘛～'] },
      behavior: { startCorner: 'bottom-right', keepAbove: true },
    });
    fs.writeFileSync(path.join(OUTDIR, spec.name + '.petpack'),
      zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...files]));
    made.push(spec.name);
  }
  console.log('生成: ' + made.join('、'));
  app.quit();
}).catch(e => { console.error('FATAL ' + e.message + '\n' + e.stack); app.quit(); });
