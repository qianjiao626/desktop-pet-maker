// 文件名安全化（纯函数，可单测）
// 背景：宠物库用「包名」生成磁盘文件名。若直接拼接，包含路径分隔符、
// Windows 保留名或超长名称的输入会导致写入越界、失败或不可读。

const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// 去掉首尾的点/下划线/空白（顺序敏感，抽出来避免重复）
function trimEdge(str) {
  return str.replace(/^[._\s]+/, '').replace(/[._\s]+$/, '');
}

/**
 * 把任意字符串转为安全的文件名片段。
 * 处理顺序：换行归一 -> 控制字符 -> 非法字符 -> 空白折叠 -> 首尾清理 -> 限长 -> 再清理 -> 保留名
 */
export function safeFileName(input, { maxLen = 80, fallback = 'pet' } = {}) {
  let s = String(input == null ? '' : input);

  // 1) 换行/制表先转空格，防止 "a\nb" 粘成 "ab"
  s = s.replace(/[\t\n\r\f\v]+/g, ' ');

  // 2) 去掉其余控制字符
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');

  // 3) 替换路径分隔符与 Windows 非法字符
  s = s.replace(/[\\/:*?"<>|]/g, '_');

  // 4) 折叠内部空白为下划线
  s = s.replace(/\s+/g, '_');

  // 5) 首尾清理（"../../evil" 会留下 "_.._evil"，必须清掉前导 "._"）
  s = trimEdge(s);

  // 6) 限长：按码点切，避免截断代理对产生乱码
  const cps = Array.from(s);
  if (cps.length > maxLen) s = cps.slice(0, maxLen).join('');

  // 7) 截断后可能又出现尾部点/下划线，再清一次
  s = trimEdge(s);

  // 8) Windows 保留设备名规避
  const base = s.split('.')[0].toUpperCase();
  if (RESERVED.has(base)) s = '_' + s;

  return s || fallback;
}

/** 生成宠物库中的文件名（含 .petpack 扩展名，重复扩展名不叠加） */
export function petPackFileName(name, { maxLen = 80 } = {}) {
  const base = safeFileName(name, { maxLen, fallback: 'pet' });
  return /\.petpack$/i.test(base) ? base : base + '.petpack';
}