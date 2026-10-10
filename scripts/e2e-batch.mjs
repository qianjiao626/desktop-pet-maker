// 批量处理 端到端：真实跑 AI 抠图 + 真实入库
// 验证：N 张图 -> N 只独立宠物（不是一只的 N 帧），且每只都能被宠物库读出来
import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { listModels } from '../src/main/models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 造一张有明显主体的图并落盘 */
function writeTestImage(outPath, color, size = 192) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - size / 2, y - size / 2) <= size * 0.3;
    const bg = 235;
    px[i] = on ? color[0] : bg; px[i + 1] = on ? color[1] : bg; px[i + 2] = on ? color[2] : bg; px[i + 3] = 255;
  }
  const img = nativeImage.createFromBuffer(Buffer.from(px), { width: size, height: size });
  fs.writeFileSync(outPath, img.toPNG());
}

app.whenReady().then(async () => {
  registerIpc();
  const userData = app.getPath('userData');
  const petsDir = path.join(userData, 'pets');
  fs.mkdirSync(petsDir, { recursive: true });
  const installed = listModels(userData).filter((m) => m.installed);
  check('至少有一个 AI 模型已下载', installed.length >= 1, 'n=' + installed.length);
  if (!installed.length) { log('==== BATCH E2E: ' + pass + '/' + (pass + fail) + ' (缺模型跳过) ===='); return app.exit(fail ? 1 : 0); }

  // 造 4 张图（互不相干），放在与宠物库无关的目录
  const inbox = path.join(userData, 'e2e-batch-inbox');
  fs.rmSync(inbox, { recursive: true, force: true });
  fs.mkdirSync(inbox, { recursive: true });
  const files = [];
  const colors = [[220, 60, 60], [60, 200, 90], [70, 110, 230], [240, 180, 50]];
  for (let i = 0; i < 4; i++) {
    const p = path.join(inbox, '宠物素材_' + (i + 1) + '.png');
    writeTestImage(p, colors[i]);
    files.push(p);
  }
  check('已生成 4 张测试图', files.every((f) => fs.existsSync(f)));

  const maker = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1000);
  const js = (c) => maker.webContents.executeJavaScript(c);

  // 界面：批量入口存在
  check('「批量做宠物」按钮存在', await js(`!!document.querySelector('#btnBatch')`));
  check('批量进度面板默认隐藏', await js(`document.querySelector('#batchPanel').hidden === true`));

  const before = fs.readdirSync(petsDir).filter((f) => /\.petpack$/i.test(f));

  // 真跑批量（走真实 IPC）
  const tpl = { render: { scale: 0.3 }, physics: { roam: true, roamSpeed: 1, gravity: 1.2, bounce: 0.55, friction: 0.985, throwScale: 1 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    bubble: { enabled: true, lines: ['你好'], intervalSec: 20, durationSec: 3 },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: true } };
  const r = await js(`window.api.batchRun(${JSON.stringify(files)}, ${JSON.stringify(tpl)}, true, 0.5, 0.12)`);
  check('批量任务返回成功', !!(r && r.ok), JSON.stringify(r && r.errors || '').slice(0, 120));
  if (r && r.ok) {
    check('4 张图全部成功', r.summary.ok === 4, JSON.stringify(r.summary));
    check('没有失败项', r.summary.failed === 0, JSON.stringify(r.summary.failures || []));
    check('每只都有独立的宠物包文件名', new Set(r.results.map((x) => x.id)).size === 4, r.results.map((x) => x.id).join(','));
  }

  // 关键：库里真的多了 4 只（而不是 1 只 4 帧）
  const after = fs.readdirSync(petsDir).filter((f) => /\.petpack$/i.test(f));
  const added = after.filter((f) => !before.includes(f));
  check('宠物库新增 4 个宠物包（每张图一只）', added.length === 4, 'added=' + added.join(','));

  // 用宠物库接口读回来，验证每只都是可用的单帧宠物
  const listed = await js(`window.api.listInstalled()`);
  const mine = (listed || []).filter((x) => added.includes(x.id));
  check('新增的 4 只都能被宠物库读出', mine.length === 4, 'n=' + mine.length);
  check('每只都是单帧（不是同一只的 4 帧）', mine.every((x) => x.frames === 1), mine.map((x) => x.frames).join(','));
  check('每只都有缩略图', mine.every((x) => typeof x.thumb === 'string' && x.thumb.startsWith('data:image/png')));
  check('每只名字来自文件名', mine.some((x) => x.name.includes('宠物素材')), mine.map((x) => x.name).join(' | '));
  check('每只都不是损坏状态', mine.every((x) => !x.broken));

  // 清理：只删本次新增的，不动用户的库
  for (const a of added) { try { fs.unlinkSync(path.join(petsDir, a)); } catch {} }
  check('清理完成（未动原有宠物）', fs.readdirSync(petsDir).filter((f) => /\.petpack$/i.test(f)).length === before.length);

  log('==== BATCH E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
