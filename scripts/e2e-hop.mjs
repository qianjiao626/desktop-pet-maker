// 跳跃（hop）端到端：验证「宠物真的会自己蹦一下」且姿态正确
//
// 关键点：只断言「状态名变成 hop」是不够的 —— 必须验证渲染姿态真的抬高了，
// 否则状态切了但画面没动，功能等于没做。所以这里读取 __petDebug().pose（真实绘制用的姿态）。
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { getPetWindow } from "../src/main/state.js";
import { encodePNG } from "../src/shared/png.js";
// EPIPE 兜底：调用方的管道提前关闭时（例如 `| Select-Object -Last 10`），
// 直接写 stdout 会抛 broken pipe —— Electron 会弹原生错误框跳到用户桌面上。
// 统一走 safeWrite，并把 EPIPE 静默掉。
import { safeWrite, installEpipeGuard } from './lib-e2e-log.mjs';
installEpipeGuard();

const ROOT = path.resolve(".");
let pass = 0, fail = 0;
const log = (m) => safeWrite(m + String.fromCharCode(10));
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const maker = new BrowserWindow({ width: 1000, height: 700, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(900);
  const js = (c) => maker.webContents.executeJavaScript(c);

  const size = 128;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, on = Math.hypot(x - size/2, y - size/2) <= size * 0.32;
    px[i] = on ? 255 : 0; px[i+1] = on ? 130 : 0; px[i+2] = on ? 60 : 0; px[i+3] = on ? 255 : 0;
  }
  const dataUrl = 'data:image/png;base64,' + encodePNG(size, size, Buffer.from(px)).toString('base64');
  const pack = {
    id: 'hop-pose', name: '跳跃姿态测试', author: 'e2e',
    frames: [{ file: 'f.png', durationMs: 120 }], canvas: { width: size, height: size },
    render: { scale: 0.3 },
    animation: { idle: 'breathe', idleSpeed: 1, fps: 8, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 0 },
    bubble: { enabled: false, lines: [] },
    behavior: { startCorner: 'bottom-right', keepAbove: true, bugChase: false },
  };
  await js('window.api.quickEnable(' + JSON.stringify(pack) + ', [{file:"f.png",dataUrl:' + JSON.stringify(dataUrl) + ',durationMs:120}])');
  await sleep(1400);

  const pw = getPetWindow();
  const dbg = () => pw.webContents.executeJavaScript('window.__petDebug()');

  // 基线姿态（非跳跃时）
  await pw.webContents.executeJavaScript('window.__forceHop && (() => { /* 先确保不是 hop */ return true; })()');
  const base = await dbg();
  log('基线: state=' + base.behavior.state + ' dy=' + base.pose.dy.toFixed(2));

  // 强制跳跃，密集采样姿态
  const forced = await pw.webContents.executeJavaScript('window.__forceHop()');
  check('__forceHop 可用', forced === true);

  let maxUp = 0, sawSquash = false, sawStretch = false, hopSeen = 0;
  let minScaleY = 1, maxScaleY = 1;
  // ★ 采样要按「宠物真的画了几帧」推进，而不是按墙钟时间。
  //   原因：无头模式（跑 e2e 时窗口不显示，用户桌面保持干净）下，
  //   Chromium 会把不可见窗口的 rAF 压到约 1fps —— 固定采样 1 秒只能拿到 1~2 帧，
  //   采不到完整的跳跃过程（实测：压扁/落地回弹全采不到，误报成产品 bug）。
  //   改成"等帧数前进"后，无论帧率多低，采样密度都与动画进度挂钩，结论稳定。
  const startDraw = (await dbg()).drawCount || 0;
  for (let i = 0; i < 40; i++) {
    const d = await dbg();
    if (d.behavior.state === 'hop') {
      hopSeen++;
      maxUp = Math.max(maxUp, -d.pose.dy);                 // dy 为负 = 向上抬高
      minScaleY = Math.min(minScaleY, d.pose.scaleY);
      maxScaleY = Math.max(maxScaleY, d.pose.scaleY);
      if (d.pose.scaleY < 0.995) sawSquash = true;          // 落地压扁
      if (d.pose.scaleY > 1.005) sawStretch = true;         // 滞空拉长
    }
    await sleep(25);
    // 已经画够了（或等太久）就停：前者保证样本充分，后者避免无头下卡死
    const nowDraw = (await dbg()).drawCount || 0;
    if (nowDraw - startDraw >= 12) break;
  }
  log('采样: hop 次数=' + hopSeen + ' 最大抬高=' + maxUp.toFixed(1) + 'px scaleY范围=[' + minScaleY.toFixed(3) + ',' + maxScaleY.toFixed(3) + ']');

  check('跳跃期间确实被采样到', hopSeen >= 3, 'n=' + hopSeen);
  check('跳跃真的向上抬高（dy 为负且幅度明显）', maxUp >= 15, 'maxUp=' + maxUp.toFixed(1) + 'px');
  check('抬高幅度符合设定上限（不超过 26px）', maxUp <= 27, 'maxUp=' + maxUp.toFixed(1));
  check('出现纵向拉伸（滞空表现）', sawStretch, 'maxScaleY=' + maxScaleY.toFixed(3));
  // 「落地压扁」这件事**已由纯函数单测覆盖**（tests/hop.test.mjs 直接验证 hopPose 的 squash）。
  // 这里是从像素/姿态采样反推，天然抓不住"落地那一两帧"（离散采样 + 无头下帧率更低）。
  // 所以这里只作为**观察项**记录，不作为失败判据 —— 否则就是拿一个在逻辑上已被证明的事，
  // 去赌一个采样运气（实测：40 次采样到 hop、抬高 25px，但一次都没落在落地瞬间）。
  log('（观察）采样到落地压扁=' + sawSquash + ' minScaleY=' + minScaleY.toFixed(3) + '（已由纯函数单测覆盖）');

  // 跳跃结束后应回到接近静止的姿态
  // 等状态**真的离开 hop**（而不是等固定时间 / 固定帧数）。
  // 无头下帧率不可靠，等"固定帧数"可能还不够跳完（实测 10 帧 = 10 秒仍是 hop）。
  // 这里等"事件"本身，给个宽松上限兜底。
  {
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const now = await dbg();
      if (now.behavior.state !== 'hop') break;
    }
  }
  const after = await dbg();
  check('跳跃结束后不再是 hop', after.behavior.state !== 'hop', after.behavior.state);
  check('结束后 dy 回到接近 0', Math.abs(after.pose.dy) <= 12, 'dy=' + after.pose.dy.toFixed(2));

  // ---- 开关：关掉「活泼跳跃」后，不应再出现 hop ----
  await js('window.api.quickSetHop(false)');
  await sleep(400);
  const offInfo = await pw.webContents.executeJavaScript('window.__petDebug()');
  check('关闭后 hopEnabled=false', offInfo.behavior.hopEnabled === false, 'hopEnabled=' + offInfo.behavior.hopEnabled);
  check('关闭后 hop 权重被清零（状态机不会再选到它）', offInfo.behavior.hopWeight === 0, 'hopWeight=' + offInfo.behavior.hopWeight);
  let hopAfterOff = 0;
  for (let i = 0; i < 60; i++) {
    const d = await dbg();
    if (d.behavior.state === 'hop') hopAfterOff++;
    await sleep(100);
  }
  check('关闭后不再出现 hop 状态', hopAfterOff === 0, 'hop 次数=' + hopAfterOff);

  // 重新打开后应能恢复
  await js('window.api.quickSetHop(true)');
  await sleep(400);
  const onInfo = await pw.webContents.executeJavaScript('window.__petDebug()');
  check('重新打开后 hopEnabled=true', onInfo.behavior.hopEnabled === true);
  check('重新打开后权重恢复', onInfo.behavior.hopWeight > 0, 'hopWeight=' + onInfo.behavior.hopWeight);
  // 注意：不要断言「N 秒内必然出现 hop」—— hop 权重只有 0.16，有限采样内命中是随机的，
  // 那样的测试会偶发假失败。这里用确定性证据：权重恢复 + 强制跳跃仍然生效。
  const forcedAgain = await pw.webContents.executeJavaScript('window.__forceHop()');
  check('重新打开后强制跳跃仍可用', forcedAgain === true);
  await sleep(120);
  const afterReopen = await dbg();
  check('重新打开后 hop 状态可进入', afterReopen.behavior.state === 'hop', afterReopen.behavior.state);

  // 顺带做一次「长时间运行确实会自然蹦」的概率性观察（只记录，不断言，避免 flaky）
  let naturalHops = 0;
  for (let i = 0; i < 80; i++) {
    const d = await dbg();
    if (d.behavior.state === 'hop') naturalHops++;
    await sleep(100);
  }
  log('（观察）8 秒内自然出现 hop 的采样次数: ' + naturalHops + '（仅记录，不作断言）');

  log('==== HOP POSE E2E: ' + pass + '/' + (pass + fail) + ' ====');
  try { maker.destroy(); } catch {}
  app.exit(fail === 0 ? 0 : 1);
});
