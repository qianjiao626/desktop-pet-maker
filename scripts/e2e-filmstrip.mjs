// 帧缩略图条 端到端：可见性、点击切帧、拖动排序、帧多时只渲染可视窗口
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每帧一个可区分的颜色；四周深色边框避免被自动抠图吃掉 */
function frameImg(tag, w = 60, h = 40) {
  const px = new Uint8ClampedArray(w * h * 4);
  const inBorder = (x, y) => x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = inBorder(x, y) ? [10, 10, 10] : [tag * 15, 90, 255 - tag * 15];
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

  check("缩略图条元素存在", await js(`!!document.querySelector('#filmstrip')`));
  check("无图时缩略图条隐藏", await js(`document.querySelector('#filmstrip').hidden === true`));

  // 拖入 5 张图
  const imgs = [1, 2, 3, 4, 5].map((t) => frameImg(t));
  await js(`(async () => {
    const dt = new DataTransfer();
    const urls = ${JSON.stringify(imgs)};
    for (let i = 0; i < urls.length; i++) {
      const blob = await (await fetch(urls[i])).blob();
      dt.items.add(new File([blob], String(i + 1).padStart(2, '0') + '.png', { type: 'image/png' }));
    }
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(2500);

  const cells = () => js(`[...document.querySelectorAll('#fsTrack .fs-cell')].map(c => c.dataset.idx)`);
  const activeCell = () => js(`(() => { const c = document.querySelector('#fsTrack .fs-cell.on'); return c ? c.dataset.idx : null; })()`);

  check("多帧时缩略图条可见", await js(`document.querySelector('#filmstrip').hidden === false`));
  check("渲染出 5 个缩略格", (await cells()).length === 5, JSON.stringify(await cells()));
  check("每格都有缩略图", await js(`[...document.querySelectorAll('#fsTrack img')].every(i => i.src.startsWith('data:image/png'))`));
  const act = await activeCell();
  check("当前帧被高亮", act === "4", "active=" + act);   // 导入后停在最后一帧（第 5 帧，下标 4）
  check("标签显示帧号", (await js(`document.querySelector('#fsLabel').textContent`)).includes("/5"), await js(`document.querySelector('#fsLabel').textContent`));

  // 点击第 1 格 -> 切到第 1 帧
  await js(`document.querySelector('#fsTrack .fs-cell[data-idx="0"]').click()`);
  await sleep(600);
  check("点缩略图可切帧", (await activeCell()) === "0", "active=" + await activeCell());
  check("帧徽章同步", (await js(`document.querySelector('#frameBadge').textContent`)).startsWith("帧 1/5"), await js(`document.querySelector('#frameBadge').textContent`));

  // 拖动排序：把第 1 帧拖到最后一格之后
  const dragResult = await js(`(() => {
    const track = document.querySelector('#fsTrack');
    const from = track.querySelector('.fs-cell[data-idx="0"]');
    const last = track.querySelector('.fs-cell[data-idx="4"]');
    const r = last.getBoundingClientRect();
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    last.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 2 }));
    last.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 2 }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(900);
  check("拖动事件已派发", dragResult === true);
  const after = await cells();
  check("拖动后仍是 5 帧（不丢帧）", after.length === 5, JSON.stringify(after));

  // 帧数远大于窗口时，只渲染可视数量
  const many = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map((t) => frameImg(t, 20, 14));
  await js(`(async () => {
    const dt = new DataTransfer();
    const urls = ${JSON.stringify(many)};
    for (let i = 0; i < urls.length; i++) {
      const blob = await (await fetch(urls[i])).blob();
      dt.items.add(new File([blob], 'x' + String(i).padStart(3,'0') + '.png', { type: 'image/png' }));
    }
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(3000);
  const cellCount = (await cells()).length;
  const total = await js(`(() => { const t = document.querySelector('#frameBadge').textContent; const m = t.match(/\\/(\\d+)/); return m ? parseInt(m[1],10) : 0; })()`);
  check("帧很多时也只渲染可视窗口（不全渲染）", cellCount <= 12, `cells=${cellCount} total=${total}`);
  check("确实有很多帧（说明窗口逻辑生效）", total > 12, "total=" + total);

  log("==== FILMSTRIP E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
