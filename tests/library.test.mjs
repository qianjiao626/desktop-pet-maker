import { ok } from './_harness.mjs';
import {
  RECENT_MAX, emptyState, normalizeState, isFavorite, toggleFavorite,
  touchRecent, forgetPet, filterLibrary,
} from '../src/shared/library.js';

// ---------- 归一化 / 容错 ----------
ok('空状态结构正确', JSON.stringify(emptyState()) === JSON.stringify({ favorites: [], recent: [] }));
const bad = normalizeState(null);
ok('null 输入不崩', bad.favorites.length === 0 && bad.recent.length === 0);
ok('非对象输入不崩', normalizeState('x').favorites.length === 0);
ok('非法元素被丢弃', JSON.stringify(normalizeState({ favorites: [null, 1, '', 'a'] }).favorites) === JSON.stringify(['a']));
ok('收藏去重保序', JSON.stringify(normalizeState({ favorites: ['b', 'a', 'b'] }).favorites) === JSON.stringify(['b', 'a']));
ok('recent 超长被裁剪', normalizeState({ recent: Array.from({ length: 30 }, (_, i) => 'p' + i) }).recent.length === RECENT_MAX);

// ---------- 收藏 ----------
let s = emptyState();
ok('未收藏时 isFavorite=false', isFavorite(s, 'a') === false);
s = toggleFavorite(s, 'a');
ok('切换后成为收藏', isFavorite(s, 'a') === true);
ok('原对象未被修改（纯函数）', isFavorite(emptyState(), 'a') === false);
s = toggleFavorite(s, 'a');
ok('再次切换取消收藏', isFavorite(s, 'a') === false);
ok('toggle 空 id 安全', JSON.stringify(toggleFavorite(emptyState(), '')) === JSON.stringify(emptyState()));
ok('toggle 非字符串安全', isFavorite(toggleFavorite(emptyState(), 123), '123') === false);

// ---------- 最近使用 ----------
let r = emptyState();
r = touchRecent(r, 'a');
r = touchRecent(r, 'b');
r = touchRecent(r, 'c');
ok('最近使用按时间倒序', JSON.stringify(r.recent) === JSON.stringify(['c', 'b', 'a']));
r = touchRecent(r, 'a');
ok('再次使用会提到最前且不重复', JSON.stringify(r.recent) === JSON.stringify(['a', 'c', 'b']));
let many = emptyState();
for (let i = 0; i < 20; i++) many = touchRecent(many, 'p' + i);
ok('最近使用不超过上限', many.recent.length === RECENT_MAX);
ok('超出后保留最新的', many.recent[0] === 'p19');

// ---------- 删除宠物时清痕迹 ----------
let f = toggleFavorite(emptyState(), 'x');
f = touchRecent(f, 'x');
const cleaned = forgetPet(f, 'x');
ok('删除后收藏被清除', cleaned.favorites.length === 0);
ok('删除后最近使用被清除', cleaned.recent.length === 0);

// ---------- 库过滤 / 排序 ----------
const items = [
  { id: 'c1', name: '西瓜', builtin: true, size: 300, frames: 12 },
  { id: 'm1', name: '苹果', builtin: false, size: 100, frames: 6 },
  { id: 'c2', name: '香蕉', builtin: true, size: 200, frames: 6 },
];
ok('全部：默认按名字（中文）', filterLibrary(items, { scope: 'all' }, emptyState()).length === 3);
ok('内置筛选', filterLibrary(items, { scope: 'builtin' }, emptyState()).every((i) => i.builtin));
ok('我的筛选', filterLibrary(items, { scope: 'mine' }, emptyState()).length === 1);
ok('搜索按名字命中', filterLibrary(items, { query: '苹' }, emptyState()).length === 1);
ok('搜索无命中返回空', filterLibrary(items, { query: '不存在' }, emptyState()).length === 0);
ok('按体积降序', filterLibrary(items, { sort: 'size' }, emptyState())[0].id === 'c1');
ok('按帧数降序', filterLibrary(items, { sort: 'frames' }, emptyState())[0].id === 'c1');
ok('空输入安全', filterLibrary(null, {}, null).length === 0);

// 收藏分类
let fav = toggleFavorite(emptyState(), 'm1');
const favList = filterLibrary(items, { scope: 'fav' }, fav);
ok('收藏分类只含已收藏', favList.length === 1 && favList[0].id === 'm1');
ok('收藏分类支持叠加搜索', filterLibrary(items, { scope: 'fav', query: '苹' }, fav).length === 1);
ok('收藏分类搜索不命中则为空', filterLibrary(items, { scope: 'fav', query: '西瓜' }, fav).length === 0);

// 收藏置顶（非「收藏」分类时）
const sorted = filterLibrary(items, { scope: 'all' }, fav);
ok('收藏的排在列表最前', sorted[0].id === 'm1');

// 最近使用分类
let rec = emptyState();
rec = touchRecent(rec, 'c2');
rec = touchRecent(rec, 'm1');
const recList = filterLibrary(items, { scope: 'recent' }, rec);
ok('最近使用按时间倒序（不被名字排序打乱）', JSON.stringify(recList.map((i) => i.id)) === JSON.stringify(['m1', 'c2']));

// 最近使用里含已删除的 id —— 必须优雅跳过（这是最容易崩的场景）
const ghost = touchRecent(emptyState(), '已删除的宠物');
ok('最近使用含幽灵 id 不崩且被跳过', filterLibrary(items, { scope: 'recent' }, ghost).length === 0);
