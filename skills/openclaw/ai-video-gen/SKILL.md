---
name: ai-video-gen
description: "AI 视频生成：文生视频 / 图生视频 / 数字人首帧驱动。通过可插拔 provider（通义万相 Wan / 火山 Seedance / 快手可灵 / OpenAI 兼容）异步生成视频，用户自备 API key。当用户说 AI 视频生成、文生视频、图生视频、AI 生成视频、AI 短视频、让图片动起来、数字人视频、生成一段视频 时使用。与 video-strategy（选型/策略）、video-editing（剪辑处理）、clipify（切片）区别：本 SKILL 是从 0 用 AI 生成新视频。"
layer: produce
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# AI 视频生成

> 文生视频 / 图生视频 / 数字人首帧驱动。多 provider 异步提交→轮询→有界下载。API Key 由 DSH Host 安全注入。

## DSH 受管模式（最高优先级）

1. 让用户在 DSH-MediaOps 设置页的“多模态模型”中配置/选中视频 provider，先调用 `mediaops_model_status` 读脱敏状态。
2. 不得读写 workspace `.env`，不得直接运行 `ai_video.py`/`model_registry.py`，不得传 `--env-file` 或 `--model`。Host 锁定已配置的 provider/模型。
3. 每一个远程视频生成都单独调用 `mediaops_run_model_script`、单独审批；不得用批处理脚本绕过逐个审批。
4. `probe-dialogue` 会发起额外付费生成，当前不在 managed runner 允许列表；在 DSH 内不可用。

## 输入

> **画幅确认硬门**：用户或上游任务未明确横版/竖版（或 16:9/9:16/具体比例）时，任何生成/付费调用前必须追问并等确认；不得从平台、Profile 或脚本默认值静默推断。已明确则不重复问。

- 文生视频：画面/镜头/风格描述（prompt）
- 图生视频：一张输入图（本地路径或 URL）+ 可选运动描述
- 可选：时长 `--duration`、画幅 `--ratio`（16:9 / 9:16 / 1:1）、原生音频 `--audio auto|on|off`。模型只能在设置页选定。

## 输出

生成的视频文件；必须用 `-o` 指定到 `outputs/主题名/`。异步任务自动轮询到完成再下载。

## 执行步骤

1. **确认配置**：调用 `mediaops_model_status`；未就绪时请用户去设置页补齐，不索要 key。
2. **写好 prompt**：AI 视频对 prompt 敏感，按 [AI 视频提示词规范](../video-strategy/references/ai-video-prompting.md) 写镜头、运镜、风格与时长。竖版短视频用 `--ratio 9:16`。
3. **文生视频**：
   `mediaops_run_model_script({"script":"ai-video","argv":["text2video","--prompt","海边日落，慢镜头推进，暖色调，电影感","--ratio","9:16","--duration","5","--audio","auto","--output","outputs/主题名/clip.mp4"]})`
4. **图生视频 / 让图动起来 / 数字人首帧**：
   `mediaops_run_model_script({"script":"ai-video","argv":["image2video","--image","outputs/主题名/cover.png","--prompt","人物微笑挥手，头发轻微飘动","--ratio","9:16","--output","outputs/主题名/clip.mp4"]})`
5. **后续加工**：生成的片段可交给 `video_ops.py`（拼接/加字幕/加 BGM/横竖转）、`auto-subtitle`（字幕）、`tts-voiceover`（配音）串成成片，或直接进 `auto-short-video` 端到端流程。

## Profile 感知

- 有 Profile：从 `style.md` 取视觉风格倾向注入 prompt；`platforms.md` 只用于给出画幅建议，不能替代用户确认。
- 无 Profile：先确认横版/竖版，再按已确认比例生成。

## 注意

- 视频生成 API 均为异步且**耗时较长**（数十秒到数分钟）+ **按量计费**，先与用户确认。
- 各 provider 的 model 名/字段各版本有差异；只能在 DSH-MediaOps 设置页调整，managed 运行禁止 `--model` 覆盖。
- `--audio auto` 只按 capability profile 映射已知字段；能力声明不等于质量保证，下载后仍须 ffprobe/ASR/视觉审计。网关默认有声但开关字段未知时，不猜测注入参数。
