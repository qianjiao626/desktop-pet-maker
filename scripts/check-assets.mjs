// 素材自检：把 素材/原始素材/ 里的图逐个跑身体识别，告诉你哪张能用。
//
// 为什么需要：豆包（或任何 AI）生成完，用户最想知道的就是
// "这张到底行不行、不行要改哪里"。
// 与其让用户一个个拖进制作器试，不如一次全跑完给出清单。
//
// 用法：
//   electron scripts/check-assets.mjs
//
// 输出：每张图识别到几个关键点、素材检查结论、以及具体的修改建议。
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { estimatePose } from '../src/main/pose.js';
import { checkMaterial } from '../src/shared/material.js';
import { availableParts } from '../src/shared/pose.js';

const log = (m) => { try { process.stdout.write(m + String.fromCharCode(10)); } catch {} };
const ROOT = process.cwd();
const SRC = path.join(ROOT, '素材', '原始素材');
const PASS = path.join(ROOT, '素材', '已通过自检');
const EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

app.whenReady().then(async () => {
  if (!fs.existsSync(SRC)) {
    log('找不到素材目录：' + SRC);
    log('请先创建它，并把 AI 生成的图放进去。');
    app.exit(1);
    return;
  }
  const files = fs.readdirSync(SRC).filter((f) => EXTS.has(path.extname(f).toLowerCase()));
  if (!files.length) {
    log('素材目录是空的：' + SRC);
    log('把 AI 生成的图放进去，再运行这个脚本。');
    app.exit(0);
    return;
  }

  fs.mkdirSync(PASS, { recursive: true });
  const ud = app.getPath('userData');
  const ok = [], warn = [], bad = [];

  log('检查 ' + files.length + ' 个文件…');
  log('');
  for (const f of files) {
    const full = path.join(SRC, f);
    let line = '';
    try {
      const buf = fs.readFileSync(full);
      const ext = path.extname(f).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
      const r = await estimatePose(ud, dataUrl);
      const kps = r.keypoints || [];
      const good = kps.filter((k) => k.score >= 0.3).length;
      const parts = availableParts(kps);
      const mat = checkMaterial(kps);
      const partCount = ['core', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']
        .filter((k) => parts[k]).length;

      if (mat.ok && good >= 15) {
        ok.push(f);
        line = '✅ ' + f + '  —  ' + good + '/17 点，' + partCount + '/6 部位（合格）';
        try { fs.copyFileSync(full, path.join(PASS, f)); } catch { /* 拷贝失败不影响判定 */ }
      } else if (mat.ok) {
        warn.push(f);
        line = '⚠️  ' + f + '  —  ' + good + '/17 点，' + partCount + '/6 部位（勉强可用，建议改进）';
      } else {
        bad.push(f);
        line = '❌ ' + f + '  —  ' + good + '/17 点，' + partCount + '/6 部位（不合格）';
      }
      log(line);
      // 具体问题（把制作器自己的建议原样给出来，用户可以直接拿去让 AI 改）
      for (const it of (mat.issues || [])) {
        log('      · ' + it.msg + (it.fix ? '  ->  ' + it.fix : ''));
      }
    } catch (err) {
      bad.push(f);
      log('❌ ' + f + '  —  读取/识别失败：' + (err && err.message));
    }
  }

  log('');
  log('==== 汇总 ====');
  log('合格 ' + ok.length + ' 张' + (ok.length ? '：' + ok.join('、') : ''));
  log('勉强 ' + warn.length + ' 张' + (warn.length ? '：' + warn.join('、') : ''));
  log('不合格 ' + bad.length + ' 张' + (bad.length ? '：' + bad.join('、') : ''));
  if (ok.length) log('');
  if (ok.length) log('合格的已复制到：' + PASS);
  if (bad.length) {
    log('');
    log('不合格的怎么改：把上面每张后面的「-> 建议」原样发给豆包，让它按建议重画。');
    log('最常见的原因：四肢并拢/贴身体（让手臂张开 45 度、双腿分开）。');
  }
  app.exit(0);
});
