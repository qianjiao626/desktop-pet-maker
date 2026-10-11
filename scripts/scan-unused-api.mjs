// 扫描「preload 暴露了、但渲染进程从没调用」的接口。
//
// 为什么需要（v0.9.27 的真实收获）：
//   「记住上次位置」坏了很久 —— 通道在 preload 里暴露了、主进程也注册了监听，
//   但**没有任何调用方**，功能等于没生效。这类 bug 不报错、不崩溃，只表现为"点了没用"。
//   定期跑一次这个对比，成本极低，能直接找出漏接的功能。
//
// 用法：node scripts/scan-unused-api.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|html)$/.test(name)) out.push(full);
  }
  return out;
}

export function scanUnusedApi(root = ROOT) {
  const preload = fs.readFileSync(path.join(root, "src", "preload", "preload.cjs"), "utf8");
  const names = new Set();
  for (const m of preload.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):/gm)) names.add(m[1]);
  const used = new Set();
  for (const f of walk(path.join(root, "src"))) {
    const t = fs.readFileSync(f, "utf8");
    for (const m of t.matchAll(/\bapi\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
  }
  const unused = [...names].filter((n) => !used.has(n)).sort();
  return { total: names.size, unused };
}

if (process.argv[1] && process.argv[1].endsWith("scan-unused-api.mjs")) {
  const r = scanUnusedApi();
  console.log("preload 暴露 " + r.total + " 个接口，其中 " + r.unused.length + " 个没有调用方：");
  for (const n of r.unused) console.log("  - " + n);
  console.log("");
  console.log("说明：这里面可能有预留接口（无害），但每个都值得确认一次 ——");
  console.log("「暴露了」不等于「接上了」，漏接的功能会表现为「点了没反应」。");
}
