// ---------------------------------------------------------------------------
// GIF LZW 解压 + 去隔行
//
// 移植自 gifuct-js (https://github.com/matt-way/gifuct-js)
//   Copyright (c) Matt Way — MIT License
// 原始算法：Java LZW 解压移植，作者 https://gist.github.com/devunwired/4479231
// 去隔行来自 https://github.com/shachaf/jsgif
//
// 本项目仅为保持"零打包"而内联，算法未改动。许可证见 THIRD-PARTY.md
// ---------------------------------------------------------------------------

/** GIF LZW 解码：minCodeSize + 数据子块 -> 像素索引数组 */
export function lzwDecode(minCodeSize, data, pixelCount) {
  const MAX_STACK_SIZE = 4096;
  const nullCode = -1;
  const npix = pixelCount;
  let available, clear, codeMask, codeSize, endOfInformation, inCode, oldCode;
  let bits, code, i, datum, dataSize, first, top, bi, pi;
  const dstPixels = new Array(pixelCount);
  const prefix = new Array(MAX_STACK_SIZE);
  const suffix = new Array(MAX_STACK_SIZE);
  const pixelStack = new Array(MAX_STACK_SIZE + 1);

  dataSize = minCodeSize;
  clear = 1 << dataSize;
  endOfInformation = clear + 1;
  available = clear + 2;
  oldCode = nullCode;
  codeSize = dataSize + 1;
  codeMask = (1 << codeSize) - 1;

  for (code = 0; code < clear; code++) {
    prefix[code] = 0;
    suffix[code] = code;
  }

  datum = bits = first = top = pi = bi = 0;

  for (i = 0; i < npix;) {
    if (top === 0) {
      if (bits < codeSize) {
        if (bi >= data.length) break;
        datum += data[bi] << bits;
        bits += 8;
        bi++;
        continue;
      }
      code = datum & codeMask;
      datum >>= codeSize;
      bits -= codeSize;

      if (code > available || code === endOfInformation) break;

      if (code === clear) {
        codeSize = dataSize + 1;
        codeMask = (1 << codeSize) - 1;
        available = clear + 2;
        oldCode = nullCode;
        continue;
      }

      if (oldCode === nullCode) {
        pixelStack[top++] = suffix[code];
        oldCode = code;
        first = code;
        continue;
      }

      inCode = code;
      if (code === available) {
        pixelStack[top++] = first;
        code = oldCode;
      }
      while (code > clear) {
        pixelStack[top++] = suffix[code];
        code = prefix[code];
      }
      first = suffix[code] & 0xff;
      pixelStack[top++] = first;

      if (available < MAX_STACK_SIZE) {
        prefix[available] = oldCode;
        suffix[available] = first;
        available++;
        if ((available & codeMask) === 0 && available < MAX_STACK_SIZE) {
          codeSize++;
          codeMask += available;
        }
      }
      oldCode = inCode;
    }
    top--;
    dstPixels[pi++] = pixelStack[top];
    i++;
  }

  for (i = pi; i < npix; i++) dstPixels[i] = 0;
  return dstPixels;
}

/** GIF 交错（interlaced）行序还原 */
export function deinterlace(pixels, width) {
  const newPixels = new Array(pixels.length);
  const rows = pixels.length / width;
  const cpRow = (toRow, fromRow) => {
    const fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
    newPixels.splice(toRow * width, width, ...fromPixels);
  };
  const offsets = [0, 4, 2, 1];
  const steps = [8, 8, 4, 2];
  let fromRow = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
      cpRow(toRow, fromRow);
      fromRow++;
    }
  }
  return newPixels;
}