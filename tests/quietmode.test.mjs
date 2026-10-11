import { ok } from './_harness.mjs';
import { moveMenuLabel, muteMenuLabel, quietMenuItems, quietEffect } from '../src/shared/quietmode.js';

// 用户在专心工作时，常想让宠物"别动/别吵"但又不想关掉它。
// 菜单项文案必须反映**当前状态**，否则用户不知道自己现在是暂停还是继续。
{
  ok('未暂停时提示可以暂停', moveMenuLabel(false).includes('暂停'), moveMenuLabel(false));
  ok('已暂停时提示可以继续', moveMenuLabel(true).includes('继续'), moveMenuLabel(true));
  ok('两种文案不一样', moveMenuLabel(false) !== moveMenuLabel(true), 'diff');
  ok('未静音时提示可以静音', muteMenuLabel(false).includes('静音'), muteMenuLabel(false));
  ok('已静音时提示可以打开', muteMenuLabel(true).includes('打开'), muteMenuLabel(true));
}
{
  // 参数缺失要有合理默认（不能因为 undefined 就显示奇怪的状态）
  ok('undefined 视为未暂停', moveMenuLabel(undefined).includes('暂停'), moveMenuLabel(undefined));
  ok('undefined 视为未静音', muteMenuLabel(undefined).includes('静音'), muteMenuLabel(undefined));
}
{
  const items = quietMenuItems({ moving: true, bubbleOn: true });
  ok('给出两项', items.length === 2, String(items.length));
  ok('第一项是走动开关', items[0].act === 'toggleMove', JSON.stringify(items[0]));
  ok('第二项是静音开关', items[1].act === 'toggleMute', JSON.stringify(items[1]));
  ok('走动项初始是"暂停"', items[0].label.includes('暂停'), items[0].label);
  ok('静音项初始是"静音"', items[1].label.includes('静音'), items[1].label);
}
{
  const items = quietMenuItems({ moving: false, bubbleOn: false });
  ok('已暂停时文案变成"继续"', items[0].label.includes('继续'), items[0].label);
  ok('已静音时文案变成"打开"', items[1].label.includes('打开'), items[1].label);
  ok('状态字段也带上了', items[0].paused === true && items[1].muted === true, JSON.stringify(items));
}
{
  const a = quietEffect({ paused: true, muted: true });
  ok('暂停 -> 停止走动', a.stopWalking === true);
  ok('静音 -> 抑制气泡', a.suppressBubble === true);
  const b = quietEffect({ paused: false, muted: false });
  ok('都不开时都不生效', b.stopWalking === false && b.suppressBubble === false, JSON.stringify(b));
  const c = quietEffect({ paused: true });
  ok('只暂停时不影响气泡', c.stopWalking === true && c.suppressBubble === false, JSON.stringify(c));
  const d = quietEffect({ muted: true });
  ok('只静音时不影响走动', d.stopWalking === false && d.suppressBubble === true, JSON.stringify(d));
  const e = quietEffect({});
  ok('空参数不崩且都不生效', e.stopWalking === false && e.suppressBubble === false, JSON.stringify(e));
}
