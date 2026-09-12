---
name: ai-image-gen
description: "通用 AI 生图：文生图 / 图生图 / 图像变体。当用户说 AI 生图、AI 画图、文生图、图生图、生成图片、生成配图、图像生成、AI 出图、AI 作图、换图、改图、图像编辑、给我画一张、生成一张图 时使用。支持 OpenAI 兼容 API 与 apimart 异步 API，用户自备 API key。"
layer: produce
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# ai-image-gen Skill

> 通用 AI 文生图 / 图生图 / 图像变体。用户自备图像生成 API key（OpenAI 兼容 或 apimart 异步），产物写入 `outputs/`。

在 DSH 中只能通过 `mediaops_run_model_script` 调用 Host 受控脚本。API Key 由 Host 从私有配置存储注入，不索要、不回显，也不进入 workspace、审批摘要或日志。

## 边界（和相邻 SKILL 区分）

- **ai-image-gen（本 SKILL）**：通用 AI 生图，任意题材，文生图 / 图生图 / 变体。
- **ecom-details-image**：电商详情页 / 商品主图专用出图（25 场景模板、PDP 序列）。要做电商商品图走它。
- **card-\* / poster-\***：HTML+CSS 渲染截图（金句卡、小红书卡、海报），**非 AI 生成**，是确定性设计出图。
- **image-editing**：已有图片的确定性处理（改尺寸/裁剪/加水印/压缩），不生成新画面。

## DSH 受管模式（最高优先级）

1. 让用户在 DSH-MediaOps 设置页的“多模态模型”中配置图像 provider；先调用 `mediaops_model_status` 读取脱敏状态。
2. 不得读写 `.env`，不得直接执行 Python，不得运行 `model_registry.py`，不得传 `--env-file` 或 `--model`。
3. 每一次远程生成都必须单独调用 `mediaops_run_model_script`，并让 DSH 原生审批展示 provider、实际模型、数量/规格与输入文件摘要。

## 执行步骤

### 1. 确认配置（离线）

调用 `mediaops_model_status`。图像 provider 未启用或缺必填项时，请用户打开设置页补齐；不要请求用户把 key 发到对话。

### 2. 文生图 text2img

先把用户诉求写成一条清晰的图像 Prompt（主体 + 风格 + 构图 + 光线 + 画质），再执行：

`mediaops_run_model_script({"script":"ai-image","argv":["text2img","--prompt","一只戴墨镜的柴犬，扁平插画风，明亮撞色背景，高细节","--size","1024x1024","--n","1","--output","outputs/主题名/ai-image"]})`

- `--size`：同步模式用像素（`1024x1024` / `1536x1024` / `1024x1536`…）；异步模式用比例（`1:1` / `16:9` / `9:16`…）。
- `--n`：生成张数（多张时按序号自动命名）。
- `--output`：目录（多张自动编号）或含扩展名的单文件；统一放 `outputs/主题名/`。
- 同步可加 `--quality low|medium|high`；异步可加 `--resolution 1k|2k|4k`。

### 3. 图生图 / 图像编辑 img2img

基于一张输入图 + 指令生成新图（OpenAI 走 `/images/edits` multipart，可选 `--mask` 局部编辑；apimart 把输入图作参考图走生成端点）：

`mediaops_run_model_script({"script":"ai-image","argv":["img2img","--prompt","把背景换成夜晚霓虹街道，保留主体","--image","path/to/input.png","--output","outputs/主题名/edited.png"]})`

### 4. 图像变体 variations

由一张图生成多个变体：

`mediaops_run_model_script({"script":"ai-image","argv":["variations","--image","path/to/input.png","--n","3","--output","outputs/主题名/variations"]})`

### 5. 交付

告诉用户产物路径、生成参数（模式/模型/尺寸/张数）。如需再改尺寸/加水印/压缩，转 `image-editing`。

## 产物

统一输出到 `outputs/主题名/`。脚本会自动创建目录，多张按时间戳 + 序号命名。

## Profile 感知

有账号 Profile（`=== EASEL ACCOUNT PROFILE ===`）时，把品牌视觉风格（配色 / 调性 / 元素偏好）融入 Prompt，保持系列图统一；无 Profile 时按用户描述走通用生成。

## 常见问题

- **缺 key / 缺配置**：`mediaops_model_status` 会明确列出缺失项；只能在设置页更新。
- **同步 vs 异步用错尺寸格式**：同步用像素、异步用比例。用 `--mode` 可强制模式。
- **不要把真实 key 写进任何产物、工具参数或提交**。
