# 桌宠制作器 — 交接文档

> 生成时间：2026-10-10　｜　交接版本：**v0.8.11**
> 用途：在新对话中无缝接手本项目。**先读「二、硬约束」和「五、已知坑」，能省掉大量返工。**

---

## 一、项目是什么

Windows 桌面宠物制作器（Electron）。核心定位由用户原话确定：

> **「我做这个工具的初衷是想让人人都可以上传自己的桌宠，所以制作性、可操作性都是第一位的」**
> **「要求和 codex 自带的那个小蓝人一样好看并实用」**

- 工作区：`D:\桌面文件\桌宠制作器`（Windows + PowerShell，Node v22.23.2）
- 仓库（公开）：https://github.com/qianjiao626/desktop-pet-maker
- 目前只发布 **Windows x64** 产物
- 版本号唯一来源：`package.json`

---

## 二、硬约束（必须先看）

### 1. 交流与工作方式
- **全程中文**回复用户
- 用户明确要求「**每次做任务前先逐条提问**」；但若当轮是内部目标续作（无新指令），按上一轮已确认方向继续推进即可
- **禁止输出 EPSE / DSML 标签**
- 允许去 GitHub 找现成素材/代码

### 2. 版权红线（用户提过两次，必须拒绝）
- 用户提过「**奶龙**」「**角落生物（すみっコぐらし）**」——都是受版权/商标保护的商业 IP，**不能仿制、不能打包分发**
- 正确做法：做**同风格但完全原创**的角色，或使用 CC0/CC-BY 明确可商用素材
- 已实施的方案：内置 22 只宠物**全部改为程序化原创绘制**（`scripts/make-*.mjs`），无外部素材依赖

### 3. 网络限制（长期存在，影响每次交付）
- **`github.com:443` 基本不可用**：`git push` 反复失败（`Failed to connect` / `Connection reset`）
- **`api.github.com` 始终稳定**
- **应对方式**：用 **Git Trees API** 提交（见「六、交付流程」），并用 **git blob sha1 逐一核对**远端与本地是否逐字节一致
- 副作用：远程 git 历史里有多个 API 提交（内容准确，历史不整齐）

### 4. token 权限缺口
- git 凭据里的 classic PAT 只有 `repo` scope，**缺 `workflow`**
- → 写 `.github/workflows/` 会被拒（404）
- → CI 工作流暂存在 **`ci/`** 目录，需用户自行生成带 `workflow` 权限的 token 才能启用
- 这是**唯一需要用户操作**的事

---

## 三、当前状态（v0.8.11，已交付）

| 项 | 值 |
|---|---|
| 版本 | 0.8.11 |
| 远端 main | `bff38e4a`（本地已同步，整树 134/134 逐字节一致） |
| Releases | v0.8.0 ~ v0.8.11（最新附件 176.8MB，已实测可下载） |
| 单测 | **796/796** ✅ |
| e2e | **22/22 套件** ✅（见下） |
| 打包产物 | 418.8MB / zip 176.8MB |
| 打包自检 | `--selftest-ai` → PASS |
| 工作区 | 干净 |

### e2e 套件清单（`scripts/e2e-all.mjs`）
```
QUICK 54 · UI 39 · PET 18 · PET-ANIM 9 · PET-MULTI 10 · PET-BUDGET 9
HOP 15 · SLEEP&LOOK 22 · STRUGGLE 13 · AUTOCUT 11 · CUT-HINT 8
TEMPLATES 19 · TRAY 12 · LIBRARY-PREFS 15 · LIBRARY 21
SHARE 17 · SHARE-DROP 10 · DOWNLOAD-ROBUST 13 · PACKAGE 22
（另有 SEGMENT / PIPELINE / DOWNLOAD 等）
```

### 已实现的功能（按用户关注度）
1. **上传即用**：拖入图片 → 自动抠图（纯色**与渐变**背景都支持）→ 一键上桌
2. **抠图质量反馈**：预览下方直接给「已扣干净」/「该调大/调小强度」+ 主体占比
3. **性格模板**：5 个一键预设（活泼/温顺/贪睡/粘人/静默），只改性格字段，不动图片与画布
4. **桌宠行为**：爬动 / 发呆 / 打瞌睡（会冒 Zzz）/ 活泼跳跃 / 看向鼠标 / 被拎起来会挣扎 / 抓虫子
5. **系统托盘**：退出桌宠 / 隐藏显示 / 重开制作器（根治过「退不出去」）
6. **宠物库**：搜索 / 排序 / 分组 / 收藏 / 最近使用
7. **分享闭环**：拖入 `.petpack` 即装即用；导出后弹窗可复制路径
8. **内置 22 只原创宠物**：小蓝机器人（12 帧）等，全部程序化绘制
9. **全局快捷键** `Ctrl+Alt+Q` 强制退出桌宠（兜底）
10. **AI 抠图**（本地 ONNX，纯 CPU）

