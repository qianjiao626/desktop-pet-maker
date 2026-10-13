import { ok } from './_harness.mjs';
import { escapeHtml, safeJsonForScript, shareFileName, buildShareHtml } from '../src/shared/sharepack.js';

// ---------- 转义：用户可控内容不能破坏页面 ----------
ok('escapeHtml 处理尖括号', escapeHtml('<img src=x onerror=alert(1)>').includes('&lt;img'));
ok('escapeHtml 处理引号', escapeHtml('a"b\'c').includes('&quot;') && escapeHtml('a"b\'c').includes('&#39;'));
ok('escapeHtml 处理 &', escapeHtml('a&b') === 'a&amp;b');
ok('escapeHtml null 安全', escapeHtml(null) === '');

// ---------- 关键：内嵌 JSON 不能提前闭合 </script> ----------
{
  const j = safeJsonForScript({ x: '</script><script>alert(1)</script>' });
  ok('safeJsonForScript 不含裸 </', !j.includes('</'), j.slice(0, 60));
  ok('safeJsonForScript 不含裸 <', !j.includes('<'));
  ok('safeJsonForScript 仍可反序列化回原值',
    JSON.parse(j).x === '</script><script>alert(1)</script>', 'roundtrip');
  ok('safeJsonForScript 处理 U+2028', !safeJsonForScript({ x: 'a\u2028b' }).includes('\u2028'));
}

// ---------- 文件名 ----------
ok('shareFileName 加 _share.html 后缀', shareFileName('小黄龙') === '小黄龙_share.html', shareFileName('小黄龙'));
ok('shareFileName 替换非法字符', shareFileName('a/b:c').includes('_'));
ok('shareFileName 空名兜底', shareFileName('') === 'pet_share.html');
ok('shareFileName 限长', Array.from(shareFileName('龙'.repeat(200)).replace('_share.html', '')).length <= 60);
ok('shareFileName 去首尾点', !shareFileName('...a...').startsWith('.'));

// ---------- 生成的 HTML ----------
const pack = {
  name: '小<黄>龙', author: '作者 & 我', bubble: { enabled: true, lines: ['你好呀', '点我一下'] },
  frames: [{ file: 'f0.png', durationMs: 100 }],
};
const frames = [
  { file: 'f0.png', dataUrl: 'data:image/png;base64,AAA', durationMs: 100 },
  { file: 'f1.png', dataUrl: 'data:image/png;base64,BBB', durationMs: 250 },
];
const html = buildShareHtml(pack, frames, { petpackBase64: 'UEsDBA==', petpackName: '小黄龙.petpack' });

ok('HTML 有 doctype', html.startsWith('<!DOCTYPE html>'));
ok('HTML 是完整文档', html.includes('<html') && html.includes('</html>'));
ok('宠物名被转义（不注入标签）', html.includes('小&lt;黄&gt;龙') && !html.includes('<黄>'));
ok('作者被安全编码（& 不裸奔）', html.includes('作者 \\u0026 我') && !html.includes('作者 & 我'), 'author json');
ok('两帧的 dataURL 都内嵌了', html.includes('base64,AAA') && html.includes('base64,BBB'));
ok('每帧延迟带上了', html.includes('"ms":100') && html.includes('"ms":250'));
ok('台词带上了', html.includes('点我一下'));
ok('内嵌了 petpack base64（拖回制作器可还原）', html.includes('"petpack":"UEsDBA=="'));
ok('没有外链资源（真·零依赖）', !/src\s*=\s*"https?:/i.test(html) && !/href\s*=\s*"https?:/i.test(html));
ok('没有裸 </script> 注入点', html.split('</script>').length === 2, 'script tags=' + (html.split('</script>').length - 1));
ok('空 frames 安全', buildShareHtml({ name: 'x' }, [], {}).includes('<!DOCTYPE html>'));
ok('null frames 安全', typeof buildShareHtml({ name: 'x' }, null, {}) === 'string');
ok('气泡关闭时不带台词行为标记', buildShareHtml({ name: 'x', bubble: { enabled: false, lines: ['a'] } }, frames, {}).includes('"bubble":false'));

// ============ 多动作片段也要带进分享页（v0.9.44）============
// 背景：分享页此前只播主帧 —— 作者在工坊存了好几段舞步，
// 分享出去别人**看不到跳舞**，只看到"一直在呼吸"。这是真缺口。
// 规则：老分享页（没有 clips）行为必须完全不变（向后兼容）。
{
  const pack = { name: '跳舞的小人', author: '小明', bubble: { enabled: true, lines: ['嗨'] } };
  const frames = [
    { dataUrl: 'data:image/png;base64,AA', durationMs: 100 },
    { dataUrl: 'data:image/png;base64,BB', durationMs: 100 },
  ];
  const clips = [
    { id: 'c1', name: '狂欢', weight: 1, frames: [{ dataUrl: 'data:image/png;base64,CC', durationMs: 90 }] },
    { id: 'c2', name: '招手', weight: 1, frames: [{ dataUrl: 'data:image/png;base64,DD', durationMs: 90 }, { dataUrl: 'data:image/png;base64,EE', durationMs: 90 }] },
  ];
  const html = buildShareHtml(pack, frames, { clips });
  ok('分享页里带上了片段数据', html.includes('CC') && html.includes('DD') && html.includes('EE'), 'clips-in-html');
  ok('分享页运行时有多片段切换逻辑', html.includes('pickClip') && html.includes('nextSwapAt'), 'swap-logic');
  ok('片段名也带过去了（便于以后显示）', html.includes('狂欢') || html.includes('招手'), 'names');
}

