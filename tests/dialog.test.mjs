import { ok } from './_harness.mjs';
import {
  EVENTS, TONES, linesFor, pickLine, lineDuration, shouldSpeak, toneOf,
} from '../src/shared/dialog.js';

// ---------- 台词库的"健康度"：变体太少会立刻显得假 ----------
{
  ok('事件至少有 10 个', EVENTS.length >= 10, String(EVENTS.length));
  ok('口吻至少有 6 种', TONES.length >= 6, String(TONES.length));
  for (const tone of TONES) {
    for (const ev of EVENTS) {
      const lines = linesFor(tone, ev);
      ok(`${tone}.${ev} 至少有 4 条变体`, lines.length >= 4, String(lines.length));
      ok(`${tone}.${ev} 没有空台词`, lines.every((x) => String(x).trim().length > 0), 'empty');
    }
  }
}

// ---------- 口吻必须**真的不同**，不能五套性格说同样的话 ----------
{
  const sig = (tone) => EVENTS.map((e) => linesFor(tone, e).join('|')).join('||');
  const seen = new Map();
  for (const t of TONES) seen.set(t, sig(t));
  const uniq = new Set(seen.values());
  ok('不同口吻的台词库互不相同', uniq.size === TONES.length, `${uniq.size}/${TONES.length}`);
  ok('活泼和贪睡明显不同', sig('lively') !== sig('lazy'));
  ok('粘人和静默明显不同', sig('clingy') !== sig('quiet'));
  // 静默性格应该偏"短/沉默"
  const quietPat = linesFor('quiet', 'pat').join('');
  ok('静默性格的台词普遍很短', quietPat.length / linesFor('quiet', 'pat').length < 8,
    (quietPat.length / linesFor('quiet', 'pat').length).toFixed(1));
}

// ---------- 未知事件 / 未知口吻必须有兜底，不能返回空 ----------
{
  ok('未知事件回落到通用台词', linesFor('default', 'unknown-event').length >= 3,
    String(linesFor('default', 'unknown-event').length));
  ok('未知口吻回落到 default', linesFor('nope', 'pat').length >= 4, String(linesFor('nope', 'pat').length));
  ok('空事件也有兜底', linesFor('default', '').length >= 3, String(linesFor('default', '').length));
  ok('null 参数不炸', Array.isArray(linesFor(null, null)), 'array');
}

// ---------- pickLine：可选性 + 避重 ----------
{
  let i = 0;
  const rng = () => [0.0, 0.5, 0.99, 0.25][i++ % 4];
  for (let k = 0; k < 40; k++) {
    const line = pickLine({ event: 'pat', tone: 'lively', rng });
    ok(`第 ${k} 次拿到非空台词`, typeof line === 'string' && line.length > 0, '[' + line + ']');
    ok('拿到的台词确实在候选池里', linesFor('lively', 'pat').includes(line), line);
  }
}
{
  // 用真实随机统计：每个变体都应该有机会出现（不能永远只出第一条）
  const seen = new Set();
  for (let k = 0; k < 400; k++) seen.add(pickLine({ event: 'poke', tone: 'default' }));
  const pool = linesFor('default', 'poke');
  ok('随机采样能覆盖全部变体', [...pool].every((x) => seen.has(x)), `${seen.size}/${pool.length}`);
  ok('采样到的都在池内', [...seen].every((x) => pool.includes(x)), 'ok');
}
{
  // 避重：把除了一条以外的都说过了 -> 必须说没说过的那条
  const pool = linesFor('default', 'pat');
  const avoid = pool.slice(1);
  const r = pickLine({ event: 'pat', tone: 'default', avoid, rng: () => 0.5 });
  ok('避重时优先说没说过的那条', r === pool[0], r + ' vs ' + pool[0]);
}
{
  // 全部说过 -> 仍然要给一句话（不能因为避重就哑巴）
  const pool = linesFor('default', 'pat');
  const r = pickLine({ event: 'pat', tone: 'default', avoid: pool, rng: () => 0 });
  ok('全说过时仍能说话', pool.includes(r), r);
}
{
  // 用户自定义台词优先
  // 注意：自定义台词**只在闲聊时**优先。有具体事件时事件台词优先，
  // 否则用户写的台词会把摸头/挨打/被抓全部盖掉（这是实测过的 bug）。
  const r = pickLine({ event: 'idle', tone: 'lively', custom: ['我说这句'], rng: () => 0 });
  ok('闲聊时自定义台词优先', r === '我说这句', r);
  const r2 = pickLine({ event: 'pat', tone: 'lively', custom: ['', '   '], rng: () => 0 });
  ok('自定义台词为空时回落到内置', linesFor('lively', 'pat').includes(r2), r2);
  const r3 = pickLine({ event: 'pat', tone: 'lively', custom: 'not-an-array', rng: () => 0 });
  ok('custom 不是数组时也不炸', linesFor('lively', 'pat').includes(r3), r3);
}
{
  // ★ 关键语义：自定义台词不能把**事件专属**台词全盖掉。
  // 实测过的 bug：用户在气泡面板写了台词后，摸头/挨打/被抓全都只说自定义的第一句。
  const pool = linesFor('lively', 'pat');
  const r = pickLine({ event: 'pat', tone: 'lively', custom: ['自定义1', '自定义2'], rng: () => 0 });
  ok('有具体事件时，事件台词优先于自定义', pool.includes(r), r);
  ok('事件台词不会被自定义顶掉（40 次采样都在事件池里）', (() => {
    for (let k = 0; k < 40; k++) {
      const x = pickLine({ event: 'grab', tone: 'lively', custom: ['自定义'] });
      if (!linesFor('lively', 'grab').includes(x)) return false;
    }
    return true;
  })(), 'ok');
  // 但"闲聊"场景，自定义必须优先（那是用户自己的意愿）
  const idle = pickLine({ event: 'idle', tone: 'lively', custom: ['自定义1', '自定义2'], rng: () => 0 });
  ok('闲聊时自定义台词优先', ['自定义1', '自定义2'].includes(idle), idle);
  const noEvent = pickLine({ event: '', tone: 'lively', custom: ['只说我'], rng: () => 0 });
  ok('没有事件时用自定义', noEvent === '只说我', noEvent);
}
{
  ok('rng 返回 NaN 也不崩', typeof pickLine({ event: 'pat', rng: () => NaN }) === 'string', 'ok');
  ok('rng 返回负数也不崩', typeof pickLine({ event: 'pat', rng: () => -1 }) === 'string', 'ok');
  ok('rng 不是函数也不崩', typeof pickLine({ event: 'pat', rng: 42 }) === 'string', 'ok');
}

