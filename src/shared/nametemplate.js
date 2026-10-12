// 导出命名模板（纯逻辑，可单测）。
//
// 场景：批量导出 20 只宠物时，文件名全是「名字.petpack」；作者想加上日期、
// 序号或自己的前缀（比如 "2026-10-12_我的桌宠_01.petpack"），只能导完手动改。
//
// 参考调研结论：这类需求没有值得引入的库（找到的都是 CLI 工具或 GPL 的 AI 重命名），
// 而且规则很简单 —— 自己实现 20 行，保持零依赖。
//
// 支持的占位符（大小写不敏感）：
//   {name}    宠物名
//   {n}       序号（从 1 开始，可按 {n:03} 补零）
//   {date}    今天日期 YYYY-MM-DD
//   {time}    当前时间 HH-mm
//   {author}  作者
//   {ext}     扩展名（不含点）
//
// 设计要点：
//   1) 用户输入什么都不能让文件名非法（Windows 禁用字符、保留名、超长）。
//   2) 占位符写错（比如 {nmae}）时**原样保留**并给出提示，而不是静默变成空。
//   3) 补零格式 {n:03} 要支持（批量导出时最常见）。

/** Windows 文件名禁用字符（跨平台都避开，省得换机出错） */
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Windows 保留设备名（不区分大小写，且带扩展名也算） */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 单个文件名片段的清理（不含扩展名） */
export function safePart(s, maxLen = 80) {
  let v = String(s == null ? '' : s);
  v = v.replace(/[\t\n\r\f\v]+/g, ' ');     // 换行/制表 -> 空格
  v = v.replace(BAD_CHARS, '_');               // 禁用字符 -> 下划线
  v = v.replace(/ {2,}/g, ' ');                // 折叠空格
  v = v.replace(/^[. ]+/, '').replace(/[. ]+$/, '');   // 首尾的点/空格（Windows 不允许）
  if (!v) v = 'pet';
  const cps = Array.from(v);
  if (cps.length > maxLen) v = cps.slice(0, maxLen).join('').replace(/[. ]+$/, '');
  if (RESERVED.test(v)) v = '_' + v;
  return v || 'pet';
}

/** 解析出来的占位符列表（用于校验/提示） */
export const PLACEHOLDERS = ['name', 'n', 'date', 'time', 'author', 'ext'];

/**
 * 找出模板里"不认识的占位符"（给用户提示，而不是静默留着）。
 * @returns ['nmae', ...]
 */
export function unknownPlaceholders(tpl) {
  const out = [];
  const src = String(tpl == null ? '' : tpl);
  for (const m of src.matchAll(/\{([^{}]+)\}/g)) {
    const raw = m[1].trim();
    const base = raw.split(':')[0].trim().toLowerCase();
    if (!PLACEHOLDERS.includes(base)) out.push(raw);
  }
  return [...new Set(out)];
}

function pad(n, width) {
  const s = String(Math.max(0, Math.floor(n)));
  if (!width || width <= s.length) return s;
  return '0'.repeat(width - s.length) + s;
}

/**
 * 展开一个文件名模板。
 * @param tpl   模板字符串
 * @param ctx   { name, n, date, time, author, ext }
 * @returns 清理后的文件名（含扩展名）
 */
export function expandTemplate(tpl, ctx = {}) {
  const c = (ctx && typeof ctx === 'object') ? ctx : {};
  const ext = safePart(c.ext || 'petpack', 12).replace(/^\.+/, '') || 'petpack';
  let src = String(tpl == null ? '' : tpl).trim();
  if (!src) src = '{name}';                    // 空模板退化为"用宠物名"，不要产生空文件名

  const out = src.replace(/\{([^{}]+)\}/g, (whole, raw) => {
    const parts = String(raw).trim().split(':');
    const key = parts[0].trim().toLowerCase();
    const width = parts[1] ? parseInt(parts[1].replace(/[^0-9]/g, ''), 10) : 0;
    switch (key) {
      case 'name': return String(c.name == null ? '' : c.name);
      case 'author': return String(c.author == null ? '' : c.author);
      case 'n': return pad(Number(c.n) || 1, Number.isFinite(width) ? width : 0);
      case 'date': return String(c.date || '');
      case 'time': return String(c.time || '');
      case 'ext': return ext;
      default: return whole;                   // 不认识的占位符原样保留（配合 unknownPlaceholders 提示）
    }
  });

  // 把整体拆成"主名 + 扩展名"再清理：扩展名里的点不能被当"首尾点"删掉
  const withExt = out;
  const lastDot = withExt.lastIndexOf('.');
  let main = withExt, tail = ext;
  if (lastDot > 0 && lastDot < withExt.length - 1) {
    main = withExt.slice(0, lastDot);
    tail = withExt.slice(lastDot + 1);
  } else if (lastDot === 0) {
    main = withExt.slice(1);
  }
  const safeMain = safePart(main, 120);
  const safeExt = safePart(tail, 12).replace(/^\.+/, '') || 'petpack';
  return safeMain + '.' + safeExt;
}

/**
 * 给一批宠物生成文件名（自动去重）。
 * @param items [{ name, author }]
 * @param tpl   模板
 * @param opt   { date, time, ext, startAt }
 * @returns [{ item, fileName }]
 */
export function planNames(items, tpl, opt = {}) {
  const list = Array.isArray(items) ? items : [];
  const o = (opt && typeof opt === 'object') ? opt : {};
  const startAt = Number.isFinite(Number(o.startAt)) ? Math.max(1, Math.floor(Number(o.startAt))) : 1;
  const used = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = (list[i] && typeof list[i] === 'object') ? list[i] : {};
    const base = expandTemplate(tpl, {
      name: it.name, author: it.author, n: startAt + i,
      date: o.date, time: o.time, ext: o.ext || 'petpack',
    });
    // 去重：同名时加 -2 / -3（包内按文件名寻址，重名会静默覆盖）
    let name = base, k = 1;
    if (used.has(name.toLowerCase())) {
      const dot = base.lastIndexOf('.');
      const main = dot > 0 ? base.slice(0, dot) : base;
      const tail = dot > 0 ? base.slice(dot) : '';
      do { k++; name = main + '-' + k + tail; } while (used.has(name.toLowerCase()));
    }
    used.add(name.toLowerCase());
    out.push({ item: it, fileName: name });
  }
  return out;
}

/** 给用户看的模板说明（界面里显示，避免用户猜） */
export function templateHelp() {
  return '可用：{name} 名字 · {n} 序号（{n:03} 补零）· {date} 日期 · {time} 时间 · {author} 作者 · {ext} 扩展名';
}
