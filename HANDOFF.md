# 桌宠制作器 — 交接文档

> 生成时间：2026-10-10　｜　交接版本：**v0.9.3**
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

## 三、当前状态（v0.9.3，已交付）

| 项 | 值 |
|---|---|
| 版本 | 0.9.3 |
| 远端 main | `28c9da9`（整树 152/152 逐字节一致） |
| Releases | v0.8.0 ~ v0.8.16（每版含 Windows + Linux，均已实测可下载） |
| 单测 | **1343/1343** ✅ |
| e2e | **29/29 套件** ✅（见下） |
| 打包产物 | Windows 325MB/144.0MB zip · Linux 321MB/136.2MB zip |
| 打包自检 | `--selftest-ai` → PASS |
| 远端一致性 | 用 git Trees API 推送后，整树逐文件 sha 必须零差异 |
| 工作区 | 干净 |

### e2e 套件清单（`scripts/e2e-all.mjs`）
```
QUICK 54 · UI 39 · PET 18 · PET-ANIM 9 · PET-MULTI 10 · PET-BUDGET 9
HOP 15 · SLEEP&LOOK 22 · STRUGGLE 13 · AUTOCUT 11 · CUT-HINT 8
TEMPLATES 19 · TRAY 12 · LIBRARY-PREFS 15 · LIBRARY 21
SHARE-PAGE 25 · AUTOSELECT 22 · BATCH 15 · CORRUPT-MODEL 8 · PLATFORM 28
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

### 本轮（v0.8.12~0.8.15）新踩的坑
17. **模型文件「看起来在」不等于能用**：`isInstalled` 若只判断文件大小，
    下载中断留下的**截断文件**会被当成已就绪 → `InferenceSession.create()` 在损坏的
    protobuf 上**永久挂起**（实测卡死 90s+，且同步解析会阻塞事件循环，
    连 `setTimeout` 守卫都不触发）。→ 必须按登记字节数校验，并单独区分「下了一半」。
18. **单个中心像素做动画断言会 flake**：breathe 会缩放精灵，全量套件满载时采样落在
    缩放过渡上就取到插值边缘色。→ 改为统计整幅画布的「占比最大颜色」，并额外断言
    不透明像素数有变化（否则静止图也能通过）。
19. **`git push` 与 API 提交会制造分叉**：两者内容一致但 SHA 不同，下次 push 会
    因非快进被拒。→ fetch 后 merge，冲突一律取本地（本地是超集），合并后**必须复跑全量**。
20. **用 `Select-Object -First N` 截断 e2e 输出会触发 EPIPE**：管道提前关闭，
    测试脚本写 stdout 时崩溃并弹出「A JavaScript error occurred in the main process」。
    → 用 `*> file` 重定向，跑完再读。
21. **PowerShell 拼代码时 `\n` 会变成字面反斜杠 n**：写进 JS 会制造语法错误，
    表现为脚本「卡死」。→ 用 `[char]10` 或 here-string，改完立刻 `node --check`。
### 23~25：v0.9.0「身体识别」踩的坑（**重要，别再重试已经失败的路**）
### 26：v0.9.1 的关键发现（**这条推翻了之前的直觉，很重要**）
### 29：v0.9.2 的教训（**空 catch 是最大的时间黑洞**）
29. **`catch {}` 会静默吞掉 ReferenceError**。v0.9.2 修「宠物悬空」时，
    `pet.js` 漏了一个 `import { commonGroundOffset }`，调用时抛 ReferenceError，
    而我的 `try { ... } catch { groundDy = 0 }` **把它整个吃掉了** ——
    代码"看起来改好了、实际一行都没跑"。为此反复测了十几次、绕了几十分钟。
    → 兜底可以，但**必须在 catch 里至少 console.warn 打出来**；
      以及：**先打印运行时真实值，再谈公式**（这次打了值问题立刻现形）。
30. **"改一处、忘一处"的连锁**：为了让脚底贴地，需要同时改 5 个地方 ——
    绘制位移、变换原点、命中测试、特效包围盒、以及画布底部预留。
    只改绘制位移 -> 点击区域错位；只改画布高不改基线 -> 双重位移把精灵顶出画布
    （实测内容高度从 50px 掉到 23px）。
    → 这类"同一量影响多处"的改动，**必须先在纸上列出所有受影响的位置**。
31. **"内容不在画布中心"是贴地后的正常结果**，不是 bug。
    `e2e-pet-anim` 原先采样**画布中心**像素，贴地后内容下移就采到透明，
    表现得像"没画出来"。→ 测试应采样**内容的实际包围盒中心**，
      与"内容在画布哪个位置"解耦。
26. **MoveNet 只认「真实照片」，不认扁平矢量卡通**（实测）：
    - 扁平卡通小人 -> 只识别到 **8/17**，髋部全丢，闸门判定「0 段肢体可驱动」-> 拒绝
    - 真实人物照片 -> **16/17**，闸门判定「4 段肢体可驱动」-> 放行
    所以「标准立绘」的实际含义是**写实插画或真人照片**，不是"我画的色块小人"。
    测试里必须用真实照片做「合格素材」，用扁平卡通做「不合格素材」——
    我第一版 e2e 断言写反了，被实测纠正。
27. **带函数的对象不能过 IPC**。`MOTIONS.find(...)` 返回的对象含 `pose` 函数，
    直接 return 给渲染进程会让结构化克隆**永久挂起**（实测 e2e 卡死十几分钟、
    零输出，CPU 还在跑，极难定位）。→ 过 IPC 前只挑纯数据字段。
28. **小角度微动作（≤7°）是静态图上唯一可靠的做法**：
    不需要补全任何像素，关节缺口小到能用圆形补丁完全盖住。
    实测：真实照片渲染出 6 帧，画面完整无碎片。
    一旦角度变大就必须补全不存在的像素 -> 必然穿帮（见第 23 条）。
23. **不要用"搬运像素"去做大动作**。目标原是"识别身体部位 -> 操控小人跳舞"。
    实测**三条路全部失败**，都留下过截图证据：
    - 部件切分（固定比例胶囊沿骨架裁剪）：真实手臂是**弯的**，直胶囊取到背景，
      四肢变成漂浮碎片。
    - 网格形变（绝对角度）：把"自然下垂"的角度套到本来就摆着姿势的照片上，
      手臂被拧成麻花、背景被卷进来。
    - 网格形变（相对源姿势）+ 微动作：身体被撕成互不相连的块。
    **根因是信息缺失，不是参数问题**：一张照片没有背面、没有关节内侧、
    没有被遮挡的肢体，任何"搬运像素"都补不出来。
    → 结论：**先拿真实素材手工验证方案能出合格画面，再写代码**。
      这次是先写了几百行、做了三轮才看图，返工代价极大。
24. **MoveNet 只认真实照片**。拿"扁平矢量卡通小人"测，只识别到 8/17 个点、
    髋部全丢（它是在真人照片上训练的）。真实人物照片：**16/17 个点**。
    → 素材引导里要说清"真人照片或写实插画"，别让用户拿扁平色块图来试。
25. **姿态模型不能混进抠图模型列表**。加了 kind:'pose' 的注册项后，
    `segmentAuto` 的兜底 `Object.keys(MODELS)` 会把姿态模型也当抠图模型跑，
    输入 dtype 不同直接失败（实测 e2e-autoselect 三连红）。
    → 模型按 kind 分流；`segmentAuto` 显式只取 kind==='cutout'。
22. **「产物瘦身」不能只盯着自己 node_modules 里的东西**：`dxcompiler.dll`（24.6MB）与
    `dxil.dll`（1.4MB）是 **Electron 发行包自带**、位于应用**根目录**，不在
    `onnxruntime-node/bin` 下。早期的 GPU 裁剪只扫了后者，于是这两把文件被冷落了 15 个版本、
    打进了每一个产物。→ 裁剪脚本要覆盖「根目录 + 依赖目录」两处；新增断言锁死
    「根目录 GPU 组件必须已裁掉」与「LICENSES.chromium.html 必须保留」。
    教训：瘦身要先**盘点产物实际内容**（按体积排序看最大的 20 个文件），
    而不是照着已知清单删。

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
| 远端一致性 | 用 git Trees API 推送后，整树逐文件 sha 必须零差异 |
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

## 八、下一步候选

### 已完成（原候选 1/2/3/4/6）
1. ~~跨平台打包~~ → **Windows / Linux 可直接产出**（`npm run package:linux`）；
   macOS 仍需 CI（见下）
2. ~~宠物包在线分享~~ → **零依赖分享页**：导出一个自包含 `.html`，
   对方双击用浏览器就能看桌宠动起来，不装任何东西、不联网
3. ~~批量处理多张图~~ → **批量做宠物**：一次拖一批图，每张各成一只独立宠物并入库
4. ~~我的模板~~ → 可保存/重命名/删除/导出 `.pettpl` 分享
5. **身体识别（v0.9.0 新增）** → 上传人物图自动识别 17 个关键点，
   画出骨架 + 逐部位结果 + **素材合格性检查**（缺哪个部位、哪里重叠、怎么改）。
   模型：MoveNet SinglePose Lightning，本地 CPU，**推理约 11ms**。
   ⚠ "操控他跳舞"**未实现**：三条渲染路线都实测失败（见已知坑 23），
   静态图做不出大动作所需的缺失像素。当前只交付"识别 + 素材诊断"。
6. ~~AI 抠图模型自动推荐~~ → **自动挑最好的模型**（先快后慢，够干净就提前收手，实测 3.5 倍提速）

### 仍可做
1. **macOS 产物**（唯一需要用户操作的事）
   本机（Windows）无法打包：`.app` 需要符号链接（需管理员/开发者模式），
   且未签名应用会被 Gatekeeper 拦截（arm64 会被系统终止），需要 Apple 证书签名 + 公证。
   走 `ci/package.yml` 在 `macos-latest` 上构建即可 —— 但需要带 `workflow` 权限的 token
   才能把 `ci/*.yml` 移到 `.github/workflows/`。
2. ~~继续瘦身~~ → 已裁掉根目录 GPU 组件（省 26MB，zip 154.7→144MB）。
   `LICENSES.chromium.html` 19.5MB 是**法律文件，明确不动**，已用断言锁住。
3. **分享页增强**：目前是浏览器内互动；可考虑加「一键装到桌面」的提示引导
4. **批量增强**：按文件名前缀自动分组、批量套用不同模板

---

## 九、一句话总结

工具已从「能跑」做到「好用」：上传即用（含渐变背景抠图 + 质量反馈）、性格模板、
丰富的桌面行为、系统托盘兜底、完整的宠物库与分享闭环，22 只原创内置宠物。
v0.8.12~v0.8.15 又补齐了四块：**跨平台产物（Win/Linux 可本地打包）**、
**零依赖分享页（单个 HTML 双击即看）**、**批量做宠物**、**AI 抠图自动挑最好的模型**，
并顺手修掉两个真 bug（模型残件导致永久卡死、分享页里 AI 抠图在 Linux/mac 上加载失败）。

**唯一卡在用户侧的是 `workflow` token 权限**（用于启用 CI 跑 macOS 构建）。
其余方向都可以继续自主推进 —— 保持「全量测试 → 打包 → 推送 → 建 Release」的闭环即可。

> 网络提示：`github.com:443` 时通时断。断时用 **Git Trees API** 推送
> （`api.github.com` 通常仍可用），推完务必做整树 sha 复核。