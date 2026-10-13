// 宠物包「一键更新」端到端：
// 1) 导出的包里必须**真的带上版本戳**（createdAt/updatedAt/rev）
// 2) 同一只宠物导出两次 -> 第二次能被判为「新版」
// 3) 安装前预检要能给出结论（新版/同版/旧版），且不落盘
//
// 为什么必须端到端验：版本字段要穿过
//   制作器 readPack -> normalizePack（白名单！）-> zip -> readPackFile -> 比较
// 这条链上任何一环丢字段，用户看到的就是"永远判不出来"。
import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
import { zipRead } from "../src/shared/zip.js";
import { compareVersions } from "../src/shared/packversion.js";
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

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1400);
  const js = (c) => win.webContents.executeJavaScript(c);

  const tmp = path.join(app.getPath("temp"), "packver-e2e");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  // 造一个最小的合法包（用主进程现成的导出路径，避免自己拼 zip 拼错）
  const basePack = {
    schema: 2, id: "packver-e2e-pet", name: "版本测试宠", author: "e2e",
    frames: [{ file: "pet.png", durationMs: 120 }],
    canvas: { width: 8, height: 8 },
    render: { scale: 0.3, flip: false },
    animation: { idle: "breathe", idleSpeed: 1, fps: 8, click: "bounce", hover: "grow" },
    physics: { gravity: 1.2, bounce: 0.5, friction: 0.98, roam: false, roamSpeed: 0, throwScale: 1 },
    bubble: { enabled: false, lines: [] },
    behavior: { startCorner: "bottom-right", keepAbove: true },
  };
  // 1x1 透明 PNG（合法最小图）
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const images = [{ dataUrl: tinyPng, durationMs: 120 }];

  // 走真实导出（pack:save 需要对话框；这里用渲染进程里的导出链之外的等价路径：
  // 直接调主进程写盘函数不可达，所以用 IPC 的 writePackFile 路径 —— 通过 pet:install 反推不可行。
  // 折中：用 maker 的 readPack + window.api 的导出会弹对话框，e2e 无法交互。
  // 因此这里**手工用 zipCreate 拼包**，但版本戳逻辑仍由 packversion 提供（与主进程一致）。
  const { zipCreate } = await import("../src/shared/zip.js");
  const { stampForExport } = await import("../src/shared/packversion.js");
  const { normalizePack } = await import("../src/shared/petpack.js");

  const pngBuf = Buffer.from(tinyPng.split(",")[1], "base64");
  function writePackAt(file, prev) {
    const stamp = stampForExport(prev || {});
    const p = normalizePack({ ...basePack, ...stamp });
    const buf = zipCreate([
      { name: "pet.json", data: JSON.stringify(p, null, 2) },
      { name: "pet.png", data: pngBuf },
    ]);
    fs.writeFileSync(file, buf);
    return p;
  }

  const p1 = writePackAt(path.join(tmp, "v1.petpack"), null);
  check("第一次导出带上 createdAt", !!p1.createdAt, String(p1.createdAt));
  check("第一次导出带上 updatedAt", !!p1.updatedAt, String(p1.updatedAt));
  check("第一次导出 rev=1", p1.rev === 1, String(p1.rev));

  // ★ 关键：字段要真的在 zip 里（normalizePack 是白名单，丢字段就白做）
  const entries = zipRead(fs.readFileSync(path.join(tmp, "v1.petpack")));
  const mani = JSON.parse(entries.find((e) => e.name === "pet.json").data.toString("utf8"));
  check("zip 里的 pet.json 带 updatedAt（没被白名单丢掉）", !!mani.updatedAt, String(mani.updatedAt));
  check("zip 里的 pet.json 带 rev", mani.rev === 1, String(mani.rev));

  // 第二次导出（模拟作者改了东西后重新导出）
  await sleep(1100);   // 让时间戳确实不同（ISO 精确到毫秒，但保险起见等一下）
  const p2 = writePackAt(path.join(tmp, "v2.petpack"), p1);
  check("第二次导出 rev=2", p2.rev === 2, String(p2.rev));
  check("第二次导出 updatedAt 更新", Date.parse(p2.updatedAt) > Date.parse(p1.updatedAt),
    p1.updatedAt + " -> " + p2.updatedAt);
  check("第二次导出保留 createdAt", p2.createdAt === p1.createdAt, p2.createdAt);

  // 比较：v2 相对 v1 应该是新版
  const cmp = compareVersions(p1, p2);
  check("v2 被判为比 v1 新", cmp.result === "newer", JSON.stringify(cmp));
  check("反向比较判为旧版", compareVersions(p2, p1).result === "older", compareVersions(p2, p1).result);

  // ★ 走真实 IPC：预检要能读出结论
  const infoNew = await js("window.api.inspectPack(" + JSON.stringify(path.join(tmp, "v2.petpack")) + ")");
  check("预检接口可用", !!(infoNew && infoNew.ok), JSON.stringify(infoNew && infoNew.errors));
  check("预检能读出包名", infoNew && infoNew.name === "版本测试宠", infoNew && infoNew.name);
  check("首次安装时没有版本比较（existed=false）", infoNew && infoNew.existed === false, "existed=" + (infoNew && infoNew.existed));

  // 先装 v1，再预检 v2 -> 应该判为「新版」
  const inst1 = await js("window.api.installPack(" + JSON.stringify(path.join(tmp, "v1.petpack")) + ")");
  check("能装上 v1", !!(inst1 && inst1.ok), JSON.stringify(inst1 && inst1.errors));
  const info2 = await js("window.api.inspectPack(" + JSON.stringify(path.join(tmp, "v2.petpack")) + ")");
  check("装了 v1 后，v2 被判为有新版本", !!(info2 && info2.ok && info2.version && info2.version.result === "newer"),
    JSON.stringify(info2 && info2.version));
  check("预检给出可读提示", !!(info2 && info2.version && info2.version.prompt), info2 && info2.version && info2.version.prompt);

  // 预检**不能落盘**：调完 inspect 之后，已装的那份还得是 v1
  const instDir = path.join(app.getPath("userData"), "pets");
  const installedName = path.basename(inst1.path);
  const cur = zipRead(fs.readFileSync(path.join(instDir, installedName)));
  const curMani = JSON.parse(cur.find((e) => e.name === "pet.json").data.toString("utf8"));
  check("预检不会改动已安装的包（仍是 v1）", curMani.rev === 1, "rev=" + curMani.rev);

  // 装 v2 -> 预检同版
  const inst2 = await js("window.api.installPack(" + JSON.stringify(path.join(tmp, "v2.petpack")) + ")");
  check("能覆盖装上 v2", !!(inst2 && inst2.ok), JSON.stringify(inst2 && inst2.errors));
  const info3 = await js("window.api.inspectPack(" + JSON.stringify(path.join(tmp, "v2.petpack")) + ")");
  check("再预检同一个包 -> 同版", !!(info3 && info3.version && info3.version.result === "same"),
    JSON.stringify(info3 && info3.version));

  // 装旧版 -> 应该警告（warn 级别）
  const infoOld = await js("window.api.inspectPack(" + JSON.stringify(path.join(tmp, "v1.petpack")) + ")");
  check("拿旧包预检 -> 判为 older", !!(infoOld && infoOld.version && infoOld.version.result === "older"),
    JSON.stringify(infoOld && infoOld.version));
  check("旧包预检是 warn 级别（要警告用户别误覆盖）", !!(infoOld && infoOld.version && infoOld.version.level === "warn"),
    infoOld && infoOld.version && infoOld.version.level);

  // 清理
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  try { fs.unlinkSync(path.join(instDir, installedName)); } catch (e) { /* 忽略 */ }

  log("");
  log("==== PACK VERSION E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
}).catch((e) => { log("FATAL " + e.message + "\n" + (e.stack || "")); app.exit(1); });
