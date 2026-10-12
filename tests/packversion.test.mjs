import { ok } from './_harness.mjs';
import { packVersion, compareVersions, updatePrompt, stampForExport, versionLabel } from '../src/shared/packversion.js';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const mk = (o = {}) => ({ id: 'pet-x', name: '小猫', createdAt: T1, updatedAt: T1, rev: 1, ...o });

// ---------- packVersion ----------
{
  const v = packVersion(mk());
  ok('取出 id/name', v.id === 'pet-x' && v.name === '小猫', JSON.stringify(v));
  ok('取出 rev', v.rev === 1, String(v.rev));
  ok('有版本标记', v.hasVersion === true, 'has');
  ok('stamp 是 updatedAt 的时间', v.stamp === Date.parse(T1), String(v.stamp));
}
{
  // 老包（没有任何版本字段）不该被当成"有版本"
  const v = packVersion({ id: 'old', name: '老包' });
  ok('老包 hasVersion=false', v.hasVersion === false, 'has');
  ok('老包 rev=0', v.rev === 0, String(v.rev));
  ok('老包 stamp=0', v.stamp === 0, String(v.stamp));
}
{
  ok('null 不崩', packVersion(null).hasVersion === false, 'null');
  ok('字符串不崩', packVersion('x').hasVersion === false, 'str');
  const bad = packVersion({ rev: -3, updatedAt: 'not-a-date' });
  ok('负 rev 归零', bad.rev === 0, String(bad.rev));
  ok('坏日期 stamp=0', bad.stamp === 0, String(bad.stamp));
  ok('坏日期 + 负 rev -> 无版本', bad.hasVersion === false, 'has');
}
{
  // 只有 createdAt 的老式包也算"有版本"（能比较）
  const v = packVersion({ createdAt: T1 });
  ok('只有 createdAt 也算有版本', v.hasVersion === true, 'created-only');
  ok('stamp 退回用 createdAt', v.stamp === Date.parse(T1), String(v.stamp));
}

// ---------- compareVersions ----------
{
  ok('更新时间的算新版', compareVersions(mk(), mk({ updatedAt: T2, rev: 2 })).result === 'newer', 'newer');
  ok('更早时间的算旧版', compareVersions(mk({ updatedAt: T2 }), mk()).result === 'older', 'older');
  ok('完全相同算同版', compareVersions(mk(), mk()).result === 'same', 'same');
}
{
  // 时间相同 -> 比 rev
  const a = mk({ updatedAt: T1, rev: 1 });
  const b = mk({ updatedAt: T1, rev: 2 });
  ok('同一时间 rev 更高的算新版', compareVersions(a, b).result === 'newer', compareVersions(a, b).result);
  ok('同一时间 rev 更低的算旧版', compareVersions(b, a).result === 'older', compareVersions(b, a).result);
  ok('同一时间同 rev 算同版', compareVersions(a, mk({ updatedAt: T1, rev: 1 })).result === 'same', 'same');
}
{
  // 老包兼容：新包无版本 -> unknown（不误报"有新版"）
  ok('新包无版本信息 -> unknown', compareVersions(mk(), { id: 'pet-x' }).result === 'unknown', 'incoming-old');
  // 旧包无版本 -> 视为可用新版覆盖（这是合理的默认）
  ok('旧包无版本 -> 视为新版', compareVersions({ id: 'pet-x' }, mk()).result === 'newer', 'current-old');
}
{
  // 不同 id 不是同一只宠物，不该说"更新"
  ok('id 不同 -> unknown', compareVersions(mk({ id: 'a' }), mk({ id: 'b' })).result === 'unknown', 'diff-id');
  // 任一侧没有 id 时不做这个判断（不能因为缺字段就拒绝）
  ok('缺 id 时仍能比较', compareVersions(mk({ id: '' }), mk({ id: 'b', updatedAt: T2 })).result === 'newer', 'no-id');
}
{
  // 每个结果都要给得出原因
  for (const [a, b] of [[mk(), mk({ updatedAt: T2 })], [mk(), mk()], [mk({ updatedAt: T2 }), mk()], [mk(), { id: 'pet-x' }]]) {
    const r = compareVersions(a, b);
    ok('结果带原因：' + r.result, typeof r.reason === 'string' && r.reason.length > 0, r.reason);
  }
}
{
  ok('null 不崩', typeof compareVersions(null, null).result === 'string', 'null');
}

