// GIF 编码（纯逻辑，可单测）。
//
// 为什么自己写：项目里 `src/vendor/gif-lzw.js` 只有**解码**（导入 GIF 用），
// 而 `omggif` 只是 devDependency（打包不带）。要导出动图必须自己编码。
//
// GIF 结构（本文件实现的范围）：
//   Header("GIF89a") + LogicalScreenDescriptor + [GlobalColorTable]
//   + 每帧: GraphicControlExtension(延迟/透明) + ImageDescriptor + LZW 数据
//   + Trailer(0x3B)
//
// 关键点（每一条都踩过或极易踩）：
//   1. GIF 是**调色板**格式，最多 256 色。必须先把 RGBA 量化成索引。
//   2. 调色板大小必须是 2 的幂（2,4,8,...,256），不是就补零。
//   3. LZW 的 code size 至少 2（即使只有 1 个颜色）。
//   4. 延迟单位是 **1/100 秒**，且很多解码器把 <2 的值当成 10 -> 要取整并夹到 >=2。
//   5. 写 LZW 数据要把 code 流按位打包成字节，且要**清位对齐**后写子块。
//   6. 透明色需要在 GraphicControlExtension 里指定 transparentIndex。

/** 中位切分量化：把 RGBA 像素降到 <= maxColors 个颜色 + 索引图 */
export function quantize(frame, maxColors = 256, transparent = true) {
  const { data, width, height } = frame;
  const n = width * height;
  // 收集不透明像素的颜色（量化到 5 位/通道，先聚类再统计，速度可控）
  const hist = new Map();
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = data[p + 3];
    if (transparent && a < 128) continue;               // 透明像素不参与调色板
    const k = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
    const e = hist.get(k);
    if (e) { e.n++; e.r += data[p]; e.g += data[p + 1]; e.b += data[p + 2]; }
    else hist.set(k, { n: 1, r: data[p], g: data[p + 1], b: data[p + 2] });
  }
  // 按出现次数取前 maxColors-1 个（留一个给透明色）
  const budget = transparent ? Math.max(1, maxColors - 1) : maxColors;
  const list = [...hist.values()].sort((a, b) => b.n - a.n).slice(0, budget);
  const palette = list.map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
  if (!palette.length) palette.push([0, 0, 0]);         // 全透明图也要有 1 个颜色
  const transparentIndex = transparent ? palette.length : -1;
  if (transparent) palette.push([0, 0, 0]);             // 透明占位色（值不重要）

  // 建索引：对每个像素找最近调色板颜色（线性查找；palette <= 256，可接受）
  const idx = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (transparent && data[p + 3] < 128) { idx[i] = transparentIndex; continue; }
    const k = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    let best = cache.get(k);
    if (best === undefined) {
      let bd = Infinity; best = 0;
      for (let c = 0; c < (transparent ? palette.length - 1 : palette.length); c++) {
        const dr = data[p] - palette[c][0], dg = data[p + 1] - palette[c][1], db = data[p + 2] - palette[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; if (d === 0) break; }
      }
      cache.set(k, best);
    }
    idx[i] = best;
  }
  return { palette, indices: idx, transparentIndex };
}

/** 调色板大小必须是 2 的幂；返回需要的位数（>=1） */
export function colorTableBits(colorCount) {
  const n = Math.max(1, Math.min(256, Math.ceil(Number(colorCount) || 1)));
  let bits = 1;
  while ((1 << bits) < n) bits++;
  return Math.min(8, bits);
}

/**
 * GIF 的 LZW 编码。
 * @param indices 每个像素的调色板索引（Uint8Array）
 * @param minCodeSize LZW 起始 code size（= 调色板位宽，最小 2）
 * @returns Uint8Array 压缩后的字节流
 */
