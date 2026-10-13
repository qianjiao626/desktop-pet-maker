import { ok } from './_harness.mjs';
import { readFileSync } from 'node:fs';
import { PROMPT_EN, PROMPT_ZH, PROMPT_NEG, PROMPT_FIX, PROMPT_CHECKLIST, promptOf } from '../src/shared/aiprompt.js';

// ★ 守护：AI 素材提示词必须包含"让图能被识别"的关键要求。
//
// 背景：用户抱怨"内置小人太丑"，想用 AI 自己生成素材。
// 但制作器的身体识别是 MoveNet（真人照片训练），
// **随手画的大头 Q 版根本识别不出来**。实测（这台机器真跑的）：
//   · 写实比例 + 明暗 + 四肢张开 -> 16/17 点，合格
//   · 写实比例 + 纯色无明暗      -> 13/17
//   · 写实比例但四肢并拢        -> 8/17，被拒绝
//   · 扁平矢量小人（大头 Q 版） -> 9/17，躯干都认不出，被拒绝
// 所以提示词里**必须**有这几条，否则用户照着生成还是用不了。

{
  ok('英文提示词非空且够长', typeof PROMPT_EN === 'string' && PROMPT_EN.length > 120, String(PROMPT_EN.length));
  ok('中文提示词非空且够长', typeof PROMPT_ZH === 'string' && PROMPT_ZH.length > 60, String(PROMPT_ZH.length));
  ok('反向提示词非空', typeof PROMPT_NEG === 'string' && PROMPT_NEG.length > 60, String(PROMPT_NEG.length));
  ok('改图提示词非空', typeof PROMPT_FIX === 'string' && PROMPT_FIX.length > 40, String(PROMPT_FIX.length));
}

// ---------- 关键要求必须在英文提示词里（对应实测判据） ----------
{
  const must = [
    ['正面朝向', 'facing the camera'],
    ['全身入画', 'head to toe'],
    ['四肢张开（实测 16 vs 8 点，最要紧）', '45 degree angle'],
    ['腿分开（不能并拢）', 'legs slightly apart'],
    ['手张开不拿东西', 'hands open'],
    ['接近真人比例（不能大头 Q 版）', 'heads tall'],
    ['有光影体积（不是纯色块）', 'light and shadow'],
    ['干净背景', 'clean solid'],
    ['四周留白（手脚别被裁）', 'margin'],
  ];
  for (const [what, needle] of must) {
    ok('英文提示词包含：' + what, PROMPT_EN.toLowerCase().includes(needle.toLowerCase()), '缺少 ' + needle);
  }
}

// ---------- 反向提示词必须明确排除"会被拒绝"的画法 ----------
{
  const must = [
    ['大头 Q 版（实测 9/17）', 'chibi'],
    ['大头', 'big head'],
    ['手交叉/插兜（会让四肢粘连）', 'arms crossed'],
    ['手插兜', 'pockets'],
    ['腿并拢（实测 8/17）', 'legs together'],
    ['肢体重叠', 'overlapping limbs'],
    ['手脚被裁', 'cropped'],
    ['侧身/背面', 'side view'],
    ['杂乱背景', 'busy background'],
    ['地面阴影', 'shadow on ground'],
  ];
  for (const [what, needle] of must) {
    ok('反向提示词排除：' + what, PROMPT_NEG.toLowerCase().includes(needle.toLowerCase()), '缺少 ' + needle);
  }
}

// ---------- 中文提示词同样要覆盖关键点 ----------
{
  const must = [
    ['正面', '正面'],
    ['全身', '全身'],
    ['四肢张开', '张开'],
    ['腿分开', '分开'],
    ['手张开不拿东西', '不拿东西'],
    ['真人比例', '头身'],
    ['光影', '光影'],
    ['干净背景', '背景'],
    ['四周留白', '留白'],
  ];
  for (const [what, needle] of must) {
    ok('中文提示词包含：' + what, PROMPT_ZH.includes(needle), '缺少 ' + needle);
  }
}

// ---------- 自查清单要能独立判断（用户不用开工具） ----------
{
  ok('自查清单至少 6 条', PROMPT_CHECKLIST.length >= 6, String(PROMPT_CHECKLIST.length));
  const joined = PROMPT_CHECKLIST.join('|');
  for (const needle of ['脚底', '腋下', '腿', '手', '正面', '头身比', '光影', '背景']) {
    ok('自查清单覆盖：' + needle, joined.includes(needle), '缺少 ' + needle);
  }
}

// ---------- promptOf：取值正确、未知参数不抛 ----------
{
  ok("promptOf('en') 返回英文提示词", promptOf('en') === PROMPT_EN, 'en');
  ok("promptOf('zh') 返回中文提示词", promptOf('zh') === PROMPT_ZH, 'zh');
  ok("promptOf('neg') 返回反向提示词", promptOf('neg') === PROMPT_NEG, 'neg');
  ok("promptOf('fix') 返回改图提示词", promptOf('fix') === PROMPT_FIX, 'fix');
  ok('未知参数返回空串（不抛错）', promptOf('zzz') === '' && promptOf() === '' && promptOf(null) === '', 'unknown');
}

// ---------- 静态守护：UI 里有复制按钮，且接了剪贴板 ----------
{
  const html = readFileSync('src/maker/index.html', 'utf8');
  ok('身体识别面板有提示词折叠块', html.includes('ai-prompt'), 'details');
  for (const id of ['btnCopyPromptEn', 'btnCopyPromptZh', 'btnCopyPromptNeg', 'promptBox']) {
    ok('界面有 ' + id, html.includes('id="' + id + '"'), id);
  }
  const maker = readFileSync('src/maker/maker.js', 'utf8');
  ok('maker 导入了 aiprompt', maker.includes("from '../shared/aiprompt.js'"), 'import');
  ok('三个复制按钮都绑定了', (maker.match(/bind\('#btnCopyPrompt/g) || []).length === 3, 'binds');
  ok('用剪贴板复制', maker.includes('navigator.clipboard.writeText'), 'clipboard');
  ok('剪贴板失败时退化成"选中文本"（不让用户干瞪眼）',
    /selectNodeContents\(box\)/.test(maker), 'fallback');
  ok('初始化时会绑定提示词按钮', /bindAiPrompt\(\);/.test(maker), 'init');
}