// ---------- updatePrompt ----------
{
  const p = updatePrompt(mk(), mk({ updatedAt: T2 }));
  ok('新版 -> ask 级别', p.level === 'ask', p.level);
  ok('新版提示里有宠物名', p.text.includes('小猫'), p.text);
  ok('新版提示问"要更新吗"', /更新/.test(p.text), p.text);
}
{
  const p = updatePrompt(mk(), mk());
  ok('同版 -> info 级别', p.level === 'info', p.level);
  ok('同版提示说"已经"', /已经/.test(p.text), p.text);
}
{
  const p = updatePrompt(mk({ updatedAt: T2 }), mk());
  ok('旧版 -> warn 级别（要提醒用户别误覆盖）', p.level === 'warn', p.level);
  ok('旧版提示里有"更旧"或"覆盖"', /更旧|覆盖/.test(p.text), p.text);
}
{
  const p = updatePrompt(mk(), { id: 'pet-x' });
  ok('无法判断 -> info', p.level === 'info', p.level);
  ok('无法判断也给出文案', typeof p.text === 'string' && p.text.length > 0, p.text);
}
{
  const p = updatePrompt(null, null);
  ok('null 不崩且有文案', typeof p.text === 'string' && p.text.length > 0, p.text);
}

// ---------- stampForExport ----------
{
  const s = stampForExport({}, new Date(T1));
  ok('新包有 createdAt', s.createdAt === T1, s.createdAt);
  ok('新包 updatedAt = 导出时间', s.updatedAt === T1, s.updatedAt);
  ok('新包 rev = 1', s.rev === 1, String(s.rev));
}
{
  // 再次导出：createdAt 保留，updatedAt 更新，rev +1
  const first = stampForExport({}, new Date(T1));
  const second = stampForExport({ ...first }, new Date(T2));
  ok('再次导出保留 createdAt', second.createdAt === T1, second.createdAt);
  ok('再次导出更新 updatedAt', second.updatedAt === T2, second.updatedAt);
  ok('再次导出 rev 递增', second.rev === 2, String(second.rev));
}
{
  // 坏的 rev 不参与累加
  const s = stampForExport({ rev: 'x' }, new Date(T1));
  ok('坏 rev 从 1 开始', s.rev === 1, String(s.rev));
  const s2 = stampForExport({ rev: -5 }, new Date(T1));
  ok('负 rev 从 1 开始', s2.rev === 1, String(s2.rev));
}
{
  ok('null 包不崩', stampForExport(null, new Date(T1)).rev === 1, 'null');
  ok('坏时间不崩（用当前时间）', typeof stampForExport({}, 'bad').updatedAt === 'string', 'badt');
  ok('导出的版本能被识别', packVersion(stampForExport({}, new Date(T1))).hasVersion === true, 'roundtrip');
}
{
  // ★ 端到端：导出两次 -> 第二次被判为"新版"
  const p1 = { id: 'pet-x', name: '小猫', ...stampForExport({}, new Date(T1)) };
  const p2 = { id: 'pet-x', name: '小猫', ...stampForExport(p1, new Date(T2)) };
  ok('二次导出被判为更新版本', compareVersions(p1, p2).result === 'newer', compareVersions(p1, p2).result);
  ok('反向比较判为旧版', compareVersions(p2, p1).result === 'older', compareVersions(p2, p1).result);
}

// ---------- versionLabel ----------
{
  const l = versionLabel(mk());
  ok('标签含日期', /2026-01-01/.test(l), l);
  ok('标签含修订号', /第 1 版/.test(l), l);
  ok('老包显示"版本未知"', versionLabel({}) === '版本未知', versionLabel({}));
  ok('null 不崩', typeof versionLabel(null) === 'string', versionLabel(null));
}
