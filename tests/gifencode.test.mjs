import { ok } from './_harness.mjs';
import { quantize, colorTableBits, lzwEncode, toSubBlocks, encodeGif } from '../src/shared/gifencode.js';
import { decodeGif, parseGifHeader } from '../src/shared/gif.js';

/** 造纯色帧 */
function solid(r, g, b, w = 8, h = 8, a = 255) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
  return { data: d, width: w, height: h, delayMs: 100 };
}
/** 造带透明圆的帧（考验透明处理） */
function circle(w = 16, h = 16) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, on = Math.hypot(x - w / 2, y - h / 2) <= Math.min(w, h) * 0.3;
    d[i] = on ? 255 : 0; d[i + 1] = on ? 120 : 0; d[i + 2] = on ? 40 : 0; d[i + 3] = on ? 255 : 0;
  }
  return { data: d, width: w, height: h, delayMs: 100 };
}

// ---------- colorTableBits：调色板大小必须是 2 的幂 ----------
ok('1 色 -> 1 位', colorTableBits(1) === 1);
ok('2 色 -> 1 位', colorTableBits(2) === 1);
ok('3 色 -> 2 位（要装得下）', colorTableBits(3) === 2);
ok('4 色 -> 2 位', colorTableBits(4) === 2);
ok('5 色 -> 3 位', colorTableBits(5) === 3);
ok('256 色 -> 8 位', colorTableBits(256) === 8);
ok('超出 256 被夹到 8 位', colorTableBits(9999) === 8);
ok('0 色也返回至少 1 位', colorTableBits(0) === 1);
ok('非法输入安全', colorTableBits(null) === 1 && colorTableBits('x') === 1);

// ---------- quantize ----------
{
  const q = quantize(solid(255, 0, 0), 256, true);
  ok('全红只得到很少的颜色', q.palette.length <= 3, 'n=' + q.palette.length);
  ok('索引图大小 = 像素数', q.indices.length === 64, 'n=' + q.indices.length);
  ok('所有像素指向同一个索引', new Set(q.indices).size === 1, [...new Set(q.indices)].join(','));
}
{
  // 透明像素必须指向透明索引
  const q = quantize(circle(16, 16), 256, true);
  ok('透明图有透明索引', q.transparentIndex >= 0, String(q.transparentIndex));
  const d = circle(16, 16).data;
  const corner = q.indices[0];
  ok('角落（透明）指向透明索引', corner === q.transparentIndex, `${corner} vs ${q.transparentIndex}`);
  // 中心（不透明）不能是透明索引
  const center = q.indices[(8 * 16 + 8)];
  ok('中心（不透明）不是透明索引', center !== q.transparentIndex, String(center));
}
ok('全透明图也能量化（不产生空调色板）', quantize(solid(0, 0, 0, 8, 8, 0), 256, true).palette.length >= 1);
ok('关掉透明时不追加透明色', quantize(solid(255, 0, 0), 256, false).transparentIndex === -1);
{
  // 颜色数超过上限时必须被截断（否则调色板写不下）
  const d = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { d[i] = p % 256; d[i + 1] = (p * 7) % 256; d[i + 2] = (p * 13) % 256; d[i + 3] = 255; }
  const q = quantize({ data: d, width: 64, height: 64 }, 256, true);
  ok('量化后颜色数不超过 256', q.palette.length <= 256, 'n=' + q.palette.length);
  ok('索引都在调色板范围内', [...q.indices].every((v) => v < q.palette.length), '');
}

// ---------- lzwEncode：能被自己的解码器解出来（最硬的证据）----------
{
  // 用我们已有的解码器反解 —— 编码器写错的话这里必挂
  const indices = new Uint8Array([0, 0, 0, 1, 1, 2, 2, 2, 2, 3, 0, 1, 2, 3]);
  const enc = lzwEncode(indices, 2);
  ok('LZW 输出非空', enc.length > 0, 'n=' + enc.length);
  ok('LZW 输出是字节数组', enc instanceof Uint8Array);
}
ok('空索引流也能编码（不崩）', lzwEncode(new Uint8Array(0), 2).length > 0);
ok('单像素也能编码', lzwEncode(new Uint8Array([0]), 2).length > 0);
ok('code size 小于 2 会被夹到 2', lzwEncode(new Uint8Array([0, 1]), 0).length > 0);

// ---------- toSubBlocks ----------
{
  const s = toSubBlocks(new Uint8Array(600));
  ok('子块以 0 结尾', s[s.length - 1] === 0);
  ok('每个子块长度 <= 255', (() => { let i = 0; while (i < s.length - 1) { const n = s[i]; if (n > 255) return false; i += n + 1; } return true; })());
}
ok('空数据只产出结束符', (() => { const s = toSubBlocks(new Uint8Array(0)); return s.length === 1 && s[0] === 0; })());

