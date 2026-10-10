// 本地跨平台打包（无需 CI）：下载目标平台的 Electron 运行时到 .electron-cache，
// 然后调用 pack.mjs 产出该平台产物，最后跑产物结构校验。
//
// 为什么需要它：
//   GitHub 的 release 下载通道可用，但 git push 被重置；本脚本让「跨平台产物」
//   不依赖 GitHub Actions 也能产出。macOS 产物必须在 macOS 上打包（Windows
//   无法创建 .app 所需符号链接、且未签名会被 Gatekeeper 拦截），脚本会明确拒绝。
//
// 用法: node scripts/pack-cross.mjs linux [x64|arm64]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.electron-cache');
const ELECTRON_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;

const platform = process.argv[2];
const arch = process.argv[3] || 'x64';

if (!platform || !['linux', 'darwin'].includes(platform)) {
  console.error('用法: node scripts/pack-cross.mjs <linux|darwin> [x64|arm64]');
  process.exit(1);
}
if (platform === 'darwin' && process.platform !== 'darwin') {
  console.error('macOS 产物必须在 macOS 上打包：');
  console.error('  - .app 内部需要符号链接，Windows 上创建符号链接需要管理员权限/开发者模式；');
  console.error('  - 未签名的 macOS 应用会被 Gatekeeper 拦截（arm64 甚至会被系统直接终止），');
  console.error('    需要 Apple Developer 证书做签名 + 公证。请用 ci/package.yml 在 macos-latest 上构建。');
  process.exit(1);
}

const zipName = `electron-v${ELECTRON_VERSION}-${platform}-${arch}.zip`;
const zipPath = path.join(CACHE, zipName);
const url = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${zipName}`;

fs.mkdirSync(CACHE, { recursive: true });
if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 10 * 1024 * 1024) {
  console.log('下载 Electron 运行时: ' + url);
  const r = spawnSync('curl', ['-L', '--fail', '--retry', '3', '--retry-delay', '2', '-o', zipPath, url], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('下载失败'); process.exit(1); }
} else {
  console.log('使用已缓存运行时: ' + zipName);
}

console.log('打包 ' + platform + ' ' + arch + ' ...');
const p = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pack.mjs'), platform, arch], { stdio: 'inherit', cwd: ROOT });
if (p.status !== 0) process.exit(p.status || 1);

console.log('校验产物结构 ...');
const v = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'e2e-package.mjs'), platform, arch], { stdio: 'inherit', cwd: ROOT });
process.exit(v.status || 0);
