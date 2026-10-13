# -*- coding: utf-8 -*-
"""把当前仓库推送到 Gitee。

用法：
  python push-to-gitee.py <登录名> <仓库名> <私人令牌>

注意：Gitee 的 URL 路径用的是**登录名**（如 megajoule），
      不是页面上显示的昵称（如 马千焦）。昵称放进 URL 会 404。
"""
import subprocess, sys, urllib.parse

if len(sys.argv) < 4:
    print(__doc__)
    sys.exit(1)
owner, repo, token = sys.argv[1], sys.argv[2], sys.argv[3]
q = lambda s: urllib.parse.quote(s, safe="")
url = "https://%s:%s@gitee.com/%s/%s.git" % (q(owner), q(token), q(owner), q(repo))
safe = "https://gitee.com/%s/%s.git" % (q(owner), q(repo))

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    out = ((r.stdout or "") + (r.stderr or "")).replace(token, "<TOKEN>")
    return r.returncode, out.strip()

print("1) 探测远端…")
code, out = run(["git", "ls-remote", "--heads", url])
if code != 0:
    print("   失败：", out[:400])
    sys.exit(1)
print("   OK")

run(["git", "remote", "remove", "gitee"])
print("2) 添加临时 remote gitee…")
code, out = run(["git", "remote", "add", "gitee", url])
if code != 0:
    print("   失败：", out[:300])
    sys.exit(1)

print("3) 推送 main…")
code, out = run(["git", "push", "gitee", "main:main", "--force"])
print("   exit =", code)
print("  ", out[:800].replace(url, safe))

run(["git", "remote", "set-url", "gitee", safe])
print()
print("完成。仓库地址：", safe)
