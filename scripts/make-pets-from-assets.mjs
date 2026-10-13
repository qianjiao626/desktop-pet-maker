// 把「素材/原始素材/」里的 AI 立绘批量做成桌宠包（.petpack）
//
// 这是「豆包/任何 AI 生成立绘 → 桌宠」的完整链路，也是 素材/工单_豆包生成素材.md
// 的配套落地脚本。用户在工单里被要求按「正面站立、双臂斜下张开、双腿微开」的
// 标准姿势出图，正是为了让这里的自动处理稳定。
//
// 流程：读图 → 自动挑抠图容差 → 抠背景 + 去污染 → 裁到内容 → 生成动作 → 打包
//
// 用法：
//   electron scripts/make-pets-from-assets.mjs            # 处理 素材/原始素材/
//   electron scripts/make-pets-from-assets.mjs --install  # 同时装进宠物库
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';
import {
  floodCut, looksLikeFlatBackground, trimBounds, cropData, pickCutTolerance,
} from '../src/shared/imageops.js';
import { buildActionClips } from './lib-action-clips.mjs';

const log = (m) => { try { process.stdout.write(m + String.fromCharCode(10)); } catch {} };
const ROOT = process.cwd();
const SRC = path.join(ROOT, '素材', '原始素材');
const OUT = path.join(ROOT, '素材', '做好的宠物');
const SIZE = 256;
const INSTALL = process.argv.includes('--install');

/**
 * 读图并缩到 SIZE 以内，返回 **RGBA**（nativeImage 给的是 BGRA，必须换序）。
 * 这条踩过：忘了换序时预览里青蛙变粉、女孩变黄。
 */
function loadRGBA(file) {
  const img = nativeImage.createFromPath(file);
  const sz = img.getSize();
  const k = Math.min(1, SIZE / Math.max(sz.width, sz.height));
  const w = Math.max(1, Math.round(sz.width * k));
  const h = Math.max(1, Math.round(sz.height * k));
  const rs = k < 1 ? img.resize({ width: w, height: h, quality: 'best' }) : img;
  const bmp = rs.toBitmap();
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i*4] = bmp[i*4+2]; data[i*4+1] = bmp[i*4+1]; data[i*4+2] = bmp[i*4]; data[i*4+3] = bmp[i*4+3];
  }
  return { data, w, h };
}

/** 把 RGBA 画到统一画布（底部对齐 + 水平居中），并做刚性变换 */
function place(src, CW, CH, t = {}) {
  const out = new Uint8ClampedArray(CW * CH * 4);
  const sc = Number.isFinite(t.scale) ? t.scale : 1;
  const dx = (Number(t.dx) || 0) * CW;
  const dy = (Number(t.dy) || 0) * CH;
  const cx = CW / 2, cy = CH;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const sx = Math.round((x - cx - dx) / sc + src.w / 2);
    const sy = Math.round((y - cy - dy) / sc + src.h);
    if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
    const si = (sy * src.w + sx) * 4, di = (y * CW + x) * 4;
    out[di] = src.data[si]; out[di+1] = src.data[si+1]; out[di+2] = src.data[si+2]; out[di+3] = src.data[si+3];
  }
  return { data: out, w: CW, h: CH };
}

/**
 * 主帧用的「呼吸」序列。
 *
 * 为什么是这种整体形变而不是"逐肢体旋转跳舞"：
 *   逐肢体旋转需要把四肢当作独立部件搬运像素，而静态立绘没有背面、
 *   没有关节内侧、没有被遮挡肢体的像素（HANDOFF 已知坑 23，三条路线实测全败）。
 *   这里做的「呼吸 / 摇摆 / 蹦跳」是刚性变换，不需要任何缺失像素，因此永远不穿帮。
 */
const IDLE = [
  { dy: 0, scale: 1, dur: 220 }, { dy: -0.012, scale: 1.01, dur: 220 },
  { dy: 0, scale: 1, dur: 220 }, { dy: -0.008, scale: 1.008, dur: 260 },
];

/**
 * 额外的动作片段（摇摆 / 蹦跳）。
 * 交给共用的 buildActionClips 组装 —— 和内置宠物走同一条路径，
 * 所以"片段与主帧同尺寸""片段名可读""帧时长合理"这些守护对这里同样生效。
 */
