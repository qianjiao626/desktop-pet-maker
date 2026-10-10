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
