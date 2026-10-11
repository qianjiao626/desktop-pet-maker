import { ok } from './_harness.mjs';
import {
  esc, slugify, assignSlugs, buildSiteIndex, buildManifest, buildReadme, planSiteFiles,
} from '../src/shared/sharesite.js';

// ---------- esc：用户内容必须转义，否则名字里带 < 会把页面搞坏 ----------
{
  ok('转义尖括号', esc('<img onerror=x>') === '&lt;img onerror=x&gt;', esc('<img onerror=x>'));
  ok('转义引号', esc('a"b\'c') === 'a&quot;b&#39;c', esc('a"b\'c'));
  ok('转义 &', esc('a&b') === 'a&amp;b', esc('a&b'));
  ok('null 变空串', esc(null) === '', '[' + esc(null) + ']');
}

// ---------- slugify：稳定 + 安全 ----------
{
  ok('英文小写', slugify('My Pet') === 'my-pet', slugify('My Pet'));
  ok('中文保留', slugify('小蓝机器人') === '小蓝机器人', slugify('小蓝机器人'));
  ok('空格变连字符', slugify('a  b') === 'a-b', slugify('a  b'));
  ok('路径分隔符被清掉', !slugify('a/b\\c:d').includes('/'), slugify('a/b\\c:d'));
  ok('不留下前导连字符', !slugify('  --x').startsWith('-'), slugify('  --x'));
  ok('表情符号被清掉', slugify('cat🐱dog') === 'cat-dog', slugify('cat🐱dog'));
  ok('空名有兜底', slugify('') === 'pet', slugify(''));
  ok('超长被截断', Array.from(slugify('a'.repeat(80))).length <= 40, String(Array.from(slugify('a'.repeat(80))).length));
  ok('同一输入结果稳定', slugify('小蓝机器人') === slugify('小蓝机器人'));
}

// ---------- assignSlugs：重名必须去重，否则静默互相覆盖 ----------
{
  const r = assignSlugs([{ id: 'a', name: '小猫' }, { id: 'b', name: '小猫' }, { id: 'c', name: '小猫' }]);
  ok('三只同名得到不同 slug', new Set(r.map(x => x.slug)).size === 3, JSON.stringify(r.map(x => x.slug)));
  ok('第一个不加后缀', r[0].slug === '小猫', r[0].slug);
  ok('第二个加 -2', r[1].slug === '小猫-2', r[1].slug);
  ok('文件名前缀 pet-', r[0].fileName === 'pet-小猫.html', r[0].fileName);
  ok('空数组不炸', assignSlugs([]).length === 0);
  ok('非数组不炸', assignSlugs(null).length === 0);
}
{
  // 名字本身带 "-2" 时也不能和去重后缀撞车
  const r = assignSlugs([{ name: 'x' }, { name: 'x' }, { name: 'x-2' }]);
  ok('后缀与真实名字不撞车', new Set(r.map(x => x.slug)).size === 3, JSON.stringify(r.map(x => x.slug)));
}

// ---------- buildSiteIndex ----------
{
  const html = buildSiteIndex([
    { name: '小蓝机器人', file: 'pet-小蓝机器人.html', author: '阿梁', frames: 12, thumb: 'data:image/png;base64,AA' },
    { name: '橘猫', file: 'pet-橘猫.html', author: '', frames: 3 },
  ]);
  ok('是完整 HTML 文档', html.startsWith('<!DOCTYPE html>'), html.slice(0, 20));
  ok('含每只宠物的链接', html.includes('href="pet-小蓝机器人.html"') && html.includes('href="pet-橘猫.html"'));
  ok('含宠物名', html.includes('小蓝机器人') && html.includes('橘猫'));
  ok('含作者', html.includes('作者：阿梁'));
  ok('含帧数', html.includes('12 帧'));
  ok('有搜索框', html.includes('id="q"'));
  ok('带 CSP，禁止外部脚本', html.includes("Content-Security-Policy") && html.includes("default-src 'none'"), 'csp');
  ok('缩略图内嵌', html.includes('src="data:image/png;base64,AA"'));
  ok('没有缩略图时不放 img', !/pet-橘猫\.html[\s\S]{0,120}<img/.test(html) || !html.includes('alt="橘猫" src'), 'ok');
  ok('计数正确', html.includes('>2</b>'), '2');
}
{
  const empty = buildSiteIndex([]);
  ok('空站点不炸且有提示', empty.includes('还没有桌宠'), 'empty');
  ok('空站点也计数 0', empty.includes('>0</b>'));
}
{
  // XSS：宠物名里的脚本必须被转义
  const bad = buildSiteIndex([{ name: '<script>alert(1)</script>', file: 'pet-x.html' }]);
  ok('名字里的脚本标签被转义', !bad.includes('<script>alert(1)</script>'), 'escaped');
  ok('转义后仍可读', bad.includes('&lt;script&gt;'), 'escaped');
}
{
  // href 里的引号逃逸也不能突破属性
  const bad = buildSiteIndex([{ name: 'x', file: 'a"onmouseover="alert(1)' }]);
  ok('file 里的引号被转义', !bad.includes('a"onmouseover="alert(1)'), 'attr');
}

