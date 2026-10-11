// 多宠物同屏 端到端：
// 1) 一次启用多只，桌面上真的有 N 个宠物窗口（不是只有 1 个）
// 2) ★ 每只宠物拿到的是**自己的**包（这是多宠物最容易错的地方：
//    以前 pet:getPack 返回全局"当前包"，三只全会变成同一只）
// 3) 各只位置错开（不叠在一起）
// 4) 关掉其中一只，其它还在
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpc } from "../src/main/main.js";
import { listPets, petCount, petByWebContentsId } from "../src/main/state.js";

// 供托盘菜单测试用：把在跑的宠物转成菜单需要的形状
function runningPetsForTray() {
  return listPets().map((it) => ({ id: it.id, name: (it.pack && it.pack.name) || it.id }));
}

const ROOT = process.cwd();
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + "\n");
const check = (n, c, e = "") => { if (c) { pass++; log("PASS  " + n + (e ? "  (" + e + ")" : "")); } else { fail++; log("FAIL  " + n + "  :: " + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 前置：清掉可能残留的宠物实例。
  // 这个套件在全量里跑时，前面的套件（library/quick 等）可能留下宠物，
  // 那些实例会被 listPets 数进来 —— 于是断言里混进旧的"北极熊"，
  // 看着像"三只都变成同一只"，其实是把旧实例也读进去了（实测踩到）。
  for (const old of listPets()) {
    try { old.win.close(); } catch (err) { /* 忽略 */ }
  }
  await sleep(2200);
  check("前置清理：开始时桌面上没有残留宠物", petCount() === 0, "count=" + petCount());

  await js("document.querySelector('#btnLibrary').click()");
  for (let i = 0; i < 40; i++) { if ((await js("document.querySelectorAll('#libGrid .lib-item').length")) > 0) break; await sleep(250); }
  check("宠物库打开且有宠物", (await js("document.querySelectorAll('#libGrid .lib-item').length")) >= 3);

  // 多选 UI 存在
  check("有「多选」按钮", await js("!!document.querySelector('#btnLibMulti')"));
  check("多选模式下才有「一起放出来」按钮（初始隐藏）", await js("document.querySelector('#btnLibEnableMulti').hidden === true"));

  // 进入多选模式
  await js("document.querySelector('#btnLibMulti').click()");
  await sleep(400);
  check("进入多选模式后出现勾选框", (await js("document.querySelectorAll('#libGrid .lib-pick').length")) >= 3);
  check("多选模式下「一起放出来」按钮出现", await js("document.querySelector('#btnLibEnableMulti').hidden === false"));

  // 勾选 3 只
  // 逐次点击，且每次都**重新查询 DOM**：
  // 每点一下卡片都会 renderLibrary() 重建整个网格，之前缓存的元素引用就失效了
  // —— 连续点击旧引用会重复点同一张（实测：三只都变成"北极熊"）。
  // 用 data-petId **按 id 精确点击**，而不是按位置：
  // 每次点击都会 renderLibrary() 重建网格，按位置取会在重渲染后点错同一张（实测踩到）。
  const wantIds = await js("(() => [...document.querySelectorAll('#libGrid .lib-item')].slice(0, 3).map(el => el.dataset.petId))()");
  for (const id of wantIds) {
    await js("(() => { const el = [...document.querySelectorAll('#libGrid .lib-item')].find(x => x.dataset.petId === " + JSON.stringify(id) + "); if (el) el.click(); return undefined; })()");
    await sleep(350);
  }
  await sleep(500);
  const btnText = await js("document.querySelector('#btnLibEnableMulti').textContent");
  check("按钮显示已选数量", btnText.includes("3"), btnText);
  // 再确认一次选中的是 3 只**不同**的宠物（防止又点到同一张卡）
  const pickedNames = await js("(() => [...document.querySelectorAll('#libGrid .lib-item.picked')].map(e => e.dataset.petId))()");
  check("勾选的是 3 只不同的宠物（按 id 判定）", new Set(pickedNames).size === 3, JSON.stringify(pickedNames));
  check("勾选后按钮可用", await js("document.querySelector('#btnLibEnableMulti').disabled === false"));

  // ★ 一起放出来
  await js("document.querySelector('#btnLibEnableMulti').click()");
  await sleep(7000);
  const cnt = petCount();
  check("桌面上真的有 3 只宠物窗口", cnt === 3, "count=" + cnt);

  const pets = listPets();
  check("每只都登记了包", pets.every((p) => p.pack && p.pack.name), JSON.stringify(pets.map((p) => p.pack && p.pack.name)));

  // ★ 关键：每只宠物自己回答"我是谁"，拿到的必须是**自己的**包。
  // 注意要按 webContents.id 逐只问 —— 直接遍历窗口对象在 Electron 里
  // 可能拿到同一个引用（实测过），那样即使后端正确也会误报"全变成同一只"。
  const ids = pets.map((p) => p.win.webContents.id);
  check("三只宠物的 webContents 各不相同", new Set(ids).size === ids.length, JSON.stringify(ids));
  const names = [];
  for (const wcId of ids) {
    const rec = petByWebContentsId(wcId);
    if (!rec || !rec.win) { names.push(null); continue; }
    // 同时打印主进程侧的证据（rec.pack.name）与渲染进程侧的证据（dbg.packName），
    // 好判断是哪一层出错
    const dbg = await rec.win.webContents.executeJavaScript("window.__petDebug()");
    log("  [id " + rec.id + "] 主进程=" + (rec.pack && rec.pack.name) + " 渲染进程=" + (dbg && dbg.packName) + " wcId=" + wcId);
    names.push(dbg ? (dbg.packName || null) : null);
  }
  // ★ 断言方式很重要：不能断言"包名互不相同"。
  // 全量跑时前面的套件会在库里留下测试宠物（内容是从同一只内置宠物复制来的，
  // 于是名字可能一样，比如三只都叫"北极熊"）—— 那是**测试数据同名**，不是后端错。
  // 正确的判据是：**每只宠物拿到的包，必须和主进程里记录的它自己那份一致**。
  let allMatch = true;
  const detail = [];
  for (const wcId of ids) {
    const rec = petByWebContentsId(wcId);
    if (!rec || !rec.win) { allMatch = false; detail.push(wcId + ":no-rec"); continue; }
    const dbg = await rec.win.webContents.executeJavaScript("window.__petDebug()");
    const mine = (rec.pack && rec.pack.name) || null;
    const got = (dbg && dbg.packName) || null;
    detail.push(wcId + ":" + mine + "==" + got);
    if (mine !== got) allMatch = false;
  }
  check("每只宠物拿到的正是它自己那份包", allMatch, detail.join(" | "));
  // 再补一条：三只必须对应三个不同的实例（不是同一只被数了三次）
  const recIds = ids.map((w) => { const r = petByWebContentsId(w); return r ? r.id : null; });
  check("三只对应三个不同的宠物实例", new Set(recIds).size === 3, JSON.stringify(recIds));

  // 位置错开
  const pos = pets.map((p) => { const b = p.win.getBounds(); return b.x + "," + b.y; });
  check("各只位置错开（不叠在一起）", new Set(pos).size === pos.length, JSON.stringify(pos));

  // ---- 多宠物互相感知：每只都应该知道"除了我以外还有同伴" ----
  {
    await sleep(600);   // 等主进程推一轮同伴位置
    let allKnow = true;
    const detail = [];
    for (const wcId of ids) {
      const rec = petByWebContentsId(wcId);
      if (!rec || !rec.win) { allKnow = false; continue; }
      const dbg = await rec.win.webContents.executeJavaScript("window.__petDebug()");
      const n = (dbg && dbg.peerCount) || 0;
      detail.push(rec.id + ":" + n);
      if (n !== ids.length - 1) allKnow = false;   // 3 只时每只应看到 2 个同伴
    }
    check("每只宠物都看到了其它同伴（不是以为自己独自活着）", allKnow, detail.join(" | "));
    // 而且不能把自己算进同伴里
    const rec0 = petByWebContentsId(ids[0]);
    const dbg0 = await rec0.win.webContents.executeJavaScript("window.__petDebug()");
    check("同伴列表里不含自己", Array.isArray(dbg0.peerIds) && !dbg0.peerIds.includes(rec0.id), JSON.stringify(dbg0.peerIds));
  }

  // ---- 托盘菜单：能列出在跑的每一只，并能点名关掉某一只 ----
  {
    const { buildTrayMenuTemplate } = await import("../src/main/tray.js");
    const acts = [];
    const menu = buildTrayMenuTemplate({ petAlive: true, makerAlive: true, pets: runningPetsForTray() }, (c) => acts.push(c));
    const labels = menu.map((x) => x.label).filter((x) => typeof x === "string");
    check("托盘标题显示在跑数量", labels.some((x) => x.includes("3 只在跑")), JSON.stringify(labels));
    check("托盘逐只列出了名字", labels.some((x) => x.includes("北极熊")) && labels.some((x) => x.includes("大胖鸡")), JSON.stringify(labels));
    // 真的点一下「关掉大胖鸡」，验证它只关那一只
    const row = menu.find((x) => typeof x.label === "string" && x.label.includes("大胖鸡"));
    check("托盘里能找到大胖鸡那一项", !!row);
    if (row) {
      const target = listPets().find((p) => (p.pack && p.pack.name) === "大胖鸡");
      check("能定位到大胖鸡这个实例", !!target, JSON.stringify(listPets().map((p) => p.pack && p.pack.name)));
      if (target) {
        target.win.close();
        await sleep(2200);
        const left = listPets().map((p) => p.pack && p.pack.name);
        check("点名关掉后只剩另外两只", left.length === 2 && !left.includes("大胖鸡"), JSON.stringify(left));
      }
    }
  }

  // 上面托盘测试已经点名关掉了大胖鸡（3 -> 2）；
  // 这里再关一只，应该只剩最后 1 只（其它照常不受影响）。
  const remainBefore = petCount();
  const one = listPets()[0];
  if (one) one.win.close();
  await sleep(2500);
  check("再关掉一只后确实又少了一只", petCount() === remainBefore - 1, remainBefore + " -> " + petCount());
  check("剩下的那只还在正常跑", petCount() >= 1, "count=" + petCount());

  // 全关
  for (const p of listPets()) { try { p.win.close(); } catch (e) {} }
  await sleep(2500);
  check("全部关闭后 count=0", petCount() === 0, "count=" + petCount());

  log("");
  log("==== MULTIPET E2E: " + pass + "/" + (pass + fail) + " ====");
  app.exit(fail ? 1 : 0);
}).catch((e) => { log("FATAL " + e.message + "\n" + (e.stack || "")); app.exit(1); });
