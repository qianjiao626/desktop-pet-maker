/**
 * 静态「在线分享站」生成（零后端 / 零依赖）。
 *
 * 目标：把宠物库里的一批桌宠导出成一个**静态网站**：
 *   index.html          首页，卡片网格，搜索 / 点击进入
 *   pet-<id>.html       每只宠物一个自包含分享页（复用 buildShareHtml）
 *   manifest.json       站点清单（给爬虫 / 二次开发用）
 *   README.txt          怎么发布（GitHub Pages / Netlify / 任意静态托管）
 *
 * 全部是纯字符串拼接 —— 不依赖 Electron、不依赖任何第三方库，方便单测。
 *
 * 为什么值得做：用户原话「我做这个工具的初衷是想让人人都可以上传自己的桌宠」。
 * 单个 .html 分享页只能一对一地发；要做「人人可浏览」的广场，
 * 就必须是一个能直接扔到静态托管上的站点。GitHub Pages 免费、零配置。
 */

/** HTML 文本转义 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 由宠物名生成**稳定且安全**的 slug，用作文件名与链接。
 * 稳定性很重要：同一只宠物每次导出都要得到同一个文件名，
 * 否则用户第二次发布就会出现一堆孤儿页面。
 */
export function slugify(name, fallback = 'pet') {
  let s = String(name == null ? '' : name).trim().toLowerCase();
  // 中文等非 ASCII 直接保留（GitHub Pages 支持，且比拼音更好认）
  s = s.replace(/[\s_]+/g, '-');
  s = s.replace(/[^\p{L}\p{N}-]+/gu, '-');
  s = s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = fallback;
  const cps = Array.from(s);
  if (cps.length > 40) s = cps.slice(0, 40).join('').replace(/-+$/, '');
  return s || fallback;
}

/**
 * 给一批宠物分配**互不冲突**的文件名。
 * 重名会静默互相覆盖 —— 这是打包类功能最经典的坑（详见 petpack 的帧名去重）。
 * @returns {Array<{id,name,slug,fileName,index}>}
 */
export function assignSlugs(items) {
  // 注意：不能只记"某个 base 用过几次"。因为真实名字里本来就可能有 "-2"，
  // 例如三只宠物叫 x / x / x-2 —— 第二只去重得到的 "x-2" 会和第三只撞车，
  // 于是两个页面互相覆盖（实测）。必须对着"已产出的 slug 全集"逐个试号。
  const taken = new Set();
  return (Array.isArray(items) ? items : []).map((it, i) => {
    const base = slugify(it && it.name, 'pet');
    let slug = base, n = 1;
    while (taken.has(slug)) { n++; slug = base + '-' + n; }
    taken.add(slug);
    return {
      id: String((it && it.id) || ('pet' + (i + 1))),
      name: String((it && it.name) || '我的桌宠'),
      slug,
      fileName: 'pet-' + slug + '.html',
      index: i,
    };
  });
}

