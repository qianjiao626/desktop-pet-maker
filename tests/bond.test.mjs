import { ok } from './_harness.mjs';
import {
  BOND_LEVELS, EVENT_SCORE, WINDOW_MS,
  normalizeEvents, bondScore, bondLevel, toNextLevel, levelProgress, bondFlavor, addEvent,
} from '../src/shared/bond.js';

const NOW = 1700000000000;

// ---------- normalizeEvents ----------
{
  ok('非数组返回空', normalizeEvents(null).length === 0 && normalizeEvents('x').length === 0, 'bad');
  const r = normalizeEvents([
    null, {}, { at: 1 }, { at: 1, type: 'pat' }, 'x',
    { at: 'bad', type: 'pat' }, { at: 5, type: '' },
  ]);
  ok('只保留合法事件', r.length === 1 && r[0].type === 'pat', JSON.stringify(r));
  ok('按时间排序', (() => {
    const s = normalizeEvents([{ at: 3, type: 'a' }, { at: 1, type: 'b' }, { at: 2, type: 'c' }]);
    return s.map((x) => x.at).join(',') === '1,2,3';
  })(), 'sorted');
  ok('未给分数时按类型给分', normalizeEvents([{ at: 1, type: 'pat' }])[0].score === EVENT_SCORE.pat, 'score');
  ok('未知类型给 1 分', normalizeEvents([{ at: 1, type: 'zzz' }])[0].score === 1, 'unknown');
  ok('显式分数优先', normalizeEvents([{ at: 1, type: 'pat', score: 99 }])[0].score === 99, 'explicit');
  ok('负分被忽略（用类型分）', normalizeEvents([{ at: 1, type: 'pat', score: -5 }])[0].score === EVENT_SCORE.pat, 'neg');
}

// ---------- bondScore ----------
{
  ok('没有互动 -> 0 分', bondScore([], NOW) === 0, String(bondScore([], NOW)));
  ok('坏输入 -> 0 分', bondScore(null, NOW) === 0 && bondScore('x', NOW) === 0, 'bad');
  const one = bondScore([{ at: NOW, type: 'pat' }], NOW);
  ok('一次摸头 > 0', one > 0, String(one));
  ok('摸头比分比戳一下高',
    bondScore([{ at: NOW, type: 'pat' }], NOW) > bondScore([{ at: NOW, type: 'poke' }], NOW), 'weight');
}
{
  // 窗口外的不算（这正是参考 codachi 的滑动窗口思路：久了要"淡下去"）
  const old = bondScore([{ at: NOW - WINDOW_MS - 1000, type: 'pat' }], NOW);
  ok('窗口外的互动不计分', old === 0, String(old));
  const edge = bondScore([{ at: NOW - WINDOW_MS + 1000, type: 'pat' }], NOW);
  ok('窗口边缘的算（但权重最低）', edge > 0, String(edge));
}
{
  // 时间衰减：最近的比很久以前的更"算数"
  const near = bondScore([{ at: NOW - 1000, type: 'pat' }], NOW);
  const far = bondScore([{ at: NOW - WINDOW_MS + 60000, type: 'pat' }], NOW);
  ok('最近的互动权重更高', near > far, near + ' > ' + far);
}
{
  // 未来时间戳是坏数据，不该计
  ok('未来时间戳不计分', bondScore([{ at: NOW + 100000, type: 'pat' }], NOW) === 0, 'future');
  // 互动越多分越高
  const few = bondScore([{ at: NOW, type: 'pat' }], NOW);
  const many = bondScore([{ at: NOW, type: 'pat' }, { at: NOW - 1000, type: 'pat' }, { at: NOW - 2000, type: 'pat' }], NOW);
  ok('互动越多分越高', many > few, few + ' < ' + many);
}
{
  ok('now 非法时用当前时间（不崩）', typeof bondScore([{ at: Date.now(), type: 'pat' }], NaN) === 'number', 'now');
}

