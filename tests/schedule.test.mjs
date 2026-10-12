import { ok } from './_harness.mjs';
import { DAY_PARTS, PART_BIAS, partOfDay, applyDayPart, partLabel, dayCurve } from '../src/shared/schedule.js';

// ---------- partOfDay ----------
{
  const cases = [
    [3, 'late'], [5, 'dawn'], [7, 'dawn'], [9, 'morning'], [10.5, 'morning'],
    [12, 'noon'], [13, 'noon'], [14, 'day'], [16, 'day'], [18, 'evening'],
    [21.9, 'evening'], [22, 'night'], [23.9, 'night'], [0, 'late'], [4.9, 'late'],
  ];
  for (const [h, id] of cases) {
    ok(h + ' 时属于 ' + id, partOfDay(h).id === id, partOfDay(h).id);
  }
}
{
  // 边界与容错：不能因为一个坏输入就崩或给出 undefined
  ok('24 点归一化为 0 点', partOfDay(24).id === 'late', partOfDay(24).id);
  ok('负数归一化', partOfDay(-1).id === 'night', partOfDay(-1).id);
  ok('超范围归一化', partOfDay(25).id === 'late', partOfDay(25).id);
  ok('NaN 退化为白天', !!partOfDay(NaN), partOfDay(NaN).id);
  ok('undefined 退化为白天', !!partOfDay(undefined), partOfDay(undefined).id);
  ok('字符串数字可用', partOfDay('7').id === 'dawn', partOfDay('7').id);
}
{
  // 时段要**完整覆盖**一天，不能有空洞
  let covered = 0;
  for (let h = 0; h < 24; h += 0.25) if (partOfDay(h)) covered++;
  ok('一整天都被覆盖（无空洞）', covered === 96, String(covered));
  ok('时段名都不为空', DAY_PARTS.every((p) => p.id && p.name), JSON.stringify(DAY_PARTS));
  ok('时段 id 不重复', new Set(DAY_PARTS.map((p) => p.id)).size === DAY_PARTS.length, 'uniq');
}

// ---------- applyDayPart ----------
{
  const base = { idle: 0.22, walk: 0.52, doze: 0.05, hop: 0.16 };
  const morning = applyDayPart(base, 10);
  ok('上午走动权重变大', morning.weights.walk > base.walk, morning.weights.walk + ' vs ' + base.walk);
  ok('上午打瞌睡权重变小', morning.weights.doze < base.doze, morning.weights.doze + ' vs ' + base.doze);
  ok('带回了时段信息', morning.part.id === 'morning', morning.part.id);

  const late = applyDayPart(base, 3);
  ok('凌晨走动权重变小', late.weights.walk < base.walk, late.weights.walk + ' vs ' + base.walk);
  ok('凌晨打瞌睡权重变大', late.weights.doze > base.doze, late.weights.doze + ' vs ' + base.doze);
  ok('凌晨走动比上午少', late.weights.walk < morning.weights.walk, late.weights.walk + ' < ' + morning.weights.walk);
}
{
  const base = { walk: 1, doze: 1 };
  const r = applyDayPart(base, 10);
  ok('不改原对象（纯函数）', base.walk === 1 && base.doze === 1, JSON.stringify(base));
  ok('返回的是新对象', r.weights !== base, 'new');
}
{
  // 权重不能变成负数（状态机会把负数当 0，但负值本身是脏数据）
  const r = applyDayPart({ walk: -5, doze: 3 }, 10);
  ok('负权重被钳到 0', r.weights.walk === 0, String(r.weights.walk));
  ok('正权重正常', r.weights.doze > 0, String(r.weights.doze));
}
{
  // 容错
  ok('base 为 null 不崩', typeof applyDayPart(null, 10).weights === 'object', 'null');
  ok('base 为空对象不崩', Object.keys(applyDayPart({}, 10).weights).length === 0, 'empty');
  ok('权重是字符串也能算', applyDayPart({ walk: '2' }, 10).weights.walk > 0, 'str');
  ok('权重是 NaN 时当 0', applyDayPart({ walk: NaN }, 10).weights.walk === 0, 'nan');
}
{
  // 只影响给了系数的项，其它项保持原值
  const r = applyDayPart({ walk: 1, lookAround: 0.18, hop: 1 }, 10);
  ok('没给系数的项保持原值', r.weights.lookAround === 0.18, String(r.weights.lookAround));
}

// ---------- partLabel ----------
{
  ok('10 点显示上午', partLabel(10) === '上午', partLabel(10));
  ok('3 点显示凌晨', partLabel(3) === '凌晨', partLabel(3));
  ok('坏输入不崩', typeof partLabel(NaN) === 'string' && partLabel(NaN).length > 0, partLabel(NaN));
}

// ---------- 作息曲线要合理 ----------
{
  const c = dayCurve(1);
  ok('曲线覆盖 24 个点', c.length === 24, String(c.length));
  const byHour = new Map(c.map((x) => [x.hour, x]));
  // 上午最精神：walk 系数应该是全天最高之一
  const maxWalk = Math.max(...c.map((x) => x.walkScale));
  ok('上午是走动最多的时候', byHour.get(10).walkScale === maxWalk, 'morning=' + byHour.get(10).walkScale + ' max=' + maxWalk);
  // 凌晨最能睡
  const maxDoze = Math.max(...c.map((x) => x.dozeScale));
  ok('凌晨是打瞌睡最多的时候', byHour.get(3).dozeScale === maxDoze, 'late=' + byHour.get(3).dozeScale + ' max=' + maxDoze);
  // 全天都有正权重（不能出现某时段什么都不做）
  ok('每个时段都至少能动或发呆', c.every((x) => x.walkScale > 0 && x.dozeScale > 0), 'positive');
}
{
  // 变化要"有规律"而不是噪声：相邻小时的差异不该剧烈跳变
  const c = dayCurve(1);
  let maxJump = 0;
  for (let i = 1; i < c.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(c[i].walkScale - c[i - 1].walkScale));
  }
  // 相邻时段之间不该出现"5 倍"级别的跳变（那是突变，不是作息）
  ok('相邻时段变化不剧烈（<=4 倍基础值）', maxJump <= 4.0, 'maxJump=' + maxJump.toFixed(2));
}
{
  ok('PART_BIAS 的键都是已知时段', Object.keys(PART_BIAS).every((k) => DAY_PARTS.some((p) => p.id === k)),
    Object.keys(PART_BIAS).join(','));
  ok('每个时段都有系数', DAY_PARTS.every((p) => !!PART_BIAS[p.id]), 'all');
}