// ---------- lineDuration ----------
{
  const a = lineDuration('嗯');
  const b = lineDuration('这是一句相当长的台词，应该显示得久一点才对');
  ok('长句显示更久', b > a, `${a} < ${b}`);
  ok('最短也有下限', a >= 1.4, String(a));
  ok('最长有上限', lineDuration('字'.repeat(500)) <= 7, String(lineDuration('字'.repeat(500))));
  ok('空串不报错', lineDuration('') >= 1.4, String(lineDuration('')));
  ok('null 不报错', lineDuration(null) >= 1.4, String(lineDuration(null)));
}

// ---------- shouldSpeak：冷却 / 静默 ----------
{
  ok('正常情况可以说话', shouldSpeak({ event: 'pat', now: 10000, lastTalkAt: 0, minGapMs: 800 }).ok === true);
  ok('刚说过话则不说', shouldSpeak({ event: 'pat', now: 1000, lastTalkAt: 900, minGapMs: 800 }).ok === false);
  ok('过了最小间隔就能说', shouldSpeak({ event: 'pat', now: 2000, lastTalkAt: 900, minGapMs: 800 }).ok === true);
  ok('同类事件冷却中不说', shouldSpeak({ event: 'pat', now: 3000, lastTalkAt: 2000, cooldownMs: 5000 }).ok === false);
  ok('冷却结束就能说', shouldSpeak({ event: 'pat', now: 8000, lastTalkAt: 2000, cooldownMs: 5000 }).ok === true);
  ok('静默模式一律不说', shouldSpeak({ event: 'pat', now: 99999, lastTalkAt: 0, silent: true }).ok === false);
  ok('没有事件不说', shouldSpeak({ event: '', now: 99999 }).ok === false);
  ok('第一次说话（lastTalkAt=0）不受冷却影响', shouldSpeak({ event: 'pet', now: 500, lastTalkAt: 0, cooldownMs: 60000 }).ok === true);
  ok('拒绝时给得出原因', !!shouldSpeak({ event: 'pat', now: 1, lastTalkAt: 1, minGapMs: 9999 }).reason);
}

// ---------- toneOf：中文性格名要能映射 ----------
{
  ok('活泼 -> lively', toneOf('活泼') === 'lively', toneOf('活泼'));
  ok('温顺 -> gentle', toneOf('温顺') === 'gentle', toneOf('温顺'));
  ok('贪睡 -> sleepy', toneOf('贪睡') === 'sleepy', toneOf('贪睡'));
  ok('粘人 -> clingy', toneOf('粘人') === 'clingy', toneOf('粘人'));
  ok('静默 -> quiet', toneOf('静默') === 'quiet', toneOf('静默'));
  ok('英文口吻名直接用', toneOf('lively') === 'lively', toneOf('lively'));
  ok('未知性格 -> default', toneOf('神秘') === 'default', toneOf('神秘'));
  ok('旧别名 lazy 兼容为 sleepy', toneOf('lazy') === 'sleepy', toneOf('lazy'));
  ok('null -> default', toneOf(null) === 'default');
  ok('空白 -> default', toneOf('   ') === 'default');
}

// ---------- 守护：性格模板 id 必须与对话口吻名一致 ----------
// 这条是踩坑后加的：模板一侧写 sleepy、对话一侧写 lazy，两边都对不上，
// 结果"贪睡"性格的所有对话都静默掉回默认口吻，而且不报错。
{
  const { readFileSync } = await import('node:fs');
  const tpl = readFileSync('src/shared/templates.js', 'utf8');
  const ids = [...tpl.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]);
  ok('读到全部性格模板 id', ids.length >= 5, ids.join(','));
  for (const id of ids) {
    ok('模板 ' + id + ' 有对应的对话口吻', TONES.includes(id), 'TONES=' + TONES.join(','));
  }
}
