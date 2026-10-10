// 打包为免安装目录（含 Electron 运行时，自动裁剪冗余）
// 用法: node scripts/pack.mjs [platform] [arch]
import packager from '@electron/packager';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || 'x64';
const KEEP_LOCALES = ['zh-CN', 'en-US'];   // 其余语言包裁剪

// 找出已缓存的 Electron 运行时 zip，避免弱网下重新下载。
// 必须按「平台 + 架构」精确匹配：多平台产物并存时（本地跨平台打包），
// 只挑第一个 zip 会把 win32 的运行时喂给 linux 构建，直接打包失败。
function findCachedZip(platform, arch) {
  const roots = [
    path.join(ROOT, '.electron-cache'),          // 本项目自建缓存（跨平台打包用）
    path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron'),
  ].filter(Boolean);
  const exact = new RegExp('^electron-v.+\\-' + platform + '\\-' + arch + '\\.zip$');
  let fallback = null;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry);
      let st; try { st = fs.statSync(dir); } catch { continue; }
      if (st.isDirectory()) {
        for (const zip of fs.readdirSync(dir)) {
          if (!zip.startsWith('electron-v') || !zip.endsWith('.zip')) continue;
          if (exact.test(zip)) return path.join(dir, zip);
          if (!fallback) fallback = path.join(dir, zip);
        }
      } else if (entry.startsWith('electron-v') && entry.endsWith('.zip')) {
        // .electron-cache 里的 zip 是直接平铺的，不在子目录
        if (exact.test(entry)) return dir;
        if (!fallback) fallback = dir;
      }
    }
  }
  return fallback;
}

const cached = findCachedZip(platform, arch);
const opts = {
  dir: ROOT,
  name: 'desktop-pet-maker',
  platform, arch,
  out: path.join(ROOT, 'dist'),
  overwrite: true,
  prune: true,
  // 原生模块及其配套动态库必须解包到 app.asar.unpacked：
  // 只解包 .node 不够——onnxruntime_binding.node 还需要同目录的 onnxruntime.dll。
  // 若留在 asar 内，加载器会回退到系统 PATH，命中 Windows 自带的
  // C:\Windows\System32\onnxruntime.dll (1.17.1)，与本包 1.30.0 绑定不兼容。
  // 必须解包整个 onnxruntime bin 目录，而不是只匹配 *.so/*.dylib：
  // Linux/mac 的动态库带版本后缀（libonnxruntime.so.1 / libonnxruntime.1.dylib），
  // 用 '*.so' 这类模式匹配不到，会被留在 asar 内 → 原生绑定在真实文件系统里
  // 找不到配套动态库，AI 抠图直接加载失败（Windows 的 onnxruntime.dll 无版本后缀，
  // 所以这个 bug 在 Windows 上一直没暴露）。
  // 解包后下面的裁剪步骤仍会删掉非目标平台目录，体积不受影响。
  asar: { unpack: '**/node_modules/onnxruntime-node/bin/**' },
  // 注意：examples/ 必须随包分发——内置宠物（.petpack）就放在那里；
  // 早期版本误把 examples 整个排除，导致打包后宠物库是空的（已修）。
  ignore: [/^\/(dist|models|tests|scripts|\.git|\.electron-cache)($|\/)/],
};
if (cached) {
  const stage = path.join(ROOT, '.electron-cache');
  fs.mkdirSync(stage, { recursive: true });
  const target = path.join(stage, path.basename(cached));
  if (!fs.existsSync(target)) fs.copyFileSync(cached, target);
  opts.electronZipDir = stage;
  console.log('使用本地缓存: ' + target);
}

let out = null, lastErr = null;
for (let attempt = 1; attempt <= 4 && !out; attempt++) {
  try { out = await packager(opts); }
  catch (e) { lastErr = e; console.error('尝试 ' + attempt + ' 失败: ' + String(e.message).split('\\n')[0]); await new Promise((r) => setTimeout(r, 4000)); }
}
if (!out) { console.error('打包失败: ' + (lastErr && lastErr.message)); process.exit(1); }

