// 宠物库批量导出：把整个宠物库打包成一个 zip，用于备份 / 换机 / 分享合集。
//
// 为什么需要：宠物库现在只能「逐个查看 / 启动 / 删除」。
// 用户手搓了 20 只宠物后，没有任何办法一次性备份或搬到另一台机器。
//
// 设计：
//   - 单个 zip，里面直接放 .petpack（不嵌套目录），双击某个就能单独拿出来用
//   - 附一份 README.txt 说明这是什么、怎么用（接收方不装本工具也能看懂）
//   - 大库保护：宠物包可能很大，导出前先算总大小并给出提示
//   - 纯逻辑（可单测）：文件命名去重、清单生成

import { safeFileName } from './safeid.js';

/** 单个 zip 的安全上限（超过就提示用户分批）。1GB 对普通用户足够，也能避免 OOM */
export const BULK_LIMIT_BYTES = 1024 * 1024 * 1024;

/**
 * 规划一次批量导出。
 * @param {Array} items [{ id, name, size, builtin }] 来自 pet:listInstalled
 * @param {object} opt  { includeBuiltin }
 * @returns {{ok, entries, totalBytes, skipped, reason}}
 */
export function planExport(items, opt = {}) {
  const list = Array.isArray(items) ? items : [];
  const includeBuiltin = !!opt.includeBuiltin;

  const entries = [];
  const skipped = [];
  const used = new Set();

  for (const it of list) {
    if (!it || !it.id) { continue; }
    // 内置宠物默认不导出：它们是程序自带、导出只是徒增体积
    if (it.builtin && !includeBuiltin) { skipped.push({ id: it.id, reason: '内置宠物（默认不导出）' }); continue; }
    if (it.broken) { skipped.push({ id: it.id, reason: '文件损坏，已跳过' }); continue; }

    // zip 内文件名去重：不同目录下可能有同名宠物
    const base = safeFileName(String(it.name || it.id), { maxLen: 60, fallback: 'pet' });
    let name = base + '.petpack';
    let n = 1;
    while (used.has(name)) { n++; name = base + '_' + n + '.petpack'; }
    used.add(name);

    entries.push({
      sourceId: it.id,
      outName: name,
      name: String(it.name || it.id),
      size: Math.max(0, Number(it.size) || 0),
    });
  }

  const totalBytes = entries.reduce((s, e) => s + e.size, 0);
  if (!entries.length) {
    return { ok: false, entries: [], skipped, totalBytes: 0, reason: '没有可导出的宠物' };
  }
  if (totalBytes > BULK_LIMIT_BYTES) {
    return {
      ok: false, entries, skipped, totalBytes,
      reason: '合计 ' + (totalBytes / 1048576).toFixed(0) + 'MB，超过单次上限 ' + (BULK_LIMIT_BYTES / 1048576).toFixed(0) + 'MB。请取消勾选「包含内置宠物」或分批导出',
    };
  }
  return { ok: true, entries, skipped, totalBytes, reason: '' };
}

/**
 * 生成随包附带的说明文件。
 * 目的：接收方即使没装本工具，也能看懂这些文件是什么、该怎么用。
 */
export function exportReadme(entries, opt = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const when = String(opt.when || new Date().toISOString().slice(0, 19).replace('T', ' '));
  const lines = [
    '桌宠合集',
    '='.repeat(32),
    '',
    '这个压缩包里是 ' + list.length + ' 只桌宠（.petpack 文件）。',
    '导出时间：' + when,
    '',
    '怎么用',
    '-'.repeat(32),
    '1. 解压本压缩包',
    '2. 打开「桌宠制作器」',
    '3. 把任意一个 .petpack 文件**直接拖进窗口** —— 它会自动安装并出现在桌面上',
    '',
    '也可以：宠物库 →「安装宠物包…」→ 选择 .petpack 文件。',
    '',
    '包含的宠物',
    '-'.repeat(32),
  ];
  for (let i = 0; i < list.length; i++) {
    lines.push(String(i + 1).padStart(3) + '. ' + list[i].name + '   ->   ' + list[i].outName);
  }
  lines.push('');
  return lines.join('\n');
}

/** 给人看的体积表述 */
export function formatBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
