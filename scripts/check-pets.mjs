// 校验：生成的 .petpack 结构完整、帧尺寸一致、能被 normalizePack 正常读回
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { zipRead } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';
import { encodePNG } from '../src/shared/png.js';

const log = (m) => { try { process.stdout.write(m + '\n'); } catch {} };
app.whenReady().then(() => {
  const DIR = path.join(process.cwd(), '素材', '做好的宠物');
  const files = fs.readdirSync(DIR).filter(f => /\.petpack$/i.test(f)).sort();
  let bad = 0;
  for (const f of files) {
    const entries = zipRead(fs.readFileSync(path.join(DIR, f)));
    const maniEntry = entries.find(e => e.name === 'pet.json');
    if (!maniEntry) { log('❌ ' + f + ' 缺 pet.json'); bad++; continue; }
    const pack = normalizePack(JSON.parse(maniEntry.data.toString('utf8')));
    const byName = new Map(entries.map(e => [e.name, e.data]));
    let ok = true, note = [];
    for (const fr of pack.frames) {
      const b = byName.get(fr.file);
      if (!b) { ok = false; note.push('缺帧 ' + fr.file); continue; }
      const im = nativeImage.createFromBuffer(b);
      const s = im.getSize();
      if (s.width !== pack.canvas.width || s.height !== pack.canvas.height) { ok = false; note.push('尺寸不符 ' + fr.file + ' ' + s.width + 'x' + s.height); }
    }
    for (const cl of pack.clips) for (const fr of cl.frames) {
      const b = byName.get(fr.file);
      if (!b) { ok = false; note.push('缺片段帧 ' + fr.file); continue; }
      const im = nativeImage.createFromBuffer(b);
      const s = im.getSize();
      if (s.width !== pack.canvas.width || s.height !== pack.canvas.height) { ok = false; note.push('片段尺寸不符 ' + fr.file); }
    }
    // 主体不透明占比（判断有没有抠成空白）
    const first = nativeImage.createFromBuffer(byName.get(pack.frames[0].file));
    const bmp = first.toBitmap();
    let n = 0;
    for (let i = 3; i < bmp.length; i += 4) if (bmp[i] > 16) n++;
    const ratio = n / (bmp.length / 4);
    if (ratio < 0.05) { ok = false; note.push('主体几乎为空 ' + (ratio*100).toFixed(1) + '%'); }
    log((ok ? '✅ ' : '❌ ') + f + '  画布 ' + pack.canvas.width + 'x' + pack.canvas.height
      + '  ' + pack.frames.length + ' 主帧 + ' + pack.clips.length + ' 片段'
      + '  主体占比 ' + (ratio*100).toFixed(1) + '%'
      + (note.length ? '  ' + note.join('; ') : ''));
    if (!ok) bad++;
  }
  log('');
  log(bad === 0 ? '全部通过：' + files.length + '/' + files.length : '有 ' + bad + ' 个不合格');
  app.exit(bad === 0 ? 0 : 1);
});