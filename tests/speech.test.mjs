import { ok } from './_harness.mjs';
import { sanitizeSpeech, isSpeakable, pushSpeech, speechDuration, MAX_LEN, MAX_QUEUE } from '../src/shared/speech.js';

// ---- sanitizeSpeech ----
ok('普通文本原样', sanitizeSpeech('你好呀') === '你好呀');
ok('去首尾空白', sanitizeSpeech('  你好  ') === '你好');
ok('换行转空格', sanitizeSpeech('a' + String.fromCharCode(10) + 'b') === 'a b', sanitizeSpeech('a' + String.fromCharCode(10) + 'b'));
ok('制表符转空格', sanitizeSpeech('a' + String.fromCharCode(9) + 'b') === 'a b', sanitizeSpeech('a' + String.fromCharCode(9) + 'b'));
ok('折叠连续空格', sanitizeSpeech('a    b') === 'a b', sanitizeSpeech('a    b'));
ok('去除控制字符', sanitizeSpeech('a' + String.fromCharCode(0) + 'b') === 'ab');
ok('空串返回空', sanitizeSpeech('') === '');
ok('null 返回空', sanitizeSpeech(null) === '');
ok('undefined 返回空', sanitizeSpeech(undefined) === '');
ok('纯空白返回空', sanitizeSpeech('    ') === '');
ok('数字转字符串', sanitizeSpeech(123) === '123');

// ---- 限长（关键：不能产生残缺代理对）----
{
  const long = '中'.repeat(500);
  const r = sanitizeSpeech(long);
  ok('超长被截断', Array.from(r).length <= MAX_LEN + 1, String(Array.from(r).length));
  ok('截断后有省略号', r.endsWith('…'), r.slice(-3));
  ok('截断不产生乱码', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r));
}
{
  const emoji = '🐱'.repeat(200);
  const r = sanitizeSpeech(emoji);
  ok('emoji 截断安全', Array.from(r).length <= MAX_LEN + 1, String(Array.from(r).length));
  ok('emoji 无残缺代理对', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r));
}
ok('刚好到限长不加省略号', (() => { const s = 'a'.repeat(MAX_LEN); const r = sanitizeSpeech(s); return r === s; })());

// ---- isSpeakable ----
ok('有效文本可发送', isSpeakable('你好') === true);
ok('空文本不可发送', isSpeakable('') === false);
ok('纯空白不可发送', isSpeakable('   ') === false);
ok('null 不可发送', isSpeakable(null) === false);

// ---- pushSpeech ----
{
  let q = [];
  q = pushSpeech(q, '第一句');
  q = pushSpeech(q, '第二句');
  ok('入队两条', q.length === 2, q.join(','));
  ok('顺序正确', q[0] === '第一句' && q[1] === '第二句');
  const q2 = pushSpeech(q, '   ');
  ok('空文本不入队', q2.length === 2);
  ok('入队时清洗', pushSpeech([], '  你好  ')[0] === '你好');
}
{
  let q = [];
  for (let i = 0; i < MAX_QUEUE + 5; i++) q = pushSpeech(q, '第' + i + '句');
  ok('队列不超过上限', q.length === MAX_QUEUE, String(q.length));
  ok('丢弃最旧的', q[0] === '第5句', q[0]);
  ok('保留最新的', q[q.length - 1] === '第' + (MAX_QUEUE + 4) + '句', q[q.length - 1]);
}
{
  const orig = ['a'];
  const q2 = pushSpeech(orig, 'b');
  ok('不修改原数组', orig.length === 1 && q2.length === 2);
}
ok('null 队列安全', pushSpeech(null, 'x').length === 1);

// ---- speechDuration ----
ok('空文本取最小', speechDuration('') >= 1.2, String(speechDuration('')));
ok('长文本时长更大', speechDuration('这是一个很长很长的句子'.repeat(3)) > speechDuration('短'));
ok('时长有上限', speechDuration('很长'.repeat(500)) <= 8, String(speechDuration('很长'.repeat(500))));
ok('时长有下限', speechDuration('a') >= 1.2, String(speechDuration('a')));
ok('非字符串安全', Number.isFinite(speechDuration(null)));