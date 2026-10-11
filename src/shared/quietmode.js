// 宠物右键菜单里「让它安静」的文案与状态（纯逻辑，可单测）。
//
// 场景（用户真实需求）：正在专心工作时，桌宠在旁边走来走去、时不时冒一句台词，很干扰。
// 但用户又不想把它关掉。以前只能重新打开制作器、去「物理/气泡」页改勾选 ——
// 门槛太高，于是要么忍着，要么直接关掉宠物。
//
// 这里给两个一键开关：
//   · 暂停走动（让它待在原地）
//   · 静音气泡（不冒台词）
// 菜单项文案要**反映当前状态**（"暂停走动" vs "继续走动"），否则用户不知道自己现在处于哪种。

/** 暂停走动那一项的文案 */
export function moveMenuLabel(paused) {
  return paused ? '继续走动' : '暂停走动（待在原地）';
}

/** 静音气泡那一项的文案 */
export function muteMenuLabel(muted) {
  return muted ? '打开气泡' : '静音气泡';
}

/**
 * 组织那一段菜单项（纯数据，便于单测菜单结构）。
 * @param opt.moving     当前是否在动（未暂停）
 * @param opt.bubbleOn   当前气泡是否开着
 */
export function quietMenuItems(opt = {}) {
  const paused = opt.moving === false;
  const muted = opt.bubbleOn === false;
  return [
    { act: 'toggleMove', label: moveMenuLabel(paused), paused },
    { act: 'toggleMute', label: muteMenuLabel(muted), muted },
  ];
}

/**
 * 关掉走动 / 静音之后，宠物应该做什么 —— 给渲染侧的动作提示。
 * 纯函数便于测试"两边都开时该怎样"这类组合。
 */
export function quietEffect(opt = {}) {
  const paused = opt.paused === true;
  const muted = opt.muted === true;
  return {
    // 暂停走动：把目标速度压成 0 并停在当前状态，不再触发新的走动
    stopWalking: paused,
    // 静音：不冒气泡（包括自动轮播与事件台词）
    suppressBubble: muted,
  };
}
