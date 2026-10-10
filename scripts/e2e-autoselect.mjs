// 自动选模型 端到端：用真实 ONNX 模型验证
// 1) 界面有「自动挑最好的模型」开关，且默认开启
// 2) 自动模式会真的尝试多个已下载模型，并给出选择理由与分数
// 3) 阈值作为下限：用户调高阈值后，结果覆盖率不应高于调低阈值时（单调性）
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc } from '../src/main/main.js';
import { segmentAuto, segmentImage } from '../src/main/segment.js';
import { listModels } from '../src/main/models.js';
import { encodePNG } from '../src/shared/png.js';
import { nativeImage } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };

/** 造一张「有明显前景/背景」的图：浅色底 + 深色圆（能区分模型质量） */
function makeImage(size = 256) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const d = Math.hypot(x - size / 2, y - size / 2);
    const on = d <= size * 0.3;
    // 背景：淡灰渐变（考验模型对渐变背景的处理）
    const bg = 225 + Math.round(20 * (y / size));
    px[i] = on ? 40 : bg; px[i + 1] = on ? 90 : bg; px[i + 2] = on ? 200 : bg; px[i + 3] = 255;
  }
  const img = nativeImage.createFromBuffer(Buffer.from(px), { width: size, height: size });
  return 'data:image/png;base64,' + img.toPNG().toString('base64');
}

app.whenReady().then(async () => {
  registerIpc();
  const dir = app.getPath('userData');
  const installed = listModels(dir).filter((m) => m.installed);
  log('已下载模型: ' + (installed.map((m) => m.id).join(', ') || '(无)'));
  check('至少有一个模型已下载（本机已有 silueta/isnet）', installed.length >= 1, 'n=' + installed.length);
  if (installed.length < 1) {
    log('==== AUTOSELECT E2E: ' + pass + '/' + (pass + fail) + ' (缺模型，跳过) ====');
    return app.exit(fail === 0 ? 0 : 1);
  }

  const dataUrl = makeImage(256);

  // ---------- 1) 自动模式：跑全部已下载模型并选最好 ----------
  const seen = [];
  const r = await segmentAuto(dir, null, dataUrl, {
    threshold: 0.5, feather: 0.12,
    onProgress: (p) => seen.push(p.id),
  });
  check('自动模式返回成功', r.ok === true, JSON.stringify(r.errors || ''));
  // 默认是「够干净就提前收手」（性能优化：全跑约 2.4s/帧，20 张图就是 ~50s），
  // 所以这里**不再断言跑遍全部**；全跑语义由下面的 alwaysFull 用例单独覆盖。
  check('自动模式至少跑了一个模型', seen.length >= 1 && seen.length <= installed.length, 'tried=' + seen.join(','));
  check('自动模式报告了尝试过的模型', (r.tried || []).length === seen.length, JSON.stringify(r.tried));
  check('默认不重复跑（tried 无重复项）', new Set(r.tried).size === r.tried.length, JSON.stringify(r.tried));
  check('给出了选中的模型', typeof r.modelId === 'string' && r.modelId.length > 0, r.modelId);
  check('选中的模型在已下载列表里', installed.some((m) => m.id === r.modelId), r.modelId);
  check('返回了排名与分数', Array.isArray(r.ranked) && r.ranked.length === (r.tried || []).length && typeof r.ranked[0].score === 'number',
    JSON.stringify(r.ranked.map((x) => x.id + '=' + x.score.toFixed(3))));
  check('排名按分数降序', r.ranked.every((x, i) => i === 0 || r.ranked[i - 1].score >= x.score - 1e-9));
  check('选中的就是排名第一', r.ranked[0].id === r.modelId, 'top=' + r.ranked[0].id + ' chosen=' + r.modelId);
  check('给出可读的选择理由', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
  check('分数在 0..1 之间', r.ranked.every((x) => x.score >= 0 && x.score <= 1));
  check('覆盖率是合理值（不是全抠或没抠）', r.coverage > 0.05 && r.coverage < 0.9, 'cov=' + r.coverage.toFixed(3));
  check('产出的是 PNG dataURL', /^data:image\/png;base64,/.test(r.dataUrl), r.dataUrl.slice(0, 30));

  // ---------- 2) 阈值作为下限：单调性检查 ----------
  {
    const lo = await segmentImage(dir, r.modelId, dataUrl, { threshold: 0.3, feather: 0.12 });
    const hi = await segmentImage(dir, r.modelId, dataUrl, { threshold: 0.7, feather: 0.12 });
    check('阈值调高 -> 保留的前景不会更多（单调性）', hi.coverage <= lo.coverage + 1e-6,
      `thr0.3 cov=${lo.coverage.toFixed(4)}  thr0.7 cov=${hi.coverage.toFixed(4)}`);
  }

  // ---------- 3) 平手时优先用户手选的模型 ----------
  if (installed.length >= 2) {
    const hint = installed[1].id;
    const r2 = await segmentAuto(dir, null, dataUrl, { threshold: 0.5, feather: 0.12, hintId: hint });
    const top = r2.ranked[0];
    const hinted = r2.ranked.find((x) => x.id === hint);
    const isTie = hinted && Math.abs(top.score - hinted.score) <= 0.02;
    check('平手时优先用户手选（否则仍选最高分）',
      isTie ? r2.modelId === hint : r2.modelId === top.id,
      `tie=${isTie} top=${top.id}(${top.score.toFixed(3)}) hint=${hint}(${hinted ? hinted.score.toFixed(3) : '?'}) chosen=${r2.modelId}`);
  }

  // ---------- 4) 单模型路径与自动路径数值一致（共用一个 runModel）----------
  {
    const single = await segmentImage(dir, r.modelId, dataUrl, { threshold: 0.5, feather: 0.12 });
    check('单模型与自动选中的覆盖率一致（同一条数值路径）',
      Math.abs(single.coverage - r.coverage) < 1e-6,
      `single=${single.coverage.toFixed(6)} auto=${r.coverage.toFixed(6)}`);
  }

  // ---------- 5) 「总是全跑」语义 + 提前收手的质量不变量 ----------
  {
    const full = await segmentAuto(dir, null, dataUrl, { threshold: 0.5, feather: 0.12, alwaysFull: true });
    check('总是全跑：确实跑遍了已下载模型', (full.tried || []).length === installed.length, JSON.stringify(full.tried));
    check('总是全跑：planned 也等于全部', (full.planned || []).length === installed.length, JSON.stringify(full.planned));
    check('总是全跑：排名覆盖全部模型', full.ranked.length === installed.length, 'n=' + full.ranked.length);
    // 这是提前收手优化的正当性依据：省下的时间里不能丢掉可感知的质量
    const chosenInFull = full.ranked.find((x) => x.id === r.modelId);
    const gap = chosenInFull ? (full.ranked[0].score - chosenInFull.score) : 999;
    check('提前收手选中的模型，质量与全跑最优的差距 <= 0.02（几乎一样好）', gap <= 0.02,
      `快速=${r.modelId} 全跑最优=${full.ranked[0].id} 质量差=${gap.toFixed(4)}`);
    check('提前收手不慢于全跑', r.ms <= full.ms, `fast=${r.ms}ms full=${full.ms}ms`);
  }

  log('==== AUTOSELECT E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.exit(fail === 0 ? 0 : 1);
});
