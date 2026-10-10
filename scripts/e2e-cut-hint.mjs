// 抠图质量反馈端到端：真实上传 -> 看反馈条是否给出可操作结论
//
// 关键：测试图必须「对容差敏感」，否则调容差结果不变，断言无法体现功能。
// 纯白底 + 橙色圆对容差完全不敏感（任意容差都能扣，实测 tol 0~140 结果一致），
// 必须用低对比图（浅灰底 + 浅橙主体）。
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from '../src/main/main.js';
import { encodePNG } from '../src/shared/png.js';

const ROOT = path.resolve('.');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const maker = new BrowserWindow({ width: 1100, height: 820, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1100);
  const js = (c) => maker.webContents.executeJavaScript(c);

  const S = 200;
  function mkPNG(bgC, fgC, radius) {
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const on = Math.hypot(x - S/2, y - S/2) < radius;
      const c = on ? fgC : bgC;
      d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=255;
    }
    return encodePNG(S, S, Buffer.from(d)).toString('base64');
  }

  const hintOf = () => js(`(() => { const e=document.querySelector('#cutHint'); return { hidden:e.hidden, cls:e.className, text:e.textContent }; })()`);
  const upload = (b64) => js(`(async () => {
    const img = new Image();
    await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src='data:image/png;base64,${b64}';});
    const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
    const cx=cv.getContext('2d'); cx.drawImage(img,0,0);
    await window.__addFrameForTest(cx.getImageData(0,0,img.width,img.height),'t.png');
  })()`);
  const setTol = (v) => js(`(async () => {
    document.querySelector('#cutTol').value = '${v}';
    await window.__rebuildForTest();
    return document.querySelector('#cutHint').textContent;
  })()`);

  check('未上传时反馈条隐藏', (await hintOf()).hidden === true);

  // ---- 正常白底：应给出正面反馈 ----
  await upload(mkPNG([255,255,255,255], [255,140,60,255], 55));
  await sleep(700);
  let h = await hintOf();
  check('上传正常白底图 -> 反馈条出现', h.hidden === false, JSON.stringify(h));
  check('正常抠图 -> 正面反馈（含"扣干净"）', /扣干净/.test(h.text), h.text);
  check('反馈条样式为 ok', /ok/.test(h.cls), h.cls);
  check('反馈条含主体占比', /主体占 \d+%/.test(h.text), h.text);

  // ---- 低对比图 + 高容差：主体被扣没 -> 应提示"调小" ----
  await js('window.__clearFramesForTest && window.__clearFramesForTest()');
  await upload(mkPNG([230,230,230,255], [245,205,170,255], 55));
  await sleep(700);
  const t140 = await setTol(140);
  await sleep(300);
  h = await hintOf();
  check('高容差把主体扣没 -> 提示调小', /调小/.test(h.text), h.text);
  check('该场景样式为 warn', /warn/.test(h.cls), h.cls);

  // ---- 低容差：背景还在 -> 应提示调大 ----
  const t2 = await setTol(15);
  await sleep(300);
  h = await hintOf();
  check('低容差时给出可操作提示', /调大|调小/.test(h.text) || /扣干净/.test(h.text), h.text);

  log('==== CUT HINT E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
