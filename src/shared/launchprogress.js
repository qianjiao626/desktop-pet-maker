// 多宠物启用的「进度文案」（纯逻辑，可单测）。
//
// 为什么需要：一次启用 3 只时，最慢的那只要等好几秒。
// 以前制作器只弹一句"正在准备 3 只宠物…"，之后到全部出现前**没有任何反馈** ——
// 用户会以为点了没反应，然后重复点击。
//
// 这里把"第几只 / 总共几只 / 这只叫什么 / 成功几个失败几个"折成一句人话，
// 让制作器每启一只就更新一次状态栏。

/**
 * 生成一行进度文案。
 * @param opt.done    已经处理完几只（含失败）
 * @param opt.total   总共几只
 * @param opt.name    刚处理的那只叫什么
 * @param opt.ok      刚处理的那只是否成功
 * @param opt.failed  累计失败数
 */
export function progressText(opt = {}) {
  const total = Math.max(0, Math.floor(Number(opt.total) || 0));
  const done = Math.max(0, Math.min(total, Math.floor(Number(opt.done) || 0)));
  const failed = Math.max(0, Math.floor(Number(opt.failed) || 0));
  const name = String(opt.name == null ? '' : opt.name).trim();

  if (!total) return '正在准备宠物…';

  const who = name ? ('「' + name + '」') : '这只';
  if (opt.ok === false) return '⚠ ' + who + ' 没放出来（' + done + '/' + total + '）';
  if (done >= total) {
    const okCount = total - failed;
    if (failed) return '⚠ 放出来 ' + okCount + ' 只，失败 ' + failed + ' 只';
    return '✅ ' + total + ' 只都放出来了';
  }
  return '正在放出来… ' + done + '/' + total + (name ? '（' + name + '）' : '');
}

/**
 * 全部结束后的总结（含"看不见它"的提示 —— 宠物可能落在屏幕别处）。
 */
export function summaryText(opt = {}) {
  const total = Math.max(0, Math.floor(Number(opt.total) || 0));
  const failed = Math.max(0, Math.floor(Number(opt.failed) || 0));
  const okCount = Math.max(0, total - failed);
  if (!total) return '没有可启用的宠物';
  if (!okCount) return '没能放出来任何一只（看看失败原因）';
  let t = '✅ 已把 ' + okCount + ' 只宠物放到桌面上';
  if (failed) t += '（失败 ' + failed + ' 只）';
  t += '；若没看到它们，可能在屏幕另一角（用 Ctrl+Alt+R 找回来）';
  return t;
}

/** 进度百分比 0..100（给进度条用） */
export function progressPct(opt = {}) {
  const total = Math.max(0, Math.floor(Number(opt.total) || 0));
  if (!total) return 0;
  const done = Math.max(0, Math.min(total, Math.floor(Number(opt.done) || 0)));
  return Math.round((done / total) * 100);
}
