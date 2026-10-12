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
  check("跳舞帧数量正确", danceFrames.length === 8, String(danceFrames.length));
  const lMin = Math.min(...danceFrames.map(f => f.l)), lMax = Math.max(...danceFrames.map(f => f.l));
  const rMin = Math.min(...danceFrames.map(f => f.r)), rMax = Math.max(...danceFrames.map(f => f.r));
  check("左手位置真的在动（不是只上下飘）", (lMax - lMin) > 1.5, "left spread=" + (lMax - lMin).toFixed(2));
  check("右手位置真的在动", (rMax - rMin) > 1.5, "right spread=" + (rMax - rMin).toFixed(2));
  check("两侧都有内容（没把一只手画丢）", danceFrames.every(f => f.lN > 50 && f.rN > 50),
    JSON.stringify(danceFrames.map(f => [f.lN, f.rN])));

  // 不跳舞 vs 跳舞：横向摆幅必须明显更小（证明 dance 参数真的生效）
  await js(`document.querySelector('#btnClearFrames').click()`);
  await sleep(300);
  await js(`(() => { const el = document.querySelector('#stDance'); el.value = 'none'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(250);
  await js(`document.querySelector('#btnStAdd').click()`);
  await sleep(1600);
  const stillFrames = await sideSpread();
  const stillSpread = Math.max(...stillFrames.map(f => f.l)) - Math.min(...stillFrames.map(f => f.l));
  check("选「不跳」时横向摆幅明显更小（dance 参数真的生效）", stillSpread < (lMax - lMin) * 0.6,
    "still=" + stillSpread.toFixed(2) + " vs dance=" + (lMax - lMin).toFixed(2));

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