// ---------- 没有片段时：行为与老版本一致 ----------
{
  const pack = { name: '普通宠物', bubble: { enabled: false, lines: [] } };
  const frames = [{ dataUrl: 'data:image/png;base64,AA', durationMs: 100 }];
  const html = buildShareHtml(pack, frames, {});
  ok('没有片段时不报错、照常出页面', html.includes('<!DOCTYPE html>'), 'ok');
  ok('没有片段时 clips 是空数组（不会凭空造片段）', /"clips":\[\]/.test(html), 'empty');
}

// ---------- 容错：脏片段数据不能让分享页崩 ----------
{
  const pack = { name: 'x', bubble: { enabled: false, lines: [] } };
  const frames = [{ dataUrl: 'data:image/png;base64,AA', durationMs: 100 }];
  const dirty = [
    null,
    { id: 'a' },                                   // 没有 frames
    { id: 'b', frames: [] },                       // 空 frames
    { id: 'c', frames: [{ durationMs: 90 }] },     // 帧没有 dataUrl
    { id: 'd', frames: [{ dataUrl: 'data:image/png;base64,ZZ', durationMs: 0 }], weight: -5 },
  ];
  let html = '';
  let threw = false;
  try { html = buildShareHtml(pack, frames, { clips: dirty }); } catch (e) { threw = true; }
  ok('脏片段数据不抛异常', !threw, 'no-throw');
  ok('脏片段被过滤掉（只留下真正可用的）', !html.includes('"id":"a"') && !html.includes('"id":"b"') && !html.includes('"id":"c"'), 'filtered');
  ok('唯一可用片段被保留', html.includes('"id":"d"'), 'kept-d');
  ok('负权重被修正为正数（否则选取会退化）', /"weight":1/.test(html) || /"weight":0\.01/.test(html), 'weight');
}

// ============ 分享页要能让人把宠物「拿走」（v0.9.52）============
// 背景：分享页一直内嵌着 .petpack，但**接收方在浏览器里没有下载入口** ——
// 只能"把 HTML 拖进桌宠制作器"，可对方不一定装了制作器、也不知道能这么拖。
// 现在给一个明确的「保存宠物包」按钮，才算真的能拿走。
{
  const pack = { name: '拿得走的宠物', author: '小明', bubble: { enabled: false, lines: [] } };
  const frames = [{ dataUrl: 'data:image/png;base64,AA', durationMs: 100 }];
  const html = buildShareHtml(pack, frames, { petpackBase64: 'UEsDBAoAAAAAAA==', petpackName: '拿得走的宠物.petpack' });
  ok('分享页有「保存宠物包」按钮', html.includes('id="savePack"'), 'button');
  ok('按钮文案说明了用途', /保存宠物包/.test(html), 'copy');
  ok('按钮默认隐藏（没有内嵌包时不该出现）', /id="savePack"[^>]*hidden/.test(html), 'hidden-default');
  ok('有内嵌包时会把按钮显示出来', /if \(!DATA\.petpack\) return;/.test(html) && /btn\.hidden = false/.test(html), 'show');
  ok('点击后把 base64 还原成文件下载', /atob\(DATA\.petpack\)/.test(html) && /a\.download =/.test(html), 'download');
  ok('下载文件名用包名', /DATA\.petpackName \|\|/.test(html), 'filename');
  ok('用完释放 blob URL（不泄漏内存）', /URL\.revokeObjectURL/.test(html), 'revoke');
  ok('失败时给出可操作的提示（而不是静默）', /保存失败，请把这个 HTML 拖进桌宠制作器/.test(html), 'fallback');
}

// ---------- 老分享页（没有内嵌包）行为不变 ----------
{
  const pack = { name: 'x', bubble: { enabled: false, lines: [] } };
  const frames = [{ dataUrl: 'data:image/png;base64,AA', durationMs: 100 }];
  const html = buildShareHtml(pack, frames, {});
  ok('没有内嵌包时按钮仍然隐藏（不会点了没反应）', /id="savePack"[^>]*hidden/.test(html), 'hidden');
  ok('没有内嵌包时页面照常可用', html.includes('<!DOCTYPE html>'), 'ok');
}