// ---------- buildManifest ----------
{
  const m = JSON.parse(buildManifest([{ name: '小猫', file: 'pet-小猫.html', author: 'me', frames: 5 }], { generatedAt: '2026-01-01T00:00:00.000Z' }));
  ok('带格式标识', m.format === 'desktop-pet-maker/share-site@1', m.format);
  ok('带固定时间', m.generatedAt === '2026-01-01T00:00:00.000Z', m.generatedAt);
  ok('count 正确', m.count === 1, String(m.count));
  ok('宠物字段完整', m.pets[0].name === '小猫' && m.pets[0].file === 'pet-小猫.html' && m.pets[0].frames === 5);
  ok('可被 JSON 解析', typeof m === 'object');
}
{
  const m = JSON.parse(buildManifest(null));
  ok('null 退化为空清单', m.count === 0 && Array.isArray(m.pets) && m.pets.length === 0);
}

// ---------- buildReadme ----------
{
  const r = buildReadme([{ name: 'a' }, { name: 'b' }]);
  ok('说明里带数量', r.includes('2 只桌宠'), r.split('\n')[2]);
  ok('给了 GitHub Pages 步骤', r.includes('GitHub Pages'));
  ok('给了本地打开方式', r.includes('双击 index.html'));
  ok('列了文件说明', r.includes('manifest.json'));
}

// ---------- planSiteFiles ----------
{
  const pets = [
    { name: '小猫', file: 'pet-小猫.html' },
    { name: '小狗', file: 'pet-小狗.html' },
  ];
  const pages = { 'pet-小猫.html': '<html>cat</html>', 'pet-小狗.html': '<html>dog</html>' };
  const files = planSiteFiles(pets, pages, { siteName: '测试站' });
  const names = files.map(f => f.name);
  ok('包含 index.html', names.includes('index.html'), names.join(','));
  ok('包含 manifest.json', names.includes('manifest.json'));
  ok('包含 README.txt', names.includes('README.txt'));
  ok('包含中文发布指南', names.includes('发布到网上.md'), names.join(','));
  ok('包含每只宠物的页面', names.includes('pet-小猫.html') && names.includes('pet-小狗.html'));
  ok('文件总数 = 4 + 宠物数', files.length === 6, String(files.length));
  ok('页面内容原样带出', files.find(f => f.name === 'pet-小猫.html').data === '<html>cat</html>');
  ok('站点名生效', files.find(f => f.name === 'index.html').data.includes('测试站'));
}
{
  // 缺页面的宠物不应产出空文件（否则站上出现白页）
  const files = planSiteFiles([{ name: 'x', file: 'pet-x.html' }], {});
  ok('缺页面时跳过该页', !files.some(f => f.name === 'pet-x.html'), files.map(f => f.name).join(','));
  ok('但 index/manifest/readme/指南 仍在', files.length === 4, String(files.length));
}

// ---------- 站点文件不能互相覆盖 ----------
{
  const items = assignSlugs([{ id: '1', name: '同名' }, { id: '2', name: '同名' }]);
  const files = planSiteFiles(
    items.map(x => ({ name: x.name, file: x.fileName })),
    Object.fromEntries(items.map(x => [x.fileName, '<html></html>']))
  );
  ok('生成的站点文件无重名', new Set(files.map(f => f.name)).size === files.length, files.map(f => f.name).join(','));
}
