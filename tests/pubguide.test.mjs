import { ok } from './_harness.mjs';
import { buildGuide } from '../src/shared/pubguide.js';

// 发布指南必须是"真的能照着做"的，不能是空壳
{
  const g = buildGuide('我的桌宠广场');
  ok('带站点名', g.includes('我的桌宠广场'), 'name');
  ok('是 Markdown', g.includes('# ') && g.includes('---'), 'md');
  ok('给了网页手动上传的完整步骤', g.includes('New repository') && g.includes('Pages') && g.includes('Commit changes'), 'manual');
  ok('给了托管平台选项', g.includes('Netlify') && g.includes('Cloudflare') && g.includes('Vercel'), 'hosts');
  ok('给了局域网方案', g.includes('npx') && g.includes('同一 WiFi'), 'lan');
  ok('说明了要不要联网', g.includes('联网'), 'net');
  ok('说明了不花钱', g.includes('免费'), 'free');
  ok('有 FAQ 段', g.includes('常见问题'), 'faq');
  ok('说明了隐私（不收集信息）', g.includes('不会'), 'privacy');
  ok('给出了访问网址的格式', g.includes('github.io'), 'url');
}
{
  const d = buildGuide();
  ok('不传站点名也有默认值', d.includes('我的桌宠广场'), 'default');
}
{
  // 指南里不能出现"本地绝对路径"这种泄漏本机信息的东西
  const g = buildGuide('x');
  ok('不含 Windows 盘符路径', !/[A-Za-z]:\\\\/.test(g), 'nopath');
  ok('不含用户目录', !g.includes('Users\\\\') && !g.includes('/home/'), 'nohome');
}
{
  const a = buildGuide('甲');
  const b = buildGuide('乙');
  ok('不同站点名生成不同指南', a !== b, 'diff');
  ok('指南长度足够（不是占位符）', a.length > 800, String(a.length));
}