// ---------- 档位 ----------
{
  ok('0 分是陌生', bondLevel(0).id === 'stranger', bondLevel(0).id);
  ok('刚够 12 分是眼熟', bondLevel(12).id === 'familiar', bondLevel(12).id);
  ok('11.9 分还是陌生', bondLevel(11.9).id === 'stranger', bondLevel(11.9).id);
  ok('40 分是熟络', bondLevel(40).id === 'close', bondLevel(40).id);
  ok('100 分是亲密', bondLevel(100).id === 'intimate', bondLevel(100).id);
  ok('远超也是亲密（不会溢出）', bondLevel(99999).id === 'intimate', bondLevel(99999).id);
  ok('坏分数当 0', bondLevel(NaN).id === 'stranger' && bondLevel('x').id === 'stranger', 'bad');
  ok('档位阈值递增', (() => {
    for (let i = 1; i < BOND_LEVELS.length; i++) if (BOND_LEVELS[i].threshold <= BOND_LEVELS[i - 1].threshold) return false;
    return true;
  })(), JSON.stringify(BOND_LEVELS.map((x) => x.threshold)));
  ok('每档都有名字和提示', BOND_LEVELS.every((x) => x.id && x.name && x.hint), 'fields');
}
{
  ok('0 分到眼熟还差 12', toNextLevel(0) === 12, String(toNextLevel(0)));
  ok('10 分还差 2', toNextLevel(10) === 2, String(toNextLevel(10)));
  ok('满级后差 0', toNextLevel(1000) === 0, String(toNextLevel(1000)));
  ok('坏分数当 0', toNextLevel(NaN) === 12, String(toNextLevel(NaN)));
}
{
  ok('0 分进度 0%', levelProgress(0) === 0, String(levelProgress(0)));
  ok('眼熟区间一半约 50%', Math.abs(levelProgress(26) - 50) <= 1, String(levelProgress(26)));
  ok('满级 100%', levelProgress(500) === 100, String(levelProgress(500)));
  ok('进度不会超 100 或低于 0', levelProgress(99999) === 100 && levelProgress(-5) === 0, 'bounds');
}
{
  ok('亲密档的粘人加成最高', bondFlavor('intimate').extraClingy > bondFlavor('close').extraClingy, 'intimate');
  ok('陌生档没有加成', bondFlavor('stranger').extraClingy === 0, 'stranger');
  ok('未知档退化为陌生', bondFlavor('zzz').extraClingy === 0, 'unknown');
  ok('每个档都有说明', ['stranger', 'familiar', 'close', 'intimate'].every((x) => bondFlavor(x).note), 'notes');
}

// ---------- addEvent ----------
{
  let ev = [];
  ev = addEvent(ev, 'pat', NOW);
  ok('加了一条', ev.length === 1 && ev[0].type === 'pat', JSON.stringify(ev));
  ok('带上了分数', ev[0].score === EVENT_SCORE.pat, String(ev[0].score));
  ev = addEvent(ev, 'poke', NOW + 1000);
  ok('再加一条', ev.length === 2, String(ev.length));
  ok('保持时间顺序', ev[0].at <= ev[1].at, 'sorted');
  ok('不改原数组（纯函数）', (() => {
    const base = [];
    addEvent(base, 'pat', NOW);
    return base.length === 0;
  })(), 'pure');
}
{
  // 窗口外的旧记录会被裁掉，避免无限增长
  let ev = [];
  for (let i = 0; i < 10; i++) ev = addEvent(ev, 'pat', NOW - i * 1000);
  const later = NOW + WINDOW_MS + 120000;
  const pruned = addEvent(ev, 'pat', later);
  ok('旧记录被裁掉（不会无限增长）', pruned.every((e) => later - e.at <= WINDOW_MS + 60000), 'pruned');
}
{
  // 条数上限
  let ev = [];
  for (let i = 0; i < 50; i++) ev = addEvent(ev, 'pat', NOW - i, { maxKeep: 10 });
  ok('受条数上限约束', ev.length <= 10, String(ev.length));
  ok('保留的是最近的那批', ev[ev.length - 1].at >= ev[0].at, 'recent');
}
{
  ok('坏 type 也有默认分', addEvent([], '', NOW)[0].score >= 1, 'default');
  ok('at 非法时用当前时间', addEvent([], 'pat', NaN).length === 1, 'now');
}

// ---------- 端到端：多互动 -> 升级 ----------
{
  let ev = [];
  for (let i = 0; i < 20; i++) ev = addEvent(ev, 'pat', NOW - i * 1000);
  const s = bondScore(ev, NOW);
  ok('20 次摸头能到熟络或以上', ['close', 'intimate'].includes(bondLevel(s).id), bondLevel(s).id + ' score=' + s);
  // 之后长时间不理它，分数会掉下来（滑动窗口的核心价值）
  const muchLater = NOW + WINDOW_MS + 60000;
  ok('很久不理之后分数归零（不会假装还亲密）', bondScore(ev, muchLater) === 0, String(bondScore(ev, muchLater)));
}
