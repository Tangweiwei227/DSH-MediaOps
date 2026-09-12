---
name: multi-voice-dubbing
description: >
  多角色对话配音：按 cast 和逐行对白为不同角色分配音色与情绪，合成多声线音轨和带角色名字幕。
  当用户说“多角色/双人/剧本/对话配音、多人对白、不同角色不同声音、有声剧配音”时使用。
  单一公共音色用 tts-voiceover；克隆本人音色用 voice-clone；整部短剧制作由 short-drama 编排。
layer: produce
---

# 多角色 / 对话配音（Multi-voice Dubbing）

把「多人对话 / 多角色脚本」合成为**多声线音轨**——每个角色一个符合其人设的声音，
不再是「全程一个声音」。本地编排可复用 `skills/shared/scripts/multivoice.py`，
但云端生成必须由 DSH Host 逐行受控调用，
把每行 emotion 喂进 provider 的**真情感通道**，`ffmpeg` 拼成一轨 + 生成对齐的说话人字幕。

> 创意（谁说什么、什么情绪）由你 LLM 产出；音色映射在 cast。确定性 IO（逐行合成/拼接/字幕）走引擎。
> 产物 `voice.mp3` 可直接当 narration 喂 `auto-short-video/assemble.py` 或加进任意视频；`voice.srt` 是带角色名的字幕。

## DSH 受管模式（最高优先级）

1. 先调用 `mediaops_model_status` 确认语音 provider 在 DSH-MediaOps 设置页就绪；不读写 `.env`，不索要/回显 key。
2. `lines.json` 中每一行云端配音都必须各自调用一次 `mediaops_run_model_script({"script":"voice-clone","argv":["clone",...]})` 并各自审批。
3. DSH managed 模式不得直接运行 `multivoice.py dub`、`tts.py` 或 `voice_clone.py`：这些组合路径会在内部批量调远程服务，无法保证逐次审批。受控生成后才可用本地确定性工具拼接音轨和 SRT。
4. edge-tts 远程合成尚未接入 managed runner，在 DSH 内不可作为自动降级路径。

## 配音质量分层（重要：治「像 AI 平读」）

**edge-tts 没有情感引擎**，只能变速变调，再怎么调也像机器平读。要"像人"必须用有情感通道的**云 provider**（用户自备 key，**无需 GPU**）：

| 引擎（cast 里 `engine`）| 质量 | 需要 | 情感机制 |
|---|---|---|---|
| `edge`（默认，免费兜底）| ⚠️ 平、机器感，仅供草稿 | 无 key、外网 | 仅 rate/pitch/volume 微调 |
| `clone`+`openai-compatible`→**SiliconFlow CosyVoice2**（推荐）| 好、中文自然 | VOICE_API_KEY（便宜/新用户赠额）| 内联 `<\|endofprompt\|>` 指令 |
| `clone`+`gemini` | 好、**真免费** | GEMINI_API_KEY（Google 免费层，国内需代理）| 自然语言前缀 |
| `clone`+`minimax` / `dashscope` | 好、有情绪 | 各家 key | emotion 枚举 / instruct |

**推荐 SiliconFlow**（云端 CosyVoice2、无需 GPU、中文最稳）可在 DSH-MediaOps 设置页选择 `openai-compatible`，并填入 endpoint、model 与 key。
cast 里角色：`--engine clone --provider openai-compatible --voice-id FunAudioLLM/CosyVoice2-0.5B:alex`（8 音色 alex/anna/benjamin/…）。

- **逐行 emotion 自动驱动演绎**：`lines.json` 每行的 `emotion`（愤怒/崩溃大哭/冷笑/温柔…）→ 引擎按 provider 转成对应情感参数。写具体越贴戏越好。
- 想要「像人」→ 至少给主角/关键角色配一个云 provider（`engine=clone`）；配了 key 才有情绪，没 key 自动回退 edge（平）并告警。
- provider 配置与脱敏校验统一使用 DSH-MediaOps 设置页 + `mediaops_model_status`。

## 谁会用到

短剧对白（short-drama 已内部委派）、**论文双人问答讲解**（paper-explainer：主讲+提问者）、
访谈/播客脚本、有声剧、任何「多个说话人」的口播。单人整段口播用 **tts-voiceover** 即可。

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| cast.json | 是 | 选角表：每个说话人 → 音色（edge 音色 + pitch/rate，或克隆音色）。含「旁白/主讲」条目 |
| lines.json | 是 | 逐行对白：有序 `[{speaker, text, emotion}]`（speaker 用 cast 里的名字；emotion 如 冷/怒/紧张/温柔，自动匹配语气） |
| 输出路径 | 否 | voice.mp3（默认与调用方约定）；voice.srt 同名 |

