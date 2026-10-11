import { ok } from './_harness.mjs';
import {
  __resetState, addPet, removePet, getPet, listPets, petCount, petByWindow,
  setActivePet, getActivePetId, petByWebContentsId, setPetWindow, getPetWindow, isPetAlive,
  setCurrentPack, getCurrentPack, clearCurrentPack,
  setCurrentScale, getCurrentScale, setMakerWindow, getMakerWindow,
} from '../src/main/state.js';

// 假窗口：只需要 isDestroyed()
const win = (destroyed = false) => ({ isDestroyed: () => destroyed });

// ---------- 旧（单例）语义必须完全不变 ----------
{
  __resetState();
  ok('初始没有宠物', isPetAlive() === false, String(isPetAlive()));
  ok('初始窗口为 null', getPetWindow() === null, JSON.stringify(getPetWindow()));
  const w = win();
  setPetWindow(w);
  ok('设了窗口后算存活', isPetAlive() === true);
  ok('getPetWindow 返回它', getPetWindow() === w);
  setPetWindow(null);
  ok('清空后又不存活', isPetAlive() === false);
  ok('清空后窗口为 null', getPetWindow() === null);
}
{
  __resetState();
  const w = win(true);   // 已销毁
  addPet({ win: w });
  ok('窗口已销毁 -> 不算存活', isPetAlive() === false, 'destroyed');
  ok('窗口已销毁 -> getPetWindow 返回 null', getPetWindow() === null, 'destroyed');
}
{
  __resetState();
  const w1 = win(), w2 = win();
  setPetWindow(w1);
  setPetWindow(w2);
  ok('旧 API 多次 setPetWindow 不炸', isPetAlive() === true);
  ok('旧 API 指向最后一个', getPetWindow() === w2, 'last');
}
{
  // setCurrentPack / getCurrentPack 的旧用法
  __resetState();
  const w = win();
  setPetWindow(w);
  setCurrentPack({ pack: { name: 'A' }, frames: [{ file: 'a.png' }] });
  const got = getCurrentPack();
  ok('set/getCurrentPack 往返正确', got && got.pack.name === 'A' && got.frames.length === 1, JSON.stringify(got));
  clearCurrentPack();
  ok('clearCurrentPack 后为 null', getCurrentPack() === null, JSON.stringify(getCurrentPack()));
}
{
  // 缩放：旧 API
  __resetState();
  setPetWindow(win());
  setCurrentScale(0.8);
  ok('缩放往返正确', getCurrentScale() === 0.8, String(getCurrentScale()));
  setCurrentScale(null);
  ok('清空缩放回 null', getCurrentScale() === null, String(getCurrentScale()));
  setCurrentScale('bad');
  ok('非法缩放变 null', getCurrentScale() === null, String(getCurrentScale()));
}
{
  __resetState();
  const m = { isDestroyed: () => false };
  setMakerWindow(m);
  ok('maker 窗口往返正确', getMakerWindow() === m);
}

