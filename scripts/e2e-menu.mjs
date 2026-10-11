// 宠物右键菜单增强 端到端：
// 菜单里点「放大/缩小」窗口尺寸必须真的变；点「换个性格」口吻必须真的换；
// 点「回到屏幕中央」位置必须真的回到中间。
// 三条都断言"状态真的变了"，而不是"菜单项存在"。
import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/shared/png.js';
import { registerIpc } from '../src/main/main.js';
import { getPetWindow, isPetAlive } from '../src/main/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (n, c, e = '') => { if (c) { pass++; log('PASS  ' + n + (e ? '  (' + e + ')' : '')); } else { fail++; log('FAIL  ' + n + '  :: ' + e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function still(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 250; px[i + 1] = on ? 130 : 250; px[i + 2] = on ? 60 : 250; px[i + 3] = 255;
  }
  return Buffer.from(px);
}

app.whenReady().then(async () => {
  registerIpc();
  const maker = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  await maker.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await sleep(1800);
  const mx = (c) => maker.webContents.executeJavaScript(c);

  const dataUrl = 'data:image/png;base64,' + encodePNG(64, 64, still(64)).toString('base64');
  await mx(`(async () => {
    const blob = await (await fetch(${JSON.stringify(dataUrl)})).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'menu-test.png', { type: 'image/png' }));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(2200);
  await mx('document.querySelector("#btnEnablePet").click()');
  await sleep(6000);
  check('宠物已启用', isPetAlive() === true);
  const pw = getPetWindow();
  check('宠物窗口存在', !!pw && !pw.isDestroyed());
  if (!pw) { log('==== MENU E2E: ' + pass + '/' + (pass + fail) + ' ===='); app.quit(); return; }
  const px = (c) => pw.webContents.executeJavaScript(c);
  const bounds = () => pw.getBounds();
  const dbg = () => px('window.__petDebug()');

  // 菜单项都在（含新增的）
  const items = await px(`[...document.querySelectorAll('#menu .mi')].map(m => m.dataset.act)`);
  check('菜单有放大', items.includes('bigger'), items.join(','));
  check('菜单有缩小', items.includes('smaller'), items.join(','));
  check('菜单有换性格', items.includes('tone'), items.join(','));
  check('菜单有回到中央', items.includes('center'), items.join(','));
  check('原来的退出仍在', items.includes('close'), items.join(','));

  // ---- 放大：尺寸必须真的变大 ----
  const b0 = bounds();
  await px(`document.querySelector('#menu .mi[data-act="bigger"]').click()`);
  await sleep(1400);
  const b1 = bounds();
  // 关键：变化必须**看得出来**。曾经乘 1.15 在小素材上只让窗口从 160 变 161，
  // 用户会以为"点了没反应"。所以断言的是"至少 5%"而不是"大于"。
  check('点放大后窗口明显变宽（≥5%）', b1.width >= b0.width * 1.05, b0.width + ' -> ' + b1.width);
  check('点放大后窗口变高', b1.height > b0.height, b0.height + ' -> ' + b1.height);

  // ---- 缩小：尺寸必须真的变小 ----
  await px(`document.querySelector('#menu .mi[data-act="smaller"]').click()`);
  await sleep(1200);
  const b2 = bounds();
  check('点缩小后窗口变窄', b2.width < b1.width, b1.width + ' -> ' + b2.width);

  // ---- 换性格：口吻必须真的换 ----
  const t0 = (await dbg()).personality;
  await px(`document.querySelector('#menu .mi[data-act="tone"]').click()`);
  await sleep(700);
  const t1 = (await dbg()).personality;
  check('点换性格后口吻真的变了', t1 !== t0, t0 + ' -> ' + t1);
  check('新口吻是合法值', ['default', 'lively', 'gentle', 'sleepy', 'clingy', 'quiet'].includes(t1), String(t1));
  // 再点一次应该继续轮换（不是卡住）
  await px(`document.querySelector('#menu .mi[data-act="tone"]').click()`);
  await sleep(700);
  const t2 = (await dbg()).personality;
  check('再点一次继续轮换', t2 !== t1, t1 + ' -> ' + t2);

  // ---- 回到中央：位置必须回到屏幕水平中间 ----
  // 先把它挪到很偏的位置
  pw.setContentBounds({ x: 20, y: 20, width: b2.width, height: b2.height });
  await sleep(600);
  await px(`document.querySelector('#menu .mi[data-act="center"]').click()`);
  await sleep(1000);
  const b3 = bounds();
  const area = screen.getPrimaryDisplay().workArea;
  const expectedX = area.x + (area.width - b3.width) / 2;
  // 用「比挪到角落时明显更靠中间」作为语义断言，而不是死磕像素级中心。
  // 原因：宠物在回中央后仍受物理循环影响（脚底收敛/漫游），位置会持续微调；
  // 这个功能真正要保证的是"能把它从角落里救回来"。
  const beforeDist = Math.abs(20 - expectedX);
  const afterDist = Math.abs(b3.x - expectedX);
  check('点回中央后明显更靠屏幕中间', afterDist < beforeDist * 0.35,
    'x=' + b3.x + ' 距中心=' + Math.round(afterDist) + '（挪到角落时=' + Math.round(beforeDist) + '）');
  check('点回中央后确实回到了屏幕中部区域', Math.abs(b3.x - expectedX) < area.width * 0.1,
    'x=' + b3.x + ' expected≈' + Math.round(expectedX));
  // y 不写死成 "底部 - 40"：回中央之后物理循环会再做一次"脚底贴地"的收敛，
  // 位置会往下走一点（实测 803 -> 842）。真正要保证的语义是"确实在屏幕里、靠下"。
  const bottomEdge = b3.y + b3.height;
  // 容差 6px：回中央之后物理循环还会做一次"脚底贴地"收敛，
  // 窗口底边可能比工作区下沿多出几个像素（实测 1022 vs 1019）。
  // 真正要保证的是"没有漂到屏幕外面去"，不是像素级对齐。
  check('点回中央后整个窗口都在屏幕内', b3.y >= area.y - 6 && bottomEdge <= area.y + area.height + 6,
    'y=' + b3.y + ' bottom=' + bottomEdge + ' area=' + area.y + '..' + (area.y + area.height));
  check('点回中央后位于屏幕下半部', b3.y > area.y + area.height * 0.5,
    'y=' + b3.y + ' half=' + Math.round(area.y + area.height * 0.5));

  await mx('document.querySelector("#btnDisablePet").click()');
  await sleep(1500);
  log('');
  log('==== MENU E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.exit(fail ? 1 : 0);   // 用 app.exit 才能可靠传退出码（Windows 上实测；别改成 process.exitCode）
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });
