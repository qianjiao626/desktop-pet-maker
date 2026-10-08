// 打包产物验证：结构裁剪正确 + 原生库解包正确 + 可执行
// 用法: node scripts/e2e-package.mjs [platform] [arch]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const platform = process.argv[2] || 'win32';
const arch = process.argv[3] || 'x64';
const dir = path.join(ROOT, 'dist', `desktop-pet-maker-${platform}-${arch}`);

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sizeMB = (p) => {
  let n = 0;
  const walk = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const f = path.join(x, e.name); e.isDirectory() ? walk(f) : (n += fs.statSync(f).size); } };
  if (fs.existsSync(p)) walk(p);
  return n / 1048576;
};

check('产物目录存在', fs.existsSync(dir), dir);
if (!fs.existsSync(dir)) { log('ABORT'); process.exit(1); }

const exe = path.join(dir, platform === 'win32' ? 'desktop-pet-maker.exe' : 'desktop-pet-maker');
check('可执行文件存在', fs.existsSync(exe));

const unpacked = path.join(dir, 'resources', 'app.asar.unpacked');
check('asar.unpacked 存在', fs.existsSync(unpacked));

// 原生库必须解包且只保留目标平台
const ortBin = path.join(unpacked, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
check('onnxruntime bin 已解包', fs.existsSync(ortBin));
if (fs.existsSync(ortBin)) {
  const plats = fs.readdirSync(ortBin);
  check('仅保留目标平台', plats.length === 1 && plats[0] === platform, '实际: ' + plats.join(','));
  const archDir = path.join(ortBin, platform);
  const archs = fs.readdirSync(archDir);
  check('仅保留目标架构', archs.length === 1 && archs[0] === arch, '实际: ' + archs.join(','));
  const key = platform === 'win32' ? 'onnxruntime.dll' : (platform === 'darwin' ? 'libonnxruntime.1.30.0.dylib' : 'libonnxruntime.so.1.30.0');
  const files = fs.readdirSync(path.join(archDir, archs[0]));
  check('绑定 .node 已解包', files.some((f) => f.endsWith('.node')), files.join(','));
  check('配套动态库已解包（关键）', files.some((f) => f === key), '需要 ' + key);
  // 动态库不得留在 asar 内（否则会回退到系统 PATH 命中 Windows 自带旧版）
  const asarHasDll = files.length === 0;
  check('动态库未残留在 app.asar', !asarHasDll);
}

// locales 裁剪
const loc = path.join(dir, 'locales');
const locs = fs.existsSync(loc) ? fs.readdirSync(loc) : [];
check('保留 zh-CN 语言包', locs.includes('zh-CN.pak'), locs.join(','));
check('保留 en-US 语言包', locs.includes('en-US.pak'));
check('语言包已裁剪(<=3)', locs.length > 0 && locs.length <= 3, 'n=' + locs.length);

// 冗余不得进入产物
for (const n of ['.git', 'tests', 'scripts', 'models', 'examples', '.electron-cache']) {
  check('不含 ' + n, !fs.existsSync(path.join(dir, n)));
}

const mb = sizeMB(dir);
log('  体积: ' + mb.toFixed(1) + ' MB');
check('体积已裁剪(<600MB)', mb > 100 && mb < 600, mb.toFixed(1) + 'MB');

log('');
log('==== PACKAGE E2E: ' + pass + '/' + (pass + fail) + ' ====');
process.exit(fail ? 1 : 0);