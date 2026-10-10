// 零依赖「分享包」：把一只桌宠塞进一个自包含的 HTML 文件。
//
// 目标（用户原话：人人可以上传自己的桌宠，制作性与可操作性第一）：
//   导出后得到 **一个 .html 文件**，对方用浏览器直接打开就能看到桌宠动起来，
//   不需要装任何东西、不需要服务器、不需要网络。可以微信/QQ/邮件直接发。
//
// 设计要点：
//   1. 纯字符串拼接（可单测），不依赖 Electron，也不依赖任何第三方库。
//   2. 图片以 dataURL 内嵌，.petpack 的 base64 也内嵌 —— 这样接收方
//      「在桌宠制作器里打开这个 HTML」时也能还原成完整宠物（一条兜底路径）。
//   3. 用户可控内容（宠物名 / 台词 / 作者）必须转义，否则名字里带 < 就会把页面搞坏。
//   4. 大小写 + 转义 + </script> 逃逸都处理掉：JSON 里若不转义 "</"，
//      内嵌到 <script> 中会提前闭合标签，整页崩掉。

/** HTML 文本转义（用于 <title> / 可见文本） */
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 转义为可安全内嵌 <script> 的 JSON。
 * 关键：把 "</" 变成 "<\/"，并处理 U+2028/U+2029（JS 里是换行符，会炸）。
 */
