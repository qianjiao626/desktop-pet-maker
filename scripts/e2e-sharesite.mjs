// 在线分享站 端到端：
// 真实走一遍 share:exportSite handler（patch 掉文件夹选择框），
// 然后**读回生成的站点文件**校验：首页链接可用、每页是完整 HTML、manifest 与文件数对得上。
import { app, BrowserWindow, dialog } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";

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

  check("导出在线分享站按钮存在", await js(`!!document.querySelector('#btnLibExportSite')`));

  // 准备：库里放 2 只"我的宠物"（从内置复制并改名），保证有得导
  const builtinDir = path.join(ROOT, "examples");
  const petsDir = path.join(app.getPath("userData"), "pets");
  fs.mkdirSync(petsDir, { recursive: true });
  const srcs = fs.readdirSync(builtinDir).filter((f) => /\.petpack$/i.test(f)).slice(0, 2);
  for (let i = 0; i < srcs.length; i++) {
    fs.copyFileSync(path.join(builtinDir, srcs[i]), path.join(petsDir, `e2e站点宠物${i + 1}.petpack`));
  }
  if (srcs.length >= 2) {
    // 故意造一对**同名**宠物：验证 slug 去重（否则两个页面会互相覆盖）
    fs.copyFileSync(path.join(builtinDir, srcs[0]), path.join(petsDir, "e2e同名.petpack"));
    fs.copyFileSync(path.join(builtinDir, srcs[1]), path.join(petsDir, "e2e同名 (1).petpack"));
  }

  const outRoot = path.join(app.getPath("temp"), "sharesite-e2e");
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });

  // patch 掉文件夹选择框（e2e 无法交互），返回固定的临时目录
  const origOpen = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [outRoot] });

  // 走完整 IPC（= 按钮点下去真正执行的路径）
  const r = await js(`window.api.exportShareSite({ includeBuiltin: false })`);
  dialog.showOpenDialog = origOpen;

  check("导出返回 ok", !!(r && r.ok), JSON.stringify((r && r.errors) || "").slice(0, 120));
  if (!r || !r.ok) { log("==== SHARE SITE E2E: " + pass + "/" + (pass + fail) + " ===="); app.exit(1); return; }

  const siteDir = r.path;
  check("站点目录被创建", fs.existsSync(siteDir), siteDir);
  check("导出数量 >= 2", r.count >= 2, "count=" + r.count);

  const files = fs.readdirSync(siteDir);
  check("生成了 index.html", files.includes("index.html"), files.join(","));
  check("生成了 manifest.json", files.includes("manifest.json"));
  check("生成了 README.txt", files.includes("README.txt"));

  const index = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  check("首页带 CSP（托管到公网更安全）", index.includes("Content-Security-Policy"), "csp");
  const mani = JSON.parse(fs.readFileSync(path.join(siteDir, "manifest.json"), "utf8"));
  check("manifest 是合法 JSON 且格式标识正确", mani.format === "desktop-pet-maker/share-site@1", mani.format);
  check("manifest 数量与返回值一致", mani.count === r.count, mani.count + " vs " + r.count);
  check("manifest 每只都有文件名", mani.pets.every((p) => !!p.file), "ok");

  // ★ 真实校验：首页里的每个链接都必须在磁盘上存在（点开不能是 404）
  const linked = [...index.matchAll(/href="(pet-[^"]+\.html)"/g)].map((m) => m[1]);
  check("首页链接数 = 宠物数", linked.length === r.count, linked.length + " vs " + r.count);
  const missing = linked.filter((f) => !fs.existsSync(path.join(siteDir, f)));
  check("首页每个链接都指向真实存在的文件", missing.length === 0, "缺失: " + missing.join(","));
  check("链接无重复（没有互相覆盖）", new Set(linked).size === linked.length, linked.join(","));

  // 每只宠物的页面都必须是完整的、能独立打开的 HTML
  let allFull = true, allHasData = true;
  for (const f of linked) {
    const h = fs.readFileSync(path.join(siteDir, f), "utf8");
    if (!(h.startsWith("<!DOCTYPE html>") && h.includes("</html>"))) allFull = false;
    if (!h.includes("data:image/")) allHasData = false;
  }
  check("每只宠物的页面都是完整 HTML", allFull);
  check("每只宠物的页面都内嵌了图片（自己就能跑，不依赖外部文件）", allHasData);

  // 缩略图必须是 dataURL，站点里不能引用站外图片
  const extRefs = [...index.matchAll(/src="(?!data:)([^"]+)"/g)].map((m) => m[1]);
  check("首页不引用任何外部图片文件", extRefs.length === 0, extRefs.join(","));

  // README 要真的告诉用户怎么发布
  const readme = fs.readFileSync(path.join(siteDir, "README.txt"), "utf8");
  check("README 含 GitHub Pages 步骤", readme.includes("GitHub Pages"));
  check("README 含本地打开方式", readme.includes("双击 index.html"));

  // 生成的站点要能被浏览器真正加载（离线也要能显示）
  const siteWin = new BrowserWindow({ width: 1000, height: 800, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  siteWin.webContents.on("console-message", (e2, level, msg) => { if (level >= 2) errs.push(msg); });
  await siteWin.loadFile(path.join(siteDir, "index.html"));
  await sleep(600);
  const cardCount = await siteWin.webContents.executeJavaScript(`document.querySelectorAll('.card').length`);
  check("浏览器里首页真的渲染出卡片", cardCount === r.count, "cards=" + cardCount + " count=" + r.count);
  check("首页控制台没有报错", errs.length === 0, errs.slice(0, 2).join(" | "));

  const firstHref = await siteWin.webContents.executeJavaScript(`document.querySelector('.card').getAttribute('href')`);
  await siteWin.loadFile(path.join(siteDir, firstHref));
  await sleep(600);
  const petSrc = await siteWin.webContents.executeJavaScript(`document.getElementById('pet').getAttribute('src')`);
  check("点进宠物页后图片真的加载出 dataURL", !!petSrc && petSrc.startsWith("data:image/"), String(petSrc).slice(0, 40));

  // 搜索框过滤逻辑
  await siteWin.loadFile(path.join(siteDir, "index.html"));
  await sleep(400);
  const filtered = await siteWin.webContents.executeJavaScript(`(() => {
    const q = document.getElementById('q');
    q.value = '不可能匹配到的名字xyz';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelectorAll('.card:not([style*="none"])').length;
  })()`);
  check("搜索能过滤掉不匹配的卡片", filtered === 0, "visible=" + filtered);

  log("==== SHARE SITE E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
