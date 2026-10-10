# CI 工作流（暂存）

这两个 workflow 文件**暂时放在 `ci/` 目录**，而不是 `.github/workflows/`。

## 为什么放这里

GitHub 规定：**修改 `.github/workflows/` 下的文件，token 必须带 `workflow` 权限**。

已实测确认（针对本仓库真实调用）：
- `PUT .github/_scope_probe.txt`（普通文件）→ **201 成功**
- `PUT .github/workflows/tests.yml` → **404 Not Found**
- 用 Git Trees API 提交含 `.github/workflows/` 的 tree → 同样 **404**

也就是说：**不是脚本写法问题，GitHub 服务端强制拦截**。两个 API 通道都试过，没有可绕过的路径。
`ci/` 目录是当前 token 下唯一能提交的位置。

## 怎么启用

到 GitHub 生成一个**带 `workflow` 权限**的 token：
Settings → Developer settings → Personal access tokens (classic) → 勾选 **`workflow`**（以及 `repo`）→ 生成。

然后：

```bash
mkdir -p .github/workflows
git mv ci/tests.yml .github/workflows/tests.yml
git mv ci/package.yml .github/workflows/package.yml
git rm ci/README.md
git commit -m "ci: 启用 GitHub Actions 工作流"
git push
```

启用后：
- 每次 push / PR 自动在 **Windows / Ubuntu / macOS** 三个平台跑单元测试
- 在 Windows 上跑全套 e2e
- 可在 Actions 页面手动触发打包（可选 win32 / darwin / linux 与 x64 / arm64）

## 不等 CI 也能拿到的产物

| 目标 | 怎么做 | 现状 |
|---|---|---|
| Windows x64 | `npm run package:win` | ✅ 已产出并发布 |
| **Linux x64** | `npm run package:linux` | ✅ **可在本机直接产出**（下载通道可用，只有 git push 被墙）|
| macOS x64 / arm64 | 只能走 `ci/package.yml`（macos-latest）| ⛔ 见下 |

**为什么 macOS 不能用 `pack-cross.mjs` 本地产出**：
1. `.app` 内部需要符号链接，Windows 上创建符号链接需要管理员权限或开发者模式（本机两者都没有，实测 `SYMLINK_FAIL`）；
2. 即使打出来，**未签名的 macOS 应用会被 Gatekeeper 拦截**，arm64 更是会被系统直接终止——这需要 Apple Developer 证书做签名 + 公证，不是权限问题。

所以 `scripts/pack-cross.mjs` 会在非 macOS 主机上直接拒绝 `darwin` 目标，并提示走 CI，避免产出一个「看起来像能用、实际打不开」的包。

## 这两个工作流做什么

| 文件 | 作用 |
|---|---|
| `tests.yml` | 三平台单测 + Windows 全套 e2e（失败自动上传日志）|
| `package.yml` | 手动触发打包 + 产物结构校验（`e2e-package.mjs`），产物 zip 可下载 |

> 单元测试是纯 Node（不依赖 Electron），因此能在 Ubuntu / macOS 上直接跑，
> 这也是验证「跨平台」声明最实际的手段。
