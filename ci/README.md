# CI 工作流（暂存）

这两个 workflow 文件**暂时放在 `ci/` 目录**，而不是 `.github/workflows/`。

## 原因

GitHub 规定：**修改 `.github/workflows/` 下的文件，token 必须带 `workflow` 权限**。
当前用于提交的 GitHub token 只有 `repo` 权限，写该目录会被拒绝（实测返回 404）。
写入普通目录则正常（201）。

## 当前状态

这两个工作流文件已通过 **GitHub Contents API** 提交到仓库（走 `api.github.com`）——
因为当 `git push` 到 `github.com:443` 被网络重置时，API 通道仍然可用。

但它们**尚未生效**：GitHub 只在 `.github/workflows/` 下识别工作流。
补上 `workflow` 权限后按上面的命令移动即可。

## 如何启用

1. 到 GitHub 生成一个**带 `workflow` 权限**的 token：
   Settings → Developer settings → Personal access tokens (classic)
   → 勾选 **`workflow`**（以及 `repo`）→ 生成
2. 用新 token 推送（或更新本地 git 凭据）
3. 执行以下命令把文件就位：

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
- 在 Windows 上跑全套 12 套端到端测试
- 可在 Actions 页面手动触发打包（可选 win32 / darwin / linux 与 x64 / arm64）

## 这两个工作流做什么

| 文件 | 作用 |
|---|---|
| `tests.yml` | 三平台单测 + Windows 全套 e2e（失败自动上传日志）|
| `package.yml` | 手动触发打包，产物 zip 可下载 |

> 单元测试是纯 Node（不依赖 Electron），因此能在 Ubuntu / macOS 上直接跑，
> 这也是目前验证「跨平台」声明的最实际手段。
