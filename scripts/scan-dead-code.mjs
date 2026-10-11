// 扫描「定义了但从没被调用」的函数（同一文件内）。
//
// 为什么需要（v0.9.28）：
//   之前发现的「记住上次位置」是"通道暴露了但没人调用"。
//   同一类问题还有另一种形态：**函数定义了但从没被调用**（死代码）。
//   它们不报错、不占运行时间，但会误导后来的人（以为某条路在用）。
//
// 用法：node scripts/scan-dead-code.mjs
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
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** 找出 file 里「定义了但只出现一次」的函数（排除 export 的，导出的可能被别处用） */
export function findDeadFunctions(file) {
  const t = fs.readFileSync(file, "utf8");
  const out = [];
  for (const m of t.matchAll(/^(\s*)(?:async\s+)?function\s+([A-Za-z_]\w*)/gm)) {
    const indent = m[1] || "";
    const name = m[2];
    // 缩进的函数多是内部的辅助函数，也可能被上层用；一律按引用次数判断
    const cnt = (t.match(new RegExp("\\b" + name + "\\b", "g")) || []).length;
    if (cnt <= 1) out.push(name);
  }
  // 导出的函数即使本文件没调用也不算死（外部会用）
  const exported = new Set();
  for (const m of t.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/g)) exported.add(m[1]);
  return out.filter((n) => !exported.has(n));
}

/** 扫描 src 下所有 js */
export function scanDeadCode(root = ROOT) {
  const result = [];
  for (const f of walk(path.join(root, "src"))) {
    const dead = findDeadFunctions(f);
    if (dead.length) result.push({ file: path.relative(root, f).replace(/\\/g, "/"), dead });
  }
  return result;
}

if (process.argv[1] && process.argv[1].endsWith("scan-dead-code.mjs")) {
  const r = scanDeadCode();
  if (!r.length) {
    console.log("没有发现死函数（每个定义的函数都至少被调用一次）");
  } else {
    console.log("发现 " + r.length + " 个文件里有定义但没调用的函数：");
    for (const x of r) console.log("  " + x.file + ": " + x.dead.join(", "));
  }
}
