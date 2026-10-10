// 撤销/重做 端到端：验证**像素真的被还原**（不是只改了个按钮状态）
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 造一张测试图：左半红、右半蓝，方便检测"水平翻转"。
 *
 * 注意：**不能让边缘是平坦纯色** —— 制作器的「上传即用」会自动检测
 * 平坦背景并抠掉，红蓝两半都会被当成背景吃掉（实测拿到全透明）。
 * 所以这里四周留一圈深色边框，让背景判定为"复杂背景"从而跳过自动抠图。
 */
function blockImg(w = 80, h = 60) {
  const px = new Uint8ClampedArray(w * h * 4);
  const inBorder = (x, y) => x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c;
    if (inBorder(x, y)) c = [20, 20, 20];            // 深色边框：打乱"平坦背景"判据
    else c = x < w / 2 ? [255, 0, 0] : [0, 0, 255];  // 左红右蓝
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return 'data:image/png;base64,' + encodePNG(w, h, Buffer.from(px)).toString("base64");
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    // 转发渲染进程日志，便于定位（否则静默失败很难查）
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  win.webContents.on('console-message', (...a) => { const e = a[0]; const m = (e && typeof e === 'object' && 'message' in e) ? e.message : a[2]; if (/error|Error|撤销|history/i.test(String(m))) log('PAGE: ' + m); });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1200);
  const js = (c) => win.webContents.executeJavaScript(c);

  // 按钮存在
  check("撤销按钮存在", await js(`!!document.querySelector('#btnUndo')`));
  check("重做按钮存在", await js(`!!document.querySelector('#btnRedo')`));
  check("初始撤销不可用", await js(`document.querySelector('#btnUndo').disabled === true`));
  check("初始重做不可用", await js(`document.querySelector('#btnRedo').disabled === true`));

  // 导入一张图（走真实的 addFrameFromDataUrl 路径）
  const dataUrl = blockImg();
  await js(`(async () => {
    const img = new Image();
    await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=${JSON.stringify(dataUrl)};});
    const cv = document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
    cv.getContext('2d').drawImage(img,0,0);
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height);
    window.__t = window.__t || {};
    // 直接塞进 state 不方便（模块作用域），改用公开路径：模拟拖入
    // 这里用 DataTransfer 触发真实 drop
    const dt = new DataTransfer();
    const file = new File([await (await fetch(${JSON.stringify(dataUrl)})).blob()], 'test.png', {type:'image/png'});
    dt.items.add(file);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.querySelector('#stage').dispatchEvent(ev);
    return true;
  })()`);
  await sleep(1200);
  const hasFrames = await js(`document.querySelector('#btnTrim').disabled === false`);
  check("图片已导入（裁边按钮可用）", hasFrames);

  if (!hasFrames) {
    log("==== UNDO E2E: " + pass + "/" + (pass + fail) + " ====");
    app.exit(1);
    return;
  }

  // 记录左上角像素（红色）作为基准
  const probe = () => js(`(() => {
    const img = document.querySelector('#previewImg');
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const at = (x, y) => { const i = (y * cv.width + x) * 4; return [d[i], d[i+1], d[i+2], d[i+3]].join(','); };
    return { w: cv.width, h: cv.height, left: at(8, Math.floor(cv.height/2)), right: at(cv.width-9, Math.floor(cv.height/2)) };
  })()`);

  const before = await probe();
  log("PROBE before " + JSON.stringify(before));
  check("基准：左边红、右边蓝", before.left.startsWith("255,0,0") && before.right.startsWith("0,0,255"), JSON.stringify(before));

  // 水平翻转（一个破坏性操作）
  await js(`(() => { const el = document.querySelector('#chkFlip'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(800);
  const flipped = await probe();
  log("PROBE flipped " + JSON.stringify(flipped));
  check("翻转后左右颜色互换", flipped.left.startsWith("0,0,255") && flipped.right.startsWith("255,0,0"), JSON.stringify(flipped));
  check("翻转后撤销可用", await js(`document.querySelector('#btnUndo').disabled === false`));

  // 撤销 -> 应该回到未翻转
  await js(`document.querySelector('#btnUndo').click()`);
  await sleep(900);
  const undone = await probe();
  log("PROBE undone " + JSON.stringify(undone));
  check("撤销后像素还原（左红右蓝）", undone.left.startsWith("255,0,0") && undone.right.startsWith("0,0,255"), JSON.stringify(undone));
  check("撤销后重做可用", await js(`document.querySelector('#btnRedo').disabled === false`));

  // 重做 -> 又变回翻转
  await js(`document.querySelector('#btnRedo').click()`);
  await sleep(900);
  const redone = await probe();
  log("PROBE redone " + JSON.stringify(redone));
  check("重做后再次翻转（左蓝右红）", redone.left.startsWith("0,0,255") && redone.right.startsWith("255,0,0"), JSON.stringify(redone));

  // 快捷键 Ctrl+Z
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
  await sleep(900);
  const viaKey = await probe();
  check("Ctrl+Z 也能撤销", viaKey.left.startsWith("255,0,0"), JSON.stringify(viaKey));

  log("==== UNDO E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
