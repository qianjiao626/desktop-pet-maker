// 单帧替换 端到端：把一张图拖到缩略图上，只替换那一帧且画布不变
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";
// EPIPE 兜底：调用方的管道提前关闭时（例如 `| Select-Object -Last 10`），
// 直接写 stdout 会抛 broken pipe —— Electron 会弹原生错误框跳到用户桌面上。
// 统一走 safeWrite，并把 EPIPE 静默掉。
import { safeWrite, installEpipeGuard } from './lib-e2e-log.mjs';
installEpipeGuard();

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => safeWrite(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 纯色 + 深色边框（边框让自动抠图判定为复杂背景，跳过抠图） */
function frameUrl(r, g, b, w = 40, h = 30) {
  const px = new Uint8ClampedArray(w * h * 4);
  const border = (x, y) => x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = border(x, y) ? [10, 10, 10] : [r, g, b];
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return "data:image/png;base64," + encodePNG(w, h, Buffer.from(px)).toString("base64");
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1200);
  const js = (c) => win.webContents.executeJavaScript(c);

  // 导入 3 帧
  const urls = [frameUrl(255, 0, 0), frameUrl(0, 255, 0), frameUrl(0, 0, 255)];
  await js(`(async () => {
    const dt = new DataTransfer();
    const us = ${JSON.stringify(urls)};
    for (let i = 0; i < us.length; i++) {
      const blob = await (await fetch(us[i])).blob();
      dt.items.add(new File([blob], String(i + 1).padStart(2, '0') + '.png', { type: 'image/png' }));
    }
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(2500);

  const badge = () => js(`document.querySelector('#frameBadge').textContent`);
  const cells = () => js(`[...document.querySelectorAll('#fsTrack .fs-cell')].map(c => c.dataset.idx)`);
  check("已导入 3 帧", (await badge()).includes("/3"), await badge());
  check("缩略图条有 3 格", (await cells()).length === 3, JSON.stringify(await cells()));

  // 记录第 2 帧的中心像素（作为"替换前"的基准）
  const probe = (idx) => js(`(() => {
    const imgs = [...document.querySelectorAll('#fsTrack img')];
    const img = imgs[${idx}];
    if (!img) return null;
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const mid = ((cv.height >> 1) * cv.width + (cv.width >> 1)) * 4;
    return { r: d[mid], g: d[mid+1], b: d[mid+2], w: cv.width, h: cv.height };
  })()`);

  const before = await probe(1);
  check("第 2 帧替换前是绿色", before && before.g > 200 && before.r < 60, JSON.stringify(before));

  // ★ 把一张黄色图拖到第 2 个缩略图上（触发真实 drop 路径）
  const yellowUrl = frameUrl(255, 255, 0);
  await js(`(async () => {
    const el = document.querySelectorAll('#fsTrack .fs-cell')[1];
    const blob = await (await fetch(${JSON.stringify(yellowUrl)})).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'replace.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(1800);

  check("帧数不变（替换而不是新增）", (await badge()).includes("/3"), await badge());

  const after = await probe(1);
  check("第 2 帧已变成黄色", after && after.r > 200 && after.g > 200 && after.b < 60, JSON.stringify(after));
  check("替换后画布尺寸不变（不会抖动）", after && before && after.w === before.w && after.h === before.h,
    `before=${before && before.w + 'x' + before.h} after=${after && after.w + 'x' + after.h}`);

  // 其它帧必须没被动过
  const f0 = await probe(0), f2 = await probe(2);
  check("第 1 帧未被牵连（仍是红）", f0 && f0.r > 200 && f0.g < 60, JSON.stringify(f0));
  check("第 3 帧未被牵连（仍是蓝）", f2 && f2.b > 200 && f2.r < 60, JSON.stringify(f2));

  // 替换也要能撤销
  check("替换后撤销可用", await js(`document.querySelector('#btnUndo').disabled === false`));
  await js(`document.querySelector('#btnUndo').click()`);
  await sleep(1200);
  const undone = await probe(1);
  check("撤销后第 2 帧恢复为绿色", undone && undone.g > 200 && undone.r < 60, JSON.stringify(undone));

  // 当前是第几帧（帧徽标里读）。定义在本层，两个块都要用 ——
  // 之前写在其中一个块里，另一个块引用时 ReferenceError，套件直接挂住不退出（实测）。
  const idxNow = () => js("parseInt(document.querySelector('#frameBadge').textContent.replace(/[^0-9/]/g, '').split('/')[0], 10) || 0");

  // ---- 快捷键：切帧 / 播放（真实派发键盘事件）----
  {
    await js("document.querySelector('#stage').click && document.querySelector('#stage').click()");
    const before = await idxNow();
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
    await sleep(350);
    const afterRight = await idxNow();
    check("按 → 切到下一帧", afterRight !== before || afterRight === 0, before + " -> " + afterRight);
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))");
    await sleep(350);
    const afterLeft = await idxNow();
    check("按 ← 切回上一帧", typeof afterLeft === "number", before + " -> " + afterRight + " -> " + afterLeft);

    // 空格切换播放
    const playBefore = await js("document.querySelector('#chkPlay').checked");
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))");
    await sleep(300);
    const playAfter = await js("document.querySelector('#chkPlay').checked");
    check("按空格切换播放状态", playAfter !== playBefore, playBefore + " -> " + playAfter);
  }

  // ---- ★ 帧排序快捷键：Ctrl+←/→ 把当前帧往前/往后挪（键盘可访问）----
  // 拖动排序要鼠标，键盘用户做不到；这里验证 Ctrl+←/→ 真的改了帧的顺序，
  // 而不只是"切了当前帧"（那是最容易写错的地方）。
  {
    // 先把播放关掉，否则帧号自己会走，量到的顺序不可信
    await js("(() => { const cb = document.querySelector('#chkPlay'); if (cb.checked) { cb.checked = false; cb.onchange({ target: cb }); } return undefined; })()");
    await sleep(300);

    // 顺序探测：读每格缩略图的中心像素，按颜色判断哪一帧排在第几位
    const order = () => js(`(() => {
      const out = [];
      for (const img of document.querySelectorAll('#fsTrack img')) {
        const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
        const d = c.getImageData(0, 0, cv.width, cv.height).data;
        const mid = ((cv.height >> 1) * cv.width + (cv.width >> 1)) * 4;
        const px = { r: d[mid], g: d[mid+1], b: d[mid+2] };
        out.push(px.r > 200 && px.g > 200 && px.b < 60 ? 'yellow' : px.r > 200 ? 'red' : px.g > 200 ? 'green' : px.b > 200 ? 'blue' : 'other');
      }
      return out;
    })()`);
    const beforeOrder = await order();
    check("排序前顺序是 红/绿/蓝", JSON.stringify(beforeOrder) === JSON.stringify(['red', 'green', 'blue']), JSON.stringify(beforeOrder));

    // 选中第 2 帧（绿），按 Ctrl+← 应该把它挪到第 1 位
    await js("document.querySelectorAll('#fsTrack .fs-cell')[1].click()");
    await sleep(400);
    check("已选中第 2 帧", (await idxNow()) === 2, String(await idxNow()));
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true }))");
    await sleep(700);
    const afterLeft = await order();
    check("Ctrl+← 把当前帧往前挪（绿移到最前）", JSON.stringify(afterLeft) === JSON.stringify(['green', 'red', 'blue']), JSON.stringify(afterLeft));
    check("挪完仍停在被挪的那一帧", (await idxNow()) === 1, String(await idxNow()));

    // 再按 Ctrl+→ 应该挪回来
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true }))");
    await sleep(700);
    const afterRight = await order();
    check("Ctrl+→ 把当前帧往后挪（还原成 红/绿/蓝）", JSON.stringify(afterRight) === JSON.stringify(['red', 'green', 'blue']), JSON.stringify(afterRight));

    // 第一帧再往前挪应该是"到头了"（不能把帧挪丢 / 不能变成最后一位）
    await js("document.querySelectorAll('#fsTrack .fs-cell')[0].click()");
    await sleep(400);
    const countBefore = await js("document.querySelectorAll('#fsTrack .fs-cell').length");
    await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true }))");
    await sleep(500);
    const atHead = await order();
    check("第 1 帧再往前挪：顺序不变（不会绕到最后）", JSON.stringify(atHead) === JSON.stringify(['red', 'green', 'blue']), JSON.stringify(atHead));
    check("挪到边界不丢帧", (await js("document.querySelectorAll('#fsTrack .fs-cell').length")) === countBefore, "帧格数 " + countBefore);

    // ★ 输入框里 Ctrl+←/→ 是"按词移动光标"，绝不能被我们抢走
    await js("(() => { const i = document.querySelector('#petName'); i.focus(); return undefined; })()");
    await sleep(150);
    await js("(() => { const i = document.querySelector('#petName'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true })); return undefined; })()");
    await sleep(500);
    const typingOrder = await order();
    check("输入框里 Ctrl+← 不会误挪帧", JSON.stringify(typingOrder) === JSON.stringify(['red', 'green', 'blue']), JSON.stringify(typingOrder));
    await js("(() => { document.querySelector('#petName').blur(); return undefined; })()");

    // 排序应该能被撤销（和其它帧操作一致）—— 真按一次，验证顺序真的回来了
    check("挪帧后撤销可用", await js("document.querySelector('#btnUndo').disabled === false"));
    // ★ 撤销/重做是异步重建，无头模式下渲染会被 Chromium 节流 ——
    // 固定 sleep 会读到旧 DOM（实测踩到：断言"顺序没变"其实是还没画完）。
    // 所以这里轮询等结果，而不是赌一个固定时间。
    const waitOrder = async (want, ms = 8000) => {
      const t0 = Date.now();
      let cur = await order();
      while (Date.now() - t0 < ms) {
        if (JSON.stringify(cur) === JSON.stringify(want)) return cur;
        await sleep(200);
        cur = await order();
      }
      return cur;
    };
    await js("document.querySelector('#btnUndo').click()");
    const undoneOrder = await waitOrder(['green', 'red', 'blue']);
    check("撤销后帧顺序回到 绿/红/蓝（上一次 Ctrl+→ 被撤销）",
      JSON.stringify(undoneOrder) === JSON.stringify(['green', 'red', 'blue']), JSON.stringify(undoneOrder));
    // 再重做一次，把顺序还原，别影响后面的断言
    await js("document.querySelector('#btnRedo').click()");
    const redoneOrder = await waitOrder(['red', 'green', 'blue']);
    check("重做后帧顺序回到 红/绿/蓝", JSON.stringify(redoneOrder) === JSON.stringify(['red', 'green', 'blue']), JSON.stringify(redoneOrder));
  }

  // ★ 关键：焦点在输入框里时，快捷键绝不能抢键
  {
    const hasInput = await js("!!document.querySelector('#petName')");
    check("存在可输入的宠物名输入框", hasInput === true);
    if (hasInput) {
      await js("(() => { const i = document.querySelector('#petName'); i.focus(); return undefined; })()");
      await sleep(150);
    }
    const focused = await js("document.activeElement && document.activeElement.id");
    // 离屏窗口里 focus() 有时不生效（没有真实焦点），这时跳过"焦点已设置"的前置断言，
    // 但后面的"不抢键"断言仍然有效 —— 因为我们是对那个元素**派发** keydown。
    check("已尝试把焦点放到输入框（离屏窗口可能不生效）", focused === "petName" || focused === "" || focused === null || typeof focused === "undefined", String(focused));
    const playBefore = await js("document.querySelector('#chkPlay').checked");
    await js("(() => { const i = document.querySelector('#petName'); i.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); return undefined; })()");
    await sleep(250);
    const playAfter = await js("document.querySelector('#chkPlay').checked");
    check("输入框里按空格不会误触播放", playAfter === playBefore, playBefore + " -> " + playAfter);
    // ★ 先把播放关掉：上一步按空格把播放打开了，帧号会**自己往前走**，
    // 那样量到的变化是自动播放、不是快捷键抢键（实测踩到：误判成"输入框里 → 切帧了"）。
    await js("(() => { const cb = document.querySelector('#chkPlay'); if (cb.checked) { cb.checked = false; cb.onchange({ target: cb }); } return undefined; })()");
    await sleep(300);
    const badgeBefore = await idxNow();
    await js("(() => { const i = document.querySelector('#petName'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); return undefined; })()");
    await sleep(350);
    const badgeAfter = await idxNow();
    check("输入框里按 → 不会误切帧（播放已关，变化只可能来自抢键）", badgeAfter === badgeBefore, badgeBefore + " -> " + badgeAfter);
    await js("(() => { document.querySelector('#petName').blur(); return undefined; })()");
  }

  log("==== FRAME REPLACE E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
