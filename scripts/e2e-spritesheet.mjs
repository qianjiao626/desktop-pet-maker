// Sprite Sheet 导出 端到端：
// 拼图 -> 落盘 -> 读回，逐格验证**位置与颜色都对**（这是最容易错的地方：贴图偏移）
import { app, BrowserWindow, nativeImage } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";
import { planSheet, sheetFrames, sheetMetadata } from "../src/shared/spritesheet.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sheetBytes = (w, h) => Math.max(0, (w | 0)) * Math.max(0, (h | 0)) * 4;

function solidUrl(r, g, b, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
  return "data:image/png;base64," + encodePNG(w, h, Buffer.from(px)).toString("base64");
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1200);
  const js = (c) => win.webContents.executeJavaScript(c);

  check("导出 Sprite Sheet 按钮存在", await js(`!!document.querySelector('#btnExportSheet')`));
  check("无图时按钮禁用", await js(`document.querySelector('#btnExportSheet').disabled === true`));

  const W = 32, H = 32;
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const frames = colors.map((c, i) => ({ dataUrl: solidUrl(c[0], c[1], c[2], W, H), durationMs: 100 + i * 10 }));
  const plan = planSheet(frames.length, W, H);
  check("4 帧 -> 2x2 网格", plan.cols === 2 && plan.rows === 2 && plan.width === 64 && plan.height === 64, JSON.stringify(plan));

  // 与主进程 handler 相同的拼接步骤
  const sheetBgra = Buffer.alloc(sheetBytes(plan.width, plan.height));
  const durations = [];
  for (let i = 0; i < frames.length; i++) {
    const m = /^data:[^;]+;base64,(.*)$/i.exec(frames[i].dataUrl);
    const img = nativeImage.createFromBuffer(Buffer.from(m[1], "base64"));
    const src = img.toBitmap();
    const col = i % plan.cols, row = Math.floor(i / plan.cols);
    const ox = col * W, oy = row * H;
    for (let y = 0; y < H; y++) {
      const s = y * W * 4;
      const d = ((oy + y) * plan.width + ox) * 4;
      src.copy(sheetBgra, d, s, s + W * 4);
    }
    durations.push(frames[i].durationMs);
  }
  const sheetImg = nativeImage.createFromBuffer(sheetBgra, { width: plan.width, height: plan.height });
  check("拼接图非空", !sheetImg.isEmpty());
  const pngPath = path.join(app.getPath("temp"), "sheet-e2e.png");
  const jsonPath = path.join(app.getPath("temp"), "sheet-e2e.json");
  fs.writeFileSync(pngPath, sheetImg.toPNG());

  const rects = sheetFrames(frames.length, W, H, plan.cols, plan.rows);
  const meta = sheetMetadata(rects, {
    name: "测试宠", image: "sheet-e2e.png",
    sheetWidth: plan.width, sheetHeight: plan.height, cols: plan.cols, rows: plan.rows, durations,
  });
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));

  check("PNG 已落盘", fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0, fs.statSync(pngPath).size + "B");
  check("JSON 已落盘", fs.existsSync(jsonPath));
  const magic = fs.readFileSync(pngPath).subarray(0, 8).toString("hex");
  check("PNG 魔数正确", magic === "89504e470d0a1a0a", magic);

  // ★ 关键：读回 PNG，逐格取中心像素，验证位置与颜色都正确
  const back = nativeImage.createFromPath(pngPath);
  const bmp = back.toBitmap();
  const size = back.getSize();
  check("读回尺寸与计划一致", size.width === plan.width && size.height === plan.height, `${size.width}x${size.height}`);
  const at = (x, y) => { const i = (y * plan.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]].join(","); };  // BGRA -> RGB
  const got = rects.map((f) => at(f.x + Math.floor(W / 2), f.y + Math.floor(H / 2)));
  const want = colors.map((c) => c.join(","));
  check("每格颜色与位置都对（贴图不偏移）", got.join("|") === want.join("|"), `got=${got.join("|")} want=${want.join("|")}`);

  // 元数据可被引擎直接消费
  const loaded = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  check("元数据有格式标识", loaded.format === "desktop-pet-maker/sprite-sheet@1");
  check("元数据帧数与图一致", loaded.frames.length === 4, "n=" + loaded.frames.length);
  check("元数据每帧都可定位到图内", loaded.frames.every((f) => f.x + f.w <= plan.width && f.y + f.h <= plan.height));
  check("元数据保留了每帧不同时长", loaded.frames.map((f) => f.ms).join(",") === "100,110,120,130", loaded.frames.map((f) => f.ms).join(","));
  check("元数据总时长正确", loaded.totalMs === 460, "total=" + loaded.totalMs);

  try { fs.unlinkSync(pngPath); fs.unlinkSync(jsonPath); } catch {}

  log("==== SPRITE SHEET E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
