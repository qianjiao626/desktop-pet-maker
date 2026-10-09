// 快速模式端到端：上传一张图 -> 启用 -> 爬动/摸头 -> 停用
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow, isPetAlive } from '../src/main/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => {
  if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); }
  else { fail++; log('FAIL  ' + n + '  :: ' + e); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function still(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 250; px[i + 1] = on ? 130 : 250;
    px[i + 2] = on ? 60 : 250; px[i + 3] = 255;
  }
  return Buffer.from(px);
}

let maker = null;
const mx = (code) => maker.webContents.executeJavaScript(code);
const jsStr = (sel) => 'document.querySelector(' + JSON.stringify(sel) + ')';

app.whenReady().then(async () => {
  registerIpc();

  maker = new BrowserWindow({
    width: 1200, height: 860, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  maker.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/order|error|Error|未定义|not defined/i.test(String(msg))) log('  [maker-console] ' + msg);
  });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(2000);

  // ---- 1. 快速条初始状态 ----
  check('快速控制条存在', await mx('!!document.querySelector("#quickbar")'));
  check('启用按钮初始禁用', await mx('document.querySelector("#btnEnablePet").disabled === true'));
  check('停用按钮初始禁用', await mx('document.querySelector("#btnDisablePet").disabled === true'));
  check('初始提示引导上传', /拖入.*图片/.test(await mx('document.querySelector("#qbText").textContent')), await mx('document.querySelector("#qbText").textContent'));
  check('爬动开关默认勾选', await mx('document.querySelector("#chkWalk").checked === true'));
  check('爬动/摸头始终可见(引导发现)', await mx('document.querySelector("#qbExtra").hidden === false'));
  check('未启用时爬动开关灰显', await mx('document.querySelector("#chkWalk").disabled === true'));
  check('未启用时摸头按钮灰显', await mx('document.querySelector("#btnPat").disabled === true'));
  check('步骤号为1', (await mx('document.querySelector("#qbNum").textContent')) === '1');

  // ---- 2. 上传一张图片 ----
  const b64 = encodePNG(256, 256, still(256)).toString('base64');
  await mx('(async () => {'
    + 'const bin = atob("' + b64 + '");'
    + 'const u8 = new Uint8Array(bin.length);'
    + 'for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);'
    + 'const dt = new DataTransfer();'
    + 'dt.items.add(new File([u8], "pet.png", { type: "image/png" }));'
    + 'document.querySelector("#stage").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));'
    + 'return true;'
    + '})()');
  await sleep(4500);
  const upStatus = await mx('document.querySelector("#status").textContent');
  check('上传后已处理', /已处理/.test(upStatus), upStatus);
  check('上传后启用按钮可用', await mx('document.querySelector("#btnEnablePet").disabled === false'));
  check('上传后步骤号为2', (await mx('document.querySelector("#qbNum").textContent')) === '2');
  check('上传后提示可启用', /启用/.test(await mx('document.querySelector("#qbText").textContent')));

  // ---- 3. 启用 ----
  await mx('document.querySelector("#btnEnablePet").click()');
  await sleep(7000);
  const enStatus = await mx('document.querySelector("#status").textContent');
  check('启用成功', /已出现在屏幕上|已更新并启用/.test(enStatus), enStatus);
  check('启用后提示运行中', /运行/.test(await mx('document.querySelector("#qbText").textContent')), await mx('document.querySelector("#qbText").textContent'));
  check('启用后步骤号为3', (await mx('document.querySelector("#qbNum").textContent')) === '3');
  check('启用后步骤号标记完成', (await mx('document.querySelector("#qbNum").className')).includes('done'));
  check('启用按钮转禁用', await mx('document.querySelector("#btnEnablePet").disabled === true'));
  check('停用按钮转可用', await mx('document.querySelector("#btnDisablePet").disabled === false'));
  check('启用后爬动开关可用', await mx('document.querySelector("#chkWalk").disabled === false'));
  check('启用后摸头按钮可用', await mx('document.querySelector("#btnPat").disabled === false'));
  check('主进程登记宠物窗口', isPetAlive() === true);

  // ---- 4. 宠物窗口真实存在并绘制 ----
  const pw = getPetWindow();
  check('宠物窗口存在', !!pw && !pw.isDestroyed());
  let dbg = null;
  if (pw) {
    dbg = await pw.webContents.executeJavaScript('window.__petDebug ? window.__petDebug() : null');
    check('宠物运行时已就绪', !!dbg, JSON.stringify(dbg && dbg.behavior));
    if (dbg) {
      check('行为状态机已启动', !!dbg.behavior && typeof dbg.behavior.state === 'string', JSON.stringify(dbg.behavior));
      check('帧已加载', (dbg.loadedFrames || 0) > 0, 'frames=' + dbg.loadedFrames);
    }

    // 观察：状态应推进，且会发生水平位移（爬动）
    // 观察足够长时间（状态机含发呆/打瞌睡，短窗内可能恰好不动）
    const seen = new Set();
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 90; i++) {
      const d = await pw.webContents.executeJavaScript('window.__petDebug()');
      seen.add(d.behavior.state);
      if (d.body.x < minX) minX = d.body.x;
      if (d.body.x > maxX) maxX = d.body.x;
      await sleep(250);
    }
    check('观察到爬动状态', seen.has('walk'), [...seen].join(','));
    check('水平位置发生过变化', (maxX - minX) > 2, 'span=' + (maxX - minX).toFixed(1));

    // ---- 5. 摸头 ----
    await mx('document.querySelector("#btnPat").click()');
    await sleep(500);
    const pd = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('摸头进入 pat 状态', pd.behavior.state === 'pat', pd.behavior.state);
    check('制作器提示摸头', /摸/.test(await mx('document.querySelector("#status").textContent')));
    await sleep(1800);
    const ad = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('摸头后自动恢复', ad.behavior.state !== 'pat', ad.behavior.state);

    // ---- 6. 关闭爬动 ----
    await mx('document.querySelector("#chkWalk").checked = false');
    await mx('document.querySelector("#chkWalk").dispatchEvent(new Event("change", { bubbles: true }))');
    await sleep(1500);
    const wd = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('关闭爬动后停用行为', wd.behavior.enabled === false, JSON.stringify(wd.behavior));
    check('关闭爬动后不走动', wd.behavior.walkDir === 0, String(wd.behavior.walkDir));

    // ---- 7. 重新开启爬动 ----
    await mx('document.querySelector("#chkWalk").checked = true');
    await mx('document.querySelector("#chkWalk").dispatchEvent(new Event("change", { bubbles: true }))');
    await sleep(1500);
    const we = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('重新开启爬动生效', we.behavior.enabled === true, JSON.stringify(we.behavior));
  }

  // ---- 7b. 挨拳击 ----
  {
    const pw = getPetWindow();
    const beforeHit = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('受击前 hitCount=0', (beforeHit.behavior.hitCount || 0) === 0, String(beforeHit.behavior.hitCount));
    await mx('document.querySelector("#btnHit").click()');
    await sleep(400);
    const onHit = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('挨拳击进入 hit 状态', onHit.behavior.state === 'hit', onHit.behavior.state);
    check('受击计数递增', (onHit.behavior.hitCount || 0) === 1, String(onHit.behavior.hitCount));
    check('制作器提示给了它一拳', /一拳/.test(await mx('document.querySelector("#status").textContent')));
    // 受击瞬间先取「击退速度」：位移会被物理碰撞（撞到屏幕边缘/虫子）干扰，
    // 速度才是「这一拳有没有打出去」的直接证据。只在受击窗口内采样一次，避免时序脆弱。
    await sleep(120);
    const hitVel = await pw.webContents.executeJavaScript('window.__petDebug()');
    const vx = Math.abs((hitVel.body && hitVel.body.vx) || 0);
    await sleep(1700);
    const afterHit = await pw.webContents.executeJavaScript('window.__petDebug()');
    check('受击后自动恢复', afterHit.behavior.state !== 'hit', afterHit.behavior.state);
    // 判定：要么产生了明显位移，要么受击瞬间有击退速度（二者其一即可，避免被碰撞误判为失败）
    const dx = Math.abs(afterHit.body.x - beforeHit.body.x);
    check('受击产生了位移或击退速度', dx > 5 || vx > 0.5, 'dx=' + dx.toFixed(1) + ' vx=' + vx.toFixed(2));
  }

  // ---- 7c. 输入文本让它说出来 ----
  {
    const pw = getPetWindow();
    check('未输入时「说出来」禁用', await mx('document.querySelector("#btnSay").disabled === true'));
    await mx('document.querySelector("#sayInput").value = "你好，我是桌宠"');
    await mx('document.querySelector("#sayInput").dispatchEvent(new Event("input", { bubbles: true }))');
    await sleep(300);
    check('输入后可点「说出来」', await mx('document.querySelector("#btnSay").disabled === false'));
    await mx('document.querySelector("#btnSay").click()');
    await sleep(900);
    const bubbleShown = await pw.webContents.executeJavaScript('({ hidden: document.querySelector("#bubble").hidden, text: document.querySelector("#bubbleText").textContent })');
    check('气泡已显示', bubbleShown.hidden === false, JSON.stringify(bubbleShown));
    check('气泡内容=输入的文本', bubbleShown.text === '你好，我是桌宠', bubbleShown.text);
    check('发送后输入框清空', (await mx('document.querySelector("#sayInput").value')) === '');
    check('状态提示已让它说', /让它说/.test(await mx('document.querySelector("#status").textContent')));
    await mx('document.querySelector("#sayInput").value = "   "');
    await mx('document.querySelector("#sayInput").dispatchEvent(new Event("input", { bubbles: true }))');
    await sleep(200);
    check('纯空白输入按钮仍禁用', await mx('document.querySelector("#btnSay").disabled === true'));
    await mx('document.querySelector("#sayInput").value = "回车测试"');
    await mx('document.querySelector("#sayInput").dispatchEvent(new Event("input", { bubbles: true }))');
    await mx('document.querySelector("#sayInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
    await sleep(900);
    const b2 = await pw.webContents.executeJavaScript('document.querySelector("#bubbleText").textContent');
    check('回车发送生效', b2 === '回车测试', b2);
  }

  // ---- 8. 停用 ----
  await mx('document.querySelector("#btnDisablePet").click()');
  await sleep(3000);
  check('停用后宠物关闭', isPetAlive() === false);
  check('停用后提示可再次启用', /启用/.test(await mx('document.querySelector("#qbText").textContent')), await mx('document.querySelector("#qbText").textContent'));
  check('停用后启用按钮可用', await mx('document.querySelector("#btnEnablePet").disabled === false'));
  check('停用后爬动/摸头灰显', (await mx('document.querySelector("#chkWalk").disabled === true')) && (await mx('document.querySelector("#btnPat").disabled === true')));

  // ---- 9. 再次启用（无需重新上传）----
  await mx('document.querySelector("#btnEnablePet").click()');
  await sleep(7000);
  check('可再次启用', isPetAlive() === true);
  const pw2 = getPetWindow();
  if (pw2) {
    const d2 = await pw2.webContents.executeJavaScript('window.__petDebug()');
    check('再次启用后仍有画面', (d2.loadedFrames || 0) > 0, 'frames=' + d2.loadedFrames);
  }

  await mx('document.querySelector("#btnDisablePet").click()');
  await sleep(1500);

  log('');
  log('==== QUICK MODE E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + String.fromCharCode(10) + (e.stack || '')); app.quit(); });
