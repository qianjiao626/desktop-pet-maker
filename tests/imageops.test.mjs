import { ok } from './_harness.mjs';
import {
  estimateBackgroundColors, floodCut, colorKeyCut, keepLargestComponent,
  trimBounds, cropData, flipHorizontal, opaqueRatio, borderResidue, blurMask,
} from '../src/shared/imageops.js';

function blank(w, h, rgba = [0, 0, 0, 0]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = rgba[0]; d[i * 4 + 1] = rgba[1]; d[i * 4 + 2] = rgba[2]; d[i * 4 + 3] = rgba[3]; }
  return d;
}
function fillRect(d, w, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] ?? 255;
  }
}
const W = 64, H = 64;
const d = blank(W, H, [255, 255, 255, 255]);
fillRect(d, W, 16, 16, 47, 47, [200, 40, 40, 255]);
fillRect(d, W, 28, 28, 35, 35, [255, 255, 255, 255]);

const bgc = estimateBackgroundColors(d, W, H);
ok('背景色估计为白', bgc[0][0] > 250 && bgc[0][1] > 250 && bgc[0][2] > 250);

const flood = floodCut(d, W, H, { tol: 38, feather: 0, bgColors: bgc });
ok('漫水: 角落透明', flood.data[3] === 0);
ok('漫水: 主体内部白洞保留', flood.data[(31 * W + 31) * 4 + 3] > 200);
ok('漫水: 主体保留', flood.data[(24 * W + 24) * 4 + 3] > 200);
ok('漫水: 原图边框无残留', borderResidue(flood.data, W, H) === 0);

const ck = colorKeyCut(d, W, H, { tol: 38, feather: 0, bgColors: bgc });
ok('阈值: 内部白洞被删除', ck.data[(31 * W + 31) * 4 + 3] === 0);

const t = trimBounds(flood.data, W, H, { pad: 0 });
ok('裁边定位准确', t.x === 16 && t.y === 16 && t.w === 32 && t.h === 32, JSON.stringify(t));
const c2 = cropData(flood.data, W, H, t);
ok('裁切尺寸正确', c2.width === 32 && c2.height === 32);
const fl = flipHorizontal(c2.data, c2.width, c2.height);
ok('水平翻转', c2.data[0] === fl.data[(0 * 32 + 31) * 4]);
ok('不透明占比≈1', Math.abs(opaqueRatio(c2.data) - 1) < 0.001);

const d3 = blank(W, H, [255, 255, 255, 255]);
fillRect(d3, W, 10, 10, 30, 30, [10, 120, 220, 255]);
fillRect(d3, W, 50, 50, 54, 54, [10, 120, 220, 255]);
const cut3 = floodCut(d3, W, H, { tol: 38, feather: 0 });
const big = keepLargestComponent(cut3.data, W, H);
ok('最大连通域: 小块清除', big.data[(52 * W + 52) * 4 + 3] === 0);
ok('最大连通域: 主体保留', big.data[(20 * W + 20) * 4 + 3] > 200);

const konst = blurMask(Float32Array.from({ length: 16 }, () => 1), 4, 4, 1);
ok('blurMask 常量场保持', [...konst].every((v) => Math.abs(v - 1) < 1e-6));
const imp = new Float32Array(16); imp[5] = 1;
const bm = blurMask(imp, 4, 4, 1);
ok('blurMask 冲激衰减', bm[5] < 1 && bm[5] > 0 && [...bm].every((v) => v >= 0 && v <= 1));

const soft = floodCut(d, W, H, { tol: 38, feather: 24, bgColors: bgc });
let hasMid = false;
for (let i = 3; i < soft.data.length; i += 4) { const a = soft.data[i]; if (a > 20 && a < 235) hasMid = true; }
ok('羽化产生过渡带', hasMid);