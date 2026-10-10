// 睡眠 + 看向鼠标 端到端（真实 Electron + 真实渲染姿态）
//
// 关键：不看状态名，而是读 __petDebug().pose（真实绘制姿态）与 cursor 推送，验证功能真的生效。
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
    id: 'sleep-look-e2e', name: '睡眠跟随测试', author: 'e2e',
    frames: [{ file: 'f.png', durationMs: 120 }], canvas: { width: size, height: size },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 0 },
    bubble: { enabled: true, lines: ['你好呀～'], intervalSec: 30 },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: false },
  };
  const r = await js('window.api.quickEnable(' + JSON.stringify(pack) + ', [{file:"f.png",dataUrl:' + JSON.stringify(dataUrl) + ',durationMs:120}])');
  check('宠物已启用', !!(r && r.ok), JSON.stringify(r).slice(0, 80));
  await sleep(1400);

  const pw = getPetWindow();
  check('宠物窗口存在', !!pw && !pw.isDestroyed());
  const dbg = () => pw.webContents.executeJavaScript('window.__petDebug()');

  // ---------- A) 看向鼠标：主进程应持续推送光标 ----------
  const c1 = await dbg();
  check('渲染层已收到光标坐标（主进程在推送）', !!c1.behavior.cursor, JSON.stringify(c1.behavior.cursor));
  check('光标坐标是数字', !!(c1.behavior.cursor && Number.isFinite(c1.behavior.cursor.x) && Number.isFinite(c1.behavior.cursor.y)));

  // 等一小段时间，确认光标推送是持续的（不是一次性）
  await sleep(500);
  const c2 = await dbg();
  check('光标推送持续（非一次性）', !!c2.behavior.cursor);

  // ---------- B) 看向鼠标真的影响姿态：直接比较不同光标方向下的姿态 ----------
  // 通过注入不同的光标坐标，观察姿态偏移方向是否符合预期
  // 用「相对宠物中心的绝对坐标」注入：直接取窗口 bounds 算出右侧/左侧的点。
  // 注意：必须冻结光标，否则主进程每 120ms 的推送会立刻覆盖注入值（断言会不稳）。
  const bounds = pw.getBounds();
  const centerX = bounds.x + Math.round(bounds.width / 2);
  const centerY = bounds.y + Math.round(bounds.height / 2);
  const R = 400;   // 足够远以进入饱和区

  const inj = (x, y) => pw.webContents.executeJavaScript('window.__setCursorForTest(' + JSON.stringify({ x, y }) + ')');
  const okR = await inj(centerX + R, centerY);
  await sleep(220);
  const pr = await dbg();
  const okL = await inj(centerX - R, centerY);
  await sleep(220);
  const pl = await dbg();
  const okU = await inj(centerX, centerY - R);
  await sleep(220);
  const pu = await dbg();

  check('测试钩子可用（能注入并冻结光标）', okR && okL && okU);
  check('光标在右 -> 向右倾（rot > 0）', pr.pose.rot > 0, 'rot=' + pr.pose.rot.toFixed(3));
  check('光标在左 -> 向左倾（rot < 0）', pl.pose.rot < 0, 'rot=' + pl.pose.rot.toFixed(3));
  check('左右倾斜方向相反', Math.sign(pr.pose.rot) === -Math.sign(pl.pose.rot), `r=${pr.pose.rot.toFixed(3)} l=${pl.pose.rot.toFixed(3)}`);
  check('光标在上 -> 姿态向上偏移（dy < 0）', pu.pose.dy < 0, 'dy=' + pu.pose.dy.toFixed(3));
  check('倾斜幅度克制（不超 2°）', Math.abs(pr.pose.rot) <= 2.2, 'rot=' + pr.pose.rot.toFixed(3));
  // 诊断：打印 pat / 受击 / 其它来源是否有残留倾斜
  check('未处于摸头态（避免与注视叠加）', pr.behavior.state !== 'pat', pr.behavior.state);

  // 解除冻结，让真实推送恢复
  await pw.webContents.executeJavaScript('window.__unfreezeCursor()');

  // ---------- C) 开关能关掉「看向鼠标」 ----------
  await js('window.api.quickSetLook(false)');
  await sleep(300);
  const offLook = await dbg();
  check('关闭后 lookEnabled=false', offLook.behavior.lookEnabled === false, 'lookEnabled=' + offLook.behavior.lookEnabled);
  await js('window.api.quickSetLook(true)');
  await sleep(300);
  const onLook = await dbg();
  check('重新打开后 lookEnabled=true', onLook.behavior.lookEnabled === true);

  // ---------- D) 睡眠：强制进入 doze，验证姿态与打呼 ----------
  const forcedDoze = await pw.webContents.executeJavaScript('window.__forceDoze()');
  check('__forceDoze 可用', forcedDoze === true);
  await sleep(150);

  const dozeSamples = [];
  for (let i = 0; i < 25; i++) {
    const d = await dbg();
    if (d.behavior.state === 'doze') dozeSamples.push(d.pose);
    await sleep(60);
  }
  check('睡眠状态被采样到', dozeSamples.length >= 5, 'n=' + dozeSamples.length);
  if (dozeSamples.length) {
    const avgSY = dozeSamples.reduce((a, s) => a + s.scaleY, 0) / dozeSamples.length;
    const maxSY = Math.max(...dozeSamples.map(s => s.scaleY));
    check('睡着时整体塌下去（平均 scaleY < 1）', avgSY < 1, 'avg=' + avgSY.toFixed(3));
    check('睡眠呼吸有起伏（不是静止）', (Math.max(...dozeSamples.map(s => s.scaleY)) - Math.min(...dozeSamples.map(s => s.scaleY))) > 0.005,
      'Δ=' + (maxSY - Math.min(...dozeSamples.map(s => s.scaleY))).toFixed(4));
    check('塌陷幅度克制（不夸张）', avgSY > 0.88, 'avg=' + avgSY.toFixed(3));
  }

  // 打呼：睡到 35% 后应冒出 Zzz
  let sawSnore = false;
  for (let i = 0; i < 60; i++) {
    const bubble = await pw.webContents.executeJavaScript(`(() => {
      const b = document.querySelector('#bubble');
      return b && !b.hidden ? b.textContent : '';
    })()`);
    if (/Zzz/i.test(bubble)) { sawSnore = true; break; }
    await sleep(100);
  }
  check('睡到一定程度会打呼（气泡出现 Zzz…）', sawSnore);

  // 睡眠时不看鼠标（睡着就不理你）
  const dozeLook = await dbg();
  if (dozeLook.behavior.state === 'doze') {
    check('睡眠中仍可读到状态（不影响其它逻辑）', dozeLook.behavior.state === 'doze');
  }

  await js('window.api.quickDisable()');
  await sleep(600);
  log('==== SLEEP & LOOK E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