const CLIP_ACTIONS = [
  {
    id: 'sway', name: '摇摆', weight: 1,
    frames: [
      { o: { dx: -0.03, dy: 0 }, dur: 180 },
      { o: { dx: 0, dy: -0.01 }, dur: 160 },
      { o: { dx: 0.03, dy: 0 }, dur: 180 },
      { o: { dx: 0, dy: -0.01 }, dur: 160 },
    ],
  },
  {
    id: 'hop', name: '蹦跳', weight: 1,
    frames: [
      { o: { dy: 0.012, scale: 0.97 }, dur: 120 },
      { o: { dy: -0.05, scale: 1.04 }, dur: 140 },
      { o: { dy: -0.015, scale: 1.01 }, dur: 110 },
      { o: { dy: 0, scale: 1 }, dur: 150 },
    ],
  },
];

app.whenReady().then(() => {
  if (!fs.existsSync(SRC)) {
    log('找不到素材目录：' + SRC);
    app.exit(1);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => /\.png$/i.test(f)).sort();
  if (!files.length) {
    log('素材目录是空的：' + SRC);
    app.exit(0);
    return;
  }

  const made = [];
  for (const f of files) {
    try {
      const raw = loadRGBA(path.join(SRC, f));
      let data = raw.data;
      let cutNote = '未抠（背景不像纯色/渐变）';
      if (looksLikeFlatBackground(raw.data, raw.w, raw.h).ok) {
        const picked = pickCutTolerance(raw.data, raw.w, raw.h);
        data = floodCut(raw.data, raw.w, raw.h, { tol: picked.tol, feather: 14 }).data;
        cutNote = '已抠+去污染(tol=' + picked.tol + ', 主体保留 ' + (picked.survival * 100).toFixed(1) + '%)';
      }
      const b = trimBounds(data, raw.w, raw.h, { pad: 2 });
      const cut = cropData(data, raw.w, raw.h, b);
      const base = { data: cut.data, w: b.w, h: b.h };
      const CW = SIZE, CH = SIZE;
      const frames = [];
      const filesOut = [];
      for (let i = 0; i < IDLE.length; i++) {
        const s = IDLE[i];
        const cv = place(base, CW, CH, s);
        const name = 'frame_' + String(i).padStart(3, '0') + '.png';
        filesOut.push({ name, data: encodePNG(CW, CH, Buffer.from(cv.data)) });
        frames.push({ file: name, durationMs: s.dur });
      }
      const { clips, files: clipFiles } = buildActionClips(
        CLIP_ACTIONS,
        (o) => place(base, CW, CH, o).data,
        (px) => encodePNG(CW, CH, Buffer.from(px)),
        { prefix: 'clip' },
      );
      filesOut.push(...clipFiles);
      const petName = f.replace(/^角色\d+_/, '').replace(/\.png$/i, '');
      const pack = normalizePack({
        id: 'asset-' + petName, name: petName, author: 'AI 生成素材',
        frames, clips,
        canvas: { width: CW, height: CH },
        render: { scale: 0.3 },
        animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
        physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
        bubble: { enabled: true, lines: ['你好呀～', '今天也要加油！'] },
        behavior: { startCorner: 'bottom-right', keepAbove: true },
      });
      const outFile = path.join(OUT, petName + '.petpack');
      fs.writeFileSync(outFile, zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...filesOut]));
      made.push({ petName, outFile });
      log('✅ ' + petName + '.petpack  (' + frames.length + ' 主帧 + ' + clips.length + ' 段动作, ' + cutNote + ')');
    } catch (e) {
      log('❌ ' + f + '  ' + (e && e.message));
    }
  }

  if (INSTALL && made.length) {
    const dest = path.join(app.getPath('userData'), 'pets');
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const m of made) {
      const target = path.join(dest, m.petName + '.petpack');
      fs.copyFileSync(m.outFile, target);
      n++;
    }
    log('');
    log('已装进宠物库 ' + n + ' 只：' + dest);
  }

  log('');
  log('输出: ' + OUT);
  app.exit(0);
});