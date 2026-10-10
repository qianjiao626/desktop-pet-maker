// 性格模板端到端：点模板 -> 界面控件真的变了 -> 正在跑的桌宠配置也同步
//
// 关键：不能只看"按钮亮了"。必须验证控件值（readPack 的来源）与
// 实际推给桌宠的包都变了，否则用户点了没效果。
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
  const maker = new BrowserWindow({ width: 1100, height: 860, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1200);
  const js = (c) => maker.webContents.executeJavaScript(c);

  // ---------- 1) 模板按钮已生成 ----------
  const btns = await js(`(() => [...document.querySelectorAll('#qbTemplates button[data-tpl]')].map(b => b.dataset.tpl))()`);
  check('模板按钮已生成', Array.isArray(btns) && btns.length >= 4, JSON.stringify(btns));
  check('含活泼模板', btns.includes('lively'));
  check('含安静模板', btns.includes('quiet'));

  // ---------- 2) 点模板 -> 控件值真的变了 ----------
  const before = await js(`(() => ({
    roamSpeed: document.querySelector('#roamSpeed').value,
    interval: document.querySelector('#interval').value,
    bubbleEnabled: document.querySelector('#bubbleEnabled').checked,
  }))()`);

  await js(`document.querySelector('#qbTemplates button[data-tpl="quiet"]').click()`);
  await sleep(500);
  const afterQuiet = await js(`(() => ({
    roamSpeed: document.querySelector('#roamSpeed').value,
    interval: document.querySelector('#interval').value,
    bubbleEnabled: document.querySelector('#bubbleEnabled').checked,
    roam: document.querySelector('#roam').checked,
    chkWalk: document.querySelector('#chkWalk').checked,
    chkHop: document.querySelector('#chkHop').checked,
    btnOn: [...document.querySelectorAll('#qbTemplates button')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.tpl),
  }))()`);
  check('套用后漫游速度变了', afterQuiet.roamSpeed !== before.roamSpeed, `${before.roamSpeed} -> ${afterQuiet.roamSpeed}`);
  check('静默模板：气泡被关掉', afterQuiet.bubbleEnabled === false);
  check('静默模板：不漫游', afterQuiet.roam === false);
  check('静默模板：快速条开关同步关闭', afterQuiet.chkWalk === false && afterQuiet.chkHop === false,
    `walk=${afterQuiet.chkWalk} hop=${afterQuiet.chkHop}`);
  check('按钮被高亮', afterQuiet.btnOn.includes('quiet'), JSON.stringify(afterQuiet.btnOn));

  // ---------- 3) 换模板 -> 值随之改变（不残留上一个模板）----------
  await js(`document.querySelector('#qbTemplates button[data-tpl="lively"]').click()`);
  await sleep(500);
  const afterLively = await js(`(() => ({
    roamSpeed: document.querySelector('#roamSpeed').value,
    bubbleEnabled: document.querySelector('#bubbleEnabled').checked,
    roam: document.querySelector('#roam').checked,
    chkWalk: document.querySelector('#chkWalk').checked,
    chkHop: document.querySelector('#chkHop').checked,
    btnOn: [...document.querySelectorAll('#qbTemplates button')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.tpl),
  }))()`);
  check('换模板后漫游速度又变了', afterLively.roamSpeed !== afterQuiet.roamSpeed, `${afterQuiet.roamSpeed} -> ${afterLively.roamSpeed}`);
  check('活泼模板：气泡重新打开', afterLively.bubbleEnabled === true);
  check('活泼模板：开启漫游', afterLively.roam === true);
  check('活泼模板：快速条开关同步打开', afterLively.chkWalk === true && afterLively.chkHop === true);
  check('高亮切到活泼', afterLively.btnOn.includes('lively') && !afterLively.btnOn.includes('quiet'), JSON.stringify(afterLively.btnOn));

  // ---------- 4) 用户手改参数 -> 取消高亮（不误导）----------
  await js(`(() => { const el=document.querySelector('#roamSpeed'); el.value='7'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(300);
  const afterManual = await js(`[...document.querySelectorAll('#qbTemplates button')].filter(b=>b.classList.contains('on')).length`);
  check('手改参数后不再高亮任何模板', afterManual === 0, 'n=' + afterManual);

  // ---------- 5) 桌宠在跑时，模板要真的推过去（不能只改界面）----------
  const S = 128;
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y*S+x)*4, on = Math.hypot(x-S/2,y-S/2) <= S*0.33;
    px[i]=on?255:0; px[i+1]=on?130:0; px[i+2]=on?60:0; px[i+3]=on?255:0;
  }
  const dataUrl = 'data:image/png;base64,' + encodePNG(S, S, Buffer.from(px)).toString('base64');
  const pack = {
    id: 'tpl-e2e', name: '模板测试宠', author: 'e2e',
    frames: [{ file: 'f.png', durationMs: 120 }], canvas: { width: S, height: S },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, friction: 0.985, roam: true, roamSpeed: 1, throwScale: 1 },
    bubble: { enabled: true, lines: ['嗨'], intervalSec: 20, durationSec: 3 },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: true },
  };
  const r = await js('window.api.quickEnable(' + JSON.stringify(pack) + ', [{file:"f.png",dataUrl:' + JSON.stringify(dataUrl) + ',durationMs:120}])');
  check('桌宠已启用', !!(r && r.ok), JSON.stringify(r).slice(0, 80));
  await sleep(1500);

  // 桌宠跑着时套用「静默」模板
  await js(`document.querySelector('#qbTemplates button[data-tpl="quiet"]').click()`);
  await sleep(1800);

  const pw = getPetWindow();
  check('宠物窗口仍存活（套模板没把它弄坏）', !!pw && !pw.isDestroyed());
  if (pw && !pw.isDestroyed()) {
    const d = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('宠物仍在渲染（帧已加载）', d.loadedFrames >= 1, 'frames=' + d.loadedFrames);
    check('桌宠行为开关已同步为「静默」（关掉走路/跳跃）',
      d.behavior.enabled === false || d.behavior.walkDir === 0,
      `enabled=${d.behavior.enabled} walkDir=${d.behavior.walkDir}`);
    check('看向鼠标也被关掉（静默模板）', d.behavior.lookEnabled === false, 'lookEnabled=' + d.behavior.lookEnabled);
  }

  await js('window.api.quickDisable()');
  await sleep(500);
  log('==== TEMPLATES E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
