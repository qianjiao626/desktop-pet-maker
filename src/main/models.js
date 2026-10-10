// AI 抠图模型管理（主进程）：元数据 / 下载 / 缓存 / 校验
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MODELS = {
  silueta: {
    id: 'silueta',
    name: '通用（快）',
    desc: 'U-2-Net 精简版，43MB，速度最快，边缘略硬',
    file: 'silueta.onnx',
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    divide: 'max',         // u2net 系：除以图像最大通道值（rembg base.normalize）
    preprocess: 'resize',  // rembg 用直接拉伸
    bytes: 44173029,
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx',
    md5: '55e59e0d8062d2f5d013f4725ee84782',
    source: 'xuebinqin/U-2-Net',
    license: 'Apache-2.0',
  },
  isnetGeneral: {
    id: 'isnetGeneral',
    name: '通用（精确）',
    desc: 'DIS 模型，边缘更细腻，适合复杂主体',
    file: 'isnet-general-use.onnx',
    size: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1.0, 1.0, 1.0],
    divide: 255,           // DIS general：标准 /255 后减 0.5
    preprocess: 'resize',  // rembg 用直接拉伸
    bytes: 178648008,
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    md5: 'fc16ebd8b0c10d971d3513d564d01e29',
    source: 'xuebinqin/DIS',
    license: 'Apache-2.0',
  },
  // 姿态估计（不是抠图模型）：用于「画个小人 → 识别身体 → 跳舞」。
  // 单独一类，listModels 里用 kind 区分，避免混进抠图的下拉框。
  poseMovenet: {
    id: 'poseMovenet',
    kind: 'pose',
    name: '姿态识别（MoveNet）',
    desc: '识别头/肩/肘/腕/髋/膝/踝共 17 个关键点，用于驱动小人跳舞',
    file: 'movenet-singlepose-lightning.onnx',
    size: 192,                 // 固定输入 192x192
    inputDtype: 'int32',       // 关键：是 int32 不是 float（实测，用错会直接报错）
    bytes: 9466715,
    url: 'https://cdn.jsdelivr.net/gh/Kazuhito00/MoveNet-Python-Example@main/onnx/movenet_singlepose_lightning_4.onnx',
    md5: '9423b6b1c38e2ffe3b5d830aa498d43e',
    source: 'tensorflow/tfjs-models (MoveNet SinglePose Lightning)',
    license: 'Apache-2.0',
  },
  isnetAnime: {
    id: 'isnetAnime',
    name: '动漫角色',
    desc: '专为二次元角色训练，桌宠/立绘首选',
    file: 'isnet-anime.onnx',
    size: 1024,
    mean: [0, 0, 0],
    std: [1, 1, 1],
    divide: 1,             // DIS anime：模型内置归一化，需传原始 0..255（实测）
    preprocess: 'letterbox', // 官方 anime-segmentation 保持宽高比填充
    bytes: 176069933,
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx',
    md5: '6f184e756bb3bd901c8849220a83e38e',
    source: 'SkyTNT/anime-segmentation',
    license: 'Apache-2.0',
  },
};

