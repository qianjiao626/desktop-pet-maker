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

// 找出已缓存的 Electron 运行时 zip，避免弱网下重新下载
function findCachedZip() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const zip = fs.readdirSync(dir).find((n) => n.startsWith('electron-v') && n.endsWith('.zip'));
      if (zip) return path.join(dir, zip);
    }
  }
  return null;
}

const cached = findCachedZip();
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
  asar: { unpack: '**/node_modules/**/*.{node,dll,so,dylib}' },
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