/** 站点首页：卡片网格 + 搜索 */
export function buildSiteIndex(pets, opt = {}) {
  const siteName = String(opt.siteName || '我的桌宠广场');
  const description = String(opt.description || '用「桌宠制作器」做的桌宠，点开就能在浏览器里玩。');
  const list = (Array.isArray(pets) ? pets : []).map((p) => ({
    name: String((p && p.name) || '我的桌宠'),
    file: String((p && p.file) || ''),
    author: String((p && p.author) || ''),
    frames: Math.max(0, Math.floor(Number(p && p.frames) || 0)),
    thumb: String((p && p.thumb) || ''),
  }));

  const cards = list.map((p) => {
    const meta = [];
    if (p.frames) meta.push(esc(String(p.frames)) + ' 帧');
    if (p.author) meta.push('作者：' + esc(p.author));
    return `      <a class="card" href="${esc(p.file)}" data-name="${esc(p.name.toLowerCase())}" data-author="${esc(p.author.toLowerCase())}">
        <div class="thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" />` : '<span class="noimg">?</span>'}</div>
        <div class="card-body">
          <h2>${esc(p.name)}</h2>
          <p class="meta">${meta.join(' · ')}</p>
        </div>
      </a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(siteName)}</title>
<meta name="description" content="${esc(description)}" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 20px 64px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    background: radial-gradient(1200px 600px at 50% 0%, #1d2436 0%, #0f1117 55%, #0a0c11 100%);
    color: #e7ecf5; min-height: 100vh;
  }
  header { max-width: 980px; margin: 0 auto 28px; text-align: center; }
  h1 { font-size: clamp(24px, 4vw, 38px); margin: 0 0 10px; letter-spacing: .5px; }
  header p { margin: 0 0 20px; color: #98a4ba; font-size: 15px; }
  .search {
    width: 100%; max-width: 420px; padding: 12px 16px; border-radius: 12px;
    border: 1px solid #2c3448; background: #161b26; color: #e7ecf5; font-size: 15px; outline: none;
  }
  .search:focus { border-color: #4c7dff; box-shadow: 0 0 0 3px rgba(76,125,255,.18); }
  .grid {
    max-width: 980px; margin: 0 auto; display: grid; gap: 18px;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }
  .card {
    display: flex; flex-direction: column; text-decoration: none; color: inherit;
    background: #161b26; border: 1px solid #242c3d; border-radius: 16px; overflow: hidden;
    transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
  }
  .card:hover { transform: translateY(-3px); border-color: #4c7dff; box-shadow: 0 12px 28px rgba(0,0,0,.45); }
  .thumb {
    height: 150px; display: flex; align-items: center; justify-content: center;
    background: repeating-conic-gradient(#1b2130 0% 25%, #171c28 0% 50%) 50% / 22px 22px;
  }
  .thumb img { max-width: 82%; max-height: 82%; object-fit: contain; filter: drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
  .noimg { font-size: 34px; color: #39415a; }
  .card-body { padding: 12px 14px 15px; }
  .card h2 { margin: 0 0 5px; font-size: 16px; font-weight: 600; }
  .meta { margin: 0; font-size: 12.5px; color: #8b97ad; }
  .empty { text-align: center; color: #8b97ad; padding: 48px 0; }
  footer { max-width: 980px; margin: 44px auto 0; text-align: center; font-size: 12.5px; color: #6b7689; }
</style>
</head>
<body>
  <header>
    <h1>${esc(siteName)}</h1>
    <p>${esc(description)}</p>
    <input class="search" id="q" type="search" placeholder="搜索宠物名或作者…" autocomplete="off" />
  </header>
  <main class="grid" id="grid">
${cards || '    <div class="empty">还没有桌宠。先用桌宠制作器做一只吧！</div>'}
  </main>
  <footer>共 <b id="count">${list.length}</b> 只 · 本站是纯静态页面，可直接托管在 GitHub Pages / Netlify 等任意静态服务上</footer>
<script>
(function () {
  var q = document.getElementById('q');
  var cards = [].slice.call(document.querySelectorAll('.card'));
  var count = document.getElementById('count');
  if (q) q.addEventListener('input', function () {
    var k = q.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var hit = !k || c.dataset.name.indexOf(k) >= 0 || c.dataset.author.indexOf(k) >= 0;
      c.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    if (count) count.textContent = String(shown);
  });
})();
</script>
</body>
</html>`;
}

/** 站点清单（给爬虫 / 二次开发用） */
export function buildManifest(pets, opt = {}) {
  return JSON.stringify({
    format: 'desktop-pet-maker/share-site@1',
    siteName: String(opt.siteName || '我的桌宠广场'),
    generatedAt: String(opt.generatedAt || new Date().toISOString()),
    count: (Array.isArray(pets) ? pets : []).length,
    pets: (Array.isArray(pets) ? pets : []).map((p) => ({
      name: String((p && p.name) || '我的桌宠'),
      file: String((p && p.file) || ''),
      author: String((p && p.author) || ''),
      frames: Math.max(0, Math.floor(Number(p && p.frames) || 0)),
    })),
  }, null, 2);
}

/** 发布说明 */
export function buildReadme(pets, opt = {}) {
  const n = (Array.isArray(pets) ? pets : []).length;
  const siteName = String(opt.siteName || '我的桌宠广场');
  return [
    siteName,
    '',
    '这是一个**纯静态**网站：' + n + ' 只桌宠，没有任何后端、没有依赖。',
    '每只宠物是一个自包含的 HTML，双击就能在浏览器里看它动起来。',
    '',
    '【怎么发布给别人看】',
    '方案 A · GitHub Pages（免费）',
    '  1. 新建一个仓库，把本文件夹（index.html / pet-*.html / manifest.json）全部上传',
    '  2. 仓库 Settings -> Pages -> Source 选 "Deploy from a branch" -> main / (root) -> Save',
    '  3. 等 1 分钟，访问 https://<你的用户名>.github.io/<仓库名>/',
    '',
    '方案 B · 任意静态托管（Netlify / Cloudflare Pages / Vercel / 自己的服务器）',
    '  直接把本文件夹拖进它们的部署页面即可。',
    '',
    '方案 C · 就想先在本地看看',
    '  双击 index.html，用浏览器打开。',
    '',
    '【文件说明】',
    '  index.html      首页（卡片网格 + 搜索）',
    '  pet-*.html      每只宠物的独立分享页',
    '  manifest.json   站点清单（名称 / 文件 / 作者 / 帧数）',
    '',
    '由「桌宠制作器」自动生成。',
  ].join('\n');
}

/** 站点文件清单（交给打包层去写盘，纯数据便于单测） */
export function planSiteFiles(pets, pages, opt = {}) {
  const list = Array.isArray(pets) ? pets : [];
  const pageMap = pages && typeof pages === 'object' ? pages : {};
  const files = [
    { name: 'index.html', data: buildSiteIndex(list, opt) },
    { name: 'manifest.json', data: buildManifest(list, opt) },
    { name: 'README.txt', data: buildReadme(list, opt) },
  ];
  for (const p of list) {
    if (p && p.file && typeof pageMap[p.file] === 'string') {
      files.push({ name: String(p.file), data: pageMap[p.file] });
    }
  }
  return files;
}
