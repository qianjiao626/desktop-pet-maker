// 给**已存在的**宠物包补上动作片段。
//
// 用途：有些内置宠物是手工放入的（没有生成脚本），它们只有一段循环。
// 这个脚本读进现有帧，用**整帧刚性变换**（位移 / 缩放 / 旋转）造出几段动作，
// 再写回同一个包。
//
// ★ 为什么用"整帧刚性变换"而不是切割肢体：
//   切割/形变需要"没有被拍到的像素"（关节内侧、背面），静态素材补不出来 ——
//   三条渲染路线实测全败（见 HANDOFF 已知坑 23）。
//   而"整个角色一起平移/缩放/轻微旋转"不需要任何新像素，是安全的。
//   所以这里只做：蹦跳（上下 + 挤压）、摇摆（左右 + 轻转）。
//
// 用法: electron scripts/add-clips-to-pack.mjs <包路径> [<包路径>...]
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { zipRead, zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

/** 解码 PNG -> {w,h,bgra} */
function decode(buf) {
  const img = nativeImage.createFromBuffer(buf);
  const sz = img.getSize();
  return { w: sz.width, h: sz.height, bgra: img.toBitmap() };
}

/**
 * 把一帧做刚性变换后重新编码。
 * @param src decode() 的结果
 * @param t { dx, dy, scale, rot } 都是相对量（dx/dy 是相对宽高的比例）
 */
function transform(src, t = {}) {
  const W = src.w, H = src.h;
  const dx = (Number(t.dx) || 0) * W;
  const dy = (Number(t.dy) || 0) * H;
  const sc = Number.isFinite(Number(t.scale)) ? Number(t.scale) : 1;
  const rot = Number(t.rot) || 0;
  const out = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2, cy = H / 2;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 目标像素 -> 源像素（逆变换）
      const px = x - cx - dx, py = y - cy - dy;
      const rx = (px * cos - py * sin) / sc;
      const ry = (px * sin + py * cos) / sc;
      const sx = Math.round(rx + cx), sy = Math.round(ry + cy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
      out[di] = src.bgra[si + 2];      // BGRA -> RGBA
      out[di + 1] = src.bgra[si + 1];
      out[di + 2] = src.bgra[si];
      out[di + 3] = src.bgra[si + 3];
    }
  }
  return encodePNG(W, H, Buffer.from(out));
}

/** 两段安全的动作（只用刚性变换） */
const ACTIONS = [
  { id: 'hop', name: '蹦跳', weight: 1, seq: [
    { dx: 0, dy: 0.02, scale: 0.97, rot: 0, dur: 120 },   // 蹲
    { dx: 0, dy: -0.06, scale: 1.04, rot: 0, dur: 140 },  // 跳起
    { dx: 0, dy: -0.02, scale: 1.01, rot: 0, dur: 110 },  // 落下
    { dx: 0, dy: 0, scale: 1, rot: 0, dur: 150 },         // 站稳
  ] },
  { id: 'sway', name: '摇摆', weight: 1, seq: [
    { dx: -0.05, dy: 0, scale: 1, rot: -0.05, dur: 180 },
    { dx: 0, dy: -0.01, scale: 1, rot: 0, dur: 160 },
    { dx: 0.05, dy: 0, scale: 1, rot: 0.05, dur: 180 },
    { dx: 0, dy: -0.01, scale: 1, rot: 0, dur: 160 },
  ] },
];

function addClips(file) {
  const entries = zipRead(fs.readFileSync(file));
  const mani = JSON.parse(entries.find((e) => e.name === 'pet.json').data.toString('utf8'));
  const pack = normalizePack(mani);
  const byName = new Map(entries.map((e) => [e.name, e.data]));

  // 用主帧的第一帧作为动作的基准姿态（保证动作与主帧观感一致）
  const baseFile = pack.frames[0] && pack.frames[0].file;
  if (!baseFile || !byName.has(baseFile)) throw new Error('找不到主帧: ' + baseFile);
  const base = decode(byName.get(baseFile));

  const clips = [];
  const newFiles = [];
  for (const a of ACTIONS) {
    const cframes = [];
    for (let i = 0; i < a.seq.length; i++) {
      const s = a.seq[i];
      const name = 'clip_' + a.id + '_' + String(i).padStart(3, '0') + '.png';
      newFiles.push({ name, data: transform(base, s) });
      cframes.push({ file: name, durationMs: s.dur });
    }
    clips.push({ id: 'clip_' + a.id, name: a.name, weight: a.weight, frames: cframes });
  }

  const out = normalizePack({ ...pack, clips });
  const outEntries = entries
    .filter((e) => e.name !== 'pet.json')
    .concat(newFiles)
    .map((e) => (e.name === 'pet.json' ? e : e));
  fs.writeFileSync(file, zipCreate([
    { name: 'pet.json', data: JSON.stringify(out, null, 2) },
    ...outEntries.filter((e) => e.name !== 'pet.json'),
  ]));
  return clips.length;
}

app.whenReady().then(() => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (!files.length) { console.error('用法: electron scripts/add-clips-to-pack.mjs <包路径>...'); app.exit(1); return; }
  let ok = 0;
  for (const f of files) {
    const abs = path.resolve(f);
    try {
      const n = addClips(abs);
      console.log('已补动作片段: ' + path.basename(abs) + '（' + n + ' 段）');
      ok++;
    } catch (err) {
      console.error('失败 ' + path.basename(abs) + ': ' + (err && err.message));
    }
  }
  app.exit(ok === files.length ? 0 : 1);
});
