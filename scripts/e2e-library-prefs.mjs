// 宠物库「收藏 / 最近使用」端到端：
// 走真实 IPC，验证持久化落盘、跨「重启」保持、删除宠物后清理幽灵记录
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';
import { getMakerWindow } from '../src/main/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();

  const userData = app.getPath('userData');
  const libFile = path.join(userData, 'library.json');
  const petsDir = path.join(userData, 'pets');
  fs.mkdirSync(petsDir, { recursive: true });

  // 造两个假宠物包，保证「删除后清理」能真实验证
  const before = new Set(fs.existsSync(petsDir) ? fs.readdirSync(petsDir) : []);
  // 必须造「真的能解析」的 petpack：残缺 JSON 会被 listInstalled 标成 broken，
  // 那样断言测到的就不是真实用户的路径了。这里复用项目自己的打包函数。
  const mkPack = (id, name) => {
    const frame = (() => {
      const size = 64, px = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4, on = Math.hypot(x - size / 2, y - size / 2) <= size * 0.3;
        px[i] = on ? 255 : 0; px[i + 1] = on ? 120 : 0; px[i + 2] = on ? 60 : 0; px[i + 3] = on ? 255 : 0;
      }
      return encodePNG(size, size, Buffer.from(px));
    })();
    const pack = normalizePack({
      id, name, author: 'e2e',
      frames: [{ file: 'f0.png', durationMs: 100 }],
      canvas: { width: 64, height: 64 },
      render: { scale: 0.3 },
      animation: { idle: 'breathe', fps: 6, click: 'bounce', hover: 'grow' },
      physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
      bubble: { enabled: false, lines: [] },
      behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: false },
    });
    const f = path.join(petsDir, id + '.petpack');
    fs.writeFileSync(f, zipCreate([
      { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
      { name: 'f0.png', data: frame },
    ]));
    return f;
  };
  const f1 = mkPack('e2e-lib-a', 'E2E测试宠A');
  const f2 = mkPack('e2e-lib-b', 'E2E测试宠B');

  const maker = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(900);
  const js = (code) => maker.webContents.executeJavaScript(code);

  // --- 1) 初始状态 ---
  let st = await js('window.api.libraryGet()');
  check('library:get 返回结构正确', st && Array.isArray(st.favorites) && Array.isArray(st.recent), JSON.stringify(st));

  // --- 2) 收藏 ---
  st = await js('window.api.libraryToggleFav("e2e-lib-a.petpack")');
  check('收藏后 favorites 含该 id', st.favorites.includes('e2e-lib-a.petpack'), JSON.stringify(st.favorites));
  check('收藏已落盘到 library.json', fs.existsSync(libFile), libFile);
  const onDisk = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  check('磁盘上的 favorites 正确', onDisk.favorites.includes('e2e-lib-a.petpack'), JSON.stringify(onDisk.favorites));

  // --- 3) 取消收藏 ---
  st = await js('window.api.libraryToggleFav("e2e-lib-a.petpack")');
  check('再次切换取消收藏', !st.favorites.includes('e2e-lib-a.petpack'), JSON.stringify(st.favorites));

  // --- 4) 最近使用（按时间倒序）---
  await js('window.api.libraryTouch("e2e-lib-a.petpack")');
  await js('window.api.libraryTouch("e2e-lib-b.petpack")');
  st = await js('window.api.libraryGet()');
  check('最近使用按时间倒序', JSON.stringify(st.recent.slice(0, 2)) === JSON.stringify(['e2e-lib-b.petpack', 'e2e-lib-a.petpack']), JSON.stringify(st.recent));

  // --- 5) 「重启」后仍然存在（重新读盘）---
  const reread = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  check('重启后最近使用仍在磁盘', JSON.stringify(reread.recent.slice(0, 2)) === JSON.stringify(['e2e-lib-b.petpack', 'e2e-lib-a.petpack']), JSON.stringify(reread.recent));

  // --- 6) 删除宠物 -> 幽灵记录被清理 ---
  const favBefore = await js('window.api.libraryToggleFav("e2e-lib-b.petpack")');
  check('删除前 b 确实在收藏里', favBefore.favorites.includes('e2e-lib-b.petpack'), JSON.stringify(favBefore.favorites));
  const recBefore = await js('window.api.libraryGet()');
  check('删除前 b 确实在最近使用里', recBefore.recent.includes('e2e-lib-b.petpack'), JSON.stringify(recBefore.recent));
  await js('window.api.uninstall("e2e-lib-b.petpack")');
  await sleep(400);
  const after = await js('window.api.libraryGet()');
  check('删除宠物后收藏被清理', !after.favorites.includes('e2e-lib-b.petpack'), JSON.stringify(after.favorites));
  check('删除宠物后最近使用被清理', !after.recent.includes('e2e-lib-b.petpack'), JSON.stringify(after.recent));
  check('该宠物包已从磁盘删除', !fs.existsSync(f2));

  // --- 7) 库里不出现已删除的宠物 ---
  const list = await js('window.api.listInstalled()');
  check('宠物列表不含已删除项', !(list || []).some((it) => it.id === 'e2e-lib-b.petpack'), JSON.stringify((list || []).map(i => i.id).slice(0, 8)));

  // --- 8) 前端过滤函数在真实页面里生效（收藏分类）---
  await js('window.api.libraryToggleFav("e2e-lib-a.petpack")');
  const shown = await js(`(async () => {
    const r = await window.api.listInstalled();
    const prefs = await window.api.libraryGet();
    const mod = await import('../shared/library.js');
    return mod.filterLibrary(r || [], { scope: 'fav' }, prefs).map(x => x.id);
  })()`);
  check('收藏分类只显示已收藏的', Array.isArray(shown) && shown.includes('e2e-lib-a.petpack') && !shown.includes('e2e-lib-b.petpack'), JSON.stringify(shown));
  check('收藏分类非空断言有效', shown.length >= 1, 'n=' + shown.length);

  // 清理测试产物
  try { fs.unlinkSync(f1); } catch {}
  try { fs.unlinkSync(libFile); } catch {}
  for (const f of fs.readdirSync(petsDir)) {
    if (!before.has(f)) { try { fs.unlinkSync(path.join(petsDir, f)); } catch {} }
  }

  log('==== LIBRARY PREFS E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
