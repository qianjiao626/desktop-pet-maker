// 生成「萌系小动物」内置宠物（OpenGameArt CC0 高清带逐帧动画素材）
//
// 素材来源（均为 CC0 1.0，可自由商用）：
//   cute-polar-bear-character / cute-penguin-character / cute-ducky-duck-character
//   orange-fat-cat / fat-bird-sprites  —— 见 THIRD-PARTY.md
//
// 与之前的做法不同：这些素材**自带 12 帧 Idle 动画**（还有 Walk/Run/Jump/Hurt 等），
// 直接按帧打包即可，不需要程序化合成，因此动画质量高得多。
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const BASE = path.join(process.env.TEMP, 'oga-assets');
const OUTDIR = path.resolve('examples');
const MAX_SIDE = 256;        // 统一下采样到 256，控制体积（原图 450x523）

/** 读取一帧并等比缩放到 MAX_SIDE 内，输出 RGBA */
function loadFrame(file) {
  const img = nativeImage.createFromPath(file);
  const sz = img.getSize();
  const k = Math.min(1, MAX_SIDE / Math.max(sz.width, sz.height));
  const w = Math.max(1, Math.round(sz.width * k));
  const h = Math.max(1, Math.round(sz.height * k));
  const resized = k < 1 ? img.resize({ width: w, height: h, quality: 'best' }) : img;
  return { data: resized.toBitmap(), w, h };   // BGRA
}

/** 把一组帧统一到同一画布（居中、底部对齐），再编码为 PNG 数组 */
function packFrames(dir, opts = {}) {
  const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
  if (!files.length) return null;
  const loaded = files.map((f) => loadFrame(path.join(dir, f)));
  const CW = Math.max(...loaded.map((l) => l.w)) + 8;
  const CH = Math.max(...loaded.map((l) => l.h)) + 8;
  const pngs = loaded.map((l) => {
    const cv = new Uint8ClampedArray(CW * CH * 4);
    const ox = Math.round((CW - l.w) / 2);
    const oy = CH - 4 - l.h;                     // 底部对齐
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
      const s = (y * l.w + x) * 4, d = ((oy + y) * CW + (ox + x)) * 4;
      cv[d] = l.data[s]; cv[d+1] = l.data[s+1]; cv[d+2] = l.data[s+2]; cv[d+3] = l.data[s+3];
    }
    return encodePNG(CW, CH, Buffer.from(cv));
  });
  return { pngs, w: CW, h: CH, count: files.length };
}

// 每只宠物：idle 动画目录 + 中文名 + 台词
const PETS = [
  { name: '北极熊', src: ['cute-polar-bear-character','FAT ANIMAL POLAR','Animation PNG','POLAR','NUDE','01-Idle','01-Idle'],
    lines: ['我是软乎乎的北极熊～','想抱抱吗？','呼…有点冷'] },
  { name: '小企鹅', src: ['cute-penguin-character','FOWL ANIMAL PENGUIN','Animation PNG','PENGUIN','NUDE','01-Idle','01-Idle'],
    lines: ['我是小企鹅～','摇摇晃晃～','要一起玩吗？'] },
  { name: '小黄鸭', src: ['cute-ducky-duck-character','FOWL ANIMAL DUCKY','Animation PNG','DUCKY','NUDE','01-Idle','01-Idle'],
    lines: ['嘎嘎～','我是小黄鸭！','游泳我最行'] },
  { name: '胖橘猫', src: ['orange-fat-cat','Orange Fat Cat','Idle'],
    lines: ['喵～','今天的阳光真好','摸摸我嘛'] },
  { name: '大胖鸡', src: ['fat-bird-sprites','upload'],
    lines: ['咕咕咕～','我是大胖鸡','一起来玩吧'] },
];

app.whenReady().then(() => {
  if (!fs.existsSync(BASE)) { console.error('未找到素材目录: ' + BASE); app.quit(); return; }
  const made = [];
  for (const pet of PETS) {
    const dir = path.join(BASE, ...pet.src);
    if (!fs.existsSync(dir)) { console.log('跳过 ' + pet.name + '（缺目录）'); continue; }
    const packed = packFrames(dir);
    if (!packed) { console.log('跳过 ' + pet.name + '（无帧）'); continue; }

    const files = packed.pngs.map((data, i) => ({ name: 'frame_' + String(i).padStart(3, '0') + '.png', data }));
    // 12 帧循环：每帧 110ms 左右，接近自然呼吸节奏
    const dur = Math.max(70, Math.round(1300 / packed.count));
    const pack = normalizePack({
      id: 'cute-' + pet.name, name: pet.name, author: 'OpenGameArt (CC0)',
      frames: files.map((f) => ({ file: f.name, durationMs: dur })),
      canvas: { width: packed.w, height: packed.h },
      render: { scale: 0.3 },
      animation: { idle: 'play', idleSpeed: 1, fps: 10, click: 'bounce', hover: 'grow' },
      physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
      bubble: { enabled: true, lines: pet.lines },
      behavior: { startCorner: 'bottom-right', keepAbove: true },
    });
    fs.writeFileSync(path.join(OUTDIR, pet.name + '.petpack'),
      zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...files]));
    made.push(pet.name + '(' + packed.count + '帧 ' + packed.w + 'x' + packed.h + ')');
  }
  console.log('生成萌宠: ' + made.join('、'));
  app.quit();
}).catch((e) => { console.error('FATAL ' + e.message + '\n' + e.stack); app.quit(); });