export function modelsDir(userDataDir) {
  const d = path.join(userDataDir, 'models');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function modelPath(userDataDir, id) {
  const m = MODELS[id];
  if (!m) throw new Error('未知模型: ' + id);
  return path.join(modelsDir(userDataDir), m.file);
}
/**
 * 模型是否真正可用。
 *
 * 为什么不能用「文件 > 1MB」这种粗判（曾经就是这么写的，是个真 bug）：
 * 模型是从网上分块下载的，中途断网/被墙会留下**截断的文件**。截断文件大小往往
 * 仍然远大于 1MB，于是被判为「已安装」→ 用户点 AI 抠图 →
 * InferenceSession.create() 在损坏的 protobuf 上**永久挂起**
 * （实测：2MB 垃圾文件冒充 silueta.onnx，进程卡死 90s+，连 setTimeout 都不触发，
 *  因为它在同步解析里阻塞了事件循环）。用户看到的就是「点了没反应」。
 *
 * 现在改为按注册表里的字节数校验（允许 256KB 偏差，兼容不同来源的同名模型）。
 * 没有登记字节数的模型退回原来的宽松判断。
 */
export function isInstalled(userDataDir, id) {
  try {
    const m = MODELS[id];
    const p = modelPath(userDataDir, id);
    if (!fs.existsSync(p)) return false;
    const size = fs.statSync(p).size;
    if (!m || !m.bytes) return size > 1024 * 1024;
    // 关键：必须接近登记的完整大小，截断的文件一律不算已安装
    return size >= m.bytes - 1024 * 256;
  } catch { return false; }
}

/** 已安装但对不上大小（多半是下载中断留下的残件）—— 用于给出可读的提示 */
export function isCorrupt(userDataDir, id) {
  try {
    const m = MODELS[id];
    const p = modelPath(userDataDir, id);
    if (!m || !m.bytes || !fs.existsSync(p)) return false;
    const size = fs.statSync(p).size;
    return size > 1024 * 1024 && size < m.bytes - 1024 * 256;
  } catch { return false; }
}
/**
 * 列出模型。**默认只列抠图模型**（kind !== 'pose'）。
 *
 * 为什么：姿态模型和抠图模型放在同一个注册表里便于统一下载/校验，
 * 但它们是两个完全不同的下拉框 —— 姿态模型出现在「AI 抠图」的模型选择里
 * 会让用户选了之后抠图直接失败。需要姿态模型时显式传 { kind: 'pose' }。
 */
export function listModels(userDataDir, opt = {}) {
  const kind = opt.kind || 'cutout';
  return Object.values(MODELS)
    .filter((m) => (m.kind || 'cutout') === kind)
    .map((m) => ({
      id: m.id, name: m.name, desc: m.desc, size: m.size, kind: m.kind || 'cutout',
      bytes: m.bytes, source: m.source, license: m.license, mean: m.mean, std: m.std, divide: m.divide, preprocess: m.preprocess, md5: m.md5,
      installed: isInstalled(userDataDir, m.id),
      corrupt: isCorrupt(userDataDir, m.id),
    }));
}

/**
 * 下载模型文件（带进度回调），写入临时文件后原子重命名
 * onProgress({ received, total, percent })
 */
/** 计算文件 MD5（用于校验模型完整性） */
function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    const st = fs.createReadStream(file);
    st.on('data', (c) => h.update(c));
    st.on('end', () => resolve(h.digest('hex')));
    st.on('error', reject);
  });
}

/**
 * 下载到文件，支持断点续传（若服务端支持 Range）
 * 返回已写入的总字节数
 */
async function fetchToFile(url, tmp, onProgress, total, signal) {
  let start = 0;
  try { start = fs.statSync(tmp).size; } catch {}
  const headers = {};
  if (start > 0) headers.Range = 'bytes=' + start + '-';

  const res = await fetch(url, { redirect: 'follow', signal, headers });
  if (!res.ok && res.status !== 206) throw new Error('下载失败 HTTP ' + res.status);

  const partial = res.status === 206;
  if (!partial && start > 0) start = 0;   // 服务端不支持 Range -> 从头来

  const file = fs.createWriteStream(tmp, { flags: partial && start > 0 ? 'a' : 'w' });
  let received = start;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      await new Promise((resolve, reject) => {
        file.write(Buffer.from(value), (e) => (e ? reject(e) : resolve()));
      });
      if (onProgress) onProgress({ received, total, percent: total ? received / total : 0 });
    }
  } finally {
    await new Promise((r) => file.end(r));
  }
  return received;
}

/**
 * 下载模型：断点续传 + 自动重试 + 尺寸/MD5 双重校验
 * MD5 取自 rembg 官方 sessions/*.py，已本地实测匹配
 */
export async function downloadModel(userDataDir, id, onProgress, signal) {
  const m = MODELS[id];
  if (!m) throw new Error('未知模型: ' + id);
  const dest = modelPath(userDataDir, id);
  if (isInstalled(userDataDir, id)) return { ok: true, path: dest, cached: true };

  const tmp = dest + '.part';
  const MAX_ATTEMPTS = 4;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await fetchToFile(m.url, tmp, onProgress, m.bytes, signal);
      const size = fs.statSync(tmp).size;

      if (m.bytes && Math.abs(size - m.bytes) > 1024 * 256) {
        try { fs.unlinkSync(tmp); } catch {}   // 清掉，避免续传到错误数据之后
        throw new Error('文件大小异常 (' + size + ' / ' + m.bytes + ')');
      }
      if (m.md5) {
        const got = await md5File(tmp);
        if (got !== m.md5) {
          try { fs.unlinkSync(tmp); } catch {}
          throw new Error('MD5 校验失败 (' + got + ')');
        }
      }
      fs.renameSync(tmp, dest);
      return { ok: true, path: dest, cached: false, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (e && e.name === 'AbortError') break;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw new Error('下载失败（已重试 ' + MAX_ATTEMPTS + ' 次）：' + (lastErr && lastErr.message));
}

export function deleteModel(userDataDir, id) {
  try { const p = modelPath(userDataDir, id); if (fs.existsSync(p)) fs.unlinkSync(p); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}