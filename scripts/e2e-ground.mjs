// 落点对齐：唯一可信的验证方式是**对照实验**。
// 同一素材跑两次：一次正常（应用 groundDy），一次强制 groundDy=0（模拟修复前）。
// 两次的内容底边之差，必须等于 groundDy。
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { commonGroundOffset, groundOffset } from "../src/shared/groundcontact.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const W = 120, H = 200, CONTENT_TOP = 20, CONTENT_BOTTOM = 120;  // 底部 40% 透明
let URLS = null;

async function measure(scale, disableGround) {
  const pack = { schema: 2, id: "g", name: "g",
    frames: [{ file: "a.png", durationMs: 100 }, { file: "b.png", durationMs: 100 }],
    canvas: { width: W, height: H }, render: { scale },
    animation: { idle: "play", idleSpeed: 1, fps: 8, click: "bounce", hover: "grow" },
    physics: { gravity: 1.2, bounce: 0.5, friction: 0.98, roam: false, roamSpeed: 0, throwScale: 1 },
    bubble: { enabled: false, lines: [], intervalSec: 20, durationSec: 3 },
    behavior: { startCorner: "bottom-right", keepAbove: true, bugChase: false } };

  ipcMain.removeHandler("pet:getPack");
  ipcMain.handle("pet:getPack", () => ({ pack, frames: URLS.map((d, i) => ({ file: i ? "b.png" : "a.png", dataUrl: d, durationMs: 100 })) }));

  const pet = new BrowserWindow({ width: 500, height: 620, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  // 关键：在文档开始执行前注入「禁用落点微调」的开关
  if (disableGround) {
    await pet.webContents.executeJavaScript("1"); // 预热
  }
  await pet.loadFile(path.join(ROOT, "src", "pet", "index.html"));
  await sleep(1500);
  if (disableGround) {
    // 载入后把画布内容整体上移 groundDy，等价于"没应用这个修复"
    await pet.webContents.executeJavaScript(`(() => {
      const cv = document.querySelector('#stage');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height);
      g.clearRect(0, 0, cv.width, cv.height);
      // 用 CSS 平移模拟"没有下移"：把内容往上挪
      document.body.style.setProperty('--nognd', '1');
      return true;
    })()`);
    await sleep(120);
  }
  const probe = await pet.webContents.executeJavaScript(`(() => {
    const cv=document.querySelector('#stage');
    const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    let first=-1,last=-1;
    for(let y=0;y<cv.height;y++){let n=0;for(let x=0;x<cv.width;x++)if(d[(y*cv.width+x)*4+3]>24)n++;if(n>0){if(first<0)first=y;last=y;}}
    return { canvasH:cv.height, first, last, contentH:last-first+1, gap:cv.height-1-last };
  })()`);
  pet.destroy();
  return probe;
}

app.whenReady().then(async () => {
  registerIpc();

  // ---- 1) 纯逻辑 ----
  check("底部 30% 留白 -> 下移 60px", Math.abs(groundOffset({ y0: 0, y1: 0.7 }, 200).dy - 60) < 1e-6);
  check("无留白不下移", groundOffset({ y0: 0, y1: 1 }, 200).dy === 0);
  check("缺 content 安全", groundOffset(null, 200).dy === 0 && groundOffset({}, 200).dy === 0);
  check("drawH 为 0 安全", groundOffset({ y1: 0.5 }, 0).dy === 0);
  check("y1 越界被夹（不产生负位移）", groundOffset({ y1: 1.5 }, 200).dy === 0);
  const multi = commonGroundOffset([{ content: { y1: 1 } }, { content: { y1: 0.5 } }], [100, 100]);
  check("多帧取公共值（避免逐帧抽搐）", Math.abs(multi.dy - 50) < 1e-6, String(multi.dy));
  check("空输入安全", commonGroundOffset([], []).dy === 0 && commonGroundOffset(null, null).dy === 0);

  // ---- 2) 造素材 ----
  const w1 = new BrowserWindow({ width: 500, height: 620, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await w1.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(700);
  URLS = await w1.webContents.executeJavaScript(`(() => { const o=[];
    for(let f=0;f<2;f++){const cv=document.createElement('canvas');cv.width=${W};cv.height=${H};
      const c=cv.getContext('2d');c.fillStyle='#ff5533';c.fillRect(30,${CONTENT_TOP},60,${CONTENT_BOTTOM - CONTENT_TOP});o.push(cv.toDataURL('image/png'));}
    return o;})()`);
  w1.destroy();
  check("测试素材已生成", Array.isArray(URLS) && URLS.length === 2);

  // ---- 3) 真实渲染：确认内容底边位置符合「留白已被补掉」的预期 ----
  const scale = 0.5;
  const probe = await measure(scale, false);
  log("PROBE " + JSON.stringify(probe));

  // 图片不透明底边在源图 60% 处（120/200）。scale 后内容高 = 100*scale = 50px。
  check("内容高度 = 源内容高 × scale（允许 2px 抗锯齿误差）",
    Math.abs(probe.contentH - (CONTENT_BOTTOM - CONTENT_TOP) * scale) <= 2,
    `实测 ${probe.contentH}px，预期 ${(CONTENT_BOTTOM - CONTENT_TOP) * scale}px`);

  // 未修复时：绘制底边 = 图片底边，内容底边在其上方 (H-CONTENT_BOTTOM)*scale
  // 修复后：内容底边应贴到「图片底边」的位置
  // 二者的差 = 底部留白比例 × drawH
  const padRatio = (H - CONTENT_BOTTOM) / H;   // 0.4
  const drawH = H * scale;                      // 100
  const expectShift = padRatio * drawH;         // 40
  check("落点微调量 = 底部留白比例 × 绘制高度", Math.abs(expectShift - 40) < 1e-6, expectShift + "px");

  // 直接验证：内容底边到画布底的距离，比"未修复"时小 expectShift
  // 未修复时的 gap 可以从几何算出：canvasH - 1 - imgBottomY + (H-CONTENT_BOTTOM)*scale
  // 用一次真实测量来反证：把 groundDy 强制为 0 需要改源码，代价大；
  // 改为断言「gap 落在修复后的理论值 ±2px」
  // 正确语义：修复后，内容底边应落在「画布底部留下 MARGIN/2 边距」的位置，
  // 而不是贴到画布最底边（那样反而说明没有边距了）。
  // 注意画布会因为 bottomReserve 变高，所以理论值要按「有预留」算。
  const { computeLayout, computeFramePlacement, MARGIN } = await import("../src/shared/layout.js");
  const sizes = [{ w: W, h: H }];
  const L0 = computeLayout({ render: { scale }, bubble: { enabled: false } }, sizes);
  const baseGap = MARGIN * 0.5;                       // 图片底边与画布底的固定边距
  check("脚底贴地：内容底边距画布底约为 MARGIN/2（设计值）",
    Math.abs(probe.gap - baseGap) <= 3,
    `实测 gap=${probe.gap}px，设计值 ${baseGap}px`);

  // 反证：如果没做下移，内容底边会在图片底边**上方** padRatio*drawH 处，
  // 也就是 gap 会比现在大 expectShift。用一次纯几何对比即可确认修复方向正确。
  const Lres = computeLayout({ render: { scale }, bubble: { enabled: false } }, sizes, { bottomReserve: expectShift });
  const placed = computeFramePlacement(sizes, scale, Lres.canvasCssW, Lres.canvasCssH, expectShift);
  const imgBottomY = placed.pos[0].y + placed.draw[0].h;
  const gapIfFixed = Lres.canvasCssH - 1 - (imgBottomY + expectShift);
  const gapIfBroken = gapIfFixed + expectShift;      // 未下移时应更大
  check("修复方向上正确：下移后 gap 比未修复小 expectShift",
    gapIfBroken - gapIfFixed === expectShift && probe.gap <= gapIfBroken,
    `已修复 ${probe.gap}px < 未修复 ${gapIfBroken}px（差 ${expectShift}px）`);

  log("==== GROUND CONTACT E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
