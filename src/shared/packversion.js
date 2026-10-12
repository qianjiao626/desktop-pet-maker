// 宠物包的「版本与更新」（纯逻辑，可单测）。
//
// 场景：作者做了改进（换了帧、调了动作），重新导出同一个包发给朋友。
// 接收方现在只能**手动删掉旧的重装**，而且不知道"这个是不是新版"。
// 这一版给包加上可比较的版本信息，让"要不要更新"变成可判断的事。
//
// 设计取舍：
//   1) 不引入"服务器 / 在线检查"（那要联网，与零依赖定位冲突）。
//      用户把新包拖进来时，工具自己判断"这是新版还是旧版"，然后问他。
//   2) 版本用 **时间戳 + 修订号** 两个维度：
//      · createdAt/updatedAt 判断"哪个更新"（作者重新导出时必然变新）
//      · rev 允许作者手动标记（比如同一分钟里改了两次）
//   3) 兼容老包：老包没有这些字段 -> 视为"未知版本"，不弹更新提示（宁可少提示，不要误提示）。

/** 从包里取版本信息（老包返回 null 字段，而不是崩） */
export function packVersion(pack) {
  const p = (pack && typeof pack === 'object') ? pack : {};
  const rev = Number(p.rev);
  const created = String(p.createdAt || '');
  const updated = String(p.updatedAt || '');
  return {
    id: String(p.id || ''),
    name: String(p.name || ''),
    rev: Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0,
    createdAt: created,
    updatedAt: updated,
    // 用于比较的"时间"：优先 updatedAt（作者重新导出的时间）
    stamp: Date.parse(updated || created) || 0,
    // ★ 只有"能真正用于比较"的信息才算有版本：
    //   时间必须**解析成功**（不是"有个字符串就行"），或者 rev 有效。
    //   否则像 {updatedAt:'not-a-date', rev:-3} 这种脏数据会被当成有版本，
    //   后面比较时却拿不到任何依据（实测：单元测试抓到 hasVersion 误报 true）。
    hasVersion: (Date.parse(updated || created) > 0) || (Number.isFinite(rev) && rev > 0),
  };
}

/**
 * 比较两个包版本。
 * @returns { result: 'newer'|'same'|'older'|'unknown', reason }
 *   以 incoming 相对 current 而言：incoming 是 newer 就表示"这是新版"。
 */
export function compareVersions(current, incoming) {
  const a = packVersion(current);
  const b = packVersion(incoming);
  if (!b.hasVersion) return { result: 'unknown', reason: '新包没有版本信息（老格式）' };
  if (!a.hasVersion) return { result: 'newer', reason: '旧包没有版本信息，视为可用新版覆盖' };
  // id 不同就不是同一个宠物，谈不上"更新"
  if (a.id && b.id && a.id !== b.id) return { result: 'unknown', reason: '不是同一只宠物' };

  if (b.stamp > a.stamp) return { result: 'newer', reason: '新版导出时间更晚' };
  if (b.stamp < a.stamp) return { result: 'older', reason: '这个包的导出时间更早' };
  // 时间一样（同一秒导出）：用 rev 分高下
  if (b.rev > a.rev) return { result: 'newer', reason: '修订号更高' };
  if (b.rev < a.rev) return { result: 'older', reason: '修订号更低' };
  return { result: 'same', reason: '版本相同' };
}

/**
 * 生成更新提示文案（给界面用）。
 * @returns { text, level } level: 'ask' | 'info' | 'warn'
 */
export function updatePrompt(current, incoming) {
  const cmp = compareVersions(current, incoming);
  const b = packVersion(incoming);
  const name = b.name || '这只宠物';
  switch (cmp.result) {
    case 'newer':
      return { text: '「' + name + '」有新版本，要更新吗？', level: 'ask', reason: cmp.reason };
    case 'same':
      return { text: '「' + name + '」已经是这个版本了', level: 'info', reason: cmp.reason };
    case 'older':
      return { text: '这个「' + name + '」包比你现在用的更旧，确定要覆盖吗？', level: 'warn', reason: cmp.reason };
    default:
      return { text: '无法判断「' + name + '」的版本，直接装还是先看看？', level: 'info', reason: cmp.reason };
  }
}

/**
 * 给导出时生成一个新的版本信息（作者每次导出都会拿到新的 updatedAt）。
 * @param pack    原来的包（可能已有 createdAt / rev）
 * @param now     时间（可注入，便于测试）
 */
export function stampForExport(pack, now = new Date()) {
  const p = (pack && typeof pack === 'object') ? pack : {};
  const t = (now instanceof Date) ? now : new Date(now);
  const iso = (Number.isFinite(t.getTime()) ? t : new Date()).toISOString();
  const created = String(p.createdAt || '') || iso;
  const prevRev = Number(p.rev);
  return {
    createdAt: created,
    updatedAt: iso,
    rev: (Number.isFinite(prevRev) && prevRev > 0 ? Math.floor(prevRev) : 0) + 1,
  };
}

/** 给用户看的版本描述（界面里显示） */
export function versionLabel(pack) {
  const v = packVersion(pack);
  if (!v.hasVersion) return '版本未知';
  const when = v.stamp ? new Date(v.stamp).toISOString().slice(0, 16).replace('T', ' ') : '';
  const rev = v.rev ? ('（第 ' + v.rev + ' 版）') : '';
  return (when || '版本未知') + rev;
}
