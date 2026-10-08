import { app, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow, setMakerWindow } from '../src/main/state.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CODE = Buffer.from('KCgpID0+IHsKICBjb25zdCBjdiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoIiNzdGFnZSIpOwogIGNvbnN0IGQgPSBjdi5nZXRDb250ZXh0KCIyZCIpLmdldEltYWdlRGF0YSgwLCAwLCBjdi53aWR0aCwgY3YuaGVpZ2h0KS5kYXRhOwogIGxldCBvcGFxdWUgPSAwLCBtaW5YID0gMWU5LCBtaW5ZID0gMWU5LCBtYXhYID0gLTEsIG1heFkgPSAtMTsKICBmb3IgKGxldCB5ID0gMDsgeSA8IGN2LmhlaWdodDsgeSsrKSBmb3IgKGxldCB4ID0gMDsgeCA8IGN2LndpZHRoOyB4KyspIHsKICAgIGlmIChkWyh5ICogY3Yud2lkdGggKyB4KSAqIDQgKyAzXSA+IDE2KSB7CiAgICAgIG9wYXF1ZSsrOwogICAgICBpZiAoeCA8IG1pblgpIG1pblggPSB4OyBpZiAoeCA+IG1heFgpIG1heFggPSB4OwogICAgICBpZiAoeSA8IG1pblkpIG1pblkgPSB5OyBpZiAoeSA+IG1heFkpIG1heFkgPSB5OwogICAgfQogIH0KICBjb25zdCBkYmcgPSB3aW5kb3cuX19wZXREZWJ1ZyA/IHdpbmRvdy5fX3BldERlYnVnKCkgOiBudWxsOwogIHJldHVybiB7IGNhbnZhc1c6IGN2LndpZHRoLCBjYW52YXNIOiBjdi5oZWlnaHQsIG9wYXF1ZSwgZHJhd246IHsgbWluWCwgbWluWSwgbWF4WCwgbWF4WSB9LCBkYmcgfTsKfSkoKQ==', 'base64').toString('utf8');

function still(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.42;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 120 : 0; px[i + 1] = on ? 200 : 0; px[i + 2] = on ? 255 : 0; px[i + 3] = on ? 255 : 0;
  }
  return Buffer.from(px);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const wa = screen.getPrimaryDisplay().workArea;
  const SIZE = 320;
  const dataUrl = 'data:image/png;base64,' + encodePNG(SIZE, SIZE, still(SIZE)).toString('base64');
  const pack = { id: 'meas', name: 'meas', frames: [{ file: 'f.png', durationMs: 100 }],
    canvas: { width: SIZE, height: SIZE }, render: { scale: 0.5 },
    animation: { idle: 'breathe' }, physics: { gravity: 1.2, bounce: 0.3, roam: false },
    bubble: { enabled: true, lines: ['x'], intervalSec: 99, durationSec: 1 },
    behavior: { startCorner: 'bottom-right', keepAbove: false } };
  const mw = new BrowserWindow({ width: 200, height: 200, show: false, webPreferences: { contextIsolation: true } });
  setMakerWindow(mw);
  const handler = ipcMain._invokeHandlers.get('quick:enable');
  const ev = { sender: { isDestroyed: () => false, send: () => {} } };
  await handler(ev, { pack, frames: [{ file: 'f.png', dataUrl, durationMs: 100 }] });
  await sleep(3500);

  const pw = getPetWindow();
  if (pw) {
    console.log("  追踪开始 bounds=" + JSON.stringify(pw.getBounds()));
    let n = 0;
    const t = setInterval(() => {
      if (pw.isDestroyed()) { clearInterval(t); return; }
      n++;
      const b = pw.getBounds();
      console.log("  [t" + n + "] bounds=" + JSON.stringify(b) + " content=" + JSON.stringify(pw.getContentBounds()));
      if (n >= 12) clearInterval(t);
    }, 250);
  }
  const shots = path.join(ROOT, 'shots');
  fs.mkdirSync(shots, { recursive: true });

  const save = async (name) => {
    const img = await pw.webContents.capturePage();
    fs.writeFileSync(path.join(shots, name), img.toPNG());
  };

  const b = pw.getBounds();
  console.log('窗口=' + JSON.stringify(b) + ' 工作区底=' + (wa.y + wa.height) + ' 窗口底=' + (b.y + b.height) + ' 超出=' + (b.y + b.height - (wa.y + wa.height)));
  const base = await pw.webContents.executeJavaScript(CODE);
  console.log('基线: drawn=' + JSON.stringify(base.drawn) + ' canvas=' + base.canvasW + 'x' + base.canvasH);
  await save('fx-base.png');

  // 摸头：取动画中段截图
  pw.webContents.send('quick:pat');
  await sleep(420);
  const patMid = await pw.webContents.executeJavaScript(CODE);
  console.log('摸头中: drawn=' + JSON.stringify(patMid.drawn) + ' opaque=' + patMid.opaque);
  await save('fx-pat.png');
  await sleep(900);

  // 拳击：取撞击瞬间截图
  pw.webContents.send('quick:hit', -1);
  await sleep(260);
  const hitMid = await pw.webContents.executeJavaScript(CODE);
  console.log('拳击中: drawn=' + JSON.stringify(hitMid.drawn) + ' opaque=' + hitMid.opaque);
  await save('fx-hit.png');

  console.log('计算: 摸头不透明增量=' + (patMid.opaque - base.opaque) + ' 拳击不透明增量=' + (hitMid.opaque - base.opaque));
  app.quit();
}).catch((e) => { console.error('FATAL ' + e.message); app.quit(); });
