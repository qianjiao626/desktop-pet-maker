# 第三方代码与许可

本项目主体为 MIT。以下为内联或依赖的第三方内容：

## 内联（vendored）代码

### gifuct-js — MIT

- 来源：https://github.com/matt-way/gifuct-js
- 版权：Copyright (c) Matt Way
- 文件：`src/vendor/gif-lzw.js`
- 内容：GIF LZW 解压算法、去隔行算法（算法本身未作修改，仅改写为 ESM 模块）

### shachaf/jsgif — 去隔行算法来源

- 来源：https://github.com/shachaf/jsgif
- 用于 gifuct-js 的 `deinterlace`

## 美术素材

### Kenney 动物素材包 — CC0-1.0（公共领域）

- 来源：https://kenney.nl/assets/animal-pack-remastered
- 作者：Kenney Vleugels（Kenney.nl）
- 许可：**Creative Commons Zero (CC0)** —— 官方 License.txt 原文：
  "You may use these assets in personal and commercial projects.
   Credit (Kenney or www.kenney.nl) would be nice but is not mandatory."
- 使用位置：`examples/*.petpack` 中的内置卡通动物（熊熊 / 小黄鸭 / 企鹅豆 等）
- 说明：本项目为这些**静态**圆形动物素材程序化生成了呼吸/摆动多帧动画后再打包；
  素材本身未作修改，仅做缩放与逐帧变换。虽 CC0 不强制署名，仍在此明确标注来源。

### Kenney 怪物零件包 — CC0-1.0（公共领域）

- 来源：https://kenney.nl/assets/monster-builder-pack
- 作者：Kenney Vleugels（Kenney.nl）
- 许可：**CC0-1.0**（License.txt 同 Animal Pack：可用于个人与商业项目，署名非必须）
- 使用位置：`examples` 中的「小黄怪 / 小绿怪 / 小蓝怪 / 小红怪 / 小白怪 / 小紫怪」
- 说明：本项目用其中的 2D 零件（身体 / 眼睛 / 嘴 / 手臂 / 腿）**拼装**出小怪物，
  并程序化生成 6 帧呼吸动画；零件本身未作修改。生成脚本见 `scripts/make-monsters.mjs`。

> 注：`examples` 中的「小黄龙 / 奶团子 / 喵喵 / 呱呱 / 咚咚」为本项目**原创**形象（程序化绘制），非第三方素材。

## npm 依赖

| 包 | 许可 | 用途 |
|---|---|---|
| electron | MIT | 运行时容器（devDependency） |
| gifuct-js | MIT | 仅作参考与测试素材来源 |
| omggif | MIT | 仅测试用：生成测试 GIF（devDependency） |

## 未采用的方案（许可说明）

- `@imgly/background-removal`（AI 抠图）：**AGPL-3.0**，与本项目 MIT 不兼容，故**未采用**。
## AI 抠图模型（可选，运行时下载）

本项目**不使用** `@imgly/background-removal`（**AGPL-3.0**，与本项目 MIT 许可不兼容），
也**不使用** `bria-rmbg` / RMBG-2.0（BRIA 许可，商用需付费协议）。

所使用的模型全部为 **Apache-2.0**，来源与许可如下：

| 模型 | 来源仓库 | 许可 |
|---|---|---|
| silueta | https://github.com/xuebinqin/U-2-Net | Apache-2.0 |
| isnet-general-use | https://github.com/xuebinqin/DIS | Apache-2.0 |
| isnet-anime | https://github.com/SkyTNT/anime-segmentation | Apache-2.0 |

模型文件托管于 https://github.com/danielgatis/rembg/releases （rembg 本身为 MIT，但**模型权重带有各自独立许可**，故逐个核对如上）。

### 推理引擎

| 包 | 许可 |
|---|---|
| onnxruntime-node | MIT |