export function lzwEncode(indices, minCodeSize) {
  const MIN = Math.max(2, Math.min(8, Number(minCodeSize) || 2));
  const clearCode = 1 << MIN;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = MIN + 1;
  const dict = new Map();

  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
  };
  const resetDict = () => {
    dict.clear();
    nextCode = eoiCode + 1;
    codeSize = MIN + 1;
  };

  emit(clearCode);
  resetDict();

  if (!indices || !indices.length) { emit(eoiCode); if (curBits > 0) out.push(cur & 0xff); return Uint8Array.from(out); }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;              // 组合键（索引 < 256，安全）
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode);
      nextCode++;
      // 字典满到当前 codeSize 上限 -> 提高 code size（解码端同样规则）
      if (nextCode - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      resetDict();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

/** 把字节流切成 GIF 子块（每块最多 255 字节，末尾 0 结束） */
export function toSubBlocks(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const n = Math.min(255, bytes.length - i);
    out.push(n, ...bytes.subarray(i, i + n));
    i += n;
  }
  out.push(0);
  return Uint8Array.from(out);
}

/** 小端 16 位写入辅助 */
function w16(arr, v) { arr.push(v & 0xff, (v >> 8) & 0xff); }

/**
 * 编码多帧 GIF。
 * @param frames [{ data: Uint8ClampedArray(RGBA), width, height, delayMs }]
 * @param opt    { loop: 0=无限 }
 * @returns { buffer: Uint8Array, width, height, frameCount }
 */
export function encodeGif(frames, opt = {}) {
  const list = Array.isArray(frames) ? frames.filter((f) => f && f.data && f.width > 0 && f.height > 0) : [];
  if (!list.length) throw new Error('没有可编码的帧');
  const W = list[0].width, H = list[0].height;
  const loop = Number.isFinite(opt.loop) ? opt.loop : 0;

  const out = [];
  // ---- Header + Logical Screen Descriptor ----
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  w16(out, W); w16(out, H);
  // 全局调色板：用第一帧的
  const first = quantize(list[0], 256, true);
  const gBits = colorTableBits(first.palette.length);
  const gSize = 1 << gBits;
  out.push(0x80 | ((gBits - 1) & 0x07) | 0x00 | 0x00);  // 有全局表 + 颜色深度
  out.push(0);   // 背景色索引
  out.push(0);   // 像素宽高比
  for (let i = 0; i < gSize; i++) {
    const c = first.palette[i] || [0, 0, 0];
    out.push(c[0], c[1], c[2]);
  }
  // ---- Netscape 循环扩展 ----
  out.push(0x21, 0xFF, 0x0B);
  for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
  out.push(0x03, 0x01); w16(out, loop); out.push(0x00);

  // ---- 每帧 ----
  for (const f of list) {
    const q = quantize(f, 256, true);
    const minCode = Math.max(2, colorTableBits(q.palette.length));
    // 延迟：单位 1/100 秒；<2 会被很多解码器当成 10，所以夹到 >=2
    const delay = Math.max(2, Math.round((Number(f.delayMs) || 100) / 10));
    // Graphic Control Extension
    out.push(0x21, 0xF9, 0x04);
    const disposal = 2;   // 2 = 恢复背景（多帧透明才正确）
    out.push((disposal << 2) | 0x01);                 // 有透明色
    w16(out, delay);
    out.push(q.transparentIndex >= 0 ? q.transparentIndex : 0);
    out.push(0);
    // Image Descriptor
    //
    // 关键：每帧都必须写**自己的局部调色板**。
    // 我第一版只用了第一帧的全局表 -> 后两帧的索引指向了第一帧的颜色，
    // 解码出来全是第一帧的画面（实测：3 帧读回中心色全是红色）。
    // GIF 允许每帧带局部表（标志位 0x80），这是多帧不同配色的正确做法。
    const lBits = colorTableBits(q.palette.length);
    const lSize = 1 << lBits;
    out.push(0x2C);
    w16(out, 0); w16(out, 0); w16(out, W); w16(out, H);
    out.push(0x80 | ((lBits - 1) & 0x07));   // 有局部表 + 表大小
    for (let i = 0; i < lSize; i++) {
      const c = q.palette[i] || [0, 0, 0];
      out.push(c[0], c[1], c[2]);
    }
    out.push(minCode);
    const lzw = lzwEncode(q.indices, minCode);
    const sub = toSubBlocks(lzw);
    for (const b of sub) out.push(b);
  }
  out.push(0x3B);   // Trailer
  return { buffer: Uint8Array.from(out), width: W, height: H, frameCount: list.length };
}
