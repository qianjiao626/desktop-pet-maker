import { ok } from './_harness.mjs';
import { normalizeClips, pickClip, clipFrameAt, clipDuration, createClipScheduler } from '../src/shared/clips.js';
import { normalizePack } from '../src/shared/petpack.js';

const mk = (id, frameCount = 2, durationMs = 100, weight = 1) => ({
  id, name: '动作' + id, weight,
  frames: Array.from({ length: frameCount }, (_, i) => ({ file: id + '_' + i + '.png', durationMs })),
});

// ---------- normalizeClips 容错 ----------
ok('空输入返回空数组', normalizeClips(null).length === 0 && normalizeClips([]).length === 0);
ok('丢弃 null / 非对象', normalizeClips([null, 1, 'x', {}]).length === 0);
ok('丢弃没有帧的片段', normalizeClips([{ id: 'a', frames: [] }, { id: 'b' }]).length === 0);
ok('丢弃帧里没有 file 的', normalizeClips([{ id: 'a', frames: [{ durationMs: 100 }] }]).length === 0);
ok('合法片段被保留', normalizeClips([mk('a')]).length === 1);
ok('非法权重兜底为 1', normalizeClips([{ id: 'a', frames: [{ file: 'f.png' }], weight: -5 }])[0].weight === 1);
ok('字符串权重兜底为 1', normalizeClips([{ id: 'a', frames: [{ file: 'f.png' }], weight: 'x' }])[0].weight === 1);
ok('时长被夹到合法区间', (() => {
  const c = normalizeClips([{ id: 'a', frames: [{ file: 'f.png', durationMs: 1 }] }])[0];
  return c.frames[0].durationMs === 16;
})());
// 注意：clips.js 只保证「下限 16ms」（避免 0/负时长导致死循环），
// 上限 5000ms 由 petpack 的归一化负责 —— 两个模块的职责不同，别混着断言。
ok('clips.js 不做上限裁剪（上限归 petpack 管）', normalizeClips([{ id: 'a', frames: [{ file: 'f.png', durationMs: 999999 }] }])[0].frames[0].durationMs === 999999);
ok('petpack 归一化时才对时长封顶', normalizePack({ frames: [{ file: 'a.png' }], clips: [{ id: 'a', frames: [{ file: 'b.png', durationMs: 999999 }] }] }).clips[0].frames[0].durationMs === 5000);
ok('缺 id 时自动生成', normalizeClips([{ frames: [{ file: 'f.png' }] }])[0].id.length > 0);
ok('缺 name 时用 id 兜底', normalizeClips([{ id: 'zz', frames: [{ file: 'f.png' }] }])[0].name === 'zz');

// ---------- pickClip：权重必须真的生效 ----------
{
  const clips = normalizeClips([mk('a', 1, 100, 1), mk('b', 1, 100, 3)]);
  const hits = { a: 0, b: 0 };
  for (let i = 0; i < 6000; i++) hits[pickClip(clips).id]++;
  const ratio = hits.b / hits.a;
  ok('权重 3:1 时选取比例接近 3', Math.abs(ratio - 3) < 0.5, `a=${hits.a} b=${hits.b} ratio=${ratio.toFixed(2)}`);
  ok('两个片段都会被选到（不是永远只选一个）', hits.a > 0 && hits.b > 0);
}
ok('只有一个片段时总是它', (() => { const c = normalizeClips([mk('solo')]); return pickClip(c).id === 'solo'; })());
ok('空列表返回 null', pickClip([]) === null && pickClip(null) === null);
{
  // 避免连续重复：避开当前片段
  const clips = normalizeClips([mk('a'), mk('b')]);
  let dup = 0, prev = null;
  for (let i = 0; i < 500; i++) { const p = pickClip(clips, Math.random, prev); if (p.id === prev) dup++; prev = p.id; }
  ok('传了 avoidId 时不会连续选同一个', dup === 0, 'dup=' + dup);
}
{
  // 只有一个候选以外的选择：即使 avoidId 是唯一选项，也要能选出东西（不能返回 null）
  const clips = normalizeClips([mk('only')]);
  ok('只有一个片段时 avoidId 也不会让它选不出来', pickClip(clips, Math.random, 'only') !== null);
}
ok('rng 固定时结果可预测（便于单测）', (() => {
  const clips = normalizeClips([mk('a', 1, 100, 1), mk('b', 1, 100, 1)]);
  return pickClip(clips, () => 0).id === 'a' && pickClip(clips, () => 0.99).id === 'b';
})());

