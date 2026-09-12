---
name: ai-music
description: "AI 音乐 / BGM 生成：给短视频、社媒内容生成原创背景音乐 / 配乐 / 纯音乐。通过可插拔 provider（阿里 DashScope / Suno 类第三方 API）文生音乐，异步提交→轮询→下载，产物可再裁剪/归一化或加到视频。当用户说“AI 音乐”“AI 配乐”“生成 BGM”“背景音乐”“原创音乐”“AI 作曲”“纯音乐”“给视频配乐”“做首曲子”时使用。与 tts-voiceover 的区别：tts-voiceover 生成人声口播/旁白，ai-music 生成背景音乐/配乐（无人声或带演唱）。"
layer: produce
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# AI 音乐 / BGM 生成（AI Music）

给短视频、Vlog、社媒内容生成**原创背景音乐 / 配乐 / 纯音乐**。DSH 通过 Host 受控运行器调用音乐生成 API，
异步提交 → 轮询 → 有界下载。生成的音乐可再交给 `audio_ops.py` / `video_ops.py`
做裁剪、归一化或加到视频。

**边界**：本 SKILL 只做背景音乐 / 配乐。要**人声口播 / 旁白 / 朗读**用 `tts-voiceover`。

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| prompt | 是 | 风格 / 情绪 / 乐器描述（如“轻快 lo-fi，钢琴+鼓点，vlog 片头”） |
| provider | 否 | 由 DSH-MediaOps 设置页选定 `dashscope` 或 `suno-compatible` |
| lyrics | 否 | 歌词（提供后走带演唱模式，不再是纯音乐） |
| duration | 否 | 时长（秒），部分 provider 支持 |
| instrumental | 否 | 纯音乐（无人声 BGM） |
| output | 否 | 默认 `outputs/主题名/{name}.mp3` |

## 输出

- 音乐音频文件（mp3，放入 `outputs/主题名/`）
- 打印实际提交的 provider / model、任务轮询过程、最终输出路径

## DSH 受管模式（最高优先级）

1. 在 DSH-MediaOps 设置页的“多模态模型”配置 provider/key/模型，先调用 `mediaops_model_status` 读脱敏状态。
2. 不得读写 `.env`，不得直接执行 `ai_music.py`/`model_registry.py`，不得传 `--env-file` 或 `--model`，也不得把 key 放入对话或工具参数。
3. 每一次远程生成都必须单独调用 `mediaops_run_model_script` 并通过 DSH 原生审批；时长、轮询和超时由 Host 设上限。

## 执行步骤

### 1. 先用 `mediaops_model_status` 检查配置（不发请求）

配置未就绪时，请用户去设置页补齐。

### 2. 生成音乐 generate

`mediaops_run_model_script({"script":"ai-music","argv":["generate","--prompt","轻快的 lo-fi 嘻哈，钢琴 + 柔和鼓点，适合 vlog 片头","--duration","30","--instrumental","--output","outputs/主题名/vlog-bgm.mp3"]})`

带演唱时将已读取的歌词文本作为 `--lyrics` 后一个 argv 值；不要使用 shell 替换或拼接命令。

`--poll-interval`（轮询间隔，默认 5s）、`--timeout`（超时，默认 300s）可按需调。

### 3. 后处理（可选，复用已有共享脚本，不在本 SKILL 重造）

```bash
# ① 裁剪到片头需要的长度
python skills/shared/scripts/audio_ops.py trim outputs/主题名/vlog-bgm.mp3 \
  -o outputs/主题名/bgm-8s.mp3 --duration 8

# ② 归一化到社媒响度（-14 LUFS）
python skills/shared/scripts/audio_ops.py normalize outputs/主题名/vlog-bgm.mp3 \
  -o outputs/主题名/bgm-norm.mp3

# ③ 把 BGM 加到视频（可调原声/BGM 音量比，自动循环并截断）
python skills/shared/scripts/video_ops.py bgm -i clip.mp4 -o clip_bgm.mp4 \
  --music outputs/主题名/vlog-bgm.mp3 --voice-volume 1.0 --music-volume 0.3
```

## 规则

1. **先 status 再 generate** — 用 `mediaops_model_status` 检查，不浪费一次失败请求。
2. **绝不覆盖原始素材** — 只写新文件到 `outputs/主题名/`。
3. **不重造能力** — 裁剪 / 归一化 / 加视频 BGM 复用 `audio_ops.py` / `video_ops.py`。
4. **provider 可插拔** — 换服务商只改 DSH-MediaOps 设置页，SKILL 流程不变。
5. **与 tts-voiceover 分工** — 背景音乐/配乐找 ai-music，人声配音找 tts-voiceover。
   两者可组合：ai-music 出 BGM + tts-voiceover 出旁白 → `video_ops.py bgm` 混音。
