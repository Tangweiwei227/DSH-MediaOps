---
name: voice-clone
description: "上传本人语音样本克隆专属音色，再用它合成口播、旁白或带货语音。当用户说“声音克隆、克隆/复刻我的声音、用我的声音配音、定制专属音色”时使用，需要用户自备云端 provider 凭证。使用公共现成音色时改用 tts-voiceover。"
layer: produce
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# 声音克隆配音

> 用本人或已获明确授权的语音样本克隆音色，再合成任意文案。云端 provider 由 DSH Host 受管调用，本地无需 GPU。

> 不想克隆、用现成公共音色见 **tts-voiceover**（edge-tts，免费无需 key）；
> AI 生成音乐/BGM 见 **ai-music**；合成后与 BGM 混音见 **audio-mix**。

## DSH 受管模式（最高优先级）

1. 在 DSH-MediaOps 设置页的“多模态模型”配置语音 provider，先调用 `mediaops_model_status` 读脱敏状态。
2. 不得读写 `.env`，不得直接执行 `voice_clone.py`/`model_registry.py`，不得传 `--env-file` 或 `--model`，不得索要/回显 key。
3. `enroll` 和 `clone` 必须分别调用 `mediaops_run_model_script` 并分别审批。`enroll` 审批会明示说明“上传声音样本/创建可复用音色”；只有用户确认拥有声音权利或已获得被采集者明确授权才能批准。

| provider | 服务 | DSH 设置页字段 |
|----------|------|----------|
| `dashscope` | 阿里 CosyVoice 声音复刻 | `DASHSCOPE_API_KEY`（可选 `DASHSCOPE_TTS_MODEL`/`DASHSCOPE_BASE_URL`） |
| `minimax` | MiniMax 语音克隆 | `MINIMAX_API_KEY`、`MINIMAX_GROUP_ID`（可选 `MINIMAX_MODEL`） |
| `fish-audio` | Fish Audio | `FISH_API_KEY`（可选 `FISH_BASE_URL`） |
| `openai-compatible` | OpenAI 兼容 /audio/speech | `VOICE_API_KEY`、`VOICE_BASE_URL`（预置 voice，非零样本克隆） |
| `gemini` | Google Gemini TTS | `GEMINI_API_KEY`（可选 `GEMINI_TTS_MODEL`/`GEMINI_VOICE`/`GEMINI_BASE_URL`） |

> ⚠️ 各 provider 依公开 API 文档实现；端点/模型名只在 DSH-MediaOps 设置页调整。

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| 语音样本 | 克隆时必填 | 本人清晰无噪的语音（一般 10s-1min，具体看 provider 要求） |
| 文案 | 合成时必填 | 要用克隆音色说出来的文字 |

## 输出（`outputs/主题名/`）

- 合成的语音音频（mp3/wav）

## 执行步骤

### 1. 登记音色（enroll，得到 voice_id）
`mediaops_run_model_script({"script":"voice-clone","argv":["enroll","--sample","me.mp3","--name","my_voice"]})`

DashScope 如需 provider 可访问的 HTTPS 样本，可用 `--sample-url`；审批仅显示主机名，不回显路径/query。
（fish-audio 用已有 model_id 或内联参考音频，openai-compatible 用预置 voice 名，无需 enroll。）

### 2. 合成（clone）
`mediaops_run_model_script({"script":"voice-clone","argv":["clone","--voice-id","my_voice","--text","大家好，欢迎来到我的频道","--speed","1.0","--output","outputs/主题名/vo.mp3"]})`
fish-audio 也可直接给参考音频：`--sample ref.mp3 --sample-text "参考音频的文字"`。

## 合规红线（必须遵守）

1. **只能克隆你有权使用的声音**（本人，或已获明确授权的人）。
2. **不得克隆他人/名人声音用于误导、诈骗、冒充、伪造**。
3. 合成内容不得用于虚假信息或侵权用途。
   —— 越线不做，并向用户说明。

## 规则

1. 样本质量决定克隆效果：清晰、无背景噪、语气自然、时长足够。
2. 先用 `mediaops_model_status` 确认配置，再分别审批 enroll 与 clone。
3. 合成语音可接 **audio-mix** 加 BGM、接 **auto-subtitle** 出字幕、接视频。
4. 产物统一进 `outputs/主题名/`。

## 参考来源

主流声音克隆云服务：阿里 CosyVoice（声音复刻）、MiniMax（语音克隆 + T2A）、Fish Audio、
OpenAI 兼容 TTS。本地零样本克隆（GPT-SoVITS/CosyVoice 本地）需 GPU，故走云端 provider。
