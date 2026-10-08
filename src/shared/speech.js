// 自定义台词（气泡文本）处理（纯函数，可单测）
// 场景：用户在制作器里输入一句话，点「说出来」，桌宠上方气泡显示该文本。

export const MAX_LEN = 120;          // 单条台词最大字符数（按码点计）
export const MAX_QUEUE = 20;         // 最多缓存多少条待说

/**
 * 清洗用户输入：
 * - 折叠空白（保留换行语义 -> 转空格，气泡内自动换行）
 * - 去除控制字符
 * - 限长（按码点，避免截断代理对）
 * - 空输入返回空串（调用方据此判定不发）
 */
export function sanitizeSpeech(input, { maxLen = MAX_LEN } = {}) {
  let s = String(input == null ? '' : input);
  // 换行/制表 -> 空格（气泡自己做换行）
  s = s.replace(/[\t\n\r\f\v]+/g, ' ');
  // 去掉其余控制字符
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  // 折叠连续空格
  s = s.replace(/ {2,}/g, ' ');
  // 去首尾空白
  s = s.trim();
  // 按码点限长
  const cps = Array.from(s);
  if (cps.length > maxLen) s = cps.slice(0, maxLen).join('') + '…';
  return s;
}

/** 是否是可发送的有效台词 */
export function isSpeakable(input) {
  return sanitizeSpeech(input).length > 0;
}

/**
 * 把新台词推入队列（有限容量，超出丢最旧）
 * 队列元素为已清洗的字符串
 */
export function pushSpeech(queue, input, { maxQueue = MAX_QUEUE } = {}) {
  const text = sanitizeSpeech(input);
  if (!text) return queue;
  const next = Array.isArray(queue) ? queue.slice() : [];
  next.push(text);
  while (next.length > maxQueue) next.shift();
  return next;
}

/** 计算气泡显示时长：短句快、长句慢，但都有上下限 */
export function speechDuration(text, { min = 1.2, max = 8, perChar = 0.13 } = {}) {
  const n = Array.from(String(text == null ? '' : text)).length;
  const d = min + n * perChar;
  return Math.max(min, Math.min(max, d));
}