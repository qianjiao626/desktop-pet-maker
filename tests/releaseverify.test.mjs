import { ok } from './_harness.mjs';
import { readFileSync, existsSync } from 'node:fs';

// 发布校验脚本的守护：它是防止"假发布"的唯一手段（见 HANDOFF 第 112 条），
// 所以必须有测试盯着它别被删掉或改坏。
{
  const p = 'scripts/verify-release.mjs';
  ok('发布校验脚本存在', existsSync(p), p);
  if (existsSync(p)) {
    const src = readFileSync(p, 'utf8');
    ok('会下载附件（而不是只比元数据）', src.includes('browser_download_url') && src.includes('arrayBuffer'), 'download');
    ok('会算 SHA256', src.includes('sha256'), 'hash');
    ok('会检查 zip 魔数', src.includes('magic') && src.includes('toString("hex")'), 'magic');
    ok('会拒绝明显是错误页的响应（<1024 字节）', src.includes('< 1024'), 'guard');
    ok('失败时以非 0 退出', src.includes('process.exit(ok === assets.length'), 'exit');
    ok('支持指定 tag（也支持默认读 package.json）', src.includes('process.argv[2]') && src.includes('package.json'), 'tag');
  }
}

// 发布流程文档里必须提到"要真的下载验证"
{
  const h = readFileSync('HANDOFF.md', 'utf8');
  ok('HANDOFF 记录了「尺寸对不等于内容对」这个坑', h.includes('尺寸对') && h.includes('不等于'), 'handoff');
  ok('HANDOFF 提到必须真的下载附件核对', /必须真的下载/.test(h), 'handoff-download');
}
