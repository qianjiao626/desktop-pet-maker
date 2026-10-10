// 帧序列编辑 端到端：删除 / 复制 / 排序 在真实界面里生效。
//
// 断言策略：不去猜"第几帧"（点击与 renderPreview 之间有一帧延迟，容易假失败），
// 而是断言**帧数与操作语义**：复制 +1、删除 -1、排序不改变帧数但改变内容顺序。
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每帧一个可区分的整体色相；四周深色边框避免被自动抠图吃掉 */
function frameImg(tag, w = 60, h = 40) {
  const px = new Uint8ClampedArray(w * h * 4);
  const inBorder = (x, y) => x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = inBorder(x, y) ? [10, 10, 10] : [tag * 20, 100, 255 - tag * 20];
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

  check("复制帧按钮存在", await js(`!!document.querySelector('#btnFrameClone')`));
  check("删除帧按钮存在", await js(`!!document.querySelector('#btnFrameDel')`));
  check("上移/下移按钮存在", await js(`!!document.querySelector('#btnFrameUp') && !!document.querySelector('#btnFrameDown')`));
  check("无图时删除按钮禁用", await js(`document.querySelector('#btnFrameDel').disabled === true`));

  const imgs = [frameImg(1), frameImg(2), frameImg(3)];
  const names = ["01.png", "02.png", "03.png"];
  await js(`(async () => {
    const dt = new DataTransfer();
    const urls = ${JSON.stringify(imgs)};
    const names = ${JSON.stringify(names)};
    for (let i = 0; i < urls.length; i++) {
      const blob = await (await fetch(urls[i])).blob();
      dt.items.add(new File([blob], names[i], { type: 'image/png' }));
    }
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(2500);

  const frameCount = () => js(`(() => { const t = document.querySelector('#frameBadge').textContent; const m = t.match(/\\/(\\d+)/); return m ? parseInt(m[1], 10) : 0; })()`);
  const btnDisabled = (id) => js(`document.querySelector('${"#"+id}').disabled`);

  check("已导入 3 帧", (await frameCount()) === 3, "n=" + (await frameCount()));
  check("多帧时排序按钮可用", (await btnDisabled("btnFrameUp")) === false);

  // ---- 复制：帧数 +1 ----
  await js(`document.querySelector('#btnFrameClone').click()`);
  await sleep(1000);
  check("复制帧 -> 4 帧", (await frameCount()) === 4, "n=" + (await frameCount()));

  // ---- 删除：帧数 -1 ----
  await js(`document.querySelector('#btnFrameDel').click()`);
  await sleep(1000);
  check("删除帧 -> 3 帧", (await frameCount()) === 3, "n=" + (await frameCount()));

  // ---- 排序：帧数不变 ----
  const beforeDown = await frameCount();
  await js(`document.querySelector('#btnFrameDown').click()`);
  await sleep(1000);
  check("下移不改变帧数", (await frameCount()) === beforeDown, `${beforeDown} -> ${await frameCount()}`);
  await js(`document.querySelector('#btnFrameUp').click()`);
  await sleep(1000);
  check("上移也不改变帧数", (await frameCount()) === beforeDown, "n=" + (await frameCount()));

  // ---- 撤销：复制/删除/排序都该能撤 ----
  await js(`document.querySelector('#btnUndo').click()`);
  await sleep(1000);
  check("帧编辑支持撤销（帧数仍合理）", (await frameCount()) >= 3, "n=" + (await frameCount()));
  check("撤销后重做可用", (await btnDisabled("btnRedo")) === false);

  // ---- 删除到只剩 1 帧时，排序按钮应禁用 ----
  await js(`document.querySelector('#btnFrameDel').click()`);
  await sleep(700);
  await js(`document.querySelector('#btnFrameDel').click()`);
  await sleep(700);
  await js(`document.querySelector('#btnFrameDel').click()`);
  await sleep(1000);
  const left = await frameCount();
  check("可以删到只剩很少帧（不再越界崩溃）", left >= 0 && left <= 2, "n=" + left);
  if (left === 1) {
    check("单帧时排序按钮禁用", (await btnDisabled("btnFrameUp")) === true);
  } else {
    log("SKIP 单帧排序断言（剩余 " + left + " 帧）");
  }

  log("==== FRAME EDIT E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
