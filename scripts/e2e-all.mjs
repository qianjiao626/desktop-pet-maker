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
  ['e2e-cut-hint.mjs', []],
  ['e2e-templates.mjs', []],
  ['e2e-pet-anim.mjs', []],
  ['e2e-pet-multi.mjs', []],
  ['e2e-pet-budget.mjs', []],
  ['e2e-segment.mjs', ['--model=silueta', '--model=isnetGeneral', '--model=isnetAnime']],
  ['e2e-autoselect.mjs', []],
  ['e2e-batch.mjs', []],
  ['e2e-corrupt-model.mjs', []],
  ['e2e-pose.mjs', []],
  ['e2e-ground.mjs', []],
  ['e2e-clips.mjs', []],
  ['e2e-undo.mjs', []],
  ['e2e-frameedit.mjs', []],
  ['e2e-filmstrip.mjs', []],
  ['e2e-bulkexport.mjs', []],
  ['e2e-gifexport.mjs', []],
  ['e2e-bulkgif.mjs', []],
  ['e2e-spritesheet.mjs', []],
  ['e2e-sharesite.mjs', []],
  ['e2e-charstudio.mjs', []],
  ['e2e-dialog.mjs', []],
  ['e2e-menu.mjs', []],
  ['e2e-groups.mjs', []],
  ['e2e-multipet.mjs', []],
  ['e2e-framereplace.mjs', []],
  ['e2e-tray.mjs', []],
  ['e2e-library-prefs.mjs', []],
  ['e2e-share.mjs', []],
  ['e2e-share-drop.mjs', []],
  ['e2e-share-page.mjs', []],
  ['e2e-library.mjs', []],
  ['e2e-pipeline.mjs', []],
  ['e2e-download.mjs', []],
  ['e2e-download-robust.mjs', []],
  ['e2e-package.mjs', []],
];

// 防假绿自检：每个套件都必须能在失败时返回非 0 退出码。
// 背景（v0.9.17 踩到）：12 个套件结尾只有 app.quit() 没有退出码，
// 于是它们 FAIL 了 e2e-all 仍报"全部通过"——前几轮的"全绿"是不可信的。
// 这段自检把"脚本有没有设置退出码"作为硬性前置条件。
{
  const fs = await import('node:fs');
  const bad = [];
  for (const [file] of suites) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
    // 认几种**正确**写法，别写太窄（曾经因为只认 fail ? 1 : 0，
    // 误判了 12 个用 app.exit(fail === 0 ? 0 : 1) 的套件）。
    const hasExitCode =
      /app\.exit\(\s*fail\s*\?\s*1\s*:\s*0\s*\)/.test(src) ||
      /app\.exit\(\s*fail\s*===\s*0\s*\?\s*0\s*:\s*1\s*\)/.test(src) ||
      /app\.exit\(\s*fail\s*\?\s*1\s*:\s*0\s*\)/.test(src) ||
      /app\.exit\(\s*[0-9]+\s*\)/.test(src) ||
      /process\.exit\(/.test(src);
    if (!hasExitCode) bad.push(file);
  }
  if (bad.length) {
    console.log('!! 防假绿自检失败：以下套件没有设置退出码，FAIL 也会被当成通过：');
    for (const f of bad) console.log('   - ' + f);
    process.exit(1);
  }
  console.log('防假绿自检通过：' + suites.length + ' 个套件都能在失败时返回非 0 退出码');
}

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