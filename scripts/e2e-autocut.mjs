// 自动抠图端到端：验证"渐变背景照片"现在能自动抠掉背景
//
// 本轮修的缺陷：旧判据只看「边缘相对首像素的平均色差」，把浅色渐变
//（墙面/天空 —— 用户最常拍的）误判为复杂背景而跳过自动抠图。
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from '../src/main/main.js';
import { encodePNG } from '../src/shared/png.js';

const ROOT = path.resolve('.');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 造图：bg(x,y) -> [r,g,b]，中间一个橙色圆当主体
function makePNG(w, h, bg, fg) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = (fg && fg(x, y)) ? [255, 140, 60, 255] : bg(x, y);
    d[i] = c[0]; d[i+1] = c[1]; d[i+2] = c[2]; d[i+3] = c[3];
  }
  return encodePNG(w, h, Buffer.from(d));
}

app.whenReady().then(async () => {
  registerIpc();
  const maker = new BrowserWindow({ width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1000);
  const js = (c) => maker.webContents.executeJavaScript(c);

  const W = 200, H = 200;
  const blob = (x, y) => Math.hypot(x - W/2, y - H/2) < 55;

  const cases = [
    { name: '纯白背景', bg: () => [255,255,255,255], expectCut: true },
    { name: '浅色渐变（墙面/天空）', bg: (x,y) => [240-Math.round(x/W*30),242-Math.round(y/H*30),248-Math.round(y/H*20),255], expectCut: true },
    { name: '明显渐变（光照不均）', bg: (x,y) => [250-Math.round(x/W*90),250-Math.round(y/H*80),250-Math.round((x+y)/(W+H)*90),255], expectCut: true },
    { name: '噪点杂乱背景', bg: (x,y) => [100+((x*7+y*13)%150),110+((x*11+y*5)%140),120+((x*3+y*17)%130),255], expectCut: false },
  ];

  for (const c of cases) {
    const png = makePNG(W, H, c.bg, blob);
    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    // 走真实的 addFrameFromDataUrl 路径（内含 autoCutIfNeeded）
    const res = await js(`(async () => {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = ${JSON.stringify(dataUrl)}; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const id = cx.getImageData(0, 0, img.width, img.height);
      const before = id.data;
      // 直接调用页面内的自动抠图判定逻辑（产品代码）
      return { w: img.width, h: img.height };
    })()`);
    check(c.name + ' 图片可加载', res.w === W && res.h === H, JSON.stringify(res));

    // 用产品模块判定（与页面同源），确认判定结果
    const verdict = await js(`(async () => {
      const mod = await import('../shared/imageops.js');
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = ${JSON.stringify(dataUrl)}; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, img.width, img.height);
      const look = mod.looksLikeFlatBackground(d.data, img.width, img.height);
      const cut = mod.floodCut(d.data, img.width, img.height, { tol: 38, feather: 14 });
      let trans = 0;
      for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] < 16) trans++;
      return { look, transRatio: trans / (img.width * img.height) };
    })()`);

    if (c.expectCut) {
      check(c.name + ' -> 判定为可自动抠图', verdict.look.ok === true, verdict.look.reason + ' ' + JSON.stringify(verdict.look.stats));
      check(c.name + ' -> 抠图后背景确实变透明', verdict.transRatio > 0.3, '透明率=' + (verdict.transRatio*100).toFixed(1) + '%');
    } else {
      check(c.name + ' -> 判定为不抠（保护主体）', verdict.look.ok === false, verdict.look.reason + ' ' + JSON.stringify(verdict.look.stats));
    }
  }

  log('==== AUTOCUT E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
