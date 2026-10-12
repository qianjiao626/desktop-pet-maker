// 宠物「详情摘要」（纯逻辑，可单测）。
//
// 场景：宠物库里只显示名字 / 帧数 / 体积。想看看"这只到底是什么样"（作者、版本、
// 画布尺寸、有几个动作片段、什么时候装的）就得自己去翻文件夹。
//
// 本模块把散落的字段折成**可直接显示的一组条目**（label + value），
// 让界面只负责渲染，不负责判断"哪些该显示、缺字段怎么办"。
//
// 设计要点：
//   1) 缺字段时**不显示那一行**，而不是显示"undefined"或空值。
//   2) 体积要人话（KB/MB），不能给一串字节。
//   3) 老包（没版本信息）要显示"版本未知"，而不是崩或空白。

/** 字节数转人话 */
export function humanBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
  return (v / (1024 * 1024)).toFixed(1) + ' MB';
}

/** 时间戳/ISO 转人话（只到分钟） */
export function humanTime(v) {
  if (!v) return '';
  const t = (typeof v === 'number') ? v : Date.parse(String(v));
  if (!Number.isFinite(t) || t <= 0) return '';
  try { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }
  catch (err) { return ''; }
}

/**
 * 折成显示条目。
 * @param item 宠物库里的一项（含 name/author/frames/size/builtin/broken…）
 * @param extra 额外信息（version 描述、canvas、clips 数、分组名…）
 * @returns [{ label, value, tone? }] 只包含"有值"的项
 */
export function detailRows(item, extra = {}) {
  const it = (item && typeof item === 'object') ? item : {};
  const ex = (extra && typeof extra === 'object') ? extra : {};
  const rows = [];
  const push = (label, value, tone) => {
    const v = String(value == null ? '' : value).trim();
    if (!v) return;
    rows.push(tone ? { label, value: v, tone } : { label, value: v });
  };

  push('名字', it.name);
  push('作者', it.author);
  if (it.broken) {
    push('状态', '损坏（这个包读不出来）', 'warn');
    push('原因', it.error);
  }
  if (Number.isFinite(Number(it.frames)) && Number(it.frames) > 0) push('帧数', String(Math.floor(Number(it.frames))) + ' 帧');
  if (Number.isFinite(Number(ex.clips)) && Number(ex.clips) > 0) push('动作片段', String(Math.floor(Number(ex.clips))) + ' 段');
  if (ex.canvas && Number(ex.canvas.width) > 0 && Number(ex.canvas.height) > 0) {
    push('画布', Math.round(ex.canvas.width) + ' × ' + Math.round(ex.canvas.height));
  }
  if (it.size != null) push('文件大小', humanBytes(it.size));
  push('版本', ex.version);
  if (ex.installedAt) push('加入时间', humanTime(ex.installedAt));
  if (ex.usedAt) push('最近用过', humanTime(ex.usedAt));
  if (Array.isArray(ex.groups) && ex.groups.length) push('分组', ex.groups.join('、'));
  push('来源', it.builtin ? '内置（随程序附带）' : '自己装的');
  if (it.file) push('文件位置', it.file);

  return rows;
}

/**
 * 顶部一句"这是什么"的概括（给详情面板标题下用）。
 */
export function detailSummary(item, extra = {}) {
  const it = (item && typeof item === 'object') ? item : {};
  const ex = (extra && typeof extra === 'object') ? extra : {};
  if (it.broken) return '这个宠物包读不出来，可能已损坏';
  const parts = [];
  const n = Number(it.frames);
  if (Number.isFinite(n) && n > 0) parts.push(n + ' 帧');
  const c = Number(ex.clips);
  if (Number.isFinite(c) && c > 0) parts.push(c + ' 段动作');
  if (it.size != null) parts.push(humanBytes(it.size));
  if (it.builtin) parts.push('内置');
  return parts.join(' · ') || '没有更多信息';
}
