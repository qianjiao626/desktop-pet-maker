// 宠物库全流程（真实 UI 驱动）：安装 -> 列表 -> 启动 -> 重复安装覆盖 -> 删除
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { zipCreate } from '../src/shared/zip.js';
import { encodePNG } from '../src/shared/png.js';
import { normalizePack } from '../src/shared/petpack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function synth(size, rgb) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (Math.hypot(x - c, y - c) <= r) { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; }
  }
  return px;
}

function makePackFile(name, rgb, frames = 2, packName) {
  const SIZE = 128;
  const files = [];
  for (let i = 0; i < frames; i++) {
    files.push({ name: `frame_${String(i).padStart(3, '0')}.png`, data: encodePNG(SIZE, SIZE, Buffer.from(synth(SIZE, rgb))) });
  }
  const pack = normalizePack({
    id: 'lib-' + name, name: packName || name, author: 'e2e',
    frames: files.map((f, i) => ({ file: f.name, durationMs: 100 + i * 10 })),
    canvas: { width: SIZE, height: SIZE },
  });
  const p = path.join(os.tmpdir(), 'e2e-lib-' + name + '.petpack');
  fs.writeFileSync(p, zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...files, { name: 'README.txt', data: 'e2e' }]));
  return { file: p, name, frames: frames };
}

