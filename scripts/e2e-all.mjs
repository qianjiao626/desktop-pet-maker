// 顺序执行全部 e2e（各自单独进程，避免 Electron 多实例干扰）
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const suites = [
  ['e2e-quick.mjs', []],
  ['e2e-ui.mjs', []],
  ['e2e-pet.mjs', []],
  ['e2e-hop.mjs', []],
  ['e2e-sleep-look.mjs', []],
  ['e2e-struggle.mjs', []],
  ['e2e-autocut.mjs', []],
  ['e2e-pet-anim.mjs', []],
  ['e2e-pet-multi.mjs', []],
  ['e2e-pet-budget.mjs', []],
  ['e2e-segment.mjs', ['--model=silueta', '--model=isnetGeneral', '--model=isnetAnime']],
  ['e2e-tray.mjs', []],
  ['e2e-library-prefs.mjs', []],
  ['e2e-share.mjs', []],
  ['e2e-share-drop.mjs', []],
  ['e2e-library.mjs', []],
  ['e2e-pipeline.mjs', []],
  ['e2e-download.mjs', []],
  ['e2e-download-robust.mjs', []],
  ['e2e-package.mjs', []],
];

let failed = 0;
for (const [file, args] of suites) {
  console.log('\n########## ' + file + ' ##########');
  const r = spawnSync(electron, [path.join('scripts', file), ...args], {
    cwd: ROOT, stdio: 'inherit',
    // PETMAKER_NO_LAUNCH=1：禁止真的拉起宠物子进程，否则会留下 --pet= 孤儿进程，
    // 让后续套件连不上/挂起（pet:runInstalled / pet:launch 都受此开关保护）。
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', PETMAKER_NO_LAUNCH: '1' },
  });
  if (r.status !== 0) { failed++; console.log('!! ' + file + ' 退出码 ' + r.status); }
}
console.log('\n==== e2e 汇总: ' + (suites.length - failed) + '/' + suites.length + ' 套件通过 ====');
process.exit(failed ? 1 : 0);