// 「被拎起来会挣扎」端到端（真实 Electron + 真实渲染姿态）
//
// 关键：不看代码分支，而是采样 __petDebug().pose，确认拖动时姿态真的在摆动，
// 并且「甩得快」比「慢慢拎」晃得更明显。
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow } from '../src/main/state.js';
import { encodePNG } from '../src/shared/png.js';

const ROOT = path.resolve('.');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const maker = new BrowserWindow({ width: 1000, height: 700, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(900);
  const js = (c) => maker.webContents.executeJavaScript(c);

  const size = 128;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, on = Math.hypot(x - size/2, y - size/2) <= size * 0.33;
    px[i] = on ? 255 : 0; px[i+1] = on ? 130 : 0; px[i+2] = on ? 60 : 0; px[i+3] = on ? 255 : 0;
  }
  const dataUrl = 'data:image/png;base64,' + encodePNG(size, size, Buffer.from(px)).toString('base64');
  const pack = {
    id: 'struggle-e2e', name: '挣扎测试', author: 'e2e',
    frames: [{ file: 'f.png', durationMs: 120 }], canvas: { width: size, height: size },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 0 },
    bubble: { enabled: false, lines: [] },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: false },
  };
  const r = await js('window.api.quickEnable(' + JSON.stringify(pack) + ', [{file:"f.png",dataUrl:' + JSON.stringify(dataUrl) + ',durationMs:120}])');
  check('宠物已启用', !!(r && r.ok), JSON.stringify(r).slice(0, 80));
  await sleep(1400);

  const pw = getPetWindow();
  check('宠物窗口存在', !!pw && !!pw && !pw.isDestroyed());
  const dbg = () => pw.webContents.executeJavaScript('window.__petDebug()');

  // ---------- 1) 未拖拽时不应处于 dragging ----------
  const idle = await dbg();
  check('未拖拽时 dragging=false', idle.behavior.dragging === false, 'dragging=' + idle.behavior.dragging);

  // ---------- 2) 进入拖拽（慢速）后姿态应当在摆动 ----------
  const okDrag = await pw.webContents.executeJavaScript('window.__forceDragForTest(0)');
  check('测试钩子可进入拖拽态', okDrag === true);

  const slowSamples = [];
  for (let i = 0; i < 40; i++) {
    const d = await dbg();
    slowSamples.push(d.pose.rot);
    await sleep(28);
  }
  const slowRange = Math.max(...slowSamples) - Math.min(...slowSamples);
  const slowDxRange = (() => {
    return slowRange; // 用 rot 范围代表摆动幅度
  })();
  check('拖拽时处于 dragging=true', (await dbg()).behavior.dragging === true);
  check('拖动时姿态在左右摆动（不是静止）', slowRange > 3, 'Δrot=' + slowRange.toFixed(2));
  check('摆动有正有负（两个方向都出现）', Math.min(...slowSamples) < -0.5 && Math.max(...slowSamples) > 0.5,
    `min=${Math.min(...slowSamples).toFixed(2)} max=${Math.max(...slowSamples).toFixed(2)}`);

  // ---------- 3) 甩得快 -> 晃得更厉害 ----------
  await pw.webContents.executeJavaScript('window.__forceDragForTest(0)');
  const fastSamples = [];
  for (let i = 0; i < 40; i++) {
    // 每一帧都刷新采样点，保持"正在快速甩动"的速度
    await pw.webContents.executeJavaScript('window.__forceDragForTest(1600)');
    const d = await dbg();
    fastSamples.push(Math.abs(d.pose.rot));
    await sleep(28);
  }
  const fastMax = Math.max(...fastSamples);
  const slowMax = Math.max(...slowSamples.map(Math.abs));
  check('甩得快时晃得更明显', fastMax > slowMax + 0.3, `fast=${fastMax.toFixed(2)} > slow=${slowMax.toFixed(2)}`);

  // ---------- 4) 幅度受控（不能甩到变形） ----------
  check('摆动幅度受控（不超 11°）', fastMax <= 11.5, 'max=' + fastMax.toFixed(2));

  // ---------- 5) 被拎起来略微拉长 ----------
  await pw.webContents.executeJavaScript('window.__forceDragForTest(0)');
  await sleep(60);
  const lift = await dbg();
  check('拖拽时略微拉长（scaleY > 1）', lift.pose.scaleY > 1.0, 'sy=' + lift.pose.scaleY.toFixed(3));
  check('拉长时保持体积感（scaleX < 1）', lift.pose.scaleX < 1.0, 'sx=' + lift.pose.scaleX.toFixed(3));

  // ---------- 6) 松开后回到正常姿态 ----------
  await pw.webContents.executeJavaScript('window.__endDragForTest()');
  await sleep(500);
  const after = await dbg();
  check('松开后 dragging=false', after.behavior.dragging === false);
  check('松开后姿态回到接近正常（|rot| < 6）', Math.abs(after.pose.rot) < 6, 'rot=' + after.pose.rot.toFixed(2));

  await js('window.api.quickDisable()');
  await sleep(600);
  log('==== STRUGGLE E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
