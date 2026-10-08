// ONNX 抠图会话（主进程）：懒加载模型，输入 BGRA 位图，输出 BGRA 位图
import fs from 'node:fs';
import { nativeImage } from 'electron';
import { bgraToTensor, bgraToTensorLetterbox, cropMaskFromLetterbox, resizeMaskBilinear, applyMaskToBgraAlpha, maskCoverage, minMaxNormalize } from '../shared/segmentation.js';
import { MODELS, modelPath, isInstalled } from './models.js';

let ort = null;
const sessions = new Map();   // id -> InferenceSession

async function loadOrt() {
  if (!ort) ort = await import('onnxruntime-node');
  return ort.default || ort;
}

export async function getSession(userDataDir, id) {
  if (sessions.has(id)) return sessions.get(id);
  if (!isInstalled(userDataDir, id)) throw new Error('模型未下载：' + (MODELS[id] ? MODELS[id].name : id));
  const o = await loadOrt();
  const sess = await o.InferenceSession.create(modelPath(userDataDir, id), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  sessions.set(id, sess);
  return sess;
}

export function unloadSession(id) { sessions.delete(id); }

/** 解码 dataURL 图片 -> { bgra, width, height } */
export function decodeToBgra(dataUrl) {
  const m = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl || '');
  if (!m) throw new Error('图片数据无效');
  const buf = Buffer.from(m[1], 'base64');
  const img = nativeImage.createFromBuffer(buf);
  const size = img.getSize();
  if (!size.width || !size.height) throw new Error('图片解码失败');
  return { bgra: img.toBitmap(), width: size.width, height: size.height };
}

function encodeBgraToDataUrl(bgra, w, h) {
  const img = nativeImage.createFromBuffer(Buffer.from(bgra), { width: w, height: h });
  return img.toPNG().toString('base64');
}

/**
 * 抠图：输入 dataURL，输出带 alpha 的 PNG dataURL
 * @returns { ok, dataUrl, width, height, coverage, ms }
 */
export async function segmentImage(userDataDir, id, dataUrl, { threshold = 0.5, feather = 0.12 } = {}) {
  const t0 = Date.now();
  const sess = await getSession(userDataDir, id);
  const size = MODELS[id].size;
  const preprocess = MODELS[id].preprocess || 'resize';

  const { bgra, width, height } = decodeToBgra(dataUrl);
  // 复刻 rembg：按图像最大值缩放 + 每模型 mean/std
  let tensor, lbBox = null;
  if (preprocess === 'letterbox') {
    const r = bgraToTensorLetterbox(bgra, width, height, size, {
      mean: MODELS[id].mean, std: MODELS[id].std, divide: MODELS[id].divide,
    });
    tensor = r.data; lbBox = r.box;
  } else {
    tensor = bgraToTensor(bgra, width, height, size, {
      mean: MODELS[id].mean, std: MODELS[id].std, divide: MODELS[id].divide,
    });
  }
  const o = await loadOrt();
  const inName = sess.inputNames[0];
  const outName = sess.outputNames[0];
  const input = new o.Tensor('float32', tensor, [1, 3, size, size]);
  const out = await sess.run({ [inName]: input });
  const raw = out[outName];
  const dims = raw.dims;               // [1,1,H,W]
  const mh = dims[dims.length - 2], mw = dims[dims.length - 1];

  // rembg 后处理：min-max 归一化（否则 isnet 系原始输出并非 0..1 概率）
  const mask = minMaxNormalize(raw.data);

  const resized = lbBox
    ? cropMaskFromLetterbox(mask, mw, lbBox, width, height)
    : resizeMaskBilinear(mask, mw, mh, width, height);
  const outBgra = applyMaskToBgraAlpha(bgra, width, height, resized, width, height, { threshold, feather });
  const coverage = maskCoverage(resized, threshold);

  return {
    ok: true,
    dataUrl: 'data:image/png;base64,' + encodeBgraToDataUrl(outBgra, width, height),
    width, height, coverage, ms: Date.now() - t0,
  };
}