let win = null;
const js = (code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  registerIpc();

  // 清理 userData/pets，保证从干净状态开始
  const petsDir = path.join(app.getPath('userData'), 'pets');
  if (fs.existsSync(petsDir)) for (const f of fs.readdirSync(petsDir)) fs.unlinkSync(path.join(petsDir, f));

  win = new BrowserWindow({
    width: 1200, height: 860, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, offscreen: true,
    },
  });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error/i.test(String(msg))) log('  [renderer] ' + msg);
  });
  await win.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1800);
  // ---- 1. 打开宠物库（初始为空）----
  await js("document.querySelector('#btnLibrary').click()");
  await sleep(900);
  check('库弹窗已打开', await js("!document.querySelector('#libModal').hidden"));
  const emptyText = await js("document.querySelector('#libGrid').textContent");
  check('初始为空提示', /还没有已安装的宠物/.test(emptyText), emptyText.trim().slice(0, 30));

  // ---- 2. 安装两个宠物（打桩文件选择对话框）----
  const A = makePackFile('库测试A', [255, 120, 40], 3);
  const B = makePackFile('库测试B', [60, 160, 255], 2);

  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [A.file] });
  await js("document.querySelector('#btnLibInstall').click()");
  await sleep(1400);

  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [B.file] });
  await js("document.querySelector('#btnLibInstall').click()");
  await sleep(1400);

  const installed = await js("window.api.listInstalled()");
  check('已安装 2 个宠物', installed.length === 2, 'n=' + installed.length);
  const names = installed.map((x) => x.name).sort();
  check('名称正确', names.join(',') === '库测试A,库测试B', names.join(','));
  check('含缩略图 dataURL', installed.every((x) => /^data:image\/png;base64,/.test(x.thumb || '')));
  check('帧数正确', installed.find((x) => x.name === '库测试A').frames === 3, 'A frames=' + installed.find((x) => x.name === '库测试A').frames);
  check('无损坏项', installed.every((x) => !x.broken));

  // ---- 3. 列表渲染到 DOM ----
  await js("document.querySelector('#btnLibrary').click()");   // 关闭
  await sleep(200);
  await js("document.querySelector('#btnLibrary').click()");   // 重开 -> 刷新
  await sleep(1200);
  const cardCount = await js("document.querySelectorAll('#libGrid .lib-item').length");
  check('库中渲染 2 张卡片', cardCount === 2, 'n=' + cardCount);
  const hasThumb = await js("document.querySelectorAll('#libGrid .lib-item img').length");
  check('卡片含缩略图', hasThumb === 2, 'n=' + hasThumb);

  // ---- 4. 启动（PETMAKER_NO_LAUNCH=1，不真正拉子进程，只验通路）----
  await js("document.querySelectorAll('#libGrid .lib-item .acts button')[0].click()");
  await sleep(1200);
  const runStatus = await js("document.querySelector('#status').textContent");
  check('启动返回成功', /已启动/.test(runStatus), runStatus);

  // ---- 5. 重复安装应覆盖而非新增 ----
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [A.file] });
  await js("document.querySelector('#btnLibInstall').click()");
  await sleep(1400);
  const after = await js("window.api.listInstalled()");
  check('重复安装不增加数量', after.length === 2, 'n=' + after.length);

  // ---- 5b. 覆盖检测 + 原子写入 ----
  {
    // 重新安装 A：应报告 replaced=true
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [A.file] });
    const inst = await win.webContents.executeJavaScript("window.api.installPack(" + JSON.stringify(A.file) + ")");
    check("重复安装报告 replaced=true", inst.ok && inst.replaced === true, JSON.stringify(inst));

    // 首次安装新包：replaced 应为 false
    const C = makePackFile("库测试C", [120, 200, 90], 2);
    const inst2 = await win.webContents.executeJavaScript("window.api.installPack(" + JSON.stringify(C.file) + ")");
    check("新装报告 replaced=false", inst2.ok && inst2.replaced === false, JSON.stringify(inst2));

    // 包名含路径穿越/非法字符时，文件名必须被安全化（不逃出 pets 目录）
    // 真实攻击面：磁盘文件名必然合法，但包内 name 可以是恶意的
    const evilName = "../../evil" + String.fromCharCode(58) + "x";
    const E = makePackFile("evilpack", [200, 60, 200], 1, evilName);
    const inst3 = await win.webContents.executeJavaScript("window.api.installPack(" + JSON.stringify(E.file) + ")");
    check("恶意包名安装成功", inst3.ok === true, JSON.stringify(inst3));
    const outside = fs.existsSync(path.join(app.getPath("userData"), "evil_x.petpack"));
    check("未逃出 pets 目录", !outside, "检出越界文件=" + outside);
    const inDir = fs.readdirSync(petsDir).filter((f) => f.includes("evil"));
    check("已落在 pets 目录内", inDir.length > 0, inDir.join(","));

    // 无残留临时文件
    const tmps = fs.readdirSync(petsDir).filter((f) => f.includes(".tmp-install"));
    check("无残留临时文件", tmps.length === 0, tmps.join(","));

    // 清理 C / E，保持后续断言数量稳定
    for (const f of fs.readdirSync(petsDir)) {
      if (f.includes("库测试C") || f.includes("evil")) fs.unlinkSync(path.join(petsDir, f));
    }
    for (const f of [C.file, E.file]) { try { fs.unlinkSync(f); } catch {} }
  }

  // ---- 6. 删除 ----
  const delCount = await js("document.querySelectorAll('#libGrid .lib-item .acts button').length");
  check('每张卡片有两个按钮', delCount === 4, 'n=' + delCount);
  await js("document.querySelectorAll('#libGrid .lib-item .acts button')[1].click()");
  await sleep(1400);
  const afterDel = await js("window.api.listInstalled()");
  check('删除后剩 1 个', afterDel.length === 1, 'n=' + afterDel.length + ' 剩:' + afterDel.map((x) => x.name).join(','));

  // ---- 7. 打开数据目录 ----
  const dir = await js("window.api.openDataDir()");
  check('openDataDir 返回路径', dir && dir.ok && fs.existsSync(dir.path), dir && dir.path);

  // ---- 8. 损坏包应被标记 ----
  fs.writeFileSync(path.join(petsDir, 'broken.petpack'), Buffer.from('not a zip'));
  const withBroken = await js("window.api.listInstalled()");
  const broken = withBroken.find((x) => x.broken);
  check('损坏包被标记 broken', !!broken, broken ? broken.id : '未找到');

  // 清理
  for (const f of fs.readdirSync(petsDir)) { try { fs.unlinkSync(path.join(petsDir, f)); } catch {} }
  for (const p of [A.file, B.file]) { try { fs.unlinkSync(p); } catch {} }

  log('');
  log('==== LIBRARY E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });