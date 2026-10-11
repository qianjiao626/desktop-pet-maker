import { ok } from './_harness.mjs';
import { helpText } from '../src/shared/help.js';

// 使用说明是用户点「使用说明」时看到的唯一文档。
// 它的风险是"悄悄过时" —— 所以这里锁住"必须提到每一类能力"。
{
  const t = helpText();
  ok('是字符串且够长', typeof t === 'string' && t.length > 500, String(t.length));
  ok('不提 EPSE/DSML 之类标签', !/EPSE|DSML/.test(t), 'tag');
}
{
  const t = helpText();
  const must = [
    ['拖入图片', '拖入'],
    ['抠图', '抠图'],
    ['GIF 拆帧', 'GIF'],
    ['生成动画', '生成动画'],
    ['桌面预览', '桌面预览'],
    ['导出宠物包', '导出桌宠包'],
    ['角色工坊（没素材也能做）', '工坊'],
    ['宠物库', '宠物库'],
    ['多宠物同屏', '多选'],
    ['宠物对话', '说话'],
    ['性格口吻', '性格'],
    ['分组', '标签'],
    ['分享页', '分享页'],
    ['在线分享站', '在线分享站'],
    ['省电模式', '省电'],
    ['停止桌宠的三种方式', '退出桌宠'],
    ['全局快捷键 Ctrl+Alt+Q', 'Ctrl+Alt+Q'],
    ['找回宠物的快捷键', 'Ctrl+Alt+R'],
    ['键盘快捷键：切帧', '下一帧'],
    ['键盘快捷键：播放', '播放'],
    ['撤销', '撤销'],
  ];
  for (const [what, needle] of must) {
    ok('说明里提到了：' + what, t.includes(needle), '缺少关键字 ' + needle);
  }
}
{
  // 不能出现明显过时的说法（曾经写过「未接入对话」之类）
  const t = helpText();
  ok('没有"未接入对话"这种过时说法', !t.includes('未接入'), 'stale');
  // 步骤编号要连得上（1..5 都存在）
  for (const n of ['1.', '2.', '3.', '4.', '5.']) {
    ok('步骤 ' + n + ' 在', t.includes(n + ' '), n);
  }
}
