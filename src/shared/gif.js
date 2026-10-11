// GIF 解析 + 合成（纯 JS，无第三方依赖）
// LZW/去隔行算法内联自 gifuct-js（MIT，见 THIRD-PARTY.md）
import { lzwDecode, deinterlace } from '../vendor/gif-lzw.js';

/** 解析 GIF 头部，拿到逻辑画布尺寸 */
export function parseGifHeader(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const sig = String.fromCharCode(b[0], b[1], b[2]);
  if (sig !== 'GIF') throw new Error('不是有效的 GIF 文件');
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), version: String.fromCharCode(b[3], b[4], b[5]) };
}

function readColorTable(b, p, size) {
  const t = [];
  for (let i = 0; i < size; i++) t.push([b[p + i * 3], b[p + i * 3 + 1], b[p + i * 3 + 2]]);
  return t;
}

/**
 * 解析 GIF 为合成后的帧序列（返回每帧完整 RGBA 画布）
 * 支持：全局/局部调色板、透明索引、disposal 0/1/2/3、交错、延迟
 */
export function decodeGif(buf, { maxFrames = 300 } = {}) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const header = parseGifHeader(b);
  const W = header.width, H = header.height;
  let p = 6;

  // 逻辑屏幕描述符
  const flags = b[p + 4];
  const gctFlag = (flags & 0x80) !== 0;
  const gctSize = 2 << (flags & 0x07);
  const bgIndex = b[p + 5];
  p += 7;
  let gct = null;
  if (gctFlag) { gct = readColorTable(b, p, gctSize); p += gctSize * 3; }

  // 合成缓冲（RGBA）
  const canvas = new Uint8ClampedArray(W * H * 4);
  const frames = [];
  let gce = null;

  const fillRect = (dst, x0, y0, w, h, rgba) => {
    for (let y = 0; y < h; y++) {
      const py = y0 + y;
      if (py < 0 || py >= H) continue;
      for (let x = 0; x < w; x++) {
        const px = x0 + x;
        if (px < 0 || px >= W) continue;
        const i = (py * W + px) * 4;
        dst[i] = rgba[0]; dst[i + 1] = rgba[1]; dst[i + 2] = rgba[2]; dst[i + 3] = rgba[3];
      }
    }
  };

  const readSubBlocks = () => {
    const parts = [];
    while (p < b.length) {
      const len = b[p++];
      if (len === 0) break;
      parts.push(b.subarray(p, p + len));
      p += len;
    }
    let total = 0;
    for (const s of parts) total += s.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const s of parts) { out.set(s, o); o += s.length; }
    return out;
  };

  let prevCanvas = null;

  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) break;              // trailer
    if (block === 0x21) {                    // extension
      const label = b[p++];
      if (label === 0xf9) {                  // graphics control
        const size = b[p++];
        const packed = b[p];
        const delay = b[p + 1] | (b[p + 2] << 8);
        const transparentIndex = b[p + 3];
        p += size;
        const term = b[p++]; // 0x00
        gce = {
          disposal: (packed >> 2) & 0x07,
          transparent: (packed & 0x01) !== 0,
          transparentIndex,
          delay,
        };
        if (term !== 0) { /* 容错：部分编码器不写终止符 */ }
      } else {
        readSubBlocks();
      }
      continue;
    }
    if (block === 0x2c) {                    // image descriptor
      const left = b[p] | (b[p + 1] << 8);
      const top = b[p + 2] | (b[p + 3] << 8);
      const iw = b[p + 4] | (b[p + 5] << 8);
      const ih = b[p + 6] | (b[p + 7] << 8);
      const iflags = b[p + 8];
      p += 9;
      const lctFlag = (iflags & 0x80) !== 0;
      const interlaced = (iflags & 0x40) !== 0;
      const lctSize = 2 << (iflags & 0x07);
      let lct = null;
      if (lctFlag) { lct = readColorTable(b, p, lctSize); p += lctSize * 3; }
      const minCodeSize = b[p++];
      const data = readSubBlocks();

      const table = lct || gct || [];
      const transparentIndex = gce && gce.transparent ? gce.transparentIndex : -1;

      // 保存当前画布用于 disposal
      const before = new Uint8ClampedArray(canvas);

      let pixels = lzwDecode(minCodeSize, data, iw * ih);
      if (interlaced) pixels = deinterlace(pixels, iw);

      for (let y = 0; y < ih; y++) {
        const py = top + y;
        if (py < 0 || py >= H) continue;
        for (let x = 0; x < iw; x++) {
          const px = left + x;
          if (px < 0 || px >= W) continue;
          const ci = pixels[y * iw + x];
          if (ci === transparentIndex) continue;   // 透明像素保留底图
          const c = table[ci] || [0, 0, 0];
          const i = (py * W + px) * 4;
          canvas[i] = c[0]; canvas[i + 1] = c[1]; canvas[i + 2] = c[2]; canvas[i + 3] = 255;
        }
      }

      frames.push({
        data: new Uint8ClampedArray(canvas),
        delayMs: Math.max(20, (gce && gce.delay ? gce.delay * 10 : 100)),
      });
      if (frames.length >= maxFrames) break;

      // 处理 disposal（对下一帧生效）
      const disposal = gce ? gce.disposal : 0;
      if (disposal === 2) {
        // 还原为背景（此处用透明）
        fillRect(canvas, left, top, iw, ih, [0, 0, 0, 0]);
      } else if (disposal === 3) {
        canvas.set(prevCanvas || before);
      }
      prevCanvas = before;
      gce = null;
      continue;
    }
    // 未知块：跳过一字节，容错继续
  }

  // 读 Netscape 循环扩展（0x21 0xFF 0x0B "NETSCAPE2.0" 0x03 0x01 lo hi 0x00）。
  // 之前这里写死 loopCount: 0 —— 导致「导出时设了循环次数、读回来永远是 0」，
  // 我们自己写的编码器明明把次数写对了（已在字节级验证），却被这里掩盖。
  let loopCount = 0;
  try {
    const s = buf.toString('latin1');
    const i = s.indexOf('NETSCAPE2.0');
    if (i >= 0 && buf.length > i + 15) {
      // 结构：NETSCAPE2.0(11) + 块长(1) + 子块ID(1) + 次数(2) + 结束(1)
      const lo = buf[i + 13], hi = buf[i + 14];
      if (Number.isFinite(lo) && Number.isFinite(hi)) loopCount = lo | (hi << 8);
    }
  } catch { /* 读不到就用默认 0（无限循环） */ }

  return { width: W, height: H, frames, loopCount, bgIndex };
}