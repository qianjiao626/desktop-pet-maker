// 批量导出 GIF 端到端：
// 用真实的宠物包（内置的）跑一遍计划 + 编码 + 落盘，再用自己的解码器读回验证。
import { app, BrowserWindow, nativeImage } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
import { planBulkGif } from "../src/shared/bulkgif.js";
import { encodeGif } from "../src/shared/gifencode.js";
import { decodeGif, parseGifHeader } from "../src/shared/gif.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1200);
  const js = (c) => win.webContents.executeJavaScript(c);

  check("批量导出 GIF 按钮存在", await js(`!!document.querySelector('#btnLibExportGif')`));

  // 从内置宠物里取 2 只真实包（它们是程序生成的，含真实帧）
  const builtinDir = path.join(ROOT, "examples");
  const packs = fs.readdirSync(builtinDir).filter((f) => /\.petpack$/i.test(f)).slice(0, 2);
  check("本机有内置宠物包可用", packs.length === 2, packs.join(","));

  // 用主进程的 readPackFile 逻辑读它们（通过 IPC：listInstalled 给缩略图，
  // 但我们要完整帧，所以直接用 zip 读）
  const { zipRead } = await import("../src/shared/zip.js");
  const items = [];
  for (const f of packs) {
    const buf = fs.readFileSync(path.join(builtinDir, f));
    const entries = zipRead(buf);
    const mani = JSON.parse(entries.find((e) => e.name === "pet.json").data.toString("utf8"));
    const frames = [];
    for (const fr of mani.frames) {
      const b = entries.find((e) => e.name === fr.file);
      if (!b) continue;
      const ext = path.extname(fr.file).slice(1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : (ext === "gif" ? "image/gif" : "image/png");
      frames.push({ dataUrl: `data:${mime};base64,${b.data.toString("base64")}`, durationMs: fr.durationMs });
    }
    items.push({ id: f, name: mani.name || f, builtin: true, broken: false,
      width: (mani.canvas && mani.canvas.width) || 0, height: (mani.canvas && mani.canvas.height) || 0, frames });
  }
  check("读到真实宠物帧", items.every((it) => it.frames.length > 0), items.map((it) => it.frames.length).join(","));

  const plan = planBulkGif(items, { includeBuiltin: true });
  check("计划可导出", plan.ok === true, plan.reason);
  check("每只一个 GIF", plan.entries.length === items.length, "n=" + plan.entries.length);
  check("画布在 320 以内", Math.max(plan.canvas.w, plan.canvas.h) <= 320, JSON.stringify(plan.canvas));
  log("PLAN " + JSON.stringify({ canvas: plan.canvas, entries: plan.entries.map((e) => e.outName + ':' + e.frameCount + (e.sampled ? '(抽稀)' : '')) }));

  // 真实走一遍编码（与主进程 handler 相同的步骤）
  const outDir = path.join(app.getPath("temp"), "bulkgif-e2e");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (const en of plan.entries) {
    const src = items.find((it) => it.id === en.sourceId);
    const list = src.frames;
    const n = en.frameCount;
    const picked = list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
    const decoded = [];
    for (const fr of picked) {
      const m = /^data:[^;]+;base64,(.*)$/i.exec(fr.dataUrl);
      if (!m) continue;
      const img = nativeImage.createFromBuffer(Buffer.from(m[1], "base64"));
      const sz = img.getSize();
      if (!sz.width || !sz.height) continue;
      const resized = img.resize({ width: plan.canvas.w, height: plan.canvas.h, quality: "good" });
      const bgra = resized.toBitmap();
      const rgba = Buffer.allocUnsafe(bgra.length);
      for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3]; }
      decoded.push({ data: new Uint8ClampedArray(rgba), width: plan.canvas.w, height: plan.canvas.h, delayMs: Math.max(16, Math.round(fr.durationMs || 100)) });
    }
    const enc = encodeGif(decoded, { loop: 0 });
    fs.writeFileSync(path.join(outDir, en.outName), Buffer.from(enc.buffer));
    written++;
  }
  check("全部 GIF 已落盘", written === plan.entries.length, `${written}/${plan.entries.length}`);

  // 逐个读回验证：魔数、尺寸、帧数、能被自己的解码器解
  let okCount = 0;
  const details = [];
  for (const en of plan.entries) {
    const p = path.join(outDir, en.outName);
    if (!fs.existsSync(p)) { details.push(en.outName + ':缺失'); continue; }
    const raw = fs.readFileSync(p);
    const isGif = raw.subarray(0, 6).toString() === "GIF89a";
    const hdr = isGif ? parseGifHeader(raw) : null;
    let frames = 0;
    try { frames = decodeGif(raw).frames.length; } catch {}
    const sizeOk = hdr && hdr.width === plan.canvas.w && hdr.height === plan.canvas.h;
    const framesOk = frames === en.frameCount;
    if (isGif && sizeOk && framesOk) okCount++;
    else details.push(`${en.outName}: gif=${isGif} size=${hdr && hdr.width + 'x' + hdr.height} frames=${frames}/${en.frameCount}`);
  }
  check("每个 GIF 都是合法 GIF 且尺寸/帧数与计划一致", okCount === plan.entries.length, details.join(" | ") || "全部通过");
  check("文件都不是空的", plan.entries.every((en) => fs.statSync(path.join(outDir, en.outName)).size > 100), "");

  fs.rmSync(outDir, { recursive: true, force: true });

  log("==== BULK GIF E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
