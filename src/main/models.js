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
export function isInstalled(userDataDir, id) {
  try { const p = modelPath(userDataDir, id); return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024; }
  catch { return false; }
}
export function listModels(userDataDir) {
  return Object.values(MODELS).map((m) => ({
    id: m.id, name: m.name, desc: m.desc, size: m.size,
    bytes: m.bytes, source: m.source, license: m.license, mean: m.mean, std: m.std, divide: m.divide, preprocess: m.preprocess, md5: m.md5,
    installed: isInstalled(userDataDir, m.id),
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