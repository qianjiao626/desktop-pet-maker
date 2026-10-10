// ONNX 抠图会话（主进程）：懒加载模型，输入 BGRA 位图，输出 BGRA 位图
import fs from 'node:fs';
import { nativeImage } from 'electron';
import { bgraToTensor, bgraToTensorLetterbox, cropMaskFromLetterbox, resizeMaskBilinear, applyMaskToBgraAlpha, maskCoverage, minMaxNormalize } from '../shared/segmentation.js';
import { MODELS, modelPath, isInstalled, isCorrupt } from './models.js';
import { pickBest, decideChoice, shouldStopEarly, orderBySpeed } from '../shared/autoselect.js';

let ort = null;
const sessions = new Map();   // id -> InferenceSession

async function loadOrt() {
  if (!ort) ort = await import('onnxruntime-node');
  return ort.default || ort;
}

export async function getSession(userDataDir, id) {
  if (sessions.has(id)) return sessions.get(id);
  if (!isInstalled(userDataDir, id)) {
    // 区分「没下载」和「下了一半」——后者要引导用户重新下载，而不是让他去下载
    if (isCorrupt(userDataDir, id)) {
      throw new Error('模型文件不完整（下载可能中断过），请在「抠图」面板点「重新下载」：' + (MODELS[id] ? MODELS[id].name : id));
    }
    throw new Error('模型未下载：' + (MODELS[id] ? MODELS[id].name : id));
  }
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
/**
 * 单模型抠图：走 runModel，保持与自动模式完全一致的数值路径。
 * 注意：以前这里有一份和 runModel 重复的实现，改一处忘另一处迟早漂移，已合并。
 */
/**
 * 内部：跑单个模型，返回掩膜 + 最终结果（单模型与自动选优共用同一条数值路径）。
 * @returns { ok, mask, mw, mh, dataUrl, width, height, coverage, ms }
 */
async function runModel(userDataDir, id, dataUrl, { threshold = 0.5, feather = 0.12 } = {}) {
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
    mask: resized, mw: width, mh: height,   // 已缩放到原图尺寸，供质量评估
    dataUrl: 'data:image/png;base64,' + encodeBgraToDataUrl(outBgra, width, height),
    width, height, coverage, ms: Date.now() - t0,
  };
}

/**
 * 自动模式：**把所有已下载的模型都跑一遍**，用客观质量分数选最好的一个。
 * 用户明确要求「精确率优先」，所以不做「先跑快的、不够好再升级」的启发式 ——
 * 那种做法里「够不够好」的判据会依赖先跑了哪个模型，容易出现偶然性。
 *
 * @param {object} opt { threshold, feather, ids?, hintId?, onProgress? }
 * @returns { ok, dataUrl, width, height, coverage, ms, modelId, ranked, reason, runnerUp, tried, failures }
 */
export async function segmentAuto(userDataDir, _unused, dataUrl, opt = {}) {
  const { threshold = 0.5, feather = 0.12, hintId = null, onProgress = null, alwaysFull = false } = opt;
  const all = (Array.isArray(opt.ids) && opt.ids.length ? opt.ids : Object.keys(MODELS))
    .filter((x) => MODELS[x] && isInstalled(userDataDir, x));
  if (!all.length) throw new Error('没有已下载的模型，请先下载至少一个模型');
  // 提前收手模式必须「先快后慢」才有意义；总是全跑则保持用户给的原顺序
  const ids = alwaysFull ? all : orderBySpeed(all, (id) => MODELS[id] && MODELS[id].size);

  const t0 = Date.now();
  const results = [];
  const failures = [];
  let stopReason = '';
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (onProgress) { try { onProgress({ phase: 'run', id, index: i + 1, total: ids.length }); } catch {} }
    try {
      const r = await runModel(userDataDir, id, dataUrl, { threshold, feather });
      results.push({ id, mask: r.mask, w: r.mw, h: r.mh, dataUrl: r.dataUrl, width: r.width, height: r.height, coverage: r.coverage, ms: r.ms });
    } catch (err) {
      failures.push({ id, error: String((err && err.message) || err) });
    }
    // 够好了就收手：把已经跑过的结果算一次分，避免为小数点后第三位多花 1 秒
    if (results.length) {
      const partial = pickBest(results, threshold).ranked;
      const d = shouldStopEarly(partial, results.length, ids.length, { alwaysFull });
      if (d.stop && results.length < ids.length) { stopReason = d.reason; break; }
    }
  }
  if (!results.length) {
    throw new Error('所有模型都失败了：' + failures.map((f) => f.id + ' -> ' + f.error).join('；'));
  }

  const { ranked } = pickBest(results, threshold);
  const choice = decideChoice(ranked, hintId);
  const winner = results.find((r) => r.id === choice.id) || results[0];
  const winnerRank = ranked.find((r) => r.id === winner.id) || ranked[0];

  return {
    ok: true,
    dataUrl: winner.dataUrl,
    width: winner.width, height: winner.height, coverage: winner.coverage,
    ms: Date.now() - t0,
    modelId: winner.id,
    ranked,
    reason: choice.reason,
    stopReason,
    score: winnerRank ? winnerRank.score : null,
    runnerUp: ranked[1] || null,
    // tried 必须是**实际跑过的**模型，不是候选列表：提前收手时两者不同，
    // 界面要据此告诉用户「我试了哪几个、为什么停」。
    tried: [...results.map((x) => x.id), ...failures.map((x) => x.id)],
    planned: ids,
    failures,
  };
}
export async function segmentImage(userDataDir, id, dataUrl, { threshold = 0.5, feather = 0.12 } = {}) {
  const r = await runModel(userDataDir, id, dataUrl, { threshold, feather });
  return {
    ok: true,
    dataUrl: r.dataUrl,
    width: r.width, height: r.height, coverage: r.coverage, ms: r.ms,
  };
}