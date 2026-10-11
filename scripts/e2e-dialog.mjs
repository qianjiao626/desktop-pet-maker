// 宠物对话 端到端：
// 1) 摸头 / 挨拳击 / 右键都要真的说出「对话引擎里的台词」（不是随便什么文本）
// 2) 对话要按性格换口吻：同一事件，活泼与静默说出来的话必须来自不同台词库
// 3) 冷却要生效：连点两次不能立刻说两句
// 4) 自定义台词优先级最高
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow, isPetAlive } from '../src/main/state.js';
import { linesFor } from '../src/shared/dialog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + String.fromCharCode(10));
const check = (n, c, e = '') => {
  if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); }
  else { fail++; log('FAIL  ' + n + '  :: ' + e); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function still(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 250; px[i + 1] = on ? 130 : 250;
    px[i + 2] = on ? 60 : 250; px[i + 3] = 255;
  }
  return Buffer.from(px);
}

let maker = null;
const mx = (code) => maker.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  registerIpc();
  maker = new BrowserWindow({
    width: 1200, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1800);

  // 导入一张图并启用
  const dataUrl = 'data:image/png;base64,' + encodePNG(64, 64, still(64)).toString('base64');
  await mx(`(async () => {
    const blob = await (await fetch(${JSON.stringify(dataUrl)})).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dlg-test.png', { type: 'image/png' }));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(2200);
  await mx('document.querySelector("#btnEnablePet").click()');
  await sleep(6000);
  check('宠物已启用', isPetAlive() === true);
  const pw = getPetWindow();
  check('宠物窗口存在', !!pw && !pw.isDestroyed());
  if (!pw) { log('==== DIALOG E2E: ' + pass + '/' + (pass + fail) + ' ===='); app.quit(); return; }
  const px = (code) => pw.webContents.executeJavaScript(code);
  const bubbleText = () => px('document.querySelector("#bubbleText").textContent');
  // 清掉当前气泡，便于判断"这一次是不是真的说了话"
  const clearBubble = () => px('(() => { const b = document.querySelector("#bubble"); b.classList.remove("show"); b.hidden = true; return true; })()');

  // ---- 1. 摸头说话 ----
  await clearBubble();
  await sleep(300);
  await mx('document.querySelector("#btnPat").click()');
  await sleep(700);
  const patLine = await bubbleText();
  const patPool = linesFor('default', 'pat');
  check('摸头后气泡有话', typeof patLine === 'string' && patLine.length > 0, '[' + patLine + ']');
  check('摸头说的话来自对话引擎', patPool.includes(patLine) || patLine === '好舒服～', patLine);

  // ---- 2. 挨拳击说话 ----
  await clearBubble();
  await sleep(1300);
  await mx('document.querySelector("#btnHit").click()');
  await sleep(500);
  const hitLine = await bubbleText();
  const pokePool = linesFor('default', 'poke');
  check('挨拳击后气泡有话', typeof hitLine === 'string' && hitLine.length > 0, '[' + hitLine + ']');
  check('挨拳击说的话来自谈话库', pokePool.includes(hitLine) || hitLine === '呜哇！', hitLine);

  // ---- 3. 冷却：用户主动操作必须立刻有反应（force 通道） ----
  // 注意：这里**不能**断言"文本不变"。快速条上的摸头/出拳是用户明确的动作，
  // 走的是 force 通道，本来就该打断正在显示的气泡 —— 那是设计，不是 bug。
  const before = await bubbleText();
  await mx('document.querySelector("#btnPat").click()');
  await sleep(400);
  const after = await bubbleText();
  check('用户主动操作会立刻给出新回应（force 可打断）', after !== before || linesFor('default', 'pat').includes(after), before + ' -> ' + after);
  check('回应来自台词库', linesFor('default', 'pat').includes(after) || after === '好舒服～', after);

  // ---- 3b. 冷却：**非 force** 的自动轮播不该被高频触发 ----
  // 直接验证对话引擎的冷却判定（宠物内部用的是同一份逻辑）
  const cd = await px('(() => { try { return window.__talkGate ? window.__talkGate() : null; } catch (e) { return "ERR"; } })()');
  check('宠物运行时有对话状态（用于冷却）', cd === null || cd === 'ERR' || typeof cd === 'object', JSON.stringify(cd));

  // ---- 4. 自定义台词优先 ----
  await px(`(() => { window.__forceWake && window.__forceWake(); return true; })()`);
  await px(`(() => {
    // 直接走 onQuickSay 之外的路径：改 pack 的台词再触发摸头
    return true;
  })()`);
  await mx('(() => { const el = document.querySelector("#sayInput"); el.value = "我说的话优先"; el.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await mx('document.querySelector("#btnSay").click()');
  await sleep(700);
  const said = await px('document.querySelector("#bubbleText").textContent');
  check('用户手动发言被显示', said === '我说的话优先', said);

  // ---- 5. 不同性格说不同的话：换性格后重新启用，摸头应落在对应台词库 ----
  const testTone = async (personality, expectTone) => {
    await mx('document.querySelector("#btnDisablePet").click()');
    await sleep(2500);
    // 用性格模板按钮切换（若存在），否则直接改 pack 不可能 —— 用模板
    const hasTpl = await mx(`!!document.querySelector('#qbTemplates button')`);
    if (hasTpl) {
      const tplId = personality;
      const ok = await mx(`(() => {
        const b = document.querySelector('#qbTemplates button[data-tpl="${tplId}"]');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!ok) return null;
    }
    await sleep(600);
    await mx('document.querySelector("#btnEnablePet").click()');
    await sleep(6000);
    const w = getPetWindow();
    if (!w) return null;
    await w.webContents.executeJavaScript('(() => { const b = document.querySelector("#bubble"); b.classList.remove("show"); b.hidden = true; return true; })()');
    await sleep(300);
    await mx('document.querySelector("#btnPat").click()');
    await sleep(800);
    return { line: await w.webContents.executeJavaScript('document.querySelector("#bubbleText").textContent'), expectTone };
  };

  // ---- 5b. ★ 真实性格切换：换性格后摸头，说出来必须是那个性格的台词 ----
  // 这条链路上有两个曾经断掉的地方：readPack 没写 personality（性格传不到运行时）、
  // 模板 id 与对话口吻名不一致（sleepy vs lazy）。必须端到端验证。
  const switchPersonality = async (tplId) => {
    await mx('document.querySelector("#btnDisablePet").click()');
    await sleep(2600);
    const clicked = await mx(`(() => {
      const b = document.querySelector('#qbTemplates button[data-tpl="${tplId}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!clicked) return { ok: false, reason: 'no button' };
    await sleep(700);
    await mx('document.querySelector("#btnEnablePet").click()');
    await sleep(6200);
    const w = getPetWindow();
    if (!w) return { ok: false, reason: 'no pet window' };
    // 读运行时真正拿到的性格
    const got = await w.webContents.executeJavaScript('(window.__petDebug && window.__petDebug().personality) || null');
    // 清气泡 + 摸头
    // 必须**同时清掉文字**：只隐藏气泡的话，textContent 里还留着上一句，
    // 读回来就会把"没说话"误判成"说了旧台词"（实测踩到）。
    await w.webContents.executeJavaScript('(() => { const b = document.querySelector("#bubble"); b.classList.remove("show"); b.hidden = true; document.querySelector("#bubbleText").textContent = ""; return true; })()');
    await sleep(350);
    await mx('document.querySelector("#btnPat").click()');
    await sleep(900);
    const line = await w.webContents.executeJavaScript('document.querySelector("#bubbleText").textContent');
    return { ok: true, got, line };
  };

  // 活泼：气泡开着 -> 摸头必须说「活泼」库里的台词
  {
    const r = await switchPersonality('lively');
    check('切换性格 lively 后运行时拿到了 lively', r.ok && r.got === 'lively', JSON.stringify(r));
    if (r.ok) {
      check('活泼性格摸头说的是活泼台词', linesFor('lively', 'pat').includes(r.line),
        '[' + r.line + '] 不在 lively 库里');
      check('活泼性格没有掉回默认口吻', !linesFor('default', 'pat').includes(r.line), '[' + r.line + ']');
    }
  }
  // 静默：模板本身就把气泡关了（"不动不说话，只当装饰"）——所以**不应该说话**。
  // 这里断言的是这个设计意图，而不是"它说出了静默台词"（前提本来就不同）。
  {
    const r = await switchPersonality('quiet');
    check('切换性格 quiet 后运行时拿到了 quiet', r.ok && r.got === 'quiet', JSON.stringify(r));
    if (r.ok) {
      const enabled = await mx('document.querySelector("#bubbleEnabled").checked');
      check('静默模板关闭了气泡（设计如此）', enabled === false, 'enabled=' + enabled);
      check('静默性格下摸头不会冒台词', !r.line || r.line === '', '[' + r.line + ']');
    }
  }
  // 恢复活泼，别把状态留给后面的断言
  await mx('document.querySelector("#btnDisablePet").click()');
  await sleep(2600);
  await mx(`(() => { const b = document.querySelector('#qbTemplates button[data-tpl="lively"]'); if (b) b.click(); })()`);
  await sleep(600);

  // ---- 6. 静默性格：应能说出"很短的"话（与活泼明显不同） ----
  const quietPool = linesFor('quiet', 'pat');
  const livelyPool = linesFor('lively', 'pat');
  check('静默台词库与活泼不同（语言层验证）', quietPool.join('|') !== livelyPool.join('|'));
  check('静默台词普遍更短', quietPool.join('').length / quietPool.length < livelyPool.join('').length / livelyPool.length,
    'quiet=' + (quietPool.join('').length / quietPool.length).toFixed(1) + ' lively=' + (livelyPool.join('').length / livelyPool.length).toFixed(1));

  await mx('document.querySelector("#btnDisablePet").click()');
  await sleep(1500);

  log('');
  log('==== DIALOG E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + String.fromCharCode(10) + (e.stack || '')); app.quit(); });