const dir = out[0];
console.log('PACKAGED ' + dir);

// ---- 裁剪：非目标平台的原生二进制 ----
function dirSize(p) {
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    n += e.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return n;
}
const before = dirSize(dir);
let saved = 0;

// 1) onnxruntime 只保留目标平台/架构
const ortBin = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
if (fs.existsSync(ortBin)) {
  for (const plat of fs.readdirSync(ortBin)) {
    const pd = path.join(ortBin, plat);
    if (plat !== platform) { saved += dirSize(pd); fs.rmSync(pd, { recursive: true, force: true }); continue; }
    for (const a of fs.readdirSync(pd)) {
      if (a !== arch) { const ad = path.join(pd, a); saved += dirSize(ad); fs.rmSync(ad, { recursive: true, force: true }); }
    }
  }
}

// 1b) 裁掉 GPU 加速相关的大文件（DirectML / dxcompiler / dxil，合计约 36MB）
//    依据：src/main/segment.js 显式使用 executionProviders: ['cpu']，
//    这三者是 DirectML/GPU 执行后端才需要的，本工具纯 CPU 推理用不到。
//    裁剪后仍会跑 selftest 验证模型可推理（见 README 的打包校验流程）。
const GPU_ONLY = ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll'];
{
  const ortRoot = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node');
  if (fs.existsSync(ortRoot)) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (GPU_ONLY.includes(e.name)) {
          const sz = fs.statSync(full).size;
          fs.rmSync(full, { force: true });
          saved += sz;
          console.log('  裁剪 GPU 组件: ' + path.relative(dir, full) + '  ' + (sz / 1048576).toFixed(1) + 'MB');
        }
      }
    };
    walk(ortRoot);
  }
}

// 1c) Electron 自带的 dxcompiler.dll / dxil.dll（DirectX 着色器编译器，共约 26MB）
//    这两把文件原先一直被打进产物 —— 之前的 GPU 裁剪只扫了 onnxruntime-node 目录，
//    而它们其实躺在**应用根目录**（Electron 发行包自带），所以一直漏网。
//    依据：src/main/segment.js 显式使用 executionProviders: ['cpu']，
//    应用任何地方都不引用 dxcompiler/dxil/DirectML，纯 CPU 推理用不到它们。
//    实测：删掉后 --selftest-ai 仍然 PASS（onnxruntime OK + segment ok）。
{
  const GPU_AT_ROOT = ['dxcompiler.dll', 'dxil.dll', 'DirectML.dll'];
  for (const n of GPU_AT_ROOT) {
    const full = path.join(dir, n);
    if (!fs.existsSync(full)) continue;
    try {
      const sz = fs.statSync(full).size;
      fs.rmSync(full, { force: true });
      saved += sz;
      console.log('  裁剪根目录 GPU 组件: ' + n + '  ' + (sz / 1048576).toFixed(1) + 'MB');
    } catch (err) {
      console.warn('  裁剪根目录 GPU 组件失败: ' + n + ' -> ' + (err && err.message));
    }
  }
}

// 2) Electron 语言包只留常用
const loc = path.join(dir, 'locales');
if (fs.existsSync(loc)) {
  for (const f of fs.readdirSync(loc)) {
    const base = f.replace(/\.pak$/, '');
    if (!KEEP_LOCALES.includes(base)) { saved += fs.statSync(path.join(loc, f)).size; fs.rmSync(path.join(loc, f), { force: true }); }
  }
}

const after = dirSize(dir);
console.log('SIZE before=' + (before / 1048576).toFixed(1) + 'MB after=' + (after / 1048576).toFixed(1) + 'MB saved=' + (saved / 1048576).toFixed(1) + 'MB');
const exeName = platform === 'win32' ? 'desktop-pet-maker.exe' : 'desktop-pet-maker';
console.log('EXE_EXISTS ' + fs.existsSync(path.join(dir, exeName)));