// Release 附件完整校验：下载回来逐字节核对。
//
// 为什么要有这个脚本（v0.9.24 的真实事故）：
//   上传被中断后补传，脚本看到附件名已存在就跳过了；
//   后面的核对只比了 API 报的 size（151138575 == 本地），
//   但实际下载回来只有 9 个字节（一个错误页）。
//   **"尺寸对"不等于"内容对"** —— 只有真的下回来算 SHA256 才算验证。
//
// 用法：
//   node scripts/verify-release.mjs v0.9.24
//   node scripts/verify-release.mjs            # 默认读 package.json 的版本
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OWNER = "qianjiao626";
const REPO = "desktop-pet-maker";

function token() {
  const out = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n\n" }).toString();
  const m = out.match(/^password=(.+)$/m);
  return m ? m[1].trim() : "";
}

async function main() {
  const arg = process.argv[2];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const tag = arg || ("v" + pkg.version);
  const tok = token();
  if (!tok) { console.log("没有拿到 GitHub 凭据"); process.exit(1); }
  const H = { Authorization: "token " + tok, "User-Agent": "codex", Accept: "application/vnd.github+json" };
  const base = "https://api.github.com/repos/" + OWNER + "/" + REPO;

  const relRes = await fetch(base + "/releases/tags/" + tag, { headers: H });
  const rel = await relRes.json();
  if (relRes.status !== 200) { console.log("找不到 Release " + tag + "：" + (rel && rel.message)); process.exit(1); }
  const assets = await (await fetch(base + "/releases/" + rel.id + "/assets", { headers: H })).json();

  console.log("Release: " + rel.name);
  console.log("body 首行含 tag: " + String(rel.body).startsWith("## " + tag));
  console.log("附件数: " + assets.length);

  let ok = 0;
  for (const a of assets) {
    const localPath = path.join(ROOT, "dist", a.name);
    if (!fs.existsSync(localPath)) { console.log("  " + a.name + " -> 本地没有这个文件，无法比对"); continue; }
    const local = fs.readFileSync(localPath);
    const localSha = crypto.createHash("sha256").update(local).digest("hex");
    let done = false;
    for (let i = 1; i <= 5 && !done; i++) {
      try {
        const r = await fetch(a.browser_download_url, { headers: { "User-Agent": "codex" }, redirect: "follow", signal: AbortSignal.timeout(240000) });
        const buf = Buffer.from(await r.arrayBuffer());
        // 明显不是文件（错误页）直接重试
        if (buf.length < 1024) { console.log("    [" + i + "] 只拿到 " + buf.length + " 字节，重试…"); await new Promise(x => setTimeout(x, 3000)); continue; }
        const magic = buf.subarray(0, 4).toString("hex");
        const same = buf.length === local.length && crypto.createHash("sha256").update(buf).digest("hex") === localSha;
        if (same) ok++;
        console.log("  " + a.name + " -> 下载 " + buf.length + " | magic " + magic + " | 逐字节一致: " + same);
        done = true;
      } catch (err) { console.log("    [" + i + "] " + String(err.message).slice(0, 50)); await new Promise(x => setTimeout(x, 3000)); }
    }
    if (!done) console.log("  " + a.name + " -> 多次重试仍失败（api=" + a.size + " 本地=" + local.length + "）");
  }

  console.log("整包校验: " + ok + "/" + assets.length + (ok === assets.length && assets.length > 0 ? " 通过" : " 未通过"));
  process.exit(ok === assets.length && assets.length > 0 ? 0 : 1);
}

main().catch((e) => { console.log("校验脚本异常: " + (e && e.message)); process.exit(1); });