## 执行步骤

### 1. 选角（cast.json）——读选角指南定音色

先读 `skills/shared/references/voice-casting.md`（音色→人物原型对照 + 同性别区分 + 旁白独立 + 情绪韵律）。
为**每个说话人**定一个符合其性别/年龄/气质/身份的音色，旁白/主讲单列且与所有角色不同：

```bash
python skills/shared/scripts/multivoice.py cast init  --cast <路径>/cast.json
python skills/shared/scripts/multivoice.py cast add   --cast <路径>/cast.json \
    --name 林策 --role male_lead --voice zh-CN-YunxiNeural --rate=-5% --pitch=-3Hz --note "冷峻男主"   # 负值参数用等号
python skills/shared/scripts/multivoice.py cast add   --cast <路径>/cast.json \
    --name 苏晚 --role female_lead --voice zh-CN-XiaoxiaoNeural --note "温婉女主"
python skills/shared/scripts/multivoice.py cast check --cast <路径>/cast.json    # 校验：音色有效/旁白独立/无撞音色
```
> cast.json 也可直接写（就是 JSON）。想让某角色**像真人有情绪**（治 AI 平读）→ 该角色用云 provider：
> ```bash
> python skills/shared/scripts/multivoice.py cast add --cast <路径>/cast.json \
>     --name 霸总 --role male_lead --engine clone --provider minimax --voice-id <你的音色id> --note "克隆/表现力音色"
> ```
> provider 必须先在 DSH-MediaOps 设置页就绪；缺 key 时停止并引导配置，不自动回退到未受管的远程引擎。

### 2. 逐行对白（lines.json）

把脚本 / 对话稿拆成有序逐行：
```json
{"lines":[
  {"speaker":"主讲","text":"这篇论文解决了一个关键问题。","emotion":"平"},
  {"speaker":"提问","text":"等等，为什么现有方法不行？","emotion":"惊"},
  {"speaker":"主讲","text":"因为它们忽略了时序依赖。","emotion":"坚定"}
]}
```
speaker 必须与 cast 里的名字一致（不一致会回退旁白音色并告警）；emotion 可选。

### 3. 逐行受控合成 + 本地拼接

对每行生成独立输出，例如：`mediaops_run_model_script({"script":"voice-clone","argv":["clone","--text","这篇论文解决了一个关键问题。","--voice-id","<cast 中的音色>","--speed","1","--output","outputs/主题名/line-001.mp3"]})`。所有行完成后，使用不联网的音频拼接/字幕流程产出 `voice.mp3` + `voice.srt`，并确认多人对话至少 2 种声线。

### 4. 用到视频里

- `voice.mp3` 作 narration + `voice.srt` 作字幕，喂 `auto-short-video/scripts/assemble.py`（图/视频合成）。
- 或与 BGM 混音（**audio-mix**）、加进已有视频（**video-editing**）。

## 降级

- 缺外网/edge-tts 不通 → 无法合成，如实告知（多声线依赖 edge-tts）。
- cast 指定克隆音色但配置缺失/失败 → 停止该行，如实告知并请用户修复设置；不绕过审批降级。
- 说话人不在 cast → 回退旁白音色并告警（建议补进 cast）。

## Profile 感知

- **有 Profile**：`style.md` 融进音色气质选择（角色气质→音色）；`preferences.md` 红线过滤台词。
- **无 Profile**：按 voice-casting.md 默认对照选音色。

## 规则

1. **多人对话必须多声线**：每个说话人独立音色、旁白/主讲单列——绝不允许全程一个声音（`cast check` + `dub` 声线数把关）。
2. **要像人就上云 provider**：edge 只配草稿；成品/关键角色用 `engine=clone`+provider（有真情感通道），无需 GPU。
3. **音色贴人物**：按 voice-casting.md 的原型对照 + 同性别用 pitch/rate 区分。
4. **情绪标注要具体**：lines 每行标 emotion（愤怒/崩溃大哭/冷笑/温柔…），会喂进 provider 情感通道驱动演绎。
5. **确定性留档**：cast.json / lines.json 落文件，改台词/换音色重跑 `dub` 即可，不必重来。

## 参考来源

见 `EASEL-META.md`。多声线配音（cast + 逐行 lines + 按角色音色逐行合成 + ffmpeg 拼接 + 说话人字幕）为 Easel 自研；
底层封装 edge-tts（tts.py）与云端克隆（voice_clone.py）。
