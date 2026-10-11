import { ok } from './_harness.mjs';
import { scanDeadCode, findDeadFunctions } from '../scripts/scan-dead-code.mjs';

// 死代码扫描：找「定义了但没被调用」的函数。
// 这类东西不报错、不耗时，但会误导后来的人（以为某条路在用）。
// 见 HANDOFF 第 130 条：v0.9.28 用它清掉了 limbrender.js 里的 samplePremul。
{
  const r = scanDeadCode();
  ok('扫描返回数组', Array.isArray(r), typeof r);
  // 现在应该是干净的；如果以后加了死代码，这条会提醒
  const flat = r.flatMap((x) => x.dead.map((d) => x.file + ':' + d));
  ok('当前没有死函数', r.length === 0, flat.join(', '));
}
{
  // 扫描器本身要能认出"定义了但没调用"的情况
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const dir = mkdtempSync(nodePath.join(os.tmpdir(), 'deadscan-'));
  const f = nodePath.join(dir, 'x.js');
  writeFileSync(f, 'function used() { return 1; }\nfunction dead() { return 2; }\nused();\n', 'utf8');
  const dead = findDeadFunctions(f);
  ok('能认出没调用的那个', dead.includes('dead'), JSON.stringify(dead));
  ok('不会把被调用的算成死代码', !dead.includes('used'), JSON.stringify(dead));
  writeFileSync(f, 'export function api() { return 1; }\n', 'utf8');
  ok('导出的函数不算死代码（外部会用）', findDeadFunctions(f).length === 0, JSON.stringify(findDeadFunctions(f)));
  rmSync(dir, { recursive: true, force: true });
}
