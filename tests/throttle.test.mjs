import { ok } from './_harness.mjs';
import { STATE_FPS, DEFAULT_FPS, FULL_FPS, targetFps, frameGate, applyThrottle } from '../src/shared/throttle.js';

// ---------- targetFps ----------
{
  ok('打瞌睡时目标帧率很低', targetFps({ state: 'doze' }) === STATE_FPS.doze, String(targetFps({ state: 'doze' })));
  ok('发呆比走路低', targetFps({ state: 'idle' }) < targetFps({ state: 'walk' }), 'idle<walk');
  ok('走路 30fps', targetFps({ state: 'walk' }) === 30, String(targetFps({ state: 'walk' })));
  ok('跳跃满帧（要跟手）', targetFps({ state: 'hop' }) === FULL_FPS, String(targetFps({ state: 'hop' })));
  ok('被摸满帧', targetFps({ state: 'pat' }) === FULL_FPS);
  ok('挨打满帧', targetFps({ state: 'hit' }) === FULL_FPS);
  ok('未知状态用默认', targetFps({ state: 'wat' }) === DEFAULT_FPS, String(targetFps({ state: 'wat' })));
  ok('没有状态也用默认', targetFps({}) === DEFAULT_FPS);
}
{
  // 拖拽 / 特效一律满帧 —— 这两个场景卡顿最明显
  ok('拖拽时满帧（否则跟手很差）', targetFps({ state: 'doze', dragging: true }) === FULL_FPS, String(targetFps({ state: 'doze', dragging: true })));
  ok('有特效时满帧', targetFps({ state: 'doze', hasOverlay: true }) === FULL_FPS);
  ok('在移动时满帧', targetFps({ state: 'idle', moving: true }) === FULL_FPS, String(targetFps({ state: 'idle', moving: true })));
  // 走路**不是**满帧：画面 30fps 足够，而且状态机走路时速度一直不为 0，
  // 如果按"在动就给满帧"，打瞌睡的降帧会被彻底绕过（这是实测踩到的坑）。
  ok('走路至少 30fps', targetFps({ state: 'idle', walking: true }) >= 30, String(targetFps({ state: 'idle', walking: true })));
  ok('走路不必满帧', targetFps({ state: 'idle', walking: true }) < FULL_FPS, String(targetFps({ state: 'idle', walking: true })));
  ok('打瞌睡时即使有残余速度也保持低速', targetFps({ state: 'doze', moving: true }) === STATE_FPS.doze, String(targetFps({ state: 'doze', moving: true })));
  ok('打瞌睡被拖动时仍然满帧（跟手）', targetFps({ state: 'doze', dragging: true }) === FULL_FPS);
}
{
  // 目标帧率不能超过设备上限
  ok('不超过设备上限', targetFps({ state: 'hop', maxFps: 30 }) === 30, String(targetFps({ state: 'hop', maxFps: 30 })));
  ok('设备上限非法时用默认满帧', targetFps({ state: 'hop', maxFps: -5 }) === FULL_FPS);
  ok('设备上限是 NaN 时用默认', targetFps({ state: 'hop', maxFps: NaN }) === FULL_FPS);
  ok('doze 不会被上限抬高', targetFps({ state: 'doze', maxFps: 144 }) === STATE_FPS.doze, String(targetFps({ state: 'doze', maxFps: 144 })));
}
{
  // 帧率必须是正数，否则 frameGate 会算出 Infinity 的间隔
  for (const st of Object.keys(STATE_FPS)) {
    ok('状态 ' + st + ' 的帧率是正数', STATE_FPS[st] > 0 && STATE_FPS[st] <= 240, String(STATE_FPS[st]));
  }
}

// ---------- frameGate ----------
{
  const r = frameGate({ now: 1000, lastDraw: 0, fps: 30 });
  ok('第一次一定要画', r.draw === true, JSON.stringify(r));
  ok('第一次 dt 为 0（不推进物理）', r.dt === 0, String(r.dt));
}
{
  // 30fps -> 间隔 33.3ms
  const notYet = frameGate({ now: 1010, lastDraw: 1000, fps: 30 });
  ok('没到间隔就不画', notYet.draw === false, JSON.stringify(notYet));
  ok('不画时 dt 为 0', notYet.dt === 0, String(notYet.dt));
  const yes = frameGate({ now: 1040, lastDraw: 1000, fps: 30 });
  ok('到了间隔就画', yes.draw === true, JSON.stringify(yes));
  ok('画的时候 dt 是真实流逝时间', yes.dt === 40, String(yes.dt));
}
{
  // 10fps -> 100ms 一帧
  ok('10fps：50ms 不画', frameGate({ now: 1050, lastDraw: 1000, fps: 10 }).draw === false);
  ok('10fps：100ms 才画', frameGate({ now: 1100, lastDraw: 1000, fps: 10 }).draw === true);
}
{
  // 长时间没画（比如窗口被系统挂起）后回来应该立刻画，且 dt 反映真实间隔
  const r = frameGate({ now: 5000, lastDraw: 1000, fps: 30 });
  ok('长时间挂起后立刻画', r.draw === true, JSON.stringify(r));
  ok('dt 是真实间隔（不会丢时间）', r.dt === 4000, String(r.dt));
}
{
  // fps=0 属于非法值，应退回默认 30fps（间隔 ~33ms）。
  // 所以间隔 10ms 时**不该**画；等到 40ms 才画 —— 这才证明它没被当成 1fps。
  ok('fps=0 退回默认（10ms 不画）', frameGate({ now: 1000, lastDraw: 990, fps: 0 }).draw === false, 'fps0-short');
  ok('fps=0 退回默认（40ms 会画）', frameGate({ now: 1030, lastDraw: 990, fps: 0 }).draw === true, 'fps0-long');
  ok('now 缺失不崩', typeof frameGate({ lastDraw: 1000, fps: 30 }).draw === 'boolean');
  ok('lastDraw 缺失时直接画', frameGate({ now: 5, fps: 30 }).draw === true);
}

// ---------- applyThrottle ----------
{
  ok('开了省电：打瞌睡就是低速', applyThrottle({ enabled: true, state: 'doze' }) === STATE_FPS.doze);
  ok('关了省电：一律满帧', applyThrottle({ enabled: false, state: 'doze' }) === FULL_FPS, String(applyThrottle({ enabled: false, state: 'doze' })));
  ok('不传 enabled 默认按开启处理', applyThrottle({ state: 'doze' }) === STATE_FPS.doze);
  ok('关了省电也不能低于满帧（拖拽仍然跟手）', applyThrottle({ enabled: false, dragging: true }) === FULL_FPS);
}

// ---------- 守护：省电的收益要真的存在 ----------
{
  // 打瞌睡的帧率必须显著低于走路，否则这个功能没有意义
  ok('省电确实省（doze 明显低于 walk）', STATE_FPS.doze <= STATE_FPS.walk / 2,
    'doze=' + STATE_FPS.doze + ' walk=' + STATE_FPS.walk);
  // 但也要保证画面不至于卡（最低 10fps）
  ok('最低不低于 10fps（再低会觉得卡）', Math.min(...Object.values(STATE_FPS)) >= 10,
    String(Math.min(...Object.values(STATE_FPS))));
}
