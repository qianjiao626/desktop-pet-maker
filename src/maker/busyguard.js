// 渲染进程的「按钮防重入」：连点两次不该做两遍。
//
// 背景（用户反复强调"不要让窗口重复在桌面跳出来影响我工作"）：
//   制作器里有一批**生成/导出类**按钮，点一下要做不少事（渲染几十帧、写文件）：
//     · 生成动画帧（连点 -> 帧数翻倍：实测连点两次得到 16 帧）
//     · 一键存全部舞步（连点 -> 片段重复，且每段都要重新渲染 8 帧）
//     · 导出（连点 -> 弹两次保存对话框）
//   这些按钮**没有防重入**。用户连点（很常见，因为渲染慢、界面像没反应）
//   就会得到重复的数据、或连开两个对话框。
//
// 与托盘那批（同步动作）的区别：
//   这里是**异步**动作（要 await 渲染/IPC），所以"忙碌标记"式守卫是正确工具 ——
//   标记从开始一直持有到 Promise 结束。
//
// 用法：
//   import { guardBusy } from './busyguard.js';
//   btn.onclick = guardBusy(async () => { ... });

/**
 * 把异步动作包成"同一时刻只跑一个"。
 *
 * @param fn 异步动作（返回 Promise）
 * @param opt { onBusy } 忙碌期间再次点击时的回调（便于给用户反馈）
 * @returns 包装后的函数
 */
export function guardBusy(fn, opt = {}) {
  if (typeof fn !== 'function') throw new Error('guardBusy 需要一个函数');
  const onBusy = typeof opt.onBusy === 'function' ? opt.onBusy : null;
  let busy = false;
  // ★ 不能用 async 声明：async 函数**永远返回 Promise**，
  //   于是"忙碌时跳过"会返回一个已 resolve 的 Promise 而不是 undefined，
  //   调用方（以及测试）无法区分"跳过了"和"真的执行了"。
  //   这里手动返回 Promise，跳过时明确返回 undefined。
  function guarded(...args) {
    if (busy) {
      try { if (onBusy) onBusy(); } catch { /* 反馈失败不影响 */ }
      return undefined;
    }
    busy = true;
    let result;
    try {
      result = fn.apply(this, args);
    } catch (err) {
      // 同步抛错：也要解锁
      busy = false;
      throw err;
    }
    // 统一按 Promise 处理（动作可以是同步或异步）
    return Promise.resolve(result).finally(() => {
      // ★ 必须 finally：动作抛错也要解锁，否则按钮永久失效
      busy = false;
    });
  }
  guarded.isBusy = () => busy;
  return guarded;
}

/**
 * 给一个 DOM 按钮装上"防重入"。
 *
 * 只做一件事：**同一时刻只跑一个**。第二次点击直接忽略。
 *
 * 为什么不顺手禁用/恢复 disabled：
 *   制作器里按钮的可用性由 `updateButtons()` 统一决定
 *   （没帧时导出该灰、有帧时才亮）。这里盲目 `disabled = false`
 *   会把本该灰着的按钮点亮 —— 那是另一个 bug。
 *   所以这里**不碰 disabled**，只负责"不重复执行"。
 *
 * @param el 按钮元素
 * @param fn 异步动作
 * @returns 包装后的处理函数（便于测试直接调用；未绑定成功返回 null）
 */
export function bindGuardedClick(el, fn) {
  if (!el) return null;
  const handler = guardBusy(fn);
  el.onclick = (...args) => handler.apply(el, args);
  return el.onclick;
}
