---
name: tts-voiceover
description: "文字转语音配音：把文案/脚本合成为 AI 语音口播、旁白、朗读音频。DSH managed 模式使用设置页的云 TTS，每个远程合成步骤通过 mediaops_run_model_script 独立审批；可在生成后本地拼接 SRT 字幕及 mp3/wav/m4a。当用户说“配音”“文字转语音”“TTS”“AI 配音”“口播语音”“旁白”“朗读”“把这段文字读出来”“生成语音”“语音合成”时使用。"
layer: produce
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# 文字转语音配音（TTS Voiceover）

## DSH 受管模式（最高优先级）

把文案 / 脚本合成为 AI 语音（口播、旁白、朗读）时：

1. 先调用 `mediaops_model_status` 确认语音 provider 已在 DSH-MediaOps 设置页就绪；不读写 `.env`、不索要 key。
2. 每个远程合成步骤必须单独调用 `mediaops_run_model_script({"script":"voice-clone","argv":["clone",...]})` 并各自审批。长文本如分句，每句是一次独立的远程调用。
3. DSH managed 模式禁止直接运行 `tts.py` 的云 TTS，因为它会在内部绕过逐次审批。edge-tts 远程合成当前也未接入 managed runner，在 DSH 内暂不可用。
4. 可在每句受控合成后，使用本地确定性音频工具拼接音轨/生成 SRT。

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| text / file | 是 | 待配音的文本，或文本文件路径（长文本推荐 --file） |
| voice | 否 | 音色，默认 `zh-CN-XiaoxiaoNeural`（晓晓） |
| rate/volume/pitch | 否 | 语速 / 音量 / 音调微调 |
| output | 否 | 默认 `outputs/主题名/{name}.mp3` |

## 输出

- 配音音频文件（mp3，可选 wav/m4a），放入 `outputs/主题名/`
- 可选同步输出 SRT 字幕（`--subtitle`），供视频烧字幕用
- 打印实际执行的 edge-tts 命令 + 输出文件时长/大小/音色

## 受管执行

单段示例：`mediaops_run_model_script({"script":"voice-clone","argv":["clone","--text","欢迎来到本期内容","--voice-id","alloy","--speed","1","--output","outputs/主题名/intro.mp3"]})`

## 本地后处理

受控语音产物可按需接下游本地脚本，无需重造能力：

配音出来后按需接下游脚本，无需在本 SKILL 重造能力：

```bash
# ① 配音 + BGM 混音（原声 1.0 / BGM 0.3）→ 用 audio_ops concat / video_ops bgm
python skills/shared/scripts/video_ops.py bgm -i vo.mp3 -o vo_bgm.mp3 \
  --music bgm.mp3 --voice-volume 1.0 --music-volume 0.3

# ② 配音音量归一化到社媒响度（-14 LUFS）
python skills/shared/scripts/audio_ops.py normalize vo.mp3 -o vo_norm.mp3

# ③ 把配音作为旁白加到视频
python skills/shared/scripts/video_ops.py bgm -i clip.mp4 -o clip_vo.mp4 \
  --music vo.mp3 --voice-volume 0.4 --music-volume 1.0
```

## 常用中文音色

| 音色 | 特点 |
|------|------|
| `zh-CN-XiaoxiaoNeural` | 晓晓 · 女声，温暖亲和，通用首选（默认） |
| `zh-CN-XiaoyiNeural` | 晓伊 · 女声，活泼年轻，口播/种草 |
| `zh-CN-YunxiNeural` | 云希 · 男声，清朗自然，旁白/解说 |
| `zh-CN-YunyangNeural` | 云扬 · 男声，专业沉稳，新闻/播报 |
| `zh-CN-YunjianNeural` | 云健 · 男声，浑厚有力，激情内容 |

粤语用 `zh-HK-HiuMaanNeural`（曉曼），台式用 `zh-TW-HsiaoChenNeural`（曉臻）。

## 规则

1. **绝不覆盖原始素材** — 只写新文件到 `outputs/主题名/`。
2. **长文本分段** — 每段单独受控调用/审批，不用 shell 拼接。
3. **配置只走设置页** — 不在 workspace 保存 provider 密钥。
4. **不重造能力** — 混音/归一化/加视频旁白复用 audio_ops.py / video_ops.py。
5. **无 Profile 也能用** — 无画像时用默认音色晓晓。

## Profile 感知

有 Profile 时可读取账号偏好音色 / 语速 / 平台调性（如口播偏活泼晓伊、
知识类偏沉稳云扬）作为默认参数；无 Profile 退到通用默认（晓晓、正常语速）。