---

## 四、代码结构要点

```
src/
  main/      main.js（IPC/窗口/托盘/光标轮询）· segment.js（ONNX，纯CPU）
             models.js · state.js · tray.js
  maker/     index.html · maker.js · style.css · qcompose.js
  pet/       pet.js（运行时渲染/物理/行为）· index.html · pet.css
             assets/{hand,fist}.jpg
  shared/    behavior.js（状态机+姿态）· effects.js（手/拳/挣扎姿态）
             imageops.js（抠图+质量评估）· templates.js（性格模板）
             library.js（收藏/最近）· dnd.js（拖拽判定）
             layout.js · physics.js · motion.js · qbody.js
             petpack.js · budget.js · displays.js · speech.js
             bugchase.js · gif.js · png.js · zip.js · safeid.js
             segmentation.js
  preload/   preload.cjs
scripts/     pack.mjs（打包+裁剪GPU组件）· e2e-*.mjs（22个套件）
             make-*.mjs（生成内置宠物/图标）
tests/       27 个 *.test.mjs，入口 tests/run.mjs
examples/    22 个内置 .petpack
ci/          GitHub Actions（暂存，待 workflow 权限）
```

---

## 五、已知坑（踩过，别再踩）

### 测试与验证
1. **只跑新增 E2E 会漏回归**：曾加打瞌睡时引入「打呼抢用户输入的话」，当轮新增套件全绿，**下一轮全量跑才暴露**。→ 每次改动**跑全量** `npm test` + `npm run test:e2e`
2. **测试里重写一份产品规则 = 弱证据**：drop 判定曾在测试脚本里另写一份正则，那份通过不代表产品正确。→ 抽到 `src/shared/*.js` 让产品与测试**共用同一份**
3. **测试图必须能区分被测行为**：用「纯白底+橙色圆」测容差差异 —— 实测 tol 0~140 结果全一样（边界色差太大），断言毫无意义。→ 换低对比图
4. **不要断言随机事件必然发生**：hop 权重仅 0.16，写「8 秒内必然出现 hop」会偶发假失败。→ 用确定性证据（权重/强制钩子），随机只记录不断言
5. **断言前先确保前置状态**：注视相关断言偶发 `rot=0`，因为采样撞上 `doze`（睡着不看鼠标是设计）。→ 加 `__forceWake` 保证前置条件
6. **平均值会被少数极端值掩盖**：判「平坦背景」只看 `adjAvg` 时，「硬分界」用例 adjAvg 仅 2.5 却通过（局部跳变 198）。→ 必须同时约束 `adjMax`

### Electron / 打包
7. **`createFromPath` 读不了 asar 内文件**：打包后图标会变空。→ 用 `fs.readFileSync` + `nativeImage.createFromBuffer`
8. **`File.path` 在 Electron 32+ 已移除**：拖拽取真实路径必须用 `webUtils.getPathForFile`
9. **`app.getVersion()` 在开发模式返回 Electron 版本**（显示成 v44.x）：→ 显式读 `package.json`
10. **非整数 DPI（1.5x）下 `setPosition` 会让窗口每帧变宽**（曾膨胀到 608×951）：→ 用 `setContentBounds`
11. **`window-all-closed` 直接 `app.quit()` 会导致关窗后找不回**：→ 有托盘时常驻不退出

### 前端
12. **TDZ 崩溃会静默失效**：`initTemplates()` 放在 `let currentTemplate` 声明之前 → 控制台报 `Cannot access before initialization`，点击全部无声失败。→ 声明必须在调用之前
13. **UI 改了但宠物没变**：`quickEnable` 只推 pack；「走路/跳跃/看向鼠标/抓虫子」是**独立 IPC 通道**，必须一并下发
14. **`.stage` 是 `overflow:hidden`**：往里塞提示条会被压在图片下层看不清 → 提示条放容器外

