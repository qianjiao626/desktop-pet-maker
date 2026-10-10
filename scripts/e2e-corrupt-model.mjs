// 回归：截断的模型文件必须被判定为「未安装」，绝不能走到 InferenceSession.create
// （以前是 >1MB 就算已安装 → 卡死）
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { isInstalled, isCorrupt, listModels, MODELS } from "../src/main/models.js";
import { getSession } from "../src/main/segment.js";

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; console.log("FAIL  " + n + "  :: " + e); } };

app.whenReady().then(async () => {
  const dir = app.getPath("userData");
  const md = path.join(dir, "models");
  fs.mkdirSync(md, { recursive: true });
  const id = "silueta";
  const file = path.join(md, MODELS[id].file);
  const backup = fs.existsSync(file) ? fs.readFileSync(file) : null;

  try {
    // 造一个「2MB 垃圾文件」——正是以前骗过 isInstalled 的那种
    fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 0x41));
    check("截断文件不再算已安装（修好了核心 bug）", isInstalled(dir, id) === false, "size=" + fs.statSync(file).size);
    check("截断文件被标记为 corrupt", isCorrupt(dir, id) === true);
    check("界面数据里也带 corrupt 标记", listModels(dir).find((m) => m.id === id).corrupt === true);

    // 关键：点 AI 抠图必须立刻报错，而不是卡死
    const t0 = Date.now();
    let err = null;
    try { await getSession(dir, id); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    check("损坏模型立即抛错（不进入推理会话）", err !== null, err ? err.message.slice(0, 60) : "没报错!");
    check("报错很快返回（<3s，不是卡死）", ms < 3000, ms + "ms");
    check("报错文案引导「重新下载」", err && err.message.includes("重新下载"), err ? err.message.slice(0, 70) : "");

    // 正常大小的文件仍应判为已安装（不能误伤）
    const good = Buffer.alloc(MODELS[id].bytes);
    fs.writeFileSync(file, good);
    check("完整大小的文件判为已安装（不误伤）", isInstalled(dir, id) === true);
    check("完整文件不算 corrupt", isCorrupt(dir, id) === false);
  } finally {
    if (backup) fs.writeFileSync(file, backup);
    else { try { fs.unlinkSync(file); } catch {} }
  }

  console.log("==== CORRUPT-MODEL E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
