// 单帧替换 端到端：把一张图拖到缩略图上，只替换那一帧且画布不变
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
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

  log("==== FRAME REPLACE E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
