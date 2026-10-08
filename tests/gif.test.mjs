import { createRequire } from 'node:module';
import fs from 'node:fs';
import { ok } from './_harness.mjs';
import { decodeGif, parseGifHeader } from '../src/shared/gif.js';

const require = createRequire(import.meta.url);
const { GifWriter } = require('omggif');
const gifuct = require('gifuct-js');

// ---- 1. 用 omggif 造一个已知 GIF：4x4，两帧（红 / 蓝）----
const palette = [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]; // 4 色（必须为 2 的幂）
const out = [];
const gw = new GifWriter(out, 4, 4, { palette, loop: 0 });
gw.addFrame(0, 0, 4, 4, new Array(16).fill(0), { palette, delay: 5, disposal: 2 }); // 全红
gw.addFrame(0, 0, 4, 4, new Array(16).fill(1), { palette, delay: 5, disposal: 2 }); // 全蓝
const end = gw.end();
const bytes = new Uint8Array(out.slice(0, end));

const hdr = parseGifHeader(bytes);
ok('GIF 头尺寸=4x4', hdr.width === 4 && hdr.height === 4, JSON.stringify(hdr));

const dec = decodeGif(bytes);
ok('帧数=2', dec.frames.length === 2, 'n=' + dec.frames.length + ' end=' + end);
const f0 = dec.frames[0].data, f1 = dec.frames[1].data;
ok('帧0 为红色且不透明', f0[0] === 255 && f0[1] === 0 && f0[2] === 0 && f0[3] === 255, `rgba=${f0[0]},${f0[1]},${f0[2]},${f0[3]}`);
ok('帧1 为蓝色且不透明', f1[0] === 0 && f1[1] === 0 && f1[2] === 255 && f1[3] === 255, `rgba=${f1[0]},${f1[1]},${f1[2]},${f1[3]}`);
ok('延迟转换为毫秒', dec.frames[0].delayMs === 50, 'd=' + dec.frames[0].delayMs);

// 4x4x4 = 64 bytes per frame
ok('帧数据长度正确', f0.length === 64, 'len=' + f0.length);

// ---- 2. 非法数据 ----
let threw = false;
try { parseGifHeader(new Uint8Array([1, 2, 3, 4, 5, 6])); } catch { threw = true; }
ok('非 GIF 抛错', threw);

// ---- 3. 交叉验证：真实 dog.gif，与 gifuct-js 比对帧数与尺寸 ----
const dogBuf = fs.readFileSync('node_modules/gifuct-js/demo/dog.gif');
const dogArr = new Uint8Array(dogBuf.buffer, dogBuf.byteOffset, dogBuf.byteLength);

const mine = decodeGif(dogArr);
const ref = gifuct.decompressFrames(gifuct.parseGIF(dogArr.buffer.slice(dogBuf.byteOffset, dogBuf.byteOffset + dogBuf.byteLength)), true);

ok('dog.gif 帧数与 gifuct 一致', mine.frames.length === ref.length, `mine=${mine.frames.length} ref=${ref.length}`);
ok('dog.gif 尺寸与 gifuct 一致', mine.width === ref[0].dims.width && mine.height === ref[0].dims.height, `${mine.width}x${mine.height}`);

// 帧0 是整幅还是局部：比对帧0 的 patch 与我的合成结果（帧0 底图为空，应一致）
const r0 = ref[0];
let mismatch0 = 0;
for (let y = 0; y < r0.dims.height; y++) {
  for (let x = 0; x < r0.dims.width; x++) {
    const px = r0.dims.left + x, py = r0.dims.top + y;
    const mi = (py * mine.width + px) * 4;
    const ri = (y * r0.dims.width + x) * 4;
    if (Math.abs(mine.frames[0].data[mi] - r0.patch[ri]) > 1 ||
        Math.abs(mine.frames[0].data[mi + 3] - r0.patch[ri + 3]) > 1) mismatch0++;
  }
}
ok('dog.gif 帧0 像素与 gifuct 一致', mismatch0 === 0, 'mismatch=' + mismatch0 + ' px');

// ---- 4. 每帧都应是完整画布尺寸 ----
ok('所有帧为完整画布', mine.frames.every((f) => f.data.length === mine.width * mine.height * 4));
ok('所有帧延迟>0', mine.frames.every((f) => f.delayMs > 0));