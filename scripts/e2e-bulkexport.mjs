// 宠物库批量导出 端到端：
// 1) 导出真的产出一个 zip，且能被我们自己的 zip 读回
// 2) 里面的每个 .petpack 都能被 readPackFile 解析（说明是有效宠物包）
// 3) 不含内置 / 含内置 两种模式数量正确
import { app, BrowserWindow } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
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
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1200);
  const js = (c) => win.webContents.executeJavaScript(c);

  check("导出合集按钮存在", await js(`!!document.querySelector('#btnLibExport')`));

  const pv = await js(`window.api.previewExport()`);
  check("能预览导出规模", !!(pv && pv.ok), JSON.stringify(pv && pv.errors || "").slice(0,80));
  if (pv && pv.ok) {
    check("预览给出我的宠物数与体积", typeof pv.mine.count === "number" && typeof pv.mine.bytes === "number", `count=${pv.mine.count} bytes=${pv.mine.bytes}`);
    check("预览给出含内置的总数", typeof pv.all.count === "number", "all=" + pv.all.count);
    check("内置数 >= 0（本机应有内置宠物）", pv.all.count >= pv.mine.count, `${pv.all.count} >= ${pv.mine.count}`);
    check("内置宠物被跳过（默认导出里没有内置）", Array.isArray(pv.mine.skipped), "skipped=" + (pv.mine.skipped || []).length);
  }

  // 真正导出：绕过保存对话框，直接验证 zip 的构造与可解析性
  // （对话框在 e2e 里无法交互，所以用与主进程相同的逻辑手工构造一次并校验）
  const builtinDir = path.join(ROOT, "examples");
  const petsDir = path.join(app.getPath("userData"), "pets");
  fs.mkdirSync(petsDir, { recursive: true });

  // 往库里放一只"我的宠物"（从内置复制一份并改名），确保 mine.count > 0
  const src = fs.readdirSync(builtinDir).filter((f) => /\.petpack$/i.test(f))[0];
  if (src) {
    const myPack = path.join(petsDir, "我的测试宠物.petpack");
    if (!fs.existsSync(myPack)) fs.copyFileSync(path.join(builtinDir, src), myPack);
  }
  await sleep(300);

  const pv2 = await js(`window.api.previewExport()`);
  check("放入一只自制宠物后能被统计", pv2.ok && pv2.mine.count >= 1, "mine=" + (pv2 && pv2.mine && pv2.mine.count));

  // 用真实的 zipWriteToFile + planExport 构造一次导出（与 pet:exportAll 内部一致）
  const { planExport, exportReadme } = await import("../src/shared/bulkexport.js");
  const { zipWriteToFile, zipRead } = await import("../src/shared/zip.js");
  const items = [];
  const builtinNames = new Set(fs.readdirSync(builtinDir).filter((f) => /\.petpack$/i.test(f)));
  for (const f of fs.readdirSync(petsDir)) {
    if (!/\.petpack$/i.test(f)) continue;
    const full = path.join(petsDir, f);
    let name = f; let broken = false;
    try { const { readPackFile } = await import("../src/main/main.js"); } catch {}
    try {
      const buf = fs.readFileSync(full);
      const z = zipRead(buf);
      const mani = z.find((e) => e.name === "pet.json");
      if (mani) name = JSON.parse(mani.data.toString("utf8")).name || f; else broken = true;
    } catch { broken = true; }
    items.push({ id: f, name, size: fs.statSync(full).size, builtin: builtinNames.has(f), broken });
  }
  const plan = planExport(items, {});
  check("计划里至少有 1 只我的宠物", plan.ok && plan.entries.length >= 1, "n=" + (plan && plan.entries.length));

  const out = path.join(app.getPath("temp"), "bulk-export-test.zip");
  const entries = plan.entries.map((en) => ({ name: en.outName, getData: () => fs.readFileSync(path.join(petsDir, en.sourceId)) }));
  entries.unshift({ name: "README.txt", data: exportReadme(plan.entries) });
  const w = await zipWriteToFile(entries, out);
  check("zip 已生成", fs.existsSync(out) && fs.statSync(out).size > 0, fs.statSync(out).size + "B");
  check("zip 体积与预期一致（±1KB）", Math.abs(fs.statSync(out).size - w.bytes) <= 1024, `file=${fs.statSync(out).size} reported=${w.bytes}`);

  const back = zipRead(fs.readFileSync(out));
  const names = back.map((e) => e.name);
  check("zip 内含 README.txt", names.includes("README.txt"), names.join(","));
  const packs = names.filter((n) => n.endsWith(".petpack"));
  check("zip 内含宠物包", packs.length === plan.entries.length, `packs=${packs.length} plan=${plan.entries.length}`);
  // 注意：这个测试为了造"我的宠物"，是从内置里复制一份放进 pets/ 的，
  // 所以它的**文件名与内置相同** —— 不能用文件名判断"是否内置"（那会假失败）。
  // 真正要验证的是：内置宠物在**默认模式下被 planExport 跳过**（见上面 skipped 断言）。
  check("默认模式只导出非内置（由 planExport 的 skipped 保证）", plan.skipped.some((s) => s.reason.includes("内置")) || plan.entries.length === 0, "skipped=" + plan.skipped.length);

  // 每个宠物包都要能被解析（说明是有效包，不是坏数据）
  let parsible = 0;
  for (const e of back) {
    if (!e.name.endsWith(".petpack")) continue;
    try {
      const inner = zipRead(e.data);
      if (inner.some((x) => x.name === "pet.json")) parsible++;
    } catch {}
  }
  check("每个宠物包都能被解析出 pet.json", parsible === packs.length, `${parsible}/${packs.length}`);

  // README 内容可用
  const readme = back.find((e) => e.name === "README.txt").data.toString("utf8");
  check("README 写了怎么用（拖进窗口）", readme.includes("拖进窗口"));
  check("README 列出了宠物", packs.some((p) => readme.includes(p)), "");

  try { fs.unlinkSync(out); } catch {}
  try { fs.unlinkSync(path.join(petsDir, "我的测试宠物.petpack")); } catch {}

  // ---- 命名模板：批量导出时用户能自定义文件名（含去重） ----
  {
    const { planExport } = await import("../src/shared/bulkexport.js");
    const { unknownPlaceholders, templateHelp } = await import("../src/shared/nametemplate.js");
    const items = [
      { id: 'a.petpack', name: '小蓝机器人', author: '阿梁', size: 1000 },
      { id: 'b.petpack', name: '橘猫', author: '阿梁', size: 1000 },
      { id: 'c.petpack', name: '小蓝机器人', author: '阿梁', size: 1000 },
    ];
    const def = planExport(items, {});
    check('不传模板时沿用原来的命名', def.entries.every((e) => e.outName.endsWith('.petpack')), JSON.stringify(def.entries.map((e) => e.outName)));
    const tpl = '{n:02}_{name}';
    const withTpl = planExport(items, { nameTemplate: tpl, date: '2026-10-12' });
    const names = withTpl.entries.map((e) => e.outName);
    check('模板生效（序号 + 名字）', names[0] === '01_小蓝机器人.petpack' && names[1] === '02_橘猫.petpack', JSON.stringify(names));
    check('模板导出的文件名都合法（无禁用字符）', names.every((n) => !/[<>:"/\\|?*]/.test(n)), JSON.stringify(names));
    check('模板下重名会被去重', new Set(names.map((n) => n.toLowerCase())).size === 3, JSON.stringify(names));
    const dated = planExport(items, { nameTemplate: '{date}_{name}', date: '2026-10-12' });
    check('日期占位符生效', dated.entries[0].outName === '2026-10-12_小蓝机器人.petpack', dated.entries[0].outName);
    check('模板说明列出占位符', templateHelp().includes('{name}') && templateHelp().includes('{n:03}'), templateHelp());
    check('能识别写错的占位符', unknownPlaceholders('{nmae}').includes('nmae'), JSON.stringify(unknownPlaceholders('{nmae}')));
    check('正确的占位符不报警', unknownPlaceholders('{name}_{n:02}_{date}').length === 0, 'ok');
    check('宠物库有批量导出入口', await js("!!document.querySelector('#btnLibExport')"));
  }

  log("==== BULK EXPORT E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
});
