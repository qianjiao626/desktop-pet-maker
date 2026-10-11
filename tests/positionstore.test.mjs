import { ok } from './_harness.mjs';
import { shouldSave, sanitizePos, prunePositions } from '../src/shared/positionstore.js';

// ---------- shouldSave ----------
{
  const r = shouldSave({ now: 1000, lastSaveAt: 0, x: 10, y: 10 });
  ok('第一次应该存', r.save === true, JSON.stringify(r));
}
{
  // 刚存过、又没怎么动 -> 不存（避免每帧写盘）
  const r = shouldSave({ now: 1000, lastSaveAt: 900, lastX: 10, lastY: 10, x: 11, y: 11, minGapMs: 3000, minDelta: 8 });
  ok('刚存过且几乎没动时不存', r.save === false, JSON.stringify(r));
}
{
  // 移动够大 -> 存（即便间隔没到）
  const r = shouldSave({ now: 1000, lastSaveAt: 900, lastX: 10, lastY: 10, x: 40, y: 10, minGapMs: 3000, minDelta: 8 });
  ok('移动够大时存', r.save === true, JSON.stringify(r));
  ok('给出存的原因', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
}
{
  // 间隔到了 -> 存（哪怕没动，保证最终位置会被记住）
  const r = shouldSave({ now: 10000, lastSaveAt: 1000, lastX: 10, lastY: 10, x: 10, y: 10, minGapMs: 3000 });
  ok('间隔到了就存', r.save === true, JSON.stringify(r));
}
{
  // 纵向移动也算
  const r = shouldSave({ now: 1000, lastSaveAt: 900, lastX: 10, lastY: 10, x: 10, y: 50, minGapMs: 3000, minDelta: 8 });
  ok('纵向移动够大也存', r.save === true, JSON.stringify(r));
}
{
  // 数值容错
  ok('坐标缺失不崩', typeof shouldSave({ now: 1, lastSaveAt: 0 }).save === 'boolean');
  ok('now 缺失不崩', typeof shouldSave({ lastSaveAt: 5, lastX: 1, lastY: 1, x: 1, y: 1 }).save === 'boolean');
  ok('minGapMs 非法时用默认（不变成 0 导致每帧都存）', (() => {
    const r = shouldSave({ now: 1000, lastSaveAt: 900, lastX: 10, lastY: 10, x: 10, y: 10, minGapMs: NaN });
    return r.save === false;
  })(), 'default-gap');
}

// ---------- sanitizePos ----------
{
  ok('取整', JSON.stringify(sanitizePos(10.6, -3.2)) === JSON.stringify({ x: 11, y: -3 }), JSON.stringify(sanitizePos(10.6, -3.2)));
  ok('非法值返回 null', sanitizePos(NaN, 1) === null && sanitizePos('x', 1) === null, 'bad');
  ok('Infinity 返回 null', sanitizePos(Infinity, 0) === null);
  ok('字符串数字可用', JSON.stringify(sanitizePos('10', '20')) === JSON.stringify({ x: 10, y: 20 }), 'str');
}

// ---------- prunePositions ----------
{
  const m = { a: { x: 1, y: 2 }, b: { x: 3, y: 4.7 }, bad: { x: NaN, y: 1 }, nullv: null };
  const out = prunePositions(m, null);
  ok('剔除坏数据', !out.bad && !out.nullv, JSON.stringify(out));
  ok('保留好数据并取整', out.a.x === 1 && out.b.y === 5, JSON.stringify(out));
}
{
  const m = { a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } };
  const out = prunePositions(m, ['a', 'c']);
  ok('只保留活着的宠物', Object.keys(out).join(',') === 'a,c', JSON.stringify(out));
}
{
  // 上限裁剪：不要无限增长
  const m = {};
  for (let i = 0; i < 300; i++) m['p' + i] = { x: i, y: i };
  const out = prunePositions(m, null, 200);
  ok('超过上限被裁剪', Object.keys(out).length === 200, String(Object.keys(out).length));
  ok('裁剪后保留的是最后写入的那批', out.p299 !== undefined, JSON.stringify(Object.keys(out).slice(-2)));
}
{
  ok('非对象返回空对象', Object.keys(prunePositions(null)).length === 0);
  ok('空对象返回空对象', Object.keys(prunePositions({})).length === 0);
  ok('不传 aliveIds 不裁剪', Object.keys(prunePositions({ a: { x: 1, y: 1 } })).length === 1);
}