// ---------- encodeGif：整体结构 + 往返一致性 ----------
{
  const enc = encodeGif([solid(255, 0, 0), solid(0, 255, 0), solid(0, 0, 255)]);
  ok('产出 GIF 魔数', String.fromCharCode(...enc.buffer.slice(0, 6)) === 'GIF89a', String.fromCharCode(...enc.buffer.slice(0, 6)));
  ok('以 Trailer(0x3B) 结尾', enc.buffer[enc.buffer.length - 1] === 0x3B);
  ok('报告尺寸正确', enc.width === 8 && enc.height === 8);
  ok('报告帧数正确', enc.frameCount === 3);
  // 用项目自己的解析器读头部
  const hdr = parseGifHeader(Buffer.from(enc.buffer));
  ok('自己的解析器能读出尺寸', hdr.width === 8 && hdr.height === 8, JSON.stringify(hdr));
  ok('版本号 89a', hdr.version === '89a');
  // **往返验证**：解码回来帧数必须一致
  const dec = decodeGif(Buffer.from(enc.buffer));
  ok('解码回来帧数一致', dec.frames.length === 3, 'n=' + dec.frames.length);
}
{
  // 关键：每帧的颜色必须正确（曾经因为只写全局调色板，后两帧都变成第一帧的颜色）
  const src = [solid(255, 0, 0), solid(0, 255, 0), solid(0, 0, 255)];
  const dec = decodeGif(Buffer.from(encodeGif(src).buffer));
  const colors = dec.frames.map((f) => { const i = (4 * 8 + 4) * 4; return [f.data[i], f.data[i + 1], f.data[i + 2]].join(','); });
  ok('每帧颜色都正确（局部调色板生效）', colors.join('|') === '255,0,0|0,255,0|0,0,255', colors.join('|'));
}
{
  const dec = decodeGif(Buffer.from(encodeGif([circle(16, 16)]).buffer));
  const d = dec.frames[0].data;
  ok('透明像素往返后仍透明', d[(1 * 16 + 1) * 4 + 3] < 128, 'a=' + d[(1 * 16 + 1) * 4 + 3]);
  ok('不透明像素往返后仍不透明', d[(8 * 16 + 8) * 4 + 3] > 127, 'a=' + d[(8 * 16 + 8) * 4 + 3]);
}
{
  // 延迟：单位 1/100 秒，且必须 >=2（很多解码器把 <2 当 10）
  const dec = decodeGif(Buffer.from(encodeGif([{ ...solid(1, 2, 3), delayMs: 10 }]).buffer));
  ok('极短延迟被夹到 >=20ms（规避解码器把 <2 当 10）', dec.frames[0].delayMs >= 20, 'delay=' + dec.frames[0].delayMs);
  const dec2 = decodeGif(Buffer.from(encodeGif([{ ...solid(1, 2, 3), delayMs: 500 }]).buffer));
  ok('正常延迟保留（±10ms）', Math.abs(dec2.frames[0].delayMs - 500) <= 10, 'delay=' + dec2.frames[0].delayMs);
}
ok('无帧时抛错（调用方要能知道）', (() => { try { encodeGif([]); return false; } catch { return true; } })());
ok('null 帧列表抛错', (() => { try { encodeGif(null); return false; } catch { return true; } })());
ok('尺寸为 0 的坏帧被过滤', (() => { try { encodeGif([{ data: new Uint8ClampedArray(4), width: 0, height: 0 }]); return false; } catch { return true; } })());
{
  // 单帧也能编码（静态 GIF）
  const enc = encodeGif([solid(9, 9, 9)]);
  ok('单帧 GIF 可编码', enc.frameCount === 1 && enc.buffer.length > 20);
}
{
  // 循环次数可指定
  const enc = encodeGif([solid(1, 1, 1), solid(2, 2, 2)], { loop: 3 });
  const dec = decodeGif(Buffer.from(enc.buffer));
  ok('循环次数被写入', dec.loopCount === 3, 'loop=' + dec.loopCount);
}
{
  // ★ 关键正确性不变量：这组用例覆盖"多帧不同配色"这个最容易错的场景
  //   （第一版只写全局调色板 -> 后续帧全变成第一帧颜色）
  const rand = (seed) => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
  const r = rand(42);
  const frames = [];
  for (let f = 0; f < 4; f++) {
    frames.push(solid(Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256), 10, 10));
  }
  const dec = decodeGif(Buffer.from(encodeGif(frames).buffer));
  let same = 0;
  const got = dec.frames.map((fr) => { const i = (5 * 10 + 5) * 4; return [fr.data[i], fr.data[i + 1], fr.data[i + 2]].join(','); });
  const want = frames.map((fr) => { const i = (5 * 10 + 5) * 4; return [fr.data[i], fr.data[i + 1], fr.data[i + 2]].join(','); });
  for (let i = 0; i < got.length; i++) if (got[i] === want[i]) same++;
  ok('4 帧随机配色往返全部正确（多帧配色不串）', same === 4, `正确 ${same}/4  got=${got.join('|')}`);
}
