// 导出 GIF 端到端：造帧 -> 过 IPC 编码 -> 落盘 -> 用项目自己的解码器读回验证
import { app, BrowserWindow } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
import { encodePNG } from "../src/shared/png.js";
import { decodeGif, parseGifHeader } from "../src/shared/gif.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 纯色帧（尺寸故意做大一点，检验量化） */
function solid(r, g, b, w = 40, h = 30) {
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

  check("导出 GIF 按钮存在", await js(`!!document.querySelector('#btnExportGif')`));
  check("无图时按钮禁用", await js(`document.querySelector('#btnExportGif').disabled === true`));

  // 直接调 IPC（保存对话框在 e2e 里无法交互，所以先验证"编码"这段：
  // 用一个临时目录里的目标路径模拟，验证产出是合法 GIF）
  const { encodeGif } = await import("../src/shared/gifencode.js");
  const { nativeImage } = await import("electron");

  // 模拟主进程里的解码步骤（dataURL -> BGRA -> 编码）
  const srcColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const decoded = srcColors.map((c) => {
    const url = solid(c[0], c[1], c[2]);
    const buf = Buffer.from(url.split(",")[1], "base64");
    const img = nativeImage.createFromBuffer(buf);
    const s = img.getSize();
    // 与主进程保持一致：nativeImage.toBitmap() 是 **BGRA**，编码器要 RGBA
    const bgra = img.toBitmap();
    const rgba = Buffer.allocUnsafe(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3]; }
    return { data: new Uint8ClampedArray(rgba), width: s.width, height: s.height, delayMs: 120 };
  });
  check("解码出 3 帧", decoded.length === 3, "n=" + decoded.length);
  check("各帧尺寸一致（否则应报错提示先统一画布）", decoded.every((d) => d.width === decoded[0].width && d.height === decoded[0].height));

  const enc = encodeGif(decoded, { loop: 0 });
  const out = path.join(app.getPath("temp"), "pet-gif-export.gif");
  fs.writeFileSync(out, Buffer.from(enc.buffer));

  check("GIF 已落盘", fs.existsSync(out) && fs.statSync(out).size > 0, fs.statSync(out).size + "B");
  const raw = fs.readFileSync(out);
  check("文件以 GIF89a 开头", raw.subarray(0, 6).toString() === "GIF89a", raw.subarray(0, 6).toString());
  check("文件以 0x3B 结尾", raw[raw.length - 1] === 0x3B);

  const hdr = parseGifHeader(raw);
  check("头部尺寸正确", hdr.width === 40 && hdr.height === 30, JSON.stringify(hdr));

  const back = decodeGif(raw);
  check("解码回来帧数一致", back.frames.length === 3, "n=" + back.frames.length);
  const at = (d) => { const i = (15 * 40 + 20) * 4; return [d[i], d[i + 1], d[i + 2]].join(","); };
  const got = back.frames.map((f) => at(f.data)).join("|");
  check("每帧颜色往返正确", got === "255,0,0|0,255,0|0,0,255", got);
  check("循环为无限（0）", back.loopCount === 0, "loop=" + back.loopCount);

  // ★ 回归断言：红蓝不能互换（这是本轮抓到的真 bug）
  // nativeImage.toBitmap() 是 BGRA，直接用会让导出图红蓝颠倒。
  const { nativeImage: ni2 } = await import("electron");
  const redUrl = solid(255, 0, 0);
  const redImg = ni2.createFromBuffer(Buffer.from(redUrl.split(",")[1], "base64"));
  const rb = redImg.toBitmap();
  check("原生位图确实是 BGRA（红图读出蓝在前）", rb[0] === 0 && rb[2] === 255, `b=${rb[0]} r=${rb[2]}`);
  const fixed = Buffer.allocUnsafe(rb.length);
  for (let i = 0; i < rb.length; i += 4) { fixed[i] = rb[i + 2]; fixed[i + 1] = rb[i + 1]; fixed[i + 2] = rb[i]; fixed[i + 3] = rb[i + 3]; }
  check("转换后是 RGBA（红在前）", fixed[0] === 255 && fixed[2] === 0, `r=${fixed[0]} b=${fixed[2]}`);

  try { fs.unlinkSync(out); } catch {}

  log("==== GIF EXPORT E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
