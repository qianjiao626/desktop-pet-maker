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

> 说明：内置宠物库**已全部改为程序化原创绘制**（圆润萌系风格，比例参考通用桌面助手的审美，
> 但造型完全原创，不复制任何第三方 IP）。
> 因此下列第三方素材包**当前均未再用于内置宠物的成品图像**，仅保留许可记录以备查证历史版本。

### 曾使用的第三方素材（现已不用于内置宠物成品）

#### Kenney 动物素材包 — CC0-1.0（公共领域）
- 来源：https://kenney.nl/assets/animal-pack-remastered
- 作者：Kenney Vleugels（Kenney.nl）
- 许可：**CC0**（可用于个人与商业项目，署名非必须）
- 现状：**已移除**，内置库不再包含该素材生成的宠物

#### Kenney 怪物零件包 — CC0-1.0（公共领域）
- 来源：https://kenney.nl/assets/monster-builder-pack
- 许可：**CC0-1.0**
- 现状：**已替换**。小怪物现由 `scripts/make-monsters.mjs` 程序化原创绘制

#### Kenney 形状角色包 — CC0-1.0（公共领域）
- 来源：https://kenney.nl/assets/shape-characters
- 许可：**CC0-1.0**
- 现状：**已替换**。形状小朋友现由 `scripts/make-shapes.mjs` 程序化原创绘制

#### OpenGameArt 萌系动物素材 — CC0-1.0（公共领域）
- 来源：https://opengameart.org
- 许可：**CC0-1.0**
- 现状：**已替换**。北极熊 / 小企鹅 / 小黄鸭 / 胖橘猫 / 大胖鸡 现由
  `scripts/make-classic-pets.mjs`、`scripts/make-classic-pets2.mjs`、`scripts/make-cats.mjs`
  程序化原创绘制

#### 内置宠物的当前生成脚本（全部原创、无外部依赖）
- `scripts/make-blue-bot.mjs` —— 小蓝机器人（12 帧）
- `scripts/make-monsters.mjs` —— 6 只小怪物（6 帧）
- `scripts/make-shapes.mjs` —— 5 只形状小朋友（6 帧）
- `scripts/make-classic-pets.mjs` / `make-classic-pets2.mjs` / `make-cats.mjs` —— 经典萌宠与猫咪（6 帧）
- `scripts/make-examples.js` —— 小黄龙 / 奶团子 / 喵喵 / 呱呱 / 咚咚（6 帧）

### 推理引擎

| 包 | 许可 |
|---|---|
| onnxruntime-node | MIT |