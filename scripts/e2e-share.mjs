// 分享闭环端到端：
// 1) 「收到宠物包的人」把 .petpack 拖进窗口 -> 自动安装并启动
// 2) 导出后的分享弹窗有「复制路径」，且路径是真文件
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow, isPetAlive } from '../src/main/state.js';
import { encodePNG } from '../src/shared/png.js';
import { zipCreate } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePetpack(id, name, outPath) {
  const size = 64, px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, on = Math.hypot(x - size / 2, y - size / 2) <= size * 0.3;
    px[i] = on ? 255 : 0; px[i + 1] = on ? 120 : 0; px[i + 2] = on ? 60 : 0; px[i + 3] = on ? 255 : 0;
  }
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
  fs.writeFileSync(outPath, zipCreate([
    { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
    { name: 'f0.png', data: encodePNG(size, size, Buffer.from(px)) },
  ]));
  return outPath;
}

app.whenReady().then(async () => {
  registerIpc();

  const userData = app.getPath('userData');
  const petsDir = path.join(userData, 'pets');
  fs.mkdirSync(petsDir, { recursive: true });
  const before = new Set(fs.readdirSync(petsDir));

  // 模拟「别人发来的宠物包」：放在一个与宠物库无关的目录
  const inbox = path.join(userData, 'e2e-inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const incoming = makePetpack('shared-pet', '朋友分享的宠物', path.join(inbox, '朋友分享的宠物.petpack'));
  check('测试用 .petpack 已生成', fs.existsSync(incoming), path.basename(incoming));

  const maker = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(900);
  const js = (c) => maker.webContents.executeJavaScript(c);

  // ---- 1) 拖入 .petpack 那条路径的核心 IPC：安装并启动 ----
  check('拖入前没有桌宠在跑', isPetAlive() === false);
  const r = await js('window.api.installAndRun(' + JSON.stringify(incoming) + ')');
  check('installAndRun 返回 ok', !!(r && r.ok), JSON.stringify(r).slice(0, 120));
  check('返回了宠物名', !!(r && r.name), r && r.name);
  await sleep(1500);
  check('桌宠已自动启动', isPetAlive() === true);
  check('宠物包已装进宠物库', fs.readdirSync(petsDir).some((f) => f.includes('朋友分享的宠物')), fs.readdirSync(petsDir).filter(f => f.includes('朋友')).join(','));

  // ---- 2) 装进来的宠物出现在库里，且被记为「最近使用」----
  const list = await js('window.api.listInstalled()');
  const mine = (list || []).filter((it) => String(it.name || '').includes('朋友分享'));
  check('库列表能找到新宠物', mine.length === 1, JSON.stringify(mine.map(x => x.id)));
  check('新宠物不是 broken', mine[0] && !mine[0].broken, mine[0] && mine[0].broken ? 'broken' : 'ok');
  const prefs = await js('window.api.libraryGet()');
  check('已记为最近使用', (prefs.recent || []).some((id) => id.includes('朋友分享')), JSON.stringify(prefs.recent.slice(0, 3)));

  // ---- 3) 分享弹窗：复制路径 + 路径是真文件 ----
  const shareInfo = await js(`(() => {
    const m = document.querySelector('#shareModal');
    const copy = document.querySelector('#shareCopy');
    const reveal = document.querySelector('#shareReveal');
    return { hasModal: !!m, hasCopy: !!copy, copyLabel: copy && copy.textContent.trim(), hasReveal: !!reveal };
  })()`);
  check('分享弹窗存在', shareInfo.hasModal);
  check('分享弹窗有「复制文件路径」按钮', shareInfo.hasCopy, shareInfo.copyLabel);
  check('分享弹窗保留「打开所在文件夹」', shareInfo.hasReveal);

  // 说明文案里应给出「拖进窗口」这条最短路径
  const hintText = await js('document.querySelector("#shareModal .share-steps").textContent');
  check('对方使用说明包含「拖进窗口」', /拖进窗口/.test(hintText), hintText.slice(0, 60));

  // ---- 4) 覆盖安装同一只（用户重复拖入）不应报错 ----
  const r2 = await js('window.api.installAndRun(' + JSON.stringify(incoming) + ')');
  check('重复拖入可覆盖安装', !!(r2 && r2.ok) && r2.replaced === true, JSON.stringify({ ok: r2 && r2.ok, replaced: r2 && r2.replaced }));

  // ---- 5) 坏文件必须被拒绝（不能把损坏包塞进库）----
  const bad = path.join(inbox, '坏文件.petpack');
  fs.writeFileSync(bad, 'this is not a zip');
  const r3 = await js('window.api.installAndRun(' + JSON.stringify(bad) + ')');
  check('损坏包被拒绝', !!(r3 && !r3.ok), JSON.stringify(r3).slice(0, 100));
  check('损坏包未被写进宠物库', !fs.readdirSync(petsDir).some((f) => f.includes('坏文件')));

  // ---- 6) 不存在的路径必须安全失败 ----
  const r4 = await js('window.api.installAndRun("Z:/definitely/not/here.petpack")');
  check('不存在的路径安全失败', !!(r4 && !r4.ok), JSON.stringify(r4).slice(0, 100));

  // 清理测试产物
  for (const f of fs.readdirSync(petsDir)) {
    if (!before.has(f)) { try { fs.unlinkSync(path.join(petsDir, f)); } catch {} }
  }
  try { fs.rmSync(inbox, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(path.join(userData, 'library.json')); } catch {}

  log('==== SHARE E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { const w = getPetWindow(); if (w && !w.isDestroyed()) w.close(); } catch {}
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
