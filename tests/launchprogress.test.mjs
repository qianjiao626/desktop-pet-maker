import { ok } from './_harness.mjs';
import { progressText, summaryText, progressPct } from '../src/shared/launchprogress.js';

// ---------- progressText ----------
{
  ok('没有总数时给通用文案', progressText({}) === '正在准备宠物…', progressText({}));
  ok('total=0 也给通用文案', progressText({ total: 0, done: 0 }) === '正在准备宠物…');
}
{
  const t = progressText({ done: 1, total: 3, name: '北极熊' });
  ok('中间进度带分数', t.includes('1/3'), t);
  ok('中间进度带名字', t.includes('北极熊'), t);
  ok('中间进度用省略号表示还在进行', t.includes('…'), t);
}
{
  const t = progressText({ done: 3, total: 3 });
  ok('全部完成用 ✅', t.includes('✅'), t);
  ok('完成文案说明都放出来了', t.includes('3'), t);
}
{
  const t = progressText({ done: 2, total: 3, name: '大胖鸡', ok: false });
  ok('失败用 ⚠ 而不是 ✅', t.includes('⚠') && !t.includes('✅'), t);
  ok('失败也带进度', t.includes('2/3'), t);
  ok('失败带上是哪只', t.includes('大胖鸡'), t);
}
{
  const t = progressText({ done: 3, total: 3, failed: 1 });
  ok('有失败时总结不用全绿', !t.includes('都放出来'), t);
  ok('有失败时给出成功数', t.includes('2'), t);
  ok('有失败时给出失败数', t.includes('失败 1'), t);
}
{
  // 容错：数字乱七八糟也不该崩、不该出 NaN
  for (const opt of [{ done: 'x', total: 'y' }, { done: -5, total: 3 }, { done: 99, total: 3 }, { total: NaN }]) {
    const t = progressText(opt);
    ok('容错输入不产生 NaN：' + JSON.stringify(opt), !t.includes('NaN'), t);
    ok('容错输入仍返回字符串：' + JSON.stringify(opt), typeof t === 'string' && t.length > 0, t);
  }
  ok('done 超过 total 被钳住', progressText({ done: 99, total: 3 }).includes('✅'), progressText({ done: 99, total: 3 }));
}
{
  // 名字里的空白要被清掉；名字缺失时不该出现空括号
  const t = progressText({ done: 1, total: 2, name: '   ' });
  ok('空名字不产生空括号', !t.includes('（）') && !t.includes('()'), t);
  ok('空名字时用"这只"', t.includes('这只') || !t.includes('（'), t);
}

// ---------- summaryText ----------
{
  const s = summaryText({ total: 3 });
  ok('总结用 ✅', s.includes('✅'), s);
  ok('总结给出数量', s.includes('3'), s);
  ok('总结提醒可能在屏幕别处（并给找回方式）', s.includes('Ctrl+Alt+R'), s);
}
{
  const s = summaryText({ total: 3, failed: 1 });
  ok('有失败时总结提到失败数', s.includes('失败 1'), s);
  ok('有失败时不说"3 只"都成功', !s.includes('把 3 只'), s);
}
{
  ok('全部失败时给明确的坏消息', summaryText({ total: 2, failed: 2 }).includes('没能'), summaryText({ total: 2, failed: 2 }));
  ok('没有宠物时给提示', summaryText({ total: 0 }).includes('没有'), summaryText({ total: 0 }));
  for (const o of [{}, { total: NaN }, { total: -1 }]) {
    ok('总结容错不崩：' + JSON.stringify(o), typeof summaryText(o) === 'string' && summaryText(o).length > 0, summaryText(o));
  }
}

// ---------- progressPct ----------
{
  ok('0 只时百分比为 0', progressPct({ done: 0, total: 0 }) === 0, String(progressPct({ done: 0, total: 0 })));
  ok('一半是 50', progressPct({ done: 1, total: 2 }) === 50, String(progressPct({ done: 1, total: 2 })));
  ok('完成是 100', progressPct({ done: 3, total: 3 }) === 100, String(progressPct({ done: 3, total: 3 })));
  ok('不超过 100', progressPct({ done: 99, total: 3 }) === 100, String(progressPct({ done: 99, total: 3 })));
  ok('不低于 0', progressPct({ done: -5, total: 3 }) === 0, String(progressPct({ done: -5, total: 3 })));
  ok('1/3 约等于 33', progressPct({ done: 1, total: 3 }) === 33, String(progressPct({ done: 1, total: 3 })));
}
