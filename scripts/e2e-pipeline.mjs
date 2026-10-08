import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { decodeGif } from '../src/shared/gif.js';
import { encodePNG } from '../src/shared/png.js';
import { segmentImage } from '../src/main/segment.js';
import { MODELS } from '../src/main/models.js';
import { zipCreate, zipRead } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

const require = createRequire(import.meta.url);
const { GifWriter } = require('omggif');
const log = (m) => process.stdout.write(m + '\n');

// 造一个 4 帧的 320x320 GIF：橙色圆随时间上移
function makeGif(nFrames, size) {
  const palette = [0xff7840, 0xfafafa, 0x000000, 0xffffff];
  const out = [];
  const gw = new GifWriter(out, size, size, { palette, loop: 0 });
  for (let f = 0; f < nFrames; f++) {
    const idx = new Array(size * size).fill(1);
    const cy = size * 0.5 - f * size * 0.06;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (Math.hypot(x - size/2, y - cy) <= size * 0.22) idx[y*size+x] = 0;
    }
    gw.addFrame(0, 0, size, size, idx, { palette, delay: 8, disposal: 2 });
  }
  const end = gw.end();
  return new Uint8Array(out.slice(0, end));
}

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  const md = path.join(ud, 'models');
  fs.mkdirSync(md, { recursive: true });
  const dst = path.join(md, MODELS.silueta.file);
  if (!fs.existsSync(dst)) fs.copyFileSync('models/silueta.onnx', dst);

  const SIZE = 320, NF = 4;
  const gif = makeGif(NF, SIZE);
  log('1) GIF 字节数=' + gif.length);

  const dec = decodeGif(gif);
  log('2) 拆帧: n=' + dec.frames.length + ' size=' + dec.width + 'x' + dec.height + ' delays=' + dec.frames.map(f => f.delayMs).join(','));

  const results = [];
  for (let i = 0; i < dec.frames.length; i++) {
    const fr = dec.frames[i];
    const png = encodePNG(dec.width, dec.height, Buffer.from(fr.data));
    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    const r = await segmentImage(ud, 'silueta', dataUrl, { threshold: 0.5, feather: 0.1 });
    const im = nativeImage.createFromBuffer(Buffer.from(r.dataUrl.split(',')[1], 'base64'));
    const bmp = im.toBitmap();
    const w = im.getSize().width, h = im.getSize().height;
    const a = (x, y) => bmp[(y*w+x)*4+3];
    const corners = [a(1,1), a(w-2,1), a(1,h-2), a(w-2,h-2)];
    results.push({ i, cov: r.coverage, corners });
    log('3.' + i + ') 帧' + i + ' coverage=' + r.coverage.toFixed(3) + ' corners=' + corners.join(','));
  }

  const frames = dec.frames.map((fr, i) => ({ name: 'frame_' + String(i).padStart(3,'0') + '.png', data: encodePNG(dec.width, dec.height, Buffer.from(fr.data)), durationMs: fr.delayMs }));
  const pack = normalizePack({ id: 'e2e', name: 'E2E', frames: frames.map(f => ({ file: f.name, durationMs: f.durationMs })), canvas: { width: SIZE, height: SIZE }, animation: { idle: 'play', fps: 8 } });
  const zip = zipCreate([{ name: 'pet.json', data: JSON.stringify(pack, null, 2) }, ...frames]);
  fs.mkdirSync('examples', { recursive: true });
  fs.writeFileSync('examples/e2e-pipeline.petpack', zip);
  const back = zipRead(zip);
  log('4) 打包: ' + back.length + ' 条目, ' + (zip.length/1024).toFixed(0) + ' KB');
  const p2 = JSON.parse(back.find(e => e.name === 'pet.json').data.toString('utf8'));
  log('5) 回读: frames=' + p2.frames.length + ' canvas=' + p2.canvas.width + ' idle=' + p2.animation.idle);

  const okAll = results.every(r => r.cov > 0.05 && r.cov < 0.3 && r.corners.every(c => c < 40));
  log('结果: ' + (okAll ? 'PASS 全部帧抠图有效' : 'FAIL'));
  app.quit();
}).catch((e) => { log('FATAL ' + e.message); app.quit(); });