// ---------- 新（多宠物）语义 ----------
{
  __resetState();
  const a = win(), b = win();
  const ida = addPet({ id: 'a', win: a, pack: { name: '甲' }, frames: [{ file: 'a' }] });
  ok('addPet 返回 id', ida === 'a', ida);
  const idb = addPet({ id: 'b', win: b, pack: { name: '乙' }, frames: [{ file: 'b' }] });
  ok('第二只也有 id', idb === 'b');
  ok('两只都在', petCount() === 2, String(petCount()));
  ok('listPets 返回两只', listPets().length === 2);
  ok('按 id 取得到', getPet('a').pack.name === '甲' && getPet('b').pack.name === '乙');
  ok('取不存在的 id 返回 null', getPet('zzz') === null);
  ok('最近启用的是第二只', getActivePetId() === 'b', String(getActivePetId()));
  ok('旧 API 指向最近启用的（乙）', getPetWindow() === b, 'active');
  ok('按窗口反查甲', petByWindow(a).id === 'a', JSON.stringify(petByWindow(a) && petByWindow(a).id));
  ok('按窗口反查乙', petByWindow(b).id === 'b');
  ok('按不认识的对象反查返回 null', petByWindow({}) === null);
  ok('按 null 反查返回 null', petByWindow(null) === null);
  // 切换活跃
  ok('切换活跃成功', setActivePet('a') === true);
  ok('切换后旧 API 指向甲', getPetWindow() === a);
  ok('切换后 currentPack 是甲的', getCurrentPack().pack.name === '甲', JSON.stringify(getCurrentPack()));
  ok('切到不存在的 id 失败', setActivePet('zzz') === false);
  ok('失败的切换不改变活跃', getActivePetId() === 'a');
}
{
  // 移除
  __resetState();
  const a = win(), b = win();
  addPet({ id: 'a', win: a });
  addPet({ id: 'b', win: b });
  ok('移除存在的返回 true', removePet('b') === true);
  ok('移除后只剩一只', petCount() === 1, String(petCount()));
  ok('移除不存在的返回 false', removePet('zzz') === false);
  ok('活跃回落到剩下那只', getActivePetId() === 'a', String(getActivePetId()));
  removePet('a');
  ok('全移除后 count=0', petCount() === 0);
  ok('全移除后不存活', isPetAlive() === false);
  ok('全移除后活跃为 null', getActivePetId() === null, String(getActivePetId()));
  ok('全移除后 currentPack 为 null', getCurrentPack() === null);
}
{
  // 已销毁的实例不进 listPets
  __resetState();
  addPet({ id: 'ok1', win: win(false) });
  addPet({ id: 'dead', win: win(true) });
  ok('listPets 剔除已销毁的', listPets().length === 1 && listPets()[0].id === 'ok1', JSON.stringify(listPets().map(p => p.id)));
  ok('petCount 也剔除', petCount() === 1, String(petCount()));
  ok('但仍能按 id 取到（不主动删）', getPet('dead') !== null);
}
{
  // 每只宠物各自的缩放
  __resetState();
  const a = win(), b = win();
  addPet({ id: 'a', win: a });
  setActivePet('a');
  setCurrentScale(0.5);
  addPet({ id: 'b', win: b });
  setActivePet('b');
  setCurrentScale(1.2);
  setActivePet('a');
  ok('每只宠物记住自己的缩放', getCurrentScale() === 0.5, String(getCurrentScale()));
  setActivePet('b');
  ok('另一只的缩放独立', getCurrentScale() === 1.2, String(getCurrentScale()));
}
{
  // 自动生成 id
  __resetState();
  const id1 = addPet({ win: win() });
  const id2 = addPet({ win: win() });
  ok('自动 id 不重复', id1 !== id2, id1 + ' vs ' + id2);
  ok('自动 id 是字符串', typeof id1 === 'string' && id1.length > 0);
}
{
  // addPet 对畸形输入要有兜底
  __resetState();
  const id = addPet();
  ok('addPet() 不炸', typeof id === 'string' && id.length > 0, id);
  // 没有窗口的实例不算存活（它还没真的出现在桌面上）
  ok('空实例不算存活数量', petCount() === 0, String(petCount()));
  ok('但实例本身仍登记着（缓存了包）', getPet(id) !== null, 'registered');
  ok('空实例没有窗口时不算存活', isPetAlive() === false, 'nowin');
}

// ---------- petByWebContentsId：多宠物身份的关键 ----------
// 为什么需要它：按 BrowserWindow 对象比对在 Electron 里不可靠（实测多宠物时反查失败，
// 结果三只宠物都回落到全局包 -> 全变成同一只）。webContents.id 是稳定整数。
{
  const wc = (id) => ({ id });
  const win = (wcId, destroyed = false) => ({ isDestroyed: () => destroyed, webContents: wc(wcId) });
  __resetState();
  addPet({ id: 'a', win: win(101) });
  addPet({ id: 'b', win: win(202) });
  ok('按 wc id 101 反查到 a', (petByWebContentsId(101) || {}).id === 'a', JSON.stringify(petByWebContentsId(101) && petByWebContentsId(101).id));
  ok('按 wc id 202 反查到 b', (petByWebContentsId(202) || {}).id === 'b');
  ok('不存在的 wc id 返回 null', petByWebContentsId(999) === null);
  ok('NaN 返回 null', petByWebContentsId(NaN) === null);
  ok('字符串数字也能认', (petByWebContentsId('101') || {}).id === 'a', 'string');
  ok('null 返回 null', petByWebContentsId(null) === null);
  // 已销毁的不返回
  __resetState();
  addPet({ id: 'dead', win: win(303, true) });
  ok('已销毁窗口不参与反查', petByWebContentsId(303) === null, 'destroyed');
  // 窗口没有 webContents 时不炸
  __resetState();
  addPet({ id: 'noWc', win: { isDestroyed: () => false } });
  ok('窗口缺 webContents 时不炸', petByWebContentsId(1) === null, 'nowc');
}
