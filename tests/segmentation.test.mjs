import { ok } from './_harness.mjs';
import {
  bgraToTensor, resizeMaskBilinear, applyMaskToBgraAlpha, maskCoverage,
  minMaxNormalize, maxChannelValue, bgraToTensorLetterbox, cropMaskFromLetterbox,
  IMAGENET_MEAN, IMAGENET_STD,
} from '../src/shared/segmentation.js';

// ---------- maxChannelValue ----------
{
  const bmp = new Uint8ClampedArray([40, 40, 220, 255]);
  ok('maxChannelValue 取 BGRA 的 R', maxChannelValue(bmp) === 220, 'v=' + maxChannelValue(bmp));
}
{
  const bmp = new Uint8ClampedArray([250, 250, 250, 255]);
  ok('maxChannelValue 纯白=250', maxChannelValue(bmp) === 250);
}

// ---------- bgraToTensor ----------
// 1 像素：BGRA = [40,40,220,255] -> RGB=(220,40,40)，scaleByMax => denom=220
{
  const bmp = new Uint8ClampedArray([40, 40, 220, 255]);
  const t = bgraToTensor(bmp, 1, 1, 1, { mean: IMAGENET_MEAN, std: IMAGENET_STD, divide: 'max' });
  const norm = 220 / 220;                      // scaleByMax 后 R=1
  const expR = (norm - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
  ok('scaleByMax: R 通道 = (1-mean)/std', Math.abs(t[0] - expR) < 1e-6, t[0].toFixed(4) + ' vs ' + expR.toFixed(4));
  ok('BGRA 顺序正确(G<R)', t[1] < t[0], 'G=' + t[1].toFixed(3) + ' R=' + t[0].toFixed(3));
}
// scaleByMax=false => /255
{
  const bmp = new Uint8ClampedArray([40, 40, 220, 255]);
  const t = bgraToTensor(bmp, 1, 1, 1, { mean: [0.5, 0.5, 0.5], std: [1, 1, 1], divide: 255 });
  ok('scaleByMax=false 时按 /255', Math.abs(t[0] - (220 / 255 - 0.5)) < 1e-6, t[0].toFixed(4));
  ok('channel 数量 = 3*1*1', t.length === 3);
}
// 常量图缩放后仍一致
{
  const bmp = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { bmp[i*4] = 10; bmp[i*4+1] = 10; bmp[i*4+2] = 200; bmp[i*4+3] = 255; }
  const t = bgraToTensor(bmp, 4, 4, 2, { mean: [0, 0, 0], std: [1, 1, 1], divide: 255 });
  ok('缩放后颜色一致', Math.abs(t[0] - 200 / 255) < 1e-6, t[0].toFixed(4));
  ok('缩放后尺寸 = 3*2*2', t.length === 12);
}
// scale-by-max 与 /255 的差异（这是 isnet 塌陷的根因）
{
  const bmp = new Uint8ClampedArray([0, 0, 128, 255]); // max=128
  const a = bgraToTensor(bmp, 1, 1, 1, { mean: [0,0,0], std: [1,1,1], divide: 'max' });
  const b = bgraToTensor(bmp, 1, 1, 1, { mean: [0,0,0], std: [1,1,1], divide: 255 });
  ok('scaleByMax 放大到 1.0', Math.abs(a[0] - 1.0) < 1e-9, a[0].toFixed(3));
  ok('非 scaleByMax 按 /255 归一', Math.abs(b[0] - 128 / 255) < 1e-6, b[0].toFixed(4));
}

// ---------- minMaxNormalize ----------
{
  const r = minMaxNormalize(new Float32Array([2, 4, 6]));
  ok('minMax 归一到 0..1', Math.abs(r[0]) < 1e-9 && Math.abs(r[1] - 0.5) < 1e-9 && Math.abs(r[2] - 1) < 1e-9);
  ok('minMax 长度不变', r.length === 3);
}
{
  const r = minMaxNormalize(new Float32Array([5, 5, 5]));
  ok('常量输入不产生 NaN', [...r].every((v) => Number.isFinite(v)), [...r].join(','));
}
{
  const r = minMaxNormalize(new Float32Array(0));
  ok('空输入安全', r.length === 0);
}
{
  // 模拟 isnet 塌陷场景：极窄值域也能拉伸出来
  const r = minMaxNormalize(new Float32Array([0, 0.0059]));
  ok('窄值域可拉伸到 0..1', Math.abs(r[0]) < 1e-9 && Math.abs(r[1] - 1) < 1e-9);
}

// ---------- resizeMaskBilinear ----------
{
  const m = new Float32Array([0, 0, 0, 1]);
  const r = resizeMaskBilinear(m, 2, 2, 4, 4);
  ok('掩膜缩放尺寸正确', r.length === 16);
  ok('掩膜左上≈0', r[0] < 0.2, r[0].toFixed(3));
  ok('掩膜右下≈1', r[15] > 0.8, r[15].toFixed(3));
}
{
  const r = resizeMaskBilinear(new Float32Array([0.5, 0.5, 0.5, 0.5]), 2, 2, 3, 3);
  ok('常量掩膜缩放保持常量', [...r].every((v) => Math.abs(v - 0.5) < 1e-6));
}
ok('同尺寸缩放原样返回', resizeMaskBilinear(new Float32Array([1, 2, 3, 4]), 2, 2, 2, 2)[3] === 4);

// ---------- applyMaskToBgraAlpha ----------
{
  const bmp = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const out = applyMaskToBgraAlpha(bmp, 2, 2, new Float32Array([1, 0, 0, 0]), 2, 2, { threshold: 0.5, feather: 0.1 });
  ok('前景 alpha 保留', out[3] === 255, 'a=' + out[3]);
  ok('背景 alpha 归零', out[7] === 0 && out[11] === 0 && out[15] === 0);
  ok('RGB 不变', out[0] === 255 && out[1] === 255 && out[2] === 255);
}
{
  const out = applyMaskToBgraAlpha(new Uint8ClampedArray([10, 20, 30, 200]), 1, 1, new Float32Array([0.5]), 1, 1, { threshold: 0.5, feather: 0.5 });
  ok('阈值处半透明过渡', out[3] > 0 && out[3] < 200, 'a=' + out[3]);
}
{
  const out = applyMaskToBgraAlpha(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1, new Float32Array([0.1]), 1, 1, { threshold: 0.5, feather: 0.001 });
  ok('低于阈值完全透明', out[3] === 0);
}
{
  const out = applyMaskToBgraAlpha(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1, new Float32Array([0.1]), 1, 1, { invert: true });
  ok('invert 反转掩膜', out[3] === 255);
}
{
  const bmp = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const out = applyMaskToBgraAlpha(bmp, 4, 4, new Float32Array([1, 0, 0, 0]), 2, 2, { threshold: 0.5, feather: 0.001 });
  ok('掩膜上采样: 左上保留', out[(0 * 4 + 0) * 4 + 3] === 255);
  ok('掩膜上采样: 右下透明', out[(3 * 4 + 3) * 4 + 3] === 0);
}

// ---------- maskCoverage ----------
ok('覆盖率=0.25', Math.abs(maskCoverage(new Float32Array([1, 0, 0, 0])) - 0.25) < 1e-9);
ok('覆盖率=1', maskCoverage(new Float32Array([0.9, 0.8])) === 1);
ok('空掩膜安全', maskCoverage(new Float32Array(0)) === 0);
// ---------- letterbox ----------
{
  // 宽 2:1 的图放进 4x4 -> 内容 4x2，上下各留 1 行
  const w = 4, h = 2, size = 4;
  const bmp = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { bmp[i*4] = 0; bmp[i*4+1] = 0; bmp[i*4+2] = 255; bmp[i*4+3] = 255; }
  const { data, box } = bgraToTensorLetterbox(bmp, w, h, size, { mean: [0,0,0], std: [1,1,1] });
  ok('letterbox 尺寸 = 3*4*4', data.length === 48);
  ok('letterbox box 正确', box.w === 4 && box.h === 2 && box.x === 0 && box.y === 1, JSON.stringify(box));
  // 内容区顶部行（y=1,x=0）应为 1.0，填充区（y=0,x=0）应为 0
  ok('letterbox 内容区有值', Math.abs(data[1*size + 0] - 1.0) < 1e-6, data[1*size+0].toFixed(3));
  ok('letterbox 填充区为 0', Math.abs(data[0]) < 1e-9, data[0].toFixed(3));
}
{
  // 方形输入应无填充
  const bmp = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const { box } = bgraToTensorLetterbox(bmp, 2, 2, 2, {});
  ok('方形输入无填充', box.x === 0 && box.y === 0 && box.w === 2 && box.h === 2, JSON.stringify(box));
}

// ---------- cropMaskFromLetterbox ----------
{
  // 4x4 掩膜，内容区为中间 4x2（y=1..2）
  const size = 4;
  const mask = new Float32Array(size * size);
  for (let y = 1; y <= 2; y++) for (let x = 0; x < 4; x++) mask[y * size + x] = 1;
  const out = cropMaskFromLetterbox(mask, size, { x: 0, y: 1, w: 4, h: 2 }, 4, 2);
  ok('裁回尺寸正确', out.length === 8);
  ok('裁回内容全为 1', [...out].every((v) => Math.abs(v - 1) < 1e-6), [...out].join(','));
}
{
  const out = cropMaskFromLetterbox(new Float32Array(16), 4, { x: 0, y: 0, w: 4, h: 4 }, 2, 2);
  ok('裁回并缩放尺寸正确', out.length === 4);
}