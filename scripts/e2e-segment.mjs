import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../src/shared/png.js';
import { segmentImage } from '../src/main/segment.js';
import { MODELS } from '../src/main/models.js';

const log = (m) => process.stdout.write(m + '\n');

function synth(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size * 0.26;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const d1 = Math.hypot(x - cx, y - cy) <= r;
    const d2 = Math.hypot(x - (cx - r * 0.6), y - (cy - r * 0.9)) <= r * 0.34;
    const d3 = Math.hypot(x - (cx + r * 0.6), y - (cy - r * 0.9)) <= r * 0.34;
    const on = d1 || d2 || d3;
    px[i] = on ? 255 : 250; px[i+1] = on ? 140 : 250; px[i+2] = on ? 60 : 250; px[i+3] = 255;
  }
  return px;
}

const ids = process.argv.slice(2).filter((a) => a.startsWith('--model=')).map((a) => a.slice(8));

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  const md = path.join(ud, 'models');
  fs.mkdirSync(md, { recursive: true });

  const O = 512;
  const dataUrl = 'data:image/png;base64,' + encodePNG(O, O, Buffer.from(synth(O))).toString('base64');

  for (const id of ids) {
    const src = path.join('models', MODELS[id].file);
    if (!fs.existsSync(src)) { log('=== ' + id + ' SKIP (本地无模型文件) ==='); continue; }
    const dst = path.join(md, MODELS[id].file);
    try { if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); }
    catch (e) { log('=== ' + id + ' COPY FAILED: ' + e.message); continue; }

    try {
      const t0 = Date.now();
      const r = await segmentImage(ud, id, dataUrl, { threshold: 0.5, feather: 0.1 });
      const cold = Date.now() - t0;
      const t1 = Date.now();
      await segmentImage(ud, id, dataUrl, { threshold: 0.5, feather: 0.1 });
      const warm = Date.now() - t1;

      const out = nativeImage.createFromBuffer(Buffer.from(r.dataUrl.split(',')[1], 'base64'));
      const bmp = out.toBitmap();
      const w = out.getSize().width, h = out.getSize().height;
      const at = (x, y) => bmp[(y * w + x) * 4 + 3];
      const center = at(w >> 1, (h >> 1) + 50);
      const corners = [at(2,2), at(w-3,2), at(2,h-3), at(w-3,h-3)];

      log('=== ' + id + ' (' + MODELS[id].size + 'px) ===');
      log('  size=' + r.width + 'x' + r.height + ' cold=' + cold + 'ms warm=' + warm + 'ms');
      log('  coverage=' + r.coverage.toFixed(3) + '  centerAlpha=' + center + '  corners=' + corners.join(','));
    } catch (e) {
      log('=== ' + id + ' FAILED: ' + e.message);
    }
  }
  app.quit();
}).catch((e) => { log('FATAL ' + e.message); app.quit(); });