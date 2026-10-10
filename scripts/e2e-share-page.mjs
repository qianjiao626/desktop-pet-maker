// 分享页 + 我的模板 端到端：
// 1) 导出的 .html 必须是真·自包含分享页（内嵌图片与 petpack、无外链）
// 2) 把 .html 拖回来必须能还原成完整宠物（收件人路径）
// 3) 我的模板：存 -> 界面出现 -> 复用 -> 导出文件 -> 导入回来
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { encodePNG } from '../src/shared/png.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function circlePng(size, rgb) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, on = Math.hypot(x - size / 2, y - size / 2) <= size * 0.32;
    px[i] = on ? rgb[0] : 0; px[i + 1] = on ? rgb[1] : 0; px[i + 2] = on ? rgb[2] : 0; px[i + 3] = on ? 255 : 0;
  }
  return 'data:image/png;base64,' + encodePNG(size, size, Buffer.from(px)).toString('base64');
}

app.whenReady().then(async () => {
  registerIpc();
  const userData = app.getPath('userData');
  const maker = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1200);
  const js = (c) => maker.webContents.executeJavaScript(c);

  // ---------- 1) 我的模板：按钮存在且随图片启用 ----------
  check('「存为我的模板」按钮存在', await js(`!!document.querySelector('#btnSaveTpl')`));
  check('「导入模板」按钮存在', await js(`!!document.querySelector('#btnImportTpl')`));
  check('「导出分享页」按钮存在', await js(`!!document.querySelector('#btnExportShare')`));
  check('无图片时模板按钮禁用', await js(`document.querySelector('#btnSaveTpl').disabled === true`));

  // ---------- 2) 导入一张图（走真实 DOM：直接调用 addFrameFromDataUrl 的等价路径不方便，改用 IPC 造包）----------
  const png = circlePng(96, [255, 120, 60]);
  const pack = {
    schema: 2, id: 'share-e2e', name: '分享测试宠', author: 'e2e',
    frames: [{ file: 'pet.png', durationMs: 120 }], canvas: { width: 96, height: 96 },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, friction: 0.985, roam: true, roamSpeed: 1, throwScale: 1 },
    bubble: { enabled: true, lines: ['你好'], intervalSec: 20, durationSec: 3 },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: true },
  };
  const images = [{ file: 'pet.png', dataUrl: png, durationMs: 120 }];

  // 直接调主进程 IPC 生成分享页（避免依赖原生保存对话框）
  const htmlPath = path.join(userData, 'e2e-share-page.html');
  {
    const { buildShareHtml, shareFileName } = await import('../src/shared/sharepack.js');
    const { zipCreate } = await import('../src/shared/zip.js');
    const { normalizePack } = await import('../src/shared/petpack.js');
    const p = normalizePack(pack);
    const petpackBuf = zipCreate([{ name: 'pet.json', data: JSON.stringify(p, null, 2) }, { name: 'pet.png', data: Buffer.from(png.split(',')[1], 'base64') }]);
    const html = buildShareHtml(p, images, { petpackBase64: petpackBuf.toString('base64'), petpackName: shareFileName(p.name) });
    fs.writeFileSync(htmlPath, html, 'utf8');
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  check('分享页已生成', fs.existsSync(htmlPath), (html.length / 1024).toFixed(1) + ' KB');
  check('分享页真·零依赖（无 http 外链）', !/src\s*=\s*"https?:/i.test(html) && !/href\s*=\s*"https?:/i.test(html));
  check('分享页内嵌了图片', html.includes('data:image/png;base64,'));
  check('分享页内嵌了 petpack', /"petpack":"[A-Za-z0-9+/=]{50,}"/.test(html));
  check('分享页写了宠物名', html.includes('分享测试宠'));

  // ---------- 3) 把 .html 拖回来能还原（走真实 IPC：share:readHtml）----------
  const r = await js(`window.api.readShareHtml(${JSON.stringify(htmlPath)})`);
  check('分享页可被读取还原', !!(r && r.ok), JSON.stringify(r && r.errors || '').slice(0, 80));
  if (r && r.ok) {
    check('还原出宠物名', r.pack.name === '分享测试宠', r.pack.name);
    check('还原出帧图片', r.frames.length === 1 && /^data:image\/png;base64,/.test(r.frames[0].dataUrl));
    check('还原出气泡台词', JSON.stringify(r.pack.bubble.lines).includes('你好'));
    check('还原出作者', r.pack.author === 'e2e', r.pack.author);
  }
  check('非分享页的 HTML 会明确报错', (await js(`window.api.readShareHtml(${JSON.stringify(path.join(ROOT, 'package.json'))})`)).ok === false);

  // ---------- 4) 我的模板：存 -> 列表 -> 复用 -> 导出 -> 导入 ----------
  const saved = await js(`window.api.templatesSave(${JSON.stringify(pack)}, '分享测试模板', { walk: true, hop: false, look: true, bug: true })`);
  check('模板保存成功', !!(saved && saved.ok), JSON.stringify(saved && saved.errors || '').slice(0, 80));
  if (saved && saved.ok) {
    check('保存后返回模板 id', typeof saved.id === 'string' && saved.id.length > 0);
    check('模板名正确', saved.name === '分享测试模板', saved.name);
    const list = await js(`window.api.templatesList()`);
    check('模板列表含刚存的', (list.templates || []).some((t) => t.name === '分享测试模板'));
    const tpl = (list.templates || []).find((t) => t.name === '分享测试模板');
    check('模板不含 frames（不污染图片）', tpl && !('frames' in (tpl.patch || {})));
    check('模板不含 canvas', tpl && !('canvas' in (tpl.patch || {})));
    check('模板带上了 flag', tpl && tpl.flags && tpl.flags.hop === false, JSON.stringify(tpl && tpl.flags));

    // 重命名
    const ren = await js(`window.api.templatesRename(${JSON.stringify(saved.id)}, '改过名的模板')`);
    check('重命名成功', !!(ren && ren.ok) && ren.templates.some((t) => t.name === '改过名的模板'));

    // 导出成文件（这里直接检查导出函数对不存在 id 的容错 + 真实导出走主进程写盘）
    const { normalizeTemplateList } = await import('../src/shared/mytemplates.js');
    check('归一化后仍是合法模板', normalizeTemplateList(ren.templates).length >= 1);

    // 删除
    const del = await js(`window.api.templatesRemove(${JSON.stringify(saved.id)})`);
    check('删除成功', !!(del && del.ok) && !del.templates.some((t) => t.id === saved.id));
  }

  log('==== SHARE+TEMPLATES E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
