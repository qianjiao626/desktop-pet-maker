// 角色工坊 端到端：
// 1) 面板真的存在、滑块真的改变预览像素（不是"改了没反应"）
// 2) 「生成动画帧」真的把帧加进制作器，且像素不透明、帧与帧之间**确实不同**
//    （只有一帧/帧全一样 = 动画不动，这是最容易蒙混过关的地方）
// 3) 「替换当前帧」只换那一帧，帧数不变
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
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
  check("舞蹈选项齐全（含 4 个真动作）", danceOpts === 'none,bounce,wave,twist,party', danceOpts);

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
    } : null;
    check("导出时拿到了包数据", !!exported, JSON.stringify(exported));
    check("导出的包里带 3 段动作片段", exported && exported.clipCount === 3, JSON.stringify(exported && exported.clips.map((c) => c.name)));
    check("每段片段都有帧文件名", exported && exported.clips.every((c) => c.frames.length > 0 && c.frames.every((f) => f.file)),
      JSON.stringify(exported && exported.clips.map((c) => c.frames.length)));
    check("片段帧数据也一并给了导出（不是悬空引用）", exported && exported.clipImageKeys.length === 3, JSON.stringify(exported && exported.clipImageKeys));
    check("片段名是舞步名（用户能看懂）", exported && exported.clips.map((c) => c.name).join('|').includes('狂欢'),
      JSON.stringify(exported && exported.clips.map((c) => c.name)));
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

  log("==== CHAR STUDIO E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
