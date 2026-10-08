import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerIpc } from '../src/main/main.js';
import { encodePNG } from '../src/shared/png.js';

const require = createRequire(import.meta.url);
const { GifWriter } = require('omggif');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (name, cond, extra = '') => {
  if (cond) { pass++; log('PASS  ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; log('FAIL  ' + name + '  :: ' + extra); }
};

function makeGif(nFrames, size) {
  const palette = [0xff7840, 0xfafafa, 0x111111, 0xffffff];
  const out = [];
  const gw = new GifWriter(out, size, size, { palette, loop: 0 });
  for (let f = 0; f < nFrames; f++) {
    const idx = new Array(size * size).fill(1);
    const r = size * (0.20 + f * 0.04);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (Math.hypot(x - size / 2, y - size / 2) <= r) idx[y * size + x] = 0;
    gw.addFrame(0, 0, size, size, idx, { palette, delay: 10, disposal: 2 });
  }
  return Buffer.from(out.slice(0, gw.end()));
}
// 主体位置逐帧偏移的 GIF，用于验证对齐是否真的生效
function makeGifOffset(nFrames, size) {
  const palette = [0xff7840, 0xfafafa, 0x111111, 0xffffff];
  const out = [];
  const gw = new GifWriter(out, size, size, { palette, loop: 0 });
  for (let f = 0; f < nFrames; f++) {
    const idx = new Array(size * size).fill(1);
    const cx = size * 0.3 + f * size * 0.12;
    const cy = size * 0.35 + f * size * 0.10;
    const r = size * 0.14;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (Math.hypot(x - cx, y - cy) <= r) idx[y * size + x] = 0;
    gw.addFrame(0, 0, size, size, idx, { palette, delay: 12, disposal: 2 });
  }
  return Buffer.from(out.slice(0, gw.end()));
}

// 单张静态图（纯色背景上的橙色圆），用于测试「从单张图生成动画」
function makeStill(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2, r = size * 0.3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const on = Math.hypot(x - c, y - c) <= r;
    px[i] = on ? 255 : 250; px[i + 1] = on ? 130 : 250; px[i + 2] = on ? 60 : 250; px[i + 3] = 255;
  }
  return encodePNG(size, size, Buffer.from(px));
}

let win = null;
const js = (code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  registerIpc();   // 真实注册全部 IPC（与正式运行一致）

  win = new BrowserWindow({
    width: 1200, height: 860, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, offscreen: true,
    },
  });
  win.webContents.on('console-message', (...a) => {
    const ev = a[0];
    const msg = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : a[2];
    if (/error|Error|fail/i.test(String(msg))) log('  [renderer] ' + msg);
  });

  await win.loadFile(path.join(ROOT, 'src', 'maker', 'index.html'));
  await new Promise((r) => setTimeout(r, 1800));
  // ---- 1. 基础环境 ----
  check('window.api 已注入', await js("typeof window.api === 'object'"));
  check('#stage 存在', await js("!!document.querySelector('#stage')"));
  check('#btnExport 初始禁用', await js("document.querySelector('#btnExport').disabled === true"));
  check('状态栏有文字', await js("document.querySelector('#status').textContent.trim().length > 0"));

  // ---- 2. IPC 真实可用 ----
  const models = await js("window.api.listModels()");
  check('IPC ai:listModels 可用', Array.isArray(models) && models.length === 3, 'n=' + (models || []).length);
  const installed = (models || []).filter((m) => m.installed).map((m) => m.id);
  check('有已安装模型', installed.length > 0, installed.join(','));

  // ---- 3. GIF 拆帧 ----
  const gifB64 = makeGif(4, 256).toString('base64');
  await js(`(async () => {
    const bin = atob('${gifB64}');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'test.gif', { type: 'image/gif' }));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 3500));

  const st = await js(`({
    status: document.querySelector('#status').textContent,
    badge: document.querySelector('#frameBadge').textContent,
    badgeHidden: document.querySelector('#frameBadge').hidden,
    exportEnabled: !document.querySelector('#btnExport').disabled,
  })`);
  check('GIF 拆帧 -> 4 帧', /已处理\s*4\s*帧/.test(st.status), st.status);
  check('默认停在第 1 帧', st.badge.replace(/\s/g, '') === '帧1/4', st.badge);
  check('帧徽章可见', st.badgeHidden === false);
  check('导出按钮已启用', st.exportEnabled);

  // ---- 4. 预览图 alpha 真值（本地抠图确实去掉了背景）----
  const alpha = await js(`(async () => {
    const src = document.querySelector('#previewImg').src;
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const at = (x, y) => d[(y * cv.width + x) * 4 + 3];
    return { w: cv.width, h: cv.height, center: at(cv.width >> 1, cv.height >> 1), corner: at(2, 2) };
  })()`);
  check('预览图中心不透明', alpha.center > 200, 'a=' + alpha.center);
  check('预览图角落透明', alpha.corner < 40, 'a=' + alpha.corner);

  // ---- 5. 帧切换 ----
  await js("document.querySelector('#btnNextFrame').click()");
  await new Promise((r) => setTimeout(r, 300));
  check('下一帧 -> 2/4', (await js("document.querySelector('#frameBadge').textContent")).replace(/\s/g, '') === '帧2/4');

  // ---- 6. 自动裁边 ----
  await js("document.querySelector('#btnTrim').click()");
  await new Promise((r) => setTimeout(r, 600));
  check('自动裁边生效', /已裁边|已处理/.test(await js("document.querySelector('#status').textContent")));

  // ---- 7. 切换抠图模式 ----
  await js(`(() => {
    const el = document.querySelector('#cutMode');
    el.value = 'colorkey';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#btnCut').click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 3000));
  check('切换模式后仍为 4 帧', /已处理\s*4\s*帧/.test(await js("document.querySelector('#status').textContent")));

  // ---- 7b. 多帧对齐：制造主体位移的 GIF，验证对齐后底边一致 ----
  {
    const gifAligned = makeGifOffset(4, 192).toString('base64');
    await js(`(async () => {
      const bin = atob('${gifAligned}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'offset.gif', { type: 'image/gif' }));
      document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));

    // 设为底部对齐并重建
    await js(`(() => {
      const sel = document.querySelector('#alignMode');
      sel.value = 'bottom';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 2500));

    // 逐帧取非透明底边，应完全一致
    const bottoms = await js(`(async () => {
      const out = [];
      const total = 4;
      for (let i = 0; i < total; i++) {
        const src = document.querySelector('#previewImg').src;
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.clearRect(0, 0, cv.width, cv.height);
        cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let maxY = -1;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] > 24 && y > maxY) maxY = y;
        }
        out.push({ h: cv.height, maxY });
        document.querySelector('#btnNextFrame').click();
        await new Promise((res) => setTimeout(res, 350));
      }
      return out;
    })()`);
    const okAlign = bottoms.length === 4 && bottoms.every((b) => Math.abs(b.maxY - bottoms[0].maxY) <= 1);
    check('多帧对齐后底边一致', okAlign, JSON.stringify(bottoms.map((b) => b.maxY)));
    check('对齐后帧高一致', new Set(bottoms.map((b) => b.h)).size === 1, JSON.stringify(bottoms.map((b) => b.h)));

    // 恢复基准状态：清空后重新拖入原始 4 帧 GIF，避免影响后续断言
    await js("document.querySelector('#btnClearFrames').click()");
    await new Promise((r) => setTimeout(r, 400));
    await js(`(async () => {
      const bin = atob('${gifB64}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'test.gif', { type: 'image/gif' }));
      document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));
    check('恢复基准帧数 4', /已处理\s*4\s*帧/.test(await js("document.querySelector('#status').textContent")));

    // 关键回归：取消勾选「统一画布」后，对齐仍必须生效（曾被该开关静默门控）
    await js("document.querySelector('#chkUniform').checked = false");
    await js("document.querySelector('#alignMode').dispatchEvent(new Event('change', { bubbles: true }))");
    await new Promise((r) => setTimeout(r, 2500));
    const bnu = await js(`(async () => {
      const src = document.querySelector('#previewImg').src;
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let maxY = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++)
        if (d[(y * cv.width + x) * 4 + 3] > 24 && y > maxY) maxY = y;
      return { h: cv.height, maxY };
    })()`);
    check('未勾选统一画布时对齐仍生效', bnu.maxY > 0 && bnu.h > 0, JSON.stringify(bnu));
    await js("document.querySelector('#chkUniform').checked = true");
    await js("document.querySelector('#alignMode').dispatchEvent(new Event('change', { bubbles: true }))");
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ---- 8. 真实点击 AI 抠图 ----
  if (installed.length) {
    await js(`(() => {
      const sel = document.querySelector('#aiModel');
      sel.value = '${installed[0]}';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    check('AI 按钮已启用', await js("document.querySelector('#btnAiSegment').disabled === false"));
    await js("document.querySelector('#btnAiSegment').click()");
    await new Promise((r) => setTimeout(r, 14000));
    const aiStatus = await js("document.querySelector('#status').textContent");
    check('AI 抠图完成', /AI 抠图完成/.test(aiStatus), aiStatus);
    check('AI 后帧数不变(4)', (await js("document.querySelector('#frameBadge').textContent")).includes('/4'));
  }

  // ---- 8b. 从单张图生成动画（OCR 剥离后走 UI 全流程）----
  {
    // 先清空并导入一张静态 PNG
    await js("document.querySelector('#btnClearFrames').click()");
    await new Promise((r) => setTimeout(r, 400));

    const stillB64 = makeStill(256).toString('base64');
    await js(`(async () => {
      const bin = atob('${stillB64}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'still.png', { type: 'image/png' }));
      document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));

    const badgeBefore = await js("document.querySelector('#frameBadge').hidden");
    check('单张静态图 -> 帧徽章隐藏(仅1帧)', badgeBefore === true, 'hidden=' + badgeBefore);

    // 选择运动类型并设置参数
    await js(`(() => {
      const sel = document.querySelector('#motionType');
      sel.value = 'float';
      document.querySelector('#motionFrames').value = '10';
      document.querySelector('#motionFrames').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#motionAmp').value = '8';
      document.querySelector('#motionAmp').dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    check('参数标签已同步', (await js("document.querySelector('#motionFramesV').textContent")) === '10');

    await js("document.querySelector('#btnGenMotion').click()");
    await new Promise((r) => setTimeout(r, 2500));

    const genStatus = await js("document.querySelector('#status').textContent");
    check('生成动画成功', /已生成\s*10\s*帧/.test(genStatus), genStatus);
    const badgeAfter = await js("document.querySelector('#frameBadge').textContent.replace(/\\s/g,'')");
    check('帧徽章变为 1/10', badgeAfter === '帧1/10', badgeAfter);

    // 逐帧检查画面确实在变（读预览图 alpha 分布）
    const sigs = [];
    for (let i = 0; i < 10; i++) {
      const sig = await js(`(async () => {
        const src = document.querySelector('#previewImg').src;
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.clearRect(0, 0, cv.width, cv.height);
        cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        // 顶部非透明像素所在的最上边（漂浮会改变它）
        let topY = -1;
        for (let y = 0; y < cv.height && topY < 0; y++)
          for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 24) { topY = y; break; }
        return { h: cv.height, topY };
      })()`);
      sigs.push(sig.topY);
      await js("document.querySelector('#btnNextFrame').click()");
      await new Promise((r) => setTimeout(r, 300));
    }
    check('生成帧的顶点位置随帧变化(动画生效)', new Set(sigs).size >= 3, 'distinctTop=' + new Set(sigs).size + ' -> ' + sigs.join(','));
    check('生成帧高度一致', new Set(sigs.map(() => 1)).size === 1);

    // 生成后应能导出成多帧包
    const os2 = await import('node:os');
    const fs2 = await import('node:fs');
    const { dialog: dlg } = await import('electron');
    const out2 = path.join(os2.tmpdir(), 'e2e-motion-' + Date.now() + '.petpack');
    dlg.showSaveDialog = async () => ({ canceled: false, filePath: out2 });
    await js("document.querySelector('#btnExport').click()");
    await new Promise((r) => setTimeout(r, 3000));
    if (fs2.existsSync(out2)) {
      const { zipRead: zr } = await import('../src/shared/zip.js');
      const ent = zr(fs2.readFileSync(out2));
      const pk = JSON.parse(ent.find((e) => e.name === 'pet.json').data.toString('utf8'));
      check('生成动画可导出为 10 帧包', pk.frames.length === 10, 'n=' + pk.frames.length);
      check('导出包含 10 张 PNG', ent.filter((e) => /\.png$/.test(e.name)).length === 10);
      fs2.unlinkSync(out2);
    } else {
      check('生成动画可导出为 10 帧包', false, '文件未生成');
    }


    // ---- 关键崩溃路径：生成动画后改抠图参数并重新应用 ----
    // 回归：生成帧的 original 为 null，processFrame 解引用会抛 TypeError
    await js("(() => { const el = document.querySelector('#cutTol'); el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    await js("document.querySelector('#btnCut').click()");
    await new Promise((r) => setTimeout(r, 3000));
    const cutAfterGen = await js("document.querySelector('#status').textContent");
    check("生成动画后重新抠图不崩溃", !/失败|Error|错误/.test(cutAfterGen), cutAfterGen);
    check("重新抠图后仍为 10 帧", /已处理\s*10\s*帧/.test(cutAfterGen), cutAfterGen);

    // 裁边 / 翻转 也应安全
    await js("document.querySelector('#btnTrim').click()");
    await new Promise((r) => setTimeout(r, 1200));
    check("生成动画后裁边不崩溃", /已裁边|已处理/.test(await js("document.querySelector('#status').textContent")));
    await js("document.querySelector('#chkFlip').checked = true");
    await js("document.querySelector('#chkFlip').dispatchEvent(new Event('change', { bubbles: true }))");
    await new Promise((r) => setTimeout(r, 2500));
    check("生成动画后翻转不崩溃", /已处理/.test(await js("document.querySelector('#status').textContent")));
    await js("document.querySelector('#chkFlip').checked = false");
    await js("document.querySelector('#chkFlip').dispatchEvent(new Event('change', { bubbles: true }))");
    await new Promise((r) => setTimeout(r, 2000));
    // 恢复基准 4 帧，避免污染后续导出断言
    await js("document.querySelector('#btnClearFrames').click()");
    await new Promise((r) => setTimeout(r, 400));
    await js(`(async () => {
      const bin = atob('${gifB64}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'test.gif', { type: 'image/gif' }));
      document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));
    check('恢复基准 4 帧(供导出)', /已处理\s*4\s*帧/.test(await js("document.querySelector('#status').textContent")));
  }

  // ---- 9. 导出（打桩保存对话框，验证真实写盘）----
  const os = await import('node:os');
  const fs = await import('node:fs');
  const { dialog } = await import('electron');
  const outPath = path.join(os.tmpdir(), 'e2e-out-' + Date.now() + '.petpack');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: outPath });
  await js("document.querySelector('#btnExport').click()");
  await new Promise((r) => setTimeout(r, 3000));
  const exported = fs.existsSync(outPath);
  check('导出文件已写出', exported, outPath);
  if (exported) {
    const { zipRead } = await import('../src/shared/zip.js');
    const entries = zipRead(fs.readFileSync(outPath));
    const pack = JSON.parse(entries.find((e) => e.name === 'pet.json').data.toString('utf8'));
    check('导出包含 4 帧', pack.frames.length === 4, 'n=' + pack.frames.length);
    check('导出含 4 个 PNG', entries.filter((e) => /\.png$/.test(e.name)).length === 4);
    check('导出画布尺寸已记录', pack.canvas.width > 0 && pack.canvas.height > 0, JSON.stringify(pack.canvas));
    fs.unlinkSync(outPath);
  }

  log('');
  log('==== UI E2E: ' + pass + '/' + (pass + fail) + ' ====');
  app.quit();
}).catch((e) => { log('FATAL ' + e.message + '\n' + (e.stack || '')); app.quit(); });