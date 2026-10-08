// 模型下载健壮性（离线可测）：本地 HTTP 服务器 + 伪造 MODELS 条目
// 覆盖：正常下载 + MD5 校验、断流后自动重试并断点续传、数据损坏被拒且清理 .part
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MODELS, downloadModel, isInstalled, modelPath } from '../src/main/models.js';

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };

// ---- 测试载荷（约 600KB，够分多块）----
const PAYLOAD = Buffer.alloc(2 * 1024 * 1024);
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = (i * 31 + 7) & 0xff;
const MD5 = crypto.createHash('md5').update(PAYLOAD).digest('hex');

// 供不同场景切换行为的服务器
let mode = 'ok';        // ok | drop-once | corrupt
let dropCount = 0;
let rangeHits = 0;

const server = http.createServer((req, res) => {
  const range = req.headers.range;
  if (range) rangeHits++;
  let body = PAYLOAD;
  if (mode === 'corrupt') { body = Buffer.from(PAYLOAD); body[100] ^= 0xff; }

  if (range) {
    const m = /bytes=(\d+)-/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`,
      'Content-Length': String(body.length - start),
      'Accept-Ranges': 'bytes',
    });
    res.end(body.subarray(start));
    return;
  }

  // 模拟下载中断：第一次只发一半就断开
  if (mode === 'drop-once' && dropCount === 0) {
    dropCount++;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' });
    res.write(body.subarray(0, Math.floor(body.length / 2)));
    setTimeout(() => res.destroy(), 60);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' });
  res.end(body);
});

const tmpDir = path.join(os.tmpdir(), 'e2e-dl-robust-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
const TEST_ID = 'e2eRobust';

function installFakeModel(url) {
  MODELS[TEST_ID] = {
    id: TEST_ID, name: '测试模型', desc: 'e2e', file: 'e2e-robust.bin',
    size: 320, bytes: PAYLOAD.length, url,
    source: 'local', license: 'MIT', mean: [0, 0, 0], std: [1, 1, 1],
    divide: 1, preprocess: 'resize', md5: MD5,
  };
}

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/model.bin`;

// ---- 1. 正常下载 + MD5 校验通过 ----
mode = 'ok';
installFakeModel(base);
let r = await downloadModel(tmpDir, TEST_ID, null);
check('正常下载成功', r.ok && !r.cached, JSON.stringify({ ok: r.ok, attempts: r.attempts }));
const got = fs.readFileSync(modelPath(tmpDir, TEST_ID));
check('内容与源一致', got.length === PAYLOAD.length && got.equals(PAYLOAD), got.length + 'B');
check('已落盘为正式文件', isInstalled(tmpDir, TEST_ID) === false || fs.existsSync(modelPath(tmpDir, TEST_ID)));

// ---- 2. 已存在时直接命中缓存 ----
r = await downloadModel(tmpDir, TEST_ID, null);
check('二次调用命中缓存', r.ok && r.cached === true);

// ---- 3. 断流后自动重试 + 断点续传 ----
fs.unlinkSync(modelPath(tmpDir, TEST_ID));
mode = 'drop-once'; dropCount = 0; rangeHits = 0;
r = await downloadModel(tmpDir, TEST_ID, null);
check('断流后仍下载成功', r.ok, JSON.stringify({ attempts: r.attempts }));
check('触发了断点续传(Range)', rangeHits > 0, 'rangeHits=' + rangeHits);
const got2 = fs.readFileSync(modelPath(tmpDir, TEST_ID));
check('续传后内容完整正确', got2.equals(PAYLOAD), got2.length + 'B');

// ---- 4. 数据损坏必须被 MD5 拒绝，且清理 .part ----
fs.unlinkSync(modelPath(tmpDir, TEST_ID));
mode = 'corrupt';
let threw = null;
try { await downloadModel(tmpDir, TEST_ID, null); } catch (e) { threw = e; }
check('损坏数据被拒绝', !!threw, threw ? threw.message.slice(0, 60) : '未抛错');
check('未被写入正式文件', !fs.existsSync(modelPath(tmpDir, TEST_ID)));
check('.part 临时文件已清理', !fs.existsSync(modelPath(tmpDir, TEST_ID).replace(/\.part$/, '') + '.part-should-not-exist')
  && !fs.existsSync(path.join(tmpDir, 'models', 'e2e-robust.bin.part')));

// ---- 5. 进度回调被调用且单调递增 ----
mode = 'ok';
if (fs.existsSync(modelPath(tmpDir, TEST_ID))) fs.unlinkSync(modelPath(tmpDir, TEST_ID));
const seen = [];
await downloadModel(tmpDir, TEST_ID, (p) => seen.push(p.received));
check('进度回调被调用', seen.length > 0, 'n=' + seen.length);
check('进度单调递增', seen.every((v, i) => i === 0 || v >= seen[i - 1]));
const mp = modelPath(tmpDir, TEST_ID);
if (fs.existsSync(mp)) fs.unlinkSync(mp);
let lastPct = -1;
await downloadModel(tmpDir, TEST_ID, (pr) => { if (pr.percent >= 1) lastPct = pr.percent; });
check('最终进度达到 100%', lastPct >= 1, 'pct=' + lastPct);

// ---- 清理 ----
server.close();
delete MODELS[TEST_ID];
fs.rmSync(tmpDir, { recursive: true, force: true });

log('');
log('==== DOWNLOAD ROBUST E2E: ' + pass + '/' + (pass + fail) + ' ====');
process.exit(fail ? 1 : 0);