// ---------- clipFrameAt：按时间取帧 ----------
{
  const c = normalizeClips([{ id: 'a', frames: [
    { file: 'f0.png', durationMs: 100 }, { file: 'f1.png', durationMs: 200 }, { file: 'f2.png', durationMs: 300 },
  ] }])[0];
  ok('t=0 取第 0 帧', clipFrameAt(c, 0).file === 'f0.png');
  ok('t=50 取第 0 帧', clipFrameAt(c, 50).file === 'f0.png');
  ok('t=100 取第 1 帧（边界归下一帧）', clipFrameAt(c, 100).file === 'f1.png');
  ok('t=299 取第 1 帧', clipFrameAt(c, 299).file === 'f1.png');
  ok('t=300 取第 2 帧', clipFrameAt(c, 300).file === 'f2.png');
  ok('t=600 回到第 0 帧（循环）', clipFrameAt(c, 600).file === 'f0.png');
  ok('负数时间也能循环（安全）', clipFrameAt(c, -1).file === 'f2.png');
  ok('超大时间安全', clipFrameAt(c, 1e9).file.length > 0);
  ok('坏片段返回安全默认值', clipFrameAt(null, 100).file === '');
}
ok('clipDuration 求和正确', clipDuration({ id: 'a', frames: [{ file: 'a', durationMs: 100 }, { file: 'b', durationMs: 250 }] }) === 350);
ok('clipDuration 坏输入为 0', clipDuration(null) === 0);

// ---------- 调度器 ----------
{
  // 确定性 rng：让"换片段"的时刻可预测
  let seed = 0;
  const rng = () => { seed = (seed + 0.37) % 1; return seed; };
  const clips = normalizeClips([mk('a', 2, 100, 1), mk('b', 2, 100, 1), mk('c', 2, 100, 1)]);
  const sch = createClipScheduler(clips, { minMs: 1000, maxMs: 2000, rng });
  ok('初始没有当前片段', sch.currentId === null);
  ok('报告片段数', sch.clipCount() === 3 && sch.hasClips() === true);
  const first = sch.tick(16);
  ok('第一次 tick 会选一个片段', first.changed === true && !!first.clip);
  ok('第一次 tick 就有帧信息', !!first.frame && first.frame.file.length > 0);
  let changes = 1;
  for (let i = 0; i < 200; i++) if (sch.tick(16).changed) changes++;
  ok('3.2 秒内切换次数合理（不是每帧都换）', changes >= 1 && changes <= 5, 'changes=' + changes);
  ok('切换间隔受 minMs 限制（不会太频繁）', changes <= 5);
}
{
  const sch = createClipScheduler([], {});
  ok('没有片段时 hasClips 为 false', sch.hasClips() === false);
  ok('没有片段时 tick 安全', sch.tick(16).changed === false);
  ok('没有片段时 forceSwitch 返回 null', sch.forceSwitch() === null);
}
{
  const clips = normalizeClips([mk('a'), mk('b')]);
  const sch = createClipScheduler(clips, { rng: () => 0.5 });
  sch.tick(16);
  const before = sch.currentId;
  const after = sch.forceSwitch();
  ok('forceSwitch 能立即换片段', !!after && after.id !== before, `${before} -> ${after && after.id}`);
  ok('forceSwitch 后计时归零', sch.elapsedMs === 0);
}
{
  // 关键：相邻两次切换不会是同一个动作（避免"刚换又像没换"）
  const clips = normalizeClips([mk('a'), mk('b'), mk('c')]);
  // 用真实随机：固定 rng 会永远落在同一个下标，那是测试的必然结果、不是产品问题。
  // 这里要验证的「不会连续重复」靠 avoidId 保证，与 rng 分布无关。
  const sch = createClipScheduler(clips, { minMs: 100, maxMs: 101 });
  const seq = [];
  for (let i = 0; i < 3000; i++) { const r = sch.tick(16); if (r.changed) seq.push(r.clip.id); }
  let same = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) same++;
  ok('连续两次切换不是同一个动作', same === 0, '重复 ' + same + ' 次 / 共 ' + seq.length + ' 次切换');
  ok('多个片段都被轮到过', new Set(seq).size === 3, [...new Set(seq)].join(','));
}

// ---------- petpack 里 clips 的归一化（向后兼容是关键）----------
{
  const legacy = normalizePack({ frames: [{ file: 'a.png' }] });
  ok('老包（无 clips）clips 为空数组', Array.isArray(legacy.clips) && legacy.clips.length === 0);
  ok('老包默认值里有 clips 字段', Array.isArray(normalizePack({}).clips));
  const withClips = normalizePack({
    frames: [{ file: 'a.png' }],
    clips: [
      { id: 'x', name: '呼吸', frames: [{ file: 'x0.png', durationMs: 200 }] },
      { id: 'y', frames: [{ file: 'y0.png' }], weight: 2 },
      null, { id: 'z', frames: [] },
    ],
  });
  ok('合法片段被保留、坏片段被丢弃', withClips.clips.length === 2, JSON.stringify(withClips.clips.map((c) => c.id)));
  ok('片段时长被归一化', withClips.clips[0].frames[0].durationMs === 200);
  ok('片段权重被归一化', withClips.clips[1].weight === 2);
  ok('缺 id 的片段被补齐 id', withClips.clips.every((c) => typeof c.id === 'string' && c.id.length > 0));
}
