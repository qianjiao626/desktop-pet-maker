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