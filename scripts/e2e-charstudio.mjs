// 角色工坊 端到端：
// 1) 面板真的存在、滑块真的改变预览像素（不是"改了没反应"）
// 2) 「生成动画帧」真的把帧加进制作器，且像素不透明、帧与帧之间**确实不同**
//    （只有一帧/帧全一样 = 动画不动，这是最容易蒙混过关的地方）
// 3) 「替换当前帧」只换那一帧，帧数不变
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { registerIpc } from "../src/main/main.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1400, height: 1000, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1400);
  const js = (c) => win.webContents.executeJavaScript(c);

  // 切到工坊页
  await js(`document.querySelector('.tab[data-tab="studio"]').click()`);
  await sleep(200);
  check("工坊面板可切出", await js(`document.querySelector('.tabpane[data-pane="studio"]').classList.contains('active')`));
  check("预览画布存在", await js(`!!document.querySelector('#studioCanvas')`));
  check("配色按钮已生成", (await js(`document.querySelectorAll('#stPalettes .st-pal').length`)) >= 6);
  check("有舞蹈选择框", await js(`!!document.querySelector('#stDance')`));
  check("有「存为动作片段」按钮", await js(`!!document.querySelector('#btnStAddClip')`));
  check("有形体选择框（宠物 / 小人）", await js(`!!document.querySelector('#stFigure')`));
  const figOpts = await js(`[...document.querySelectorAll('#stFigure option')].map(o => o.value).join(',')`);
  check("形体选项是 pet,human", figOpts === 'pet,human', figOpts);
  const danceOpts = await js(`[...document.querySelectorAll('#stDance option')].map(o => o.value).join(',')`);
  check("舞蹈选项齐全（含 8 个真动作）", danceOpts === 'none,bounce,wave,twist,step,nod,spin,greet,party', danceOpts);

  // ★ 预览必须真的画出东西（不是一张空画布）
  const stat = () => js(`(() => {
    const cv = document.querySelector('#studioCanvas');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0, sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] > 200) { opaque++; sumR += d[i]; sumG += d[i+1]; sumB += d[i+2]; }
    }
    return { opaque, total: cv.width * cv.height, w: cv.width, h: cv.height,
      avg: opaque ? [Math.round(sumR/opaque), Math.round(sumG/opaque), Math.round(sumB/opaque)] : null };
  })()`);

  const s0 = await stat();
  check("预览画布有尺寸", s0.w > 0 && s0.h > 0, s0.w + "x" + s0.h);
  check("预览真的画出了不透明像素（不是空画布）", s0.opaque > s0.total * 0.15, s0.opaque + "/" + s0.total);
  check("主体没有糊满整张画布（留白合理）", s0.opaque < s0.total * 0.95, s0.opaque + "/" + s0.total);

  // 换配色 -> 预览颜色必须变（证明"改了真的生效"）
  const before = s0.avg;
  await js(`document.querySelector('#stPalettes .st-pal[data-pal="coal"]').click()`);
  await sleep(200);
  const s1 = await stat();
  check("换配色后预览颜色真的变了", JSON.stringify(s1.avg) !== JSON.stringify(before), JSON.stringify(before) + " -> " + JSON.stringify(s1.avg));
  check("煤球色确实更暗", s1.avg && s1.avg[0] < before[0], JSON.stringify(s1.avg));

  // 改体型 -> 不透明像素数必须变（大小真的变了）
  await js(`(() => { const el = document.querySelector('#stSize'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(250);
  const s2 = await stat();
  check("放大体型后不透明像素变多", s2.opaque > s1.opaque, s1.opaque + " -> " + s2.opaque);

  // 关掉手/脚/尾巴 -> 不透明像素必须减少
  await js(`(() => { for (const id of ['stArms','stLegs','stTail']) { const el = document.querySelector('#' + id); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await sleep(250);
  const s3 = await stat();
  check("关掉手脚尾巴后像素变少", s3.opaque < s2.opaque, s2.opaque + " -> " + s3.opaque);

  // 恢复成默认，准备生成帧
  await js(`(() => {
    const c = document.querySelector('#stPalettes .st-pal[data-pal="sky"]'); if (c) c.click();
    for (const id of ['stArms','stLegs','stTail']) { const el = document.querySelector('#' + id); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    const sz = document.querySelector('#stSize'); sz.value = '70'; sz.dispatchEvent(new Event('input', { bubbles: true }));
    const n = document.querySelector('#stFrames'); n.value = '8'; n.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);

  // ★ 生成动画帧
  await js(`document.querySelector('#btnStAdd').click()`);
  await sleep(1200);
  const badge = await js(`document.querySelector('#frameBadge').textContent`);
  check("生成后帧数 = 8", badge.includes("/8"), badge);

  // 帧必须真的有内容，而且**帧与帧不同**（否则是"静止的8帧"，等于没动画）
  const frameStats = await js(`(() => {
    const imgs = [...document.querySelectorAll('#fsTrack img')];
    return imgs.map((img) => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0, hash = 0;
      // 用内容包围盒的"上下重心"作为帧间差异的指纹（整体浮动会让重心变化）
      let sumY = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] > 200) { opaque++; const px = (i/4) % cv.width; const py = Math.floor((i/4) / cv.width); sumY += py; hash = (hash * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 2147483647; }
      }
      return { opaque, centroidY: opaque ? +(sumY/opaque).toFixed(3) : 0, hash };
    });
  })()`);
  check("每一帧都有不透明内容", frameStats.every((f) => f.opaque > 100), JSON.stringify(frameStats.map(f => f.opaque)));
  const hashes = new Set(frameStats.map((f) => f.hash));
  check("每帧内容确实不同（真的在动）", hashes.size >= 6, "不同帧数=" + hashes.size + "/" + frameStats.length);
  const centroids = frameStats.map((f) => f.centroidY);
  const spread = Math.max(...centroids) - Math.min(...centroids);
  check("帧之间重心有位移（上下浮动真实发生）", spread > 0.5, "spread=" + spread.toFixed(3));
  check("首尾帧重心接近（无缝循环）", Math.abs(centroids[0] - centroids[centroids.length - 1]) < spread * 0.6,
    centroids[0] + " vs " + centroids[centroids.length - 1]);

  // 生成的帧不该被自动抠图吃掉（它是透明的，不是照片）
  check("抠图模式被自动切到「不抠图」", (await js(`document.querySelector('#cutMode').value`)) === 'none');

  // ★ 跳舞：帧与帧之间**肢体位置**必须真的不同。
  //   只断言"帧不同"不够 —— 呼吸浮动也能让帧不同，但那是上下飘、不是跳舞。
  //   这里量左右两侧内容的横向重心：手臂抬起/张开时它会明显变化。
  // ★ 轮廓差异：把每帧的不透明区域降采样成 64x64 掩码，
  //   再和第一帧比对"有多少像素从有变无 / 从无变有"。
  //   为什么不用横向重心：宠物身子很大，手臂摆动会被重心稀释（实测只有 1.2px 变化，
  //   但画面上手臂其实摆得很明显）。轮廓差异直接对应"肢体真的动了"。
  const maskDiff = () => js(`(() => {
    const imgs = [...document.querySelectorAll('#fsTrack img')];
    const N = 64;
    const masks = imgs.map((img) => {
      const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
      const c = cv.getContext('2d'); c.clearRect(0, 0, N, N);
      c.drawImage(img, 0, 0, N, N);
      const d = c.getImageData(0, 0, N, N).data;
      const m = [];
      for (let i = 0; i < N * N; i++) m.push(d[i * 4 + 3] > 128 ? 1 : 0);
      return m;
    });
    if (masks.length < 2) return [];
    const base = masks[0];
    return masks.map((m) => {
      let diff = 0, union = 0;
      for (let i = 0; i < m.length; i++) {
        if (m[i] !== base[i]) diff++;
        if (m[i] || base[i]) union++;
      }
      return union ? diff / union : 0;
    });
  })()`);

  const sideSpread = () => js(`(() => {
    const imgs = [...document.querySelectorAll('#fsTrack img')];
    return imgs.map((img) => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let lN = 0, lX = 0, rN = 0, rX = 0;
      const mid = cv.width / 2;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] < 200) continue;
        const px = (i/4) % cv.width;
        if (px < mid) { lN++; lX += px; } else { rN++; rX += px; }
      }
      return { l: lN ? lX/lN : 0, r: rN ? rX/rN : 0, lN, rN };
    });
  })()`);

  // 清空后只放跳舞帧，避免和上面的 8 帧混在一起。
  // 注意：清空会弹 window.confirm —— 离屏窗口里弹窗没人点，executeJavaScript 会**挂住**，
  // 所以先临时把 confirm 覆盖成"总是确定"。
  // 注意：executeJavaScript 会把表达式**返回值**序列化回主进程；
  // 直接写 `window.confirm = () => true` 的返回值是个函数 -> "An object could not be cloned"
  // -> IPC 报错、套件挂住（实测踩到）。必须用 IIFE 显式返回 undefined。
  await js(`(() => { window.confirm = () => true; return undefined; })()`);
  await js(`document.querySelector('#btnClearFrames').click()`);
  await sleep(400);
  check("清空后没有帧了", (await js(`document.querySelector('#fsTrack .fs-cell') ? document.querySelectorAll('#fsTrack .fs-cell').length : 0`)) === 0,
    await js(`String(document.querySelectorAll('#fsTrack .fs-cell').length)`));
  await js(`(() => { const el = document.querySelector('#stDance'); el.value = 'party'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await js(`document.querySelector('#btnStAdd').click()`);
  await sleep(1600);
  const danceFrames = await sideSpread();
  const danceDiff = await maskDiff();
  check("跳舞帧数量正确", danceFrames.length === 8, String(danceFrames.length));
  check("两侧都有内容（没把一只手画丢）", danceFrames.every(f => f.lN > 50 && f.rN > 50),
    JSON.stringify(danceFrames.map(f => [f.lN, f.rN])));
  const maxDiff = Math.max(...danceDiff);
  check("跳舞时轮廓真的在变（肢体真的动了，不是整体平移）", maxDiff > 0.06,
    "max轮廓差异=" + (maxDiff * 100).toFixed(1) + "%");

  // 不跳舞 vs 跳舞：横向摆幅必须明显更小（证明 dance 参数真的生效）
  await js(`document.querySelector('#btnClearFrames').click()`);
  await sleep(300);
  await js(`(() => { const el = document.querySelector('#stDance'); el.value = 'none'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(250);
  await js(`document.querySelector('#btnStAdd').click()`);
  await sleep(1600);
  const stillDiff = await maskDiff();
  const stillMax = Math.max(...stillDiff);
  check("选「不跳」时轮廓变化明显更小（dance 参数真的生效）", stillMax < maxDiff * 0.6,
    "still=" + (stillMax * 100).toFixed(1) + "% vs dance=" + (maxDiff * 100).toFixed(1) + "%");

  // ★ 跳舞速度：调了必须真的改变帧时长（否则滑块是摆设）
  {
    check("有跳舞速度滑块", await js(`!!document.querySelector('#stSpeed')`));
    const framesWithSpeed = (v) => js(`(async () => {
      const cs = await import('../shared/charstudio.js');
      const el = document.querySelector('#stSpeed');
      el.value = '${v}'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const cfg = cs.normalizeCharacter({ figureType: 'human', dance: 'party', danceSpeed: Number(el.value) / 100 });
      const specs = cs.characterFrames(cfg, 8);
      return { durs: specs.map(s => s.durationMs), label: document.querySelector('#stSpeedV').textContent };
    })()`);
    const slow = await framesWithSpeed(50);
    const fast = await framesWithSpeed(200);
    check("速度 0.5x 时帧时长更长", slow.durs[0] > fast.durs[0], slow.durs[0] + ' vs ' + fast.durs[0]);
    check("速度文案跟着变（0.5× / 2.0×）", slow.label === '0.5×' && fast.label === '2.0×',
      slow.label + ' / ' + fast.label);
    await js(`(() => { const el = document.querySelector('#stSpeed'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); return undefined; })()`);
    await sleep(200);
  }

  // ★ 新舞步（侧步 / 点头 / 转圈 / 打招呼）必须真的动，而且动的是"对的地方"。
  //   重点验两条容易被做错的语义：
  //     ① 侧步要有**水平位移**（只有上下浮动的话，怎么动都像原地弹）
  //     ② 点头必须是**头往下沉/压扁**，不是平面内旋转（那叫歪头）
  {
    const shapeOf = (dance) => js(`(async () => {
      const mod = await import('./charrender.js');
      const cs = await import('../shared/charstudio.js');
      const cfg = cs.normalizeCharacter({ figureType: 'human', dance: '${dance}', size: 0.85 });
      const specs = cs.characterFrames(cfg, 8);
      const out = [];
      for (const spec of specs) {
        const cv = document.createElement('canvas');
        mod.renderCharacter(cv, cfg, { width: 160, height: 160, frame: spec });
        const d = cv.getContext('2d').getImageData(0, 0, 160, 160).data;
        let top = -1, bot = -1, sumX = 0, n = 0;
        for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
          if (d[(y*160+x)*4+3] > 200) {
            if (top < 0) top = y; bot = y; sumX += x; n++;
          }
        }
        out.push({ top, bot, cx: n ? +(sumX/n).toFixed(2) : 0 });
      }
      return out;
    })()`);

    const step = await shapeOf('step');
    const stepCx = step.map(f => f.cx);
    check('侧步有水平位移（真的左右走，不是原地弹）',
      Math.max(...stepCx) - Math.min(...stepCx) > 1.0,
      'cx spread=' + (Math.max(...stepCx) - Math.min(...stepCx)).toFixed(2));

    const nod = await shapeOf('nod');
    const nodTop = nod.map(f => f.top);
    check('点头时头顶位置真的在动（下压可见）',
      Math.max(...nodTop) - Math.min(...nodTop) >= 2,
      'top spread=' + (Math.max(...nodTop) - Math.min(...nodTop)));
    // 点头不该让整体横向重心大幅偏移（那是歪头的特征）
    const nodCx = nod.map(f => f.cx);
    check('点头不是歪头（横向重心基本不晃）',
      Math.max(...nodCx) - Math.min(...nodCx) < 2.0,
      'cx spread=' + (Math.max(...nodCx) - Math.min(...nodCx)).toFixed(2));

    const spin = await shapeOf('spin');
    const spinCx = spin.map(f => f.cx);
    check('转圈时头真的在左右偏', Math.max(...spinCx) - Math.min(...spinCx) > 0.8,
      'cx spread=' + (Math.max(...spinCx) - Math.min(...spinCx)).toFixed(2));

    const greet = await shapeOf('greet');
    check('打招呼时手真的举起来了（不透明像素有变化）',
      new Set(greet.map(f => f.bot)).size > 1 || new Set(greet.map(f => f.top)).size > 1,
      JSON.stringify(greet.map(f => [f.top, f.bot])));
  }

  // ★ 小人形体：必须真的画出"头 + 身子"，而不是圆滚滚的宠物。
  //   用几何量而不是"看起来像"：头部的宽度应该明显窄于整身、且集中在画布上半部。
  {
    const rowProfile = () => js(`(() => {
      const cv = document.querySelector('#studioCanvas');
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      const rows = [];
      for (let y = 0; y < cv.height; y++) {
        let n = 0, x0 = cv.width, x1 = -1;
        for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] > 200) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        rows.push({ n, w: x1 >= x0 ? x1 - x0 + 1 : 0 });
      }
      return { rows, w: cv.width, h: cv.height };
    })()`);

    // 先看宠物（默认）
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'pet'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(350);
    const petProf = await rowProfile();

    // 换小人
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'human'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(350);
    const humanProf = await rowProfile();

    check("切到小人后画面变了（不是同一张图）", JSON.stringify(petProf.rows) !== JSON.stringify(humanProf.rows), 'changed');

    // 小人的特征：上半部有一个**明显更窄的头部段**（颈/头），宠物是头身一体的宽块
    const nonEmpty = (p) => p.rows.filter((r) => r.n > 0);
    const hp = nonEmpty(humanProf), pp = nonEmpty(petProf);
    check("小人画出了内容", hp.length > 20, String(hp.length));
    // 头部最宽处 vs 整身最宽处：小人应该有明显的宽窄对比（头比身子窄）
    const maxW = Math.max(...hp.map((r) => r.w));
    const topHalf = hp.slice(0, Math.floor(hp.length / 2));
    const minTopW = Math.min(...topHalf.map((r) => r.w).filter((w) => w > 2));
    check("小人有明显的头身宽窄对比（头比身子窄）", maxW > minTopW * 1.6, `max=${maxW} minTop=${minTopW}`);
    // 宠物是头身一体：上下宽度变化没那么剧烈
    const pmax = Math.max(...pp.map((r) => r.w));
    const pTop = pp.slice(0, Math.floor(pp.length / 2));
    const pmin = Math.min(...pTop.map((r) => r.w).filter((w) => w > 2));
    check("宠物仍是头身一体（宽窄对比更小）", (pmax / pmin) < (maxW / minTopW), `pet=${(pmax/pmin).toFixed(2)} human=${(maxW/minTopW).toFixed(2)}`);

    // 小人也要能跳舞（复用同一套机制）
    await js(`(() => { const el = document.querySelector('#stDance'); el.value = 'party'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    await js(`(() => { window.confirm = () => true; return undefined; })()`);
    await js(`document.querySelector('#btnClearFrames').click()`);
    await sleep(300);
    await js(`document.querySelector('#btnStAdd').click()`);
    await sleep(1500);
    const humanDance = await sideSpread();
    const humanDiff = await maskDiff();
    check("小人跳舞生成了 8 帧", humanDance.length === 8, String(humanDance.length));
    check("小人跳舞时轮廓真的在变（手臂在动）", Math.max(...humanDiff) > 0.06,
      "max轮廓差异=" + (Math.max(...humanDiff) * 100).toFixed(1) + "%");
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'pet'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(250);
  }

  // ★ 「照着照片捏一个小人」：识别到的比例与站姿必须真的进到几何里。
  //   这里不依赖真模型（跑不动），而是把 poseEstimate 的返回值在**主进程**拦下来，
  //   塞一组构造好的关键点 —— 这样测的是"拿到关键点之后这条链路对不对"。
  {
    const body = await js(`!!document.querySelector('#btnPoseToChar')`);
    check('身体识别面板有「照着照片捏一个小人」按钮', body === true, String(body));

    // 造一组关键点：站直、左臂举起（用来验证"站姿被带进去"）
    const kps = [
      ['nose', 0.50, 0.16], ['leftShoulder', 0.40, 0.30], ['rightShoulder', 0.60, 0.30],
      ['leftHip', 0.43, 0.50], ['rightHip', 0.57, 0.50],
      ['leftElbow', 0.30, 0.30], ['rightElbow', 0.64, 0.46],
      ['leftWrist', 0.20, 0.30], ['rightWrist', 0.66, 0.62],
      ['leftKnee', 0.43, 0.70], ['rightKnee', 0.57, 0.70],
      ['leftAnkle', 0.43, 0.88], ['rightAnkle', 0.57, 0.88],
    ].map(([name, x, y]) => ({ name, x, y, score: 0.9 }));

    ipcMain.removeHandler('pose:estimate');
    ipcMain.handle('pose:estimate', async () => ({
      ok: true, keypoints: kps, srcWidth: 256, srcHeight: 256, material: { ok: true },
    }));

    // 先确保有一帧可识别
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'human'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(250);
    await js(`(() => { window.confirm = () => true; return undefined; })()`);
    await js(`document.querySelector('#btnClearFrames').click()`);
    await sleep(300);
    await js(`document.querySelector('#btnStAdd').click()`);
    await sleep(1500);

    // 把当前帧换成"橙色为主"的图，让取色有明确预期。
    // 做法：直接在渲染层造一张橙底 + 白边的图并塞进 state（走真实导入路径太绕）。
    await js(`(async () => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgb(235,140,60)'; c.fillRect(0, 0, 64, 64);   // 主体橙
      c.fillStyle = 'rgb(255,255,255)'; c.fillRect(0, 0, 64, 8);     // 一点白墙（应被排除）
      const d = c.getImageData(0, 0, 64, 64);
      // 通过公开路径导入（拖入 drop）
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'orange.png', { type: 'image/png' }));
      document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`);
    await sleep(1500);

    const beforePlan = await js(`(async () => {
      const cs = await import('../shared/charstudio.js');
      const cv = document.querySelector('#studioCanvas');
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
      return { opaque };
    })()`);

    await js(`document.querySelector('#btnPoseToChar').click()`);
    await sleep(1500);
    const afterStatus = await js(`document.querySelector('#status') ? document.querySelector('#status').textContent : ''`);
    check('点按钮后给出了结果反馈', /捏出一个小人|识别失败|没识别到/.test(String(afterStatus)), String(afterStatus).slice(0, 80));
    check('真的切到了工坊页（当场能看到）', (await js(`document.querySelector('.tabpane[data-pane="studio"]').classList.contains('active')`)) === true);

    // 比例与站姿必须真的落到界面上（读 select/复选框之外的状态：看画面是否变化）
    const afterPlan = await js(`(() => {
      const cv = document.querySelector('#studioCanvas');
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
      return { opaque };
    })()`);
    check('画面真的变了（比例/站姿进了几何）', beforePlan.opaque !== afterPlan.opaque,
      beforePlan.opaque + ' -> ' + afterPlan.opaque);
    check('形体被切成小人', (await js(`document.querySelector('#stFigure').value`)) === 'human',
      await js(`document.querySelector('#stFigure').value`));

    // ★ 配色也要取自照片：状态栏应该报出主色，画面上应该出现"照片取色"色块
    const statusText = await js(`document.querySelector('#status').textContent`);
    check('状态栏报出了从照片取到的主色', /配色取自照片\s*#[0-9a-f]{6}/i.test(String(statusText)),
      String(statusText).slice(0, 120));
    check('调色板里出现「照片取色」那一格',
      (await js(`!!document.querySelector('#stPalettes .st-pal-custom')`)) === true);

    // 取到的颜色必须真的画进预览（不是只显示在状态栏）
    const drawnColor = await js(`(() => {
      const cv = document.querySelector('#studioCanvas');
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      // 取所有不透明像素的平均色：橙色调 => 红 > 蓝
      let n = 0, sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] > 200) { n++; sr += d[i]; sg += d[i+1]; sb += d[i+2]; }
      }
      return n ? { r: Math.round(sr/n), g: Math.round(sg/n), b: Math.round(sb/n) } : null;
    })()`);
    check('预览的主色调确实是照片的橙色（红 > 蓝）',
      !!drawnColor && drawnColor.r > drawnColor.b + 20, JSON.stringify(drawnColor));

    // 点预设配色要能放弃照片取色（否则点了像没反应）
    await js(`(() => { const b = document.querySelector('#stPalettes .st-pal[data-pal="coal"]'); if (b) b.click(); return undefined; })()`);
    await sleep(400);
    check('点预设配色后「照片取色」色块消失',
      (await js(`!!document.querySelector('#stPalettes .st-pal-custom')`)) === false);

    // ★ 身体比例滑块：照照片捏完之后要能**微调**（识别不准时这是唯一的出路）
    const propVis = await js(`['stHeadRow','stTorsoRow','stLegRow','stArmRow'].map(id => !document.querySelector('#' + id).hidden)`);
    check('小人形体下比例滑块可见', propVis.every(Boolean), JSON.stringify(propVis));
    // 滑块值应该被"照照片"的结果填过（不是残留默认值）
    const sliderVals = await js(`['stHead','stTorso','stLeg','stArm'].map(id => document.querySelector('#' + id).value)`);
    check('比例滑块被自动填入', sliderVals.every((v) => Number(v) > 0), JSON.stringify(sliderVals));

    // 拖动"腿的长度" -> 必须真的改变几何。
    //
    // ★ 这里踩过两次指标选错（记下来省得再犯）：
    //   ① 量"整体重心"：比例是**归一化**的（头+躯干+腿 = 总高），
    //      拉长腿的同时头会变小，重心反而**上移**（实测 68.86 -> 56.64）。
    //   ② 量"最下面 20% 的像素数"：脚永远在最下面，那块几乎不变
    //      （实测 463 -> 442，甚至更少）。
    //   → 正确做法：量**真实渲染出来的像素**（而不是从滑块重算 —— 那只能证明滑块动了）。
    //     比例归一化后，腿变长必然让头变小，所以不透明像素总数会**明显减少**。
    //     实测：leg=0.12 -> 6628 像素；leg=0.42 -> 4789 像素（同一条渲染路径）。
    const opaqueCount = () => js(`(() => {
      const cv = document.querySelector('#studioCanvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++;
      return n;
    })()`);
    const beforeLeg = await opaqueCount();
    await js(`(() => { const el = document.querySelector('#stLeg'); el.value = '42'; el.dispatchEvent(new Event('input', { bubbles: true })); return undefined; })()`);
    await sleep(400);
    const afterLeg = await opaqueCount();
    check('拉长腿后画面真的重画了（不透明像素明显变化）', Math.abs(afterLeg - beforeLeg) > beforeLeg * 0.05,
      beforeLeg + ' -> ' + afterLeg);
    check('腿变长 -> 头相应变小 -> 总像素减少（比例归一化生效）', afterLeg < beforeLeg,
      beforeLeg + ' -> ' + afterLeg);
    check('比例数值文案跟着更新', (await js(`document.querySelector('#stLegV').textContent`)) === '42%',
      await js(`document.querySelector('#stLegV').textContent`));

    // 切回宠物：比例滑块必须隐藏（宠物没有这些比例）
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'pet'; el.dispatchEvent(new Event('input', { bubbles: true })); return undefined; })()`);
    await sleep(350);
    const petVis = await js(`['stHeadRow','stTorsoRow','stLegRow','stArmRow'].map(id => !document.querySelector('#' + id).hidden)`);
    check('宠物形体下比例滑块隐藏', petVis.every((v) => v === false), JSON.stringify(petVis));
    // 再切回小人：滑块要重新出现，且比例没被丢掉
    await js(`(() => { const el = document.querySelector('#stFigure'); el.value = 'human'; el.dispatchEvent(new Event('input', { bubbles: true })); return undefined; })()`);
    await sleep(350);
    const backVis = await js(`['stHeadRow','stTorsoRow','stLegRow','stArmRow'].map(id => !document.querySelector('#' + id).hidden)`);
    check('切回小人后比例滑块重新出现', backVis.every(Boolean), JSON.stringify(backVis));
    check('切回后腿的比例仍在（没被宠物形态丢掉）',
      (await js(`document.querySelector('#stLeg').value`)) === '42',
      await js(`document.querySelector('#stLeg').value`));
  }

  // ★ 工坊也能存「动作片段」：多存几段不同舞步，桌宠上桌后会随机切换。
  //   这条链路此前只接在"照片微动作"上 —— 捏的小人只能有一个舞步（真缺口）。
  {
    // 同样的坑：返回值必须是可序列化的，所以用 IIFE 显式返回 undefined
    await js(`(() => { window.confirm = () => true; return undefined; })()`);
    await js(`document.querySelector('#btnClearFrames').click()`);
    await sleep(300);
    // 清掉之前可能留下的片段，从零开始数
    await js(`(() => { for (const b of document.querySelectorAll('#clipList .clip-del')) b.click(); return undefined; })()`);
    await sleep(300);
    check("片段列表初始为空", (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 0);

    const addClip = async (dance) => {
      await js(`(() => { const el = document.querySelector('#stDance'); el.value = '${dance}'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(250);
      await js(`document.querySelector('#btnStAddClip').click()`);
      await sleep(900);
    };
    await addClip('party');
    await addClip('wave');
    await addClip('twist');
    // ★ 一键存全部舞步：8 个舞步手动点 8 次太烦，而且很容易只存一两个，
    //   结果桌宠还是"老重复一个动作"。
    {
      // 先清空，从零开始
      await js(`(() => { for (const b of document.querySelectorAll('#clipList .clip-del')) b.click(); return undefined; })()`);
      await sleep(400);
      check("清空后片段列表为空", (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 0);
      await js(`document.querySelector('#btnStAllClips').click()`);
      await sleep(2500);
      const ids = await js(`[...document.querySelectorAll('#clipList .clip-chip')].map(c => c.dataset.clip)`);
      check("一键存全部：存下 8 段（= 除「不跳」外的全部舞步）", ids.length === 8, String(ids.length));
      check("一键存全部：片段 id 互不重复（撞号会静默覆盖整段动作）",
        new Set(ids).size === ids.length, JSON.stringify(ids));
      // 每段都该有帧，不是空壳
      const sizes = await js(`(async () => {
        const cs = await import('../shared/charstudio.js');
        return [...document.querySelectorAll('#clipList .clip-chip')].map(c => c.textContent);
      })()`);
      check("每段片段都有帧（不是空壳）", sizes.every((t) => /\d+帧/.test(t) && !/· 0帧/.test(t)),
        JSON.stringify(sizes));
      // 撤销要能一次撤回这 8 段
      await js(`document.querySelector('#btnUndo').click()`);
      await sleep(900);
      check("一键存全部可一次撤销（回到 0 段）",
        (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 0,
        await js(`String(document.querySelectorAll('#clipList .clip-chip').length)`));
    }

    // 再手动存 3 段（后面的断言依赖这 3 段）
    await addClip('party');
    await addClip('wave');
    await addClip('twist');
    const chips = await js(`[...document.querySelectorAll('#clipList .clip-chip')].map(c => c.textContent.trim())`);
    check("存了 3 段动作片段", chips.length === 3, JSON.stringify(chips));
    check("片段名能分辨出舞步（不是一串 id）",
      chips.join('|').includes('狂欢') && chips.join('|').includes('招手') && chips.join('|').includes('扭扭'), JSON.stringify(chips));
    // 存片段不该动主帧
    check("存片段不会往主帧里塞帧", (await js(`document.querySelectorAll('#fsTrack .fs-cell').length`)) === 0,
      await js(`String(document.querySelectorAll('#fsTrack .fs-cell').length)`));
    // 片段要能撤销
    check("存片段后可撤销", (await js(`document.querySelector('#btnUndo').disabled`)) === false);
    await js(`document.querySelector('#btnUndo').click()`);
    await sleep(900);
    check("撤销后少了一段片段", (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 2,
      await js(`String(document.querySelectorAll('#clipList .clip-chip').length)`));
    await js(`document.querySelector('#btnRedo').click()`);
    await sleep(900);
    check("重做后又回到 3 段", (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 3,
      await js(`String(document.querySelectorAll('#clipList .clip-chip').length)`));

    // ★ 导出宠物包：clips 必须真的写进包里，且每段帧文件都在
    await js(`(() => { const el = document.querySelector('#stDance'); el.value = 'party'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(200);
    await js(`document.querySelector('#btnStAdd').click()`);
    await sleep(1500);
    check("主帧也生成了（导出需要主帧）", (await js(`document.querySelectorAll('#fsTrack .fs-cell').length`)) === 8,
      await js(`String(document.querySelectorAll('#fsTrack .fs-cell').length)`));
    // 把第一段（狂欢）的权重调高两次：它应该更常出现
    await js(`(() => {
      const plus = document.querySelector('#clipList .clip-chip .clip-w[data-dir="1"]');
      if (plus) { plus.click(); plus.click(); }
      return undefined;
    })()`);
    await sleep(300);
    const wText = await js(`document.querySelector('#clipList .clip-chip .clip-wv').textContent`);
    check("调高两次后显示为「常出现」", wText === '常', String(wText));

    // ★ 真导出一次，拿到**真实的包数据**。
    //   注意：不能去 stub 渲染进程的 window.api —— contextBridge 暴露的对象是只读的，
    //   赋值会静默失败（实测：captured 一直是 null）。正确做法是在**主进程**拦 IPC 通道，
    //   这样渲染进程走的是完整的真实导出链路。
    let captured = null;
    ipcMain.removeHandler('pack:save');
    ipcMain.handle('pack:save', async (e, args) => {
      captured = args;
      return { ok: true, path: 'X:/fake.petpack' };
    });
    await js(`document.querySelector('#btnExport').click()`);
    await sleep(1500);
    const exported = captured ? {
      clipCount: (captured.pack.clips || []).length,
      clips: captured.pack.clips || [],
      frameCount: (captured.images || []).length,
      clipImageKeys: Object.keys(captured.clipImages || {}),
      // 带上片段首帧的 dataUrl，供渲染层解码后量真实尺寸
      firstClipUrl: (() => {
        const keys = Object.keys(captured.clipImages || {});
        const f = keys.length ? captured.clipImages[keys[0]][0] : null;
        return (f && f.dataUrl) || '';
      })(),
      mainUrl: (captured.images && captured.images[0] && captured.images[0].dataUrl) || '',
    } : null;
    check("导出时拿到了包数据", !!exported, JSON.stringify(exported));
    check("导出的包里带 3 段动作片段", exported && exported.clipCount === 3, JSON.stringify(exported && exported.clips.map((c) => c.name)));
    // ★ 片段的画布尺寸必须和主帧一致 —— 否则运行时切换片段会重算布局，
    //   宠物会在切过去那一瞬间突然变大/变小（窗口也跟着跳）。
    const sizeCheck = await js(`(async () => {
      const load = (url) => new Promise((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res(null);
        im.src = url;
      });
      const main = ${JSON.stringify(exported && exported.mainUrl)} ? await load(${JSON.stringify(exported && exported.mainUrl)}) : null;
      const clip = ${JSON.stringify(exported && exported.firstClipUrl)} ? await load(${JSON.stringify(exported && exported.firstClipUrl)}) : null;
      return { main, clip };
    })()`);
    check("主帧与片段都能解码出尺寸", !!(sizeCheck && sizeCheck.main && sizeCheck.clip), JSON.stringify(sizeCheck));
    check("片段的画布尺寸与主帧一致（切动作不会突然变大变小）",
      !!(sizeCheck && sizeCheck.main && sizeCheck.clip
        && sizeCheck.clip.w === sizeCheck.main.w && sizeCheck.clip.h === sizeCheck.main.h),
      JSON.stringify(sizeCheck));
    // ★ 权重：运行时按权重随机切换，用户必须能调（否则文案是空话）
    check("每段片段都带权重（默认 1）", exported && exported.clips.every((c) => Number(c.weight) > 0),
      JSON.stringify(exported && exported.clips.map((c) => c.weight)));
    const wBtnCount = await js(`document.querySelectorAll('#clipList .clip-w').length`);
    check("每段片段都有加减权重的按钮", wBtnCount === 6, String(wBtnCount));
    check("每段片段都有帧文件名", exported && exported.clips.every((c) => c.frames.length > 0 && c.frames.every((f) => f.file)),
      JSON.stringify(exported && exported.clips.map((c) => c.frames.length)));
    check("片段帧数据也一并给了导出（不是悬空引用）", exported && exported.clipImageKeys.length === 3, JSON.stringify(exported && exported.clipImageKeys));
    check("片段名是舞步名（用户能看懂）", exported && exported.clips.map((c) => c.name).join('|').includes('狂欢'),
      JSON.stringify(exported && exported.clips.map((c) => c.name)));
    check("调高后的权重真的写进了包（2.0）", exported && exported.clips[0] && Number(exported.clips[0].weight) === 2,
      JSON.stringify(exported && exported.clips.map((c) => c.weight)));
  }

  // ★ 替换当前帧：帧数不变
  await js(`(() => { const cells = document.querySelectorAll('#fsTrack .fs-cell'); cells[2].click(); })()`);
  await sleep(400);
  await js(`(() => { const n = document.querySelector('#stFrames'); n.value = '4'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  await js(`document.querySelector('#btnStReplace').click()`);
  await sleep(800);
  const badge2 = await js(`document.querySelector('#frameBadge').textContent`);
  check("替换后帧数不变（仍是 8）", badge2.includes("/8"), badge2);

  // 撤销要能恢复
  check("生成/替换后可撤销", (await js(`document.querySelector('#btnUndo').disabled`)) === false);

  // ★ 往返验证放在最后：它会把内容换成「只有 1 帧的包」，
  //   放在前面会破坏后面需要 8 帧 / fsTrack 格子的断言。
  {
    // ★ 往返验证：真走一遍「打开宠物包」-> 片段必须还在。
    //   背景：applyPack 以前只恢复参数、**完全不恢复 pack.clips** ——
    //   打开带多段动作的包时那些动作直接丢了（片段列表空着，用户既看不到也导不出去）。
    //   这里在主进程拦 pack:open，喂一个**真实的、带片段的包**，
    //   然后点「打开宠物包」，最后检查界面上的片段列表。
    // 先把界面上的片段清空，确保后面看到的是"从包里恢复出来的"
    await js(`(() => { for (const b of document.querySelectorAll('#clipList .clip-del')) b.click(); return undefined; })()`);
    await sleep(400);
    check("往返前：片段列表已清空", (await js(`document.querySelectorAll('#clipList .clip-chip').length`)) === 0);

    // 在主进程拦 pack:open，喂一个真实构造的、带片段的包
    ipcMain.removeHandler('pack:open');
    ipcMain.handle('pack:open', async () => {
      const cs = await import('../src/shared/charstudio.js');
      const { zipCreate } = await import('../src/shared/zip.js');
      const { normalizePack } = await import('../src/shared/petpack.js');
      const cfg = cs.normalizeCharacter({ figureType: 'human', dance: 'party', size: 0.8 });
      const specs = cs.characterFrames(cfg, 4);
      // 用纯色小图当帧（这里只验"片段能不能恢复"，不验画面质量）
      const { encodePNG } = await import('../src/shared/png.js');
      const solid = (r, g, b) => {
        const px = new Uint8ClampedArray(32 * 32 * 4);
        for (let i = 0; i < 32 * 32; i++) { px[i*4] = r; px[i*4+1] = g; px[i*4+2] = b; px[i*4+3] = 255; }
        return encodePNG(32, 32, Buffer.from(px));
      };
      const mainPng = solid(200, 200, 200);
      const clipPng = [solid(255, 60, 60), solid(60, 60, 255)];
      const pack = normalizePack({
        schema: 2, id: 'rt', name: '往返测试',
        frames: [{ file: 'frame_000.png', durationMs: 90 }],
        clips: [{ id: 'cRT', name: '狂欢', weight: 1.5,
          frames: clipPng.map((_, i) => ({ file: 'clip_cRT_00' + i + '.png', durationMs: 90 })) }],
        canvas: { width: 32, height: 32 }, render: { scale: 0.5 },
        animation: { idle: 'play', fps: 10, click: 'bounce', hover: 'grow' },
        physics: { gravity: 1.2, bounce: 0.5, roam: false, roamSpeed: 0 },
        bubble: { enabled: false, lines: [] },
        behavior: { startCorner: 'bottom-right', keepAbove: true },
      });
      const tmp = path.join(os.tmpdir(), 'e2e-roundtrip-' + Date.now() + '.petpack');
      fs.writeFileSync(tmp, zipCreate([
        { name: 'pet.json', data: JSON.stringify(pack, null, 2) },
        { name: 'frame_000.png', data: mainPng },
        { name: 'clip_cRT_000.png', data: clipPng[0] },
        { name: 'clip_cRT_001.png', data: clipPng[1] },
      ]));
      // main.js 没导出 readPackFile，这里按它的同一条规则把图片解成 dataUrl
      // （结构必须一致：clips[].frames[].dataUrl）
      const frames = [{ file: 'frame_000.png', dataUrl: 'data:image/png;base64,' + mainPng.toString('base64'), durationMs: 90 }];
      const clips = [{
        id: 'cRT', name: '狂欢', weight: 1.5,
        frames: clipPng.map((b, i) => ({
          file: 'clip_cRT_00' + i + '.png',
          dataUrl: 'data:image/png;base64,' + b.toString('base64'),
          durationMs: 90,
        })),
      }];
      return { pack, frames, clips, file: tmp };
    });

    await js(`document.querySelector('#btnOpenPack').click()`);
    await sleep(2500);
    const afterOpen = await js(`(() => {
      const chips = [...document.querySelectorAll('#clipList .clip-chip')];
      return {
        count: chips.length,
        names: chips.map((c) => c.textContent.trim()),
        status: (document.querySelector('#status') || {}).textContent || '',
      };
    })()`);
    check("往返：打开包后片段被恢复（不是丢掉）", afterOpen.count === 1, JSON.stringify(afterOpen));
    check("往返：恢复出来的片段名正确", afterOpen.names.join('|').includes('狂欢'), JSON.stringify(afterOpen.names));
    check("往返：状态栏提示了含几段动作", /含 1 段动作/.test(afterOpen.status), afterOpen.status.slice(0, 80));

    // 恢复出来的片段必须能再导出（带图片数据，不是空壳）
    let recaptured = null;
    ipcMain.removeHandler('pack:save');
    ipcMain.handle('pack:save', async (e, args) => { recaptured = args; return { ok: true, path: 'X:/rt.petpack' }; });
    await js(`document.querySelector('#btnExport').click()`);
    await sleep(1500);
    check("往返：恢复的片段能再次导出（帧数据还在）",
      !!(recaptured && recaptured.pack.clips && recaptured.pack.clips.length === 1
        && Object.keys(recaptured.clipImages || {}).length === 1),
      JSON.stringify(recaptured && { clips: recaptured.pack.clips.length, imgs: Object.keys(recaptured.clipImages || {}).length }));
  }

  log("==== CHAR STUDIO E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