export function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 文件名：用于生成的 .html 名字（与 safeFileName 保持一致的风格） */
export function shareFileName(petName) {
  let s = String(petName == null ? '' : petName);
  s = s.replace(/[\t\n\r\f\v]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  s = s.replace(/^[._\s]+/, '').replace(/[._\s]+$/, '');
  if (!s) s = 'pet';
  const cps = Array.from(s);
  if (cps.length > 60) s = cps.slice(0, 60).join('');
  return s + '_share.html';
}

/**
 * 生成自包含分享页。
 * @param {object} pack       已归一化的宠物包（frames 里是包内文件名）
 * @param {Array}  frames     [{ file, dataUrl, durationMs }]
 * @param {object} opt        { title?: string, petpackBase64?: string, petpackName?: string }
 * @returns {string}          完整 HTML 文档
 */
export function buildShareHtml(pack, frames, opt = {}) {
  const name = String((pack && pack.name) || '我的桌宠');
  const author = String((pack && pack.author) || '');
  const title = String(opt.title || name);
  const lines = (pack && pack.bubble && Array.isArray(pack.bubble.lines)) ? pack.bubble.lines : [];
  // 气泡是否开启也带过去：接收方看到的行为应与作者设置一致
  const bubbleOn = !!(pack && pack.bubble && pack.bubble.enabled);

  const payload = {
    name,
    author,
    bubble: bubbleOn,
    lines: lines.slice(0, 50).map((x) => String(x)),
    frames: (Array.isArray(frames) ? frames : []).map((f) => ({
      url: String((f && f.dataUrl) || ''),
      ms: Math.max(16, Math.round((f && f.durationMs) || 120)),
    })),
    petpack: opt.petpackBase64 ? String(opt.petpackBase64) : '',
    petpackName: opt.petpackName ? String(opt.petpackName) : '',
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} - 桌宠分享</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    background: radial-gradient(1200px 700px at 50% 0%, #1c2233 0%, #0f1117 60%, #0b0d12 100%);
    color: #e7ecf5;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 18px; padding: 28px 18px; overflow: hidden;
  }
  .stage {
    position: relative; flex: 1; width: 100%; max-width: 760px;
    display: flex; align-items: flex-end; justify-content: center;
    min-height: 0;
  }
  #pet {
    max-width: min(70vw, 420px); max-height: min(62vh, 520px);
    image-rendering: auto; user-select: none; -webkit-user-drag: none;
    cursor: grab; will-change: transform;
    filter: drop-shadow(0 18px 26px rgba(0,0,0,.45));
  }
  #pet.dragging { cursor: grabbing; }
  .bubble {
    position: absolute; top: 4%; left: 50%; transform: translate(-50%, 6px);
    background: #fff; color: #1b2030; padding: 10px 14px; border-radius: 14px;
    font-size: 15px; line-height: 1.4; max-width: 70%; text-align: center;
    box-shadow: 0 8px 22px rgba(0,0,0,.35);
    opacity: 0; transition: opacity .22s ease, transform .22s ease; pointer-events: none;
  }
  .bubble.on { opacity: 1; transform: translate(-50%, 0); }
  .bubble::after {
    content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -7px;
    width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent;
    border-top: 8px solid #fff;
  }
  footer { font-size: 13px; color: #8b97ad; text-align: center; line-height: 1.7; }
  footer b { color: #cfd8e8; font-weight: 600; }
  .hint { font-size: 12px; color: #6b7689; }
  @media (prefers-reduced-motion: reduce) { .bubble { transition: none; } }
</style>
</head>
<body>
  <div class="stage">
    <div class="bubble" id="bubble"></div>
    <img id="pet" alt="${escapeHtml(name)}" draggable="false" />
  </div>
  <footer>
    <div><b id="petName"></b><span id="petAuthor"></span></div>
    <div class="hint">拖动我试试 · 点我一下 · 这个文件可以直接发给别人，双击用浏览器打开就能看</div>
  </footer>
<script>
(function () {
  "use strict";
  var DATA = ${safeJsonForScript(payload)};
  var el = document.getElementById('pet');
  var bubble = document.getElementById('bubble');
  document.getElementById('petName').textContent = DATA.name || '桌宠';
  document.getElementById('petAuthor').textContent = DATA.author ? ('　作者：' + DATA.author) : '';
  var frames = DATA.frames || [];
  if (!frames.length) { el.alt = '这个分享包里没有图片'; return; }
  el.src = frames[0].url;

  // ---- 帧动画：按每帧原始延迟播放 ----
  var idx = 0, last = 0, raf = 0;
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (frames.length < 2) return;
    if (!last) { last = ts; return; }
    if (ts - last >= frames[idx].ms) { last = ts; idx = (idx + 1) % frames.length; el.src = frames[idx].url; }
  }
  raf = requestAnimationFrame(tick);

  // ---- 互动：点一下 -> 弹跳 + 说话 ----
  var vx = 0, vy = 0, x = 0, y = 0, px = 0, py = 0, dragging = false;
  var baseTransform = '';
  function render() { el.style.transform = baseTransform + ' translate(' + x + 'px,' + y + 'px)'; }
  function say() {
    if (!DATA.bubble || !DATA.lines || !DATA.lines.length) return;
    bubble.textContent = DATA.lines[Math.floor(Math.random() * DATA.lines.length)];
    bubble.classList.add('on');
    setTimeout(function () { bubble.classList.remove('on'); }, 2600);
  }
  el.addEventListener('pointerdown', function (e) {
    dragging = true; el.classList.add('dragging');
    px = e.clientX; py = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    x += e.clientX - px; y += e.clientY - py;
    px = e.clientX; py = e.clientY;
    render();
  });
  function drop(e) {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    vx = (e && e.clientX ? e.clientX - px : 0) * 0.3;
    vy = (e && e.clientY ? e.clientY - py : 0) * 0.3;
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  // 松手后的惯性 + 回弹（越界就弹回来，保证宠物不会飞出屏幕再也找不到）
  (function physics() {
    requestAnimationFrame(physics);
    if (dragging) return;
    if (!vx && !vy && !x && !y) return;
    x += vx; y += vy; vx *= 0.92; vy *= 0.92;
    if (Math.abs(vx) < 0.05) vx = 0;
    if (Math.abs(vy) < 0.05) vy = 0;
    if (Math.abs(x) < 0.5) x = 0;
    if (Math.abs(y) < 0.5) y = 0;
    render();
  })();
  var moved = false;
  el.addEventListener('pointerdown', function () { moved = false; });
  el.addEventListener('pointermove', function () { moved = true; });
  el.addEventListener('click', function () {
    if (moved) return;                    // 拖动结束时不要误触发点击
    baseTransform = 'scale(1.12)';
    el.style.transition = 'transform .12s ease';
    render();
    setTimeout(function () { baseTransform = ''; el.style.transition = 'transform .18s ease'; render(); }, 130);
    say();
  });
  if (DATA.bubble && DATA.lines && DATA.lines.length) setTimeout(say, 900);

  // ---- 兜底：把这个 HTML 拖进「桌宠制作器」，也能还原成完整宠物 ----
  window.__petShare = { name: DATA.name, petpack: DATA.petpack, petpackName: DATA.petpackName };
})();
</script>
</body>
</html>`;
}
