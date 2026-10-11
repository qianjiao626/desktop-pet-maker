import { ok } from './_harness.mjs';
import {
  emptyState, normalizeState, addGroup, removeGroup, renameGroup,
  addToGroup, removeFromGroup, groupsOf, pruneGroups, groupIdOf,
  filterLibrary, forgetPet, MAX_GROUPS, MAX_GROUP_NAME,
} from '../src/shared/library.js';

// ---------- 基础 ----------
{
  ok('空状态含 groups', Array.isArray(emptyState().groups), JSON.stringify(emptyState()));
  const s = normalizeState(null);
  ok('null 归一化后 groups 是数组', Array.isArray(s.groups), JSON.stringify(s.groups));
  const s2 = normalizeState({ favorites: ['a'], recent: ['b'], groups: 'nope' });
  ok('groups 非数组时退化为空', Array.isArray(s2.groups) && s2.groups.length === 0, JSON.stringify(s2.groups));
  ok('原有字段没被破坏', s2.favorites[0] === 'a' && s2.recent[0] === 'b', JSON.stringify(s2));
}

// ---------- addGroup ----------
{
  let s = emptyState();
  const r = addGroup(s, '工作');
  ok('新建分组成功', r.ok === true, JSON.stringify(r));
  ok('分组有 id 和名字', r.state.groups[0].id === '工作' && r.state.groups[0].name === '工作', JSON.stringify(r.state.groups[0]));
  ok('新分组 pets 为空数组', Array.isArray(r.state.groups[0].pets) && r.state.groups[0].pets.length === 0);
  ok('原状态未被修改（纯函数）', s.groups.length === 0, String(s.groups.length));
}
{
  const r1 = addGroup(emptyState(), '工作');
  const r2 = addGroup(r1.state, '工作');
  ok('重名分组被拒绝', r2.ok === false, JSON.stringify(r2.reason));
  ok('拒绝后状态不变', r2.state.groups.length === 1, String(r2.state.groups.length));
}
{
  ok('空名字被拒绝', addGroup(emptyState(), '   ').ok === false);
  ok('null 名字被拒绝', addGroup(emptyState(), null).ok === false);
  const long = addGroup(emptyState(), '字'.repeat(50));
  ok('超长名字被截断', Array.from(long.state.groups[0].name).length === MAX_GROUP_NAME, String(Array.from(long.state.groups[0].name).length));
  ok('名字里的控制字符被清掉', !/[\u0000-\u001f]/.test(addGroup(emptyState(), 'a\u0000b').state.groups[0].name));
}
{
  // 达到上限后不能再加
  let s = emptyState();
  for (let i = 0; i < MAX_GROUPS; i++) { const r = addGroup(s, 'g' + i); s = r.state; }
  ok('能建满 MAX_GROUPS 个', s.groups.length === MAX_GROUPS, String(s.groups.length));
  const over = addGroup(s, '再多一个');
  ok('超过上限被拒绝', over.ok === false, String(over.reason));
}
{
  // id 冲突：名字不同但派生出同一个 id
  let s = addGroup(emptyState(), 'a b').state;
  s = addGroup(s, 'a-b').state;
  ok('id 冲突时自动加后缀', s.groups[0].id !== s.groups[1].id, JSON.stringify(s.groups.map(g => g.id)));
  ok('两个分组都在', s.groups.length === 2);
}

// ---------- groupIdOf ----------
{
  ok('英文保留', groupIdOf('Work') === 'Work', groupIdOf('Work'));
  ok('中文保留', groupIdOf('工作') === '工作', groupIdOf('工作'));
  ok('空格转连字符', groupIdOf('a b') === 'a-b', groupIdOf('a b'));
  ok('无内容时有兜底', groupIdOf('') === 'group', groupIdOf(''));
  ok('路径分隔符被清掉', !groupIdOf('a/b').includes('/'), groupIdOf('a/b'));
}

// ---------- removeGroup / renameGroup ----------
{
  let s = addGroup(emptyState(), '甲').state;
  s = addGroup(s, '乙').state;
  const r = removeGroup(s, '甲');
  ok('删除分组生效', r.groups.length === 1 && r.groups[0].name === '乙', JSON.stringify(r.groups.map(g => g.name)));
  const r2 = removeGroup(s, '不存在');
  ok('删不存在的分组不炸', r2.groups.length === 2);
}
{
  let s = addGroup(emptyState(), '甲').state;
  s = addGroup(s, '乙').state;
  ok('重命名成功', renameGroup(s, '甲', '丙').ok === true);
  ok('重命名后名字变了', renameGroup(s, '甲', '丙').state.groups.find(g => g.id === '甲').name === '丙');
  ok('重命名成已有名字被拒绝', renameGroup(s, '甲', '乙').ok === false);
  ok('改成空名字被拒绝', renameGroup(s, '甲', '').ok === false);
  ok('重命名不存在的分组被拒绝', renameGroup(s, '无', 'x').ok === false);
}

