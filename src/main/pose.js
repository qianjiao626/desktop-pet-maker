// 姿态估计推理（主进程）：MoveNet SinglePose Lightning，纯 CPU 本地推理。
//
// 为什么单独一个文件而不是塞进 segment.js：
//   抠图（segment.js）与姿态估计是两条完全不同的推理链路 ——
//   输入 dtype 不同（float vs **int32**）、后处理不同（掩膜 vs 17 个关键点）、
//   模型来源也不同。混在一起会让两边都难改。
//
// 实测数据（本机 CPU）：模型加载 133ms，单次推理 10~11ms。
// 所以在制作器里点一下「识别身体」是秒级反馈，不需要进度条。

import fs from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { parseKeypoints, clampToImage, canDance, describeKeypoints, toPixels, bodyGeometry } from '../shared/pose.js';

/** MoveNet 的固定输入边长（改这个值会直接报维度不匹配） */
export const POSE_INPUT_SIZE = 192;

let ort = null;
let poseSession = null;

async function loadOrt() {
  if (!ort) ort = await import('onnxruntime-node');
  return ort.default || ort;
}

/** 姿态模型的落盘位置（与抠图模型同一个 models 目录，便于统一管理） */
export function poseModelPath(userDataDir) {
  return path.join(userDataDir, 'models', 'movenet-singlepose-lightning.onnx');
}

export function isPoseModelInstalled(userDataDir) {
  try {
    const p = poseModelPath(userDataDir);
    if (!fs.existsSync(p)) return false;
    // 必须是完整的 9MB 左右文件；截断文件会让 ONNX 解析永久挂起（抠图那边踩过）
    return fs.statSync(p).size > 8 * 1024 * 1024;
  } catch { return false; }
}

/** 懒加载会话；拿不到模型时给出可读错误 */
export async function getPoseSession(userDataDir) {
  if (poseSession) return poseSession;
  const p = poseModelPath(userDataDir);
  if (!isPoseModelInstalled(userDataDir)) {
    throw new Error('姿态模型未安装：需要 movenet-singlepose-lightning.onnx（约 9MB）');
  }
  const o = await loadOrt();
  poseSession = await o.InferenceSession.create(p, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  return poseSession;
}

export function unloadPoseSession() { poseSession = null; }

/**
 * dataURL -> MoveNet 需要的 int32 张量数据（RGB，192x192，值域 0..255）。
 * **必须是 int32**：喂 float 会报
 *   "Unexpected input data type. Actual: (tensor(float)), expected: (tensor(int32))"。
 * nativeImage 给的是 BGRA，这里顺便换序成 RGB。
 */
export function dataUrlToPoseInput(dataUrl, size = POSE_INPUT_SIZE) {
  const m = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl || '');
  if (!m) throw new Error('图片数据无效');
  const buf = Buffer.from(m[1], 'base64');
  const img = nativeImage.createFromBuffer(buf);
  const s = img.getSize();
  if (!s.width || !s.height) throw new Error('图片解码失败');
  // 直接拉伸到正方形：MoveNet 的坐标是归一化的，拉伸后按同一比例换回即可，
  // 不引入 letterbox 的黑边（黑边会被当成图像内容影响关键点）。
  const resized = img.resize({ width: size, height: size, quality: 'good' });
  const bmp = resized.toBitmap();                 // BGRA，长度 size*size*4
  const data = new Int32Array(size * size * 3);
  for (let i = 0, j = 0; i < bmp.length; i += 4, j += 3) {
    data[j] = bmp[i + 2];       // R
    data[j + 1] = bmp[i + 1];   // G
    data[j + 2] = bmp[i];       // B
  }
  return { data, srcWidth: s.width, srcHeight: s.height };
}

/**
 * 识别一张图的人体姿态。
 * @returns { ok, keypoints, parts, canDance, reason, ms }
 */
export async function estimatePose(userDataDir, dataUrl) {
  const t0 = Date.now();
  const sess = await getPoseSession(userDataDir);
  const { data, srcWidth, srcHeight } = dataUrlToPoseInput(dataUrl, POSE_INPUT_SIZE);
  const o = await loadOrt();
  const input = new o.Tensor('int32', data, [1, POSE_INPUT_SIZE, POSE_INPUT_SIZE, 3]);
  const out = await sess.run({ [sess.inputNames[0]]: input });
  const raw = out[sess.outputNames[0]];
  // 输出 [1,1,17,3]，每个关键点 (y, x, score)
  const keypoints = clampToImage(parseKeypoints(raw.data));
  const verdict = canDance(keypoints);
  return {
    ok: true,
    keypoints,
    pixels: toPixels(keypoints, srcWidth, srcHeight),
    srcWidth, srcHeight,
    parts: verdict.parts,
    canDance: verdict.ok,
    reason: verdict.reason,
    describe: describeKeypoints(keypoints),
    geometry: bodyGeometry(keypoints),
    ms: Date.now() - t0,
  };
}