### 判据类（要边界分明）
15. **不要用「半透明像素比例」判抠图残留**：默认 feather=14 的正常羽化带就有 ~10.6% 半透明像素，会把正常抠图误报。→ 改用「外层 vs 内层亮度差」，且**只用 alpha>128 的实心像素**（正常图 diff=0.0，7px 光晕=0.11）
16. **采样要分组**：判背景连续性时把四条边的采样点连成一串 →「上边末→下边首」跨接会把主体算进来（浅色渐变 adjAvg 从 <10 飙到 40.7）。→ 按边分组算相邻差

---

## 六、交付流程（每轮收尾照做）

```powershell
# 1. 全量测试（必须两项都跑）
npm test                 # 单测
npm run test:e2e         # 22 套件

# 2. 升版本 + 打包
#    改 package.json 的 version + README 里的下载链接
node scripts/pack.mjs
node scripts/e2e-package.mjs      # 应 22/22
dist\...\desktop-pet-maker.exe --selftest-ai    # 应 RESULT: PASS

# 3. 打 zip（PowerShell，文件名带版本）
Compress-Archive -Path 'dist\desktop-pet-maker-win32-x64' `
  -DestinationPath 'dist\desktop-pet-maker-win32-x64-vX.Y.Z.zip' -CompressionLevel Optimal -Force

# 4. 本地提交
git add -A; git commit -F <信息文件>

# 5. 推送：先试 git push；失败就用 Git Trees API
```

### Git Trees API 推送要点（`github.com` 不通时的唯一路径）
1. 从 `git credential fill` 取 token（`host=github.com`）
2. 取远端 main 的 sha → 算 `git diff --name-only <上次同步的本地提交> HEAD`
3. **内容必须从 git 对象读**：`git cat-file -p HEAD:"<path>"`
   —— 不能读工作区原始字节，否则 CRLF 会让 sha 对不上（踩过：5 个文件不一致）
4. 每个文件建 blob（二进制走 base64）→ **立即用 `git rev-parse HEAD:"<path>"` 核对 sha**
5. 建 tree（`base_tree` = 远端 HEAD 的 tree）→ 建 commit → PATCH `refs/heads/main`
6. **独立复核**：拉远端 recursive tree，与 `git ls-tree -r -z HEAD` 逐文件比对（用 `-z` 避免中文被转义）
7. 建 Release + 上传附件，最后**用 API asset 端点完整下载**验证字节数与 zip 魔数

### 每轮的验证标准（缺一不可）
| 项 | 要求 |
|---|---|
| 单测 | 全绿 |
| e2e | 全绿（新增功能要有对应套件） |
| asar 内版本 | 用 `@electron/asar` 读 `package.json` 核对 |
| 打包自检 | `--selftest-ai` → PASS |
| 附件 | API 下载字节数与 `assets[].size` 一致 |
| 远端一致性 | 整树逐文件 sha 零差异 |
| 工作区 | `git status` 干净、无 `_tmp-*` 调试残留 |

---

## 七、用户沟通注意

- **如实报告失败与限制**：网络不通、token 权限不足、当前环境无图像生成能力，都要直说，用户接受
- **不要掩饰自己的错误**：测试写错、判据误报、TDZ 崩溃 —— 都在提交信息和回复里如实记录
- **改动影响既有断言时要说明**：「这是有意的变更，不是回归」
- **给数据，不给感觉**：用实测数字说话（如「渐变背景抠图透明率 70%」）
- 收尾时给出**下一步候选**让用户挑

---

## 八、下一步候选（未做）

1. **跨平台打包**（macOS / Linux）
   - `scripts/pack.mjs` 已是跨平台写法
   - 但 `.electron-cache` 只有 win32-x64，需下载对应平台 Electron（几百 MB）
   - 本机无法验证 mac/Linux 运行 → 更合适走 `ci/package.yml`（需 workflow 权限）
2. **宠物包在线分享**（生成一条链接，对方点开就下载）
3. **批量处理多张图**（一次拖 20 张自动抠图 + 对齐）
4. **「我的模板」**（把当前配置存成自定义模板复用）
5. **继续瘦身**（`LICENSES.chromium.html` 19.5MB；注意是法律文件，谨慎）
6. **AI 抠图模型自动推荐**（按图片类型选模型）

---

## 九、一句话总结

工具已从「能跑」做到「好用」：上传即用（含渐变背景抠图 + 质量反馈）、性格模板、
丰富的桌面行为、系统托盘兜底、完整的宠物库与分享闭环，22 只原创内置宠物。

**唯一卡在用户侧的是 `workflow` token 权限**（用于启用 CI 与跨平台打包）。
其余方向都可以继续自主推进 —— 保持「全量测试 → 打包 → API 推送」的闭环即可。
