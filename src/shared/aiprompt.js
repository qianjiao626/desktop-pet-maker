// 给 AI 生成「标准立绘」的提示词（纯数据，可单测）。
//
// 为什么放在工具里而不是只写文档：
//   用户最需要这条指引的时刻，就是**素材识别失败**的那一刻。
//   让他去翻文档、再去复制，多半就放弃了 —— 直接内嵌到「身体识别」面板里最实用。
//
// 提示词里的每条要求都对应制作器里的一个**硬性判据**，
// 并且是我们在这台机器上**实测**过的（见 tests/aiprompt.test.mjs）：
//   · 写实比例 + 明暗 + 四肢张开 -> 识别 16/17 点，素材检查合格
//   · 写实比例 + 纯色无明暗      -> 13/17
//   · 写实比例但四肢并拢        -> 8/17，被拒绝
//   · 扁平矢量小人（大头 Q 版） -> 9/17，躯干都认不出，被拒绝

/** 英文正向提示词（多数 AI 模型对英文更敏感） */
export const PROMPT_EN = [
  'full body character reference sheet, standing straight facing the camera,',
  'T-pose with arms extended out to the sides at a 45 degree angle,',
  'legs slightly apart, feet visible, hands open and empty,',
  'entire body visible from head to toe, centered, generous empty margin around the figure,',
  'realistic human body proportions, 7 to 7.5 heads tall,',
  'soft cel shading with clear light and shadow, volume and form,',
  'clean solid light gray background, no props, no background objects,',
  'flat even lighting, sharp clean edges, high resolution, 2D game character art',
].join(' ');

/** 英文反向提示词（有 Negative prompt 栏就填） */
export const PROMPT_NEG = [
  'chibi, super deformed, big head, tiny body, oversized eyes,',
  'arms crossed, hands in pockets, hands behind back, holding objects,',
  'legs together, legs crossed, overlapping limbs, cropped feet, cropped hands,',
  'side view, three-quarter view, back view, tilted body, sitting, jumping,',
  'busy background, scenery, shadow on ground, motion blur, low resolution',
].join(' ');

/** 中文正向提示词（即梦 / 文心 / 通义等） */
export const PROMPT_ZH = [
  '全身角色立绘，正面站直面向镜头，',
  '双臂向斜下方张开约 45 度，双腿微微分开，',
  '双手张开不拿东西，手脚完整不遮挡，',
  '从头顶到脚底完整入画，居中，四周留白，',
  '接近真人的身体比例（约 7 头身），',
  '柔和的赛璐璐上色，有明确的光影和体积感，',
  '干净的纯浅灰背景，没有任何道具和场景，',
  '光线均匀，边缘清晰，高分辨率，2D 游戏角色立绘',
].join('');

/** 生成后自查清单（用户不用打开制作器就能判断） */
export const PROMPT_CHECKLIST = [
  '头顶到脚底都在画面里，四周有空白',
  '双臂明显离开身体（能看到腋下的空隙）',
  '双腿明显分开（能看到两腿之间的空隙）',
  '手是张开的，没拿东西、没插兜、没抱胸',
  '整个人正面朝镜头，身体没有侧转、没有倾斜',
  '头身比在 1:6 ~ 1:8 之间（不要大头娃娃）',
  '有光影（不是纯色块）',
  '背景干净（纯色或简单渐变），没有地面阴影',
];

/** 生成得不够好时的"改图"提示词（比重新生成更省事） */
export const PROMPT_FIX = [
  '把这张图改成：全身正面站姿，双臂向斜下方张开 45 度，',
  '双腿分开，双手张开不拿东西，完整入画四周留白，',
  '接近真人比例，干净的纯色背景，去掉地面阴影',
].join('');

/**
 * 拿一段提示词（给界面用）。
 * @param which 'en' | 'zh' | 'neg' | 'fix'
 * @returns 提示词字符串；未知参数返回空串（不抛错）
 */
export function promptOf(which) {
  if (which === 'en') return PROMPT_EN;
  if (which === 'zh') return PROMPT_ZH;
  if (which === 'neg') return PROMPT_NEG;
  if (which === 'fix') return PROMPT_FIX;
  return '';
}