// ---------- 分组与宠物的关系 ----------
{
  let s = addGroup(emptyState(), '表情包').state;
  const gid = s.groups[0].id;
  ok('加入分组成功', addToGroup(s, gid, 'pet-a').ok === true);
  s = addToGroup(s, gid, 'pet-a').state;
  s = addToGroup(s, gid, 'pet-a').state;
  ok('重复加入是幂等的', s.groups[0].pets.length === 1, String(s.groups[0].pets.length));
  s = addToGroup(s, gid, 'pet-b').state;
  ok('可以加多个宠物', s.groups[0].pets.length === 2);
  ok('移出分组生效', removeFromGroup(s, gid, 'pet-a').state.groups[0].pets.join(',') === 'pet-b');
  ok('移出不存在的宠物是幂等的', removeFromGroup(s, gid, '不存在').state.groups[0].pets.length === 2);
  ok('往不存在的分组加宠物被拒绝', addToGroup(s, '无', 'pet-a').ok === false);
  ok('无效宠物 id 被拒绝', addToGroup(s, gid, '').ok === false && addToGroup(s, gid, null).ok === false);
}
{
  // 一只宠物可以在多个分组（这是刻意的设计）
  let s = addGroup(emptyState(), 'A').state;
  s = addGroup(s, 'B').state;
  s = addToGroup(s, 'A', 'pet-x').state;
  s = addToGroup(s, 'B', 'pet-x').state;
  const gs = groupsOf(s, 'pet-x');
  ok('一只宠物可在多个分组', gs.length === 2, JSON.stringify(gs.map(g => g.name)));
  ok('groupsOf 对不在任何分组的宠物返回空', groupsOf(s, 'pet-y').length === 0);
}

// ---------- pruneGroups / forgetPet ----------
{
  let s = addGroup(emptyState(), 'A').state;
  s = addToGroup(s, 'A', 'alive').state;
  s = addToGroup(s, 'A', 'dead').state;
  const pruned = pruneGroups(s, ['alive']);
  ok('清掉已不存在的宠物', pruned.groups[0].pets.join(',') === 'alive', JSON.stringify(pruned.groups[0].pets));
  const pruned2 = pruneGroups(s, []);
  ok('全删时分组保留但为空（分组本身不删）', pruned2.groups.length === 1 && pruned2.groups[0].pets.length === 0);
}
{
  let s = addGroup(emptyState(), 'A').state;
  s = addToGroup(s, 'A', 'pet-x').state;
  const after = forgetPet(s, 'pet-x');
  ok('forgetPet 也会清掉分组里的记录', after.groups[0].pets.length === 0, JSON.stringify(after.groups[0].pets));
}

// ---------- filterLibrary 支持按分组 ----------
{
  let s = addGroup(emptyState(), '工作').state;
  s = addToGroup(s, '工作', 'p1').state;
  const items = [
    { id: 'p1', name: '甲' }, { id: 'p2', name: '乙' }, { id: 'p3', name: '丙' },
  ];
  const r = filterLibrary(items, { scope: 'group:工作' }, s);
  ok('按分组筛选只剩组内宠物', r.length === 1 && r[0].id === 'p1', JSON.stringify(r.map(x => x.id)));
  const r2 = filterLibrary(items, { scope: 'group:不存在' }, s);
  ok('筛选不存在的分组返回空', r2.length === 0, String(r2.length));
  const r3 = filterLibrary(items, { scope: 'all' }, s);
  ok('all 不受分组影响', r3.length === 3, String(r3.length));
  // 搜索与分组可叠加
  const r4 = filterLibrary(items, { scope: 'group:工作', query: '甲' }, s);
  ok('分组 + 搜索可叠加', r4.length === 1, String(r4.length));
  const r5 = filterLibrary(items, { scope: 'group:工作', query: '乙' }, s);
  ok('不匹配的搜索被过滤掉', r5.length === 0, String(r5.length));
}
{
  // 坏数据不能让库打不开
  const s = normalizeState({ groups: [null, 'x', { name: '' }, { name: '好', pets: ['a', 'a', 3, null, 'b'] }, { name: '好', id: 'dup' }] });
  ok('坏分组被丢掉，只留合法的', s.groups.length === 1, JSON.stringify(s.groups));
  ok('组内宠物去重且只留字符串', s.groups[0].pets.join(',') === 'a,b', JSON.stringify(s.groups[0].pets));
}
