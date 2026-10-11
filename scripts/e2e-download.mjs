import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MODELS, isInstalled, downloadModel, deleteModel, modelsDir } from '../src/main/models.js';

const log = (m) => process.stdout.write(m + '\n');

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  const md = modelsDir(ud);
  log('modelsDir=' + md);
  const dst = path.join(md, MODELS.silueta.file);
  if (!fs.existsSync(dst)) fs.copyFileSync('models/silueta.onnx', dst);
  log('isInstalled(silueta)=' + isInstalled(ud, 'silueta'));
  const r = await downloadModel(ud, 'silueta', null);
  log('cached: ok=' + r.ok + ' cached=' + r.cached);

  const fake = path.join(md, MODELS.isnetGeneral.file);
  const backup = fs.existsSync(fake) ? fs.readFileSync(fake) : null;
  fs.writeFileSync(fake, Buffer.alloc(1024, 1));
  log('小文件 isInstalled=' + isInstalled(ud, 'isnetGeneral') + ' (期望 false)');
  if (backup) fs.writeFileSync(fake, backup); else { try { fs.unlinkSync(fake); } catch (e) {} }

  const del = deleteModel(ud, 'silueta');
  log('delete ok=' + del.ok + ' then isInstalled=' + isInstalled(ud, 'silueta'));
  fs.copyFileSync('models/silueta.onnx', dst);
  app.exit(0);   // 观察型脚本：跑完即通过（这里没有 fail 计数，别写 fail）
}).catch((e) => { log('FATAL ' + e.message); app.quit(); });
