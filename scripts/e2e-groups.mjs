// 宠物分组 端到端：建分组 -> 加宠物 -> 按分组筛选 -> 改名 -> 删分组。
// 全程走真实 IPC，并读回 library.json 确认持久化。
// 注：本测试会写真实的 library.json，所以分组名带随机后缀，重复运行不会互相干扰。
import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = "e2e" + Date.now().toString(36);
const G1 = TAG + "-甲";
const G2 = TAG + "-乙";

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, "src", "preload", "preload.cjs"), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  win.webContents.on("console-message", (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === "object" && "message" in ev) ? ev.message : a[2];
    if (/Error|not defined|未定义/i.test(String(msg))) log("  [renderer] " + msg);
  });
  await win.loadFile(path.join(ROOT, "src", "maker", "index.html"));
  await sleep(1500);
  const js = (c) => win.webContents.executeJavaScript(c);
  const libPath = path.join(app.getPath("userData"), "library.json");

  await js("document.querySelector('#btnLibrary').click()");
  for (let i = 0; i < 40; i++) {
    const n = await js("document.querySelectorAll('#libGrid .lib-item').length");
    if (n > 0) break;
    await sleep(250);
  }
  check("宠物库打开", await js("!document.querySelector('#libModal').hidden"));
  check("有分组栏", await js("!!document.querySelector('#libGroups')"));
  const cards = () => js("document.querySelectorAll('#libGrid .lib-item').length");
  const total = await cards();
  check("库里有宠物可测", total >= 2, "n=" + total);
  if (total < 2) { log("==== GROUPS E2E: " + pass + "/" + (pass + fail) + " ===="); app.exit(1); return; }

  const list = await js("window.api.listInstalled()");
  check("拿到已安装宠物列表", Array.isArray(list) && list.length >= 2, "n=" + (list && list.length));
  const petId = list[0].id;

  // ---- 宠物详情面板：卡片上的 ⓘ 要能打开，且内容不是空的 ----
  {
    const hasInfoBtn = await js("!!document.querySelector('#libGrid .lib-item .lib-infobtn')");
    check('卡片上有详情按钮', hasInfoBtn === true);
    if (hasInfoBtn) {
      await js("(() => { document.querySelector('#libGrid .lib-item .lib-infobtn').click(); return undefined; })()");
      await sleep(400);
      check('详情面板打开了', await js("!document.querySelector('#libDetail').hidden"));
      const name = await js("document.querySelector('#libDetailName').textContent");
      check('详情里有名字', typeof name === 'string' && name.trim().length > 0, JSON.stringify(name));
      const rowCount = await js("document.querySelectorAll('#libDetailRows .lib-detail-row').length");
      check('详情里有信息行（不是空面板）', rowCount >= 3, 'rows=' + rowCount);
      const rowsText = await js("[...document.querySelectorAll('#libDetailRows .lib-detail-row')].map(r => r.textContent).join(' | ')");
      check('详情里有"帧数"', rowsText.includes('帧数'), rowsText.slice(0, 120));
      check('详情里有"来源"', rowsText.includes('来源'), rowsText.slice(0, 120));
      check('详情里没有 undefined', !rowsText.includes('undefined'), rowsText.slice(0, 120));
      check('详情有缩略图', await js("!!document.querySelector('#libDetailThumb').src"));

      // 关闭
      await js("document.querySelector('#btnLibDetailClose').click()");
      await sleep(250);
      check('详情能关掉', await js("document.querySelector('#libDetail').hidden === true"));
    }
  }

  // ---- 1. 新建分组：走**界面**路径（点「＋ 新建分组」，stub 掉 prompt）
  // 走 UI 而不是直接调 IPC，是因为 UI 路径会同步渲染进程里的 libPrefs —— 那才是真实用户路径。
  await js("(() => { window.__origPrompt = window.prompt; window.prompt = () => " + JSON.stringify(G1) + "; return undefined; })()");
  await js("[...document.querySelectorAll('#libGroups .lib-gchip')].find(b => b.classList.contains('lib-gadd')).click()");
  await sleep(700);
  await js("(() => { window.prompt = window.__origPrompt; delete window.__origPrompt; return undefined; })()");
  const afterAdd = await js("window.api.libraryGet()");
  const g1rec = (afterAdd.groups || []).find((g) => g.name === G1);
  check("界面上新建分组成功（已落盘）", !!g1rec, JSON.stringify((afterAdd.groups || []).map((g) => g.name)));
  const r1 = { ok: !!g1rec, id: g1rec && g1rec.id };
  check("返回了分组 id", !!(r1 && r1.id), String(r1 && r1.id));
  check("界面已渲染出新分组 chip", await js("[...document.querySelectorAll('#libGroups .lib-gchip')].some(b => b.dataset.gid === " + JSON.stringify(r1.id) + ")") === true);

  // ---- 2. 把宠物加进分组：点卡片上的 🏷，勾选分组（真实 UI 路径）
  // 走 UI 而不是直接调 IPC：UI 会同步渲染进程的 libPrefs，筛选才能立刻看到效果。
  await js("(() => { const btn = document.querySelector('#libGrid .lib-item .lib-groupbtn'); btn.click(); return undefined; })()");
  await sleep(400);
  const menuRows = await js("document.querySelectorAll('#groupMenu .gm-row').length");
  check("卡片上的 🏷 弹出分组浮层", menuRows >= 1, "rows=" + menuRows);
  await js("(() => { const rows = [...document.querySelectorAll('#groupMenu .gm-row')]; const target = rows.find(r => r.textContent.includes(" + JSON.stringify(G1) + ")); if (target) { const cb = target.querySelector('input'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } return undefined; })()");
  await sleep(700);
  const r2 = await js("window.api.libraryGet().then(l => ({ ok: !!l, library: l }))");
  check("把宠物加入分组成功", !!(r2 && r2.ok), JSON.stringify(r2 && r2.reason));
  const g1 = (r2.library.groups || []).find((g) => g.id === r1.id);
  check("分组里有 1 只宠物", g1.pets.length === 1, JSON.stringify(g1.pets));
  check("组内只有 1 只（没有重复）", !!g1 && g1.pets.length === 1, JSON.stringify(g1 && g1.pets));

  // ---- 3. 持久化：直接读磁盘 ----
  await sleep(400);
  let onDisk = null;
  try { onDisk = JSON.parse(fs.readFileSync(libPath, "utf8")); } catch (e) { onDisk = null; }
  const dg = onDisk && (onDisk.groups || []).find((g) => g.id === r1.id);
  check("分组已写入磁盘 library.json", !!dg, JSON.stringify(onDisk && onDisk.groups));
  check("磁盘上的分组里有那只宠物", !!(dg && dg.pets.includes(petId)), JSON.stringify(dg && dg.pets));

  // ---- 4. 界面：点 chip 只看该分组 ----
  await js("document.querySelector('#libSearch').dispatchEvent(new Event('input', { bubbles: true }))");
  await sleep(500);
  const hasChip = await js("[...document.querySelectorAll('#libGroups .lib-gchip')].some(b => b.dataset.gid === " + JSON.stringify(r1.id) + ")");
  check("界面出现该分组 chip", hasChip === true);
  if (hasChip) {
    const click = "(() => { const b = [...document.querySelectorAll('#libGroups .lib-gchip')].find(x => x.dataset.gid === " + JSON.stringify(r1.id) + "); if (b) b.click(); })()";
    await js(click);
    await sleep(500);
    check("按分组筛选后只剩组内 1 只", (await cards()) === 1, "shown=" + (await cards()));
    await js(click);
    await sleep(400);
    check("再点一次取消筛选", (await cards()) === total, "n=" + (await cards()));
  }

  // ---- 5. 一只宠物可属多个分组 ----
  const r3 = await js("window.api.libraryAddGroup(" + JSON.stringify(G2) + ")");
  check("建第二个分组", !!(r3 && r3.ok), JSON.stringify(r3 && r3.reason));
  await js("window.api.librarySetGroupMember(" + JSON.stringify(r3.id) + ", " + JSON.stringify(petId) + ", true)");
  const after = await js("window.api.libraryGet()");
  const memberships = (after.groups || []).filter((g) => g.pets.includes(petId));
  check("同一只宠物可属于多个分组", memberships.length >= 2, JSON.stringify(memberships.map((g) => g.name)));

  // ---- 6. 改名 / 重名拒绝 ----
  const NEW = TAG + "-改名后";
  const r4 = await js("window.api.libraryRenameGroup(" + JSON.stringify(r1.id) + ", " + JSON.stringify(NEW) + ")");
  check("分组改名成功", !!(r4 && r4.ok), JSON.stringify(r4 && r4.reason));
  check("改名后名字正确", r4.library.groups.find((g) => g.id === r1.id).name === NEW, JSON.stringify(r4.library.groups.map((g) => g.name)));
  const r5 = await js("window.api.libraryRenameGroup(" + JSON.stringify(r3.id) + ", " + JSON.stringify(NEW) + ")");
  check("改成重名被拒绝", !!(r5 && r5.ok === false), JSON.stringify(r5 && r5.reason));

  // ---- 7. 删分组不影响宠物 ----
  const before = (await js("window.api.listInstalled()")).length;
  const r6 = await js("window.api.libraryRemoveGroup(" + JSON.stringify(r1.id) + ")");
  check("删除分组成功", !!(r6 && r6.ok));
  check("分组确实没了", !r6.library.groups.some((g) => g.id === r1.id), JSON.stringify(r6.library.groups.map((g) => g.name)));
  check("删分组不影响宠物本身", (await js("window.api.listInstalled()")).length === before, before + "");

  // ---- 清理 ----
  await js("window.api.libraryRemoveGroup(" + JSON.stringify(r3.id) + ")");
  const cleaned = await js("window.api.libraryGet()");
  check("清理后没有残留测试分组", !(cleaned.groups || []).some((g) => String(g.name).startsWith(TAG)), JSON.stringify((cleaned.groups || []).map((g) => g.name)));

  log("");
  log("==== GROUPS E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
}).catch((e) => { log("FATAL " + e.message + "\n" + (e.stack || "")); app.exit(1); });
