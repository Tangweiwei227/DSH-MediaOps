# 多模态模型配置

DSH-MediaOps 在 DSH 设置中提供独立的“多模态模型”页面，用于配置图像、视频、音乐和云端语音能力。配置完成后，bundled skills 通过 Host 受控工具使用这些模型；模型不会看到 API Key，浏览器也不能把已经保存的 Key 读回来。

配置按 DSH 的本地数据目录（data root）保存：同一 data root 下的会话与工作区共用提供商、凭证和默认选择。日常切换项目无需重配；换机器、`DSH_HOME` 或自定义 data root 后需安全迁移或重新配置。不同 profile 只有使用同一 data root 时才共享。

## 先完成一次生成

先配置你要用的那一类即可，不需要一次填满四类。以小红书配图为例：

1. 在“设置 → 多模态模型 → 图像”填写服务地址、模型和 Key，保存并设为默认。
2. 点击“离线验证”；这只检查填写格式，不验证余额或模型权限。
3. 回到有工作区的对话，发送：“为这篇稿件生成 1 张 3:4 配图，先给我方案，等我确认后调用模型。”
4. 核对 DSH 原生审批中的提供商、模型和规格，再批准请求。
5. 让 Agent 报告生成文件的位置；产物保存在当前工作区的 `outputs/` 中，不会自动发布。

模型服务可能单独计费。修改提示词不等于已经开始生成，真实请求以审批后返回的工具结果为准。

## 支持范围

| 类别 | Provider | 能力 |
|---|---|---|
| 图像 | OpenAI 兼容 / API 聚合服务 | 文生图、图生图、图片变体 |
| 视频 | DashScope、Ark、Kling、OpenAI 兼容、自托管 MaaS、Agnes | 文生视频、图生视频、部分模型原生音频 |
| 音乐 | DashScope、Suno 类兼容 API | 文生音乐、BGM、带歌词歌曲 |
| 语音 | DashScope、MiniMax、Fish Audio、OpenAI 兼容、Gemini | 文本转语音、预置音色、授权声音克隆 |

每个类别可以保存多个 Provider，并选择一个默认 Provider。每次运行只使用明确选中的默认项，不会自动故障转移。保存不完整的草稿配置是允许的，但只有“已启用 + 必填项齐全”的 Provider 才能执行。当前配置面板只有以上四组，不包含 ASR/语音转写模型组；相关本地或独立 Skill 不会因此自动获得转写 API。

## 在 DSH 中配置

1. 打开“设置 → 多模态模型”。
2. 选择模型类别和 Provider。
3. 填写 API 根地址、模型 ID 及必要参数。
4. 在密码框输入新 Key。密码框留空表示保留旧 Key，并不表示清空。
5. 开启 Provider，点击“保存并设为默认”。
6. 点击“离线验证”检查必填项和格式。该检查不联网、不会创建任务或产生模型费用。

要更换 Key，在密码框输入新值后保存。要清除 Key，使用字段旁的“清除”按钮。要删除该 Provider 的全部普通配置和秘密，使用“删除全部配置”。所有删除动作都会明确确认。

### Provider API 根地址与私网

- 公网 HTTP 始终拒绝，即使开启“允许私有网络地址”也不会放行；公网端点必须使用 HTTPS；
- `localhost`、`127.0.0.1`、`::1`、RFC1918 和 IPv6 ULA 只有在该 Provider 显式开启“允许私有网络地址”后才可访问；只有目标地址全部属于这些可明确识别的私网范围时，私网 HTTP 才可用；
- 私有 IP、保留 IP、单标签主机名和 `.local` / `.internal` / `.lan` 等内网名称默认拒绝；
- 自托管服务确需内网访问时，必须显式开启“允许私有网络地址”；该授权仅作用于所配置的 Provider API endpoint，不会传递给媒体下载地址；
- Host 在审批准备和实际执行前都会重新解析端点；真正发起请求时再解析一次，并只连接这一批已经验证的 IP，不让底层 HTTP 客户端二次解析。任一结果落入未授权的私有或保留地址就停止；每次 redirect 都对新目标重复这一过程；
- URL 不得携带用户名、密码、query 或 fragment；受控模型网络请求不继承 Host 的 HTTP(S) 代理环境。
- 云元数据主机及地址（包括 `169.254.169.254`、`169.254.170.2`、`fd00:ec2::254` 和常见 metadata 主机名）始终拒绝，开启私网也不例外；链路本地、多播、未指定、文档和其他保留网段也不会被私网开关放行。

## 秘密边界

秘密配置位于：

```text
<data-root>/secrets/multimodal-models.json
```

Host 创建 `secrets/` 为 `0700`、配置文件为 `0600`，使用跨进程目录锁、同目录临时文件、原子替换和最佳努力 fsync。文件是本机明文，不是加密保险库；仍应启用操作系统磁盘加密并保护 DSH data root。

以下位置不会保存或回传 API Key：

- `state.json`；
- 浏览器 GET/PUT/DELETE 响应；
- 对话上下文和 system prompt；
- DSH 原生审批文本；
- 工具参数、正常工具结果和插件日志；
- npm 安装目录或 workspace `.env`。

浏览器 DTO 中秘密字段只有 `configured: true/false`。API 更新必须为每个秘密明确指定：

```json
{
  "secretChanges": {
    "IMG_API_KEY": { "action": "keep" }
  }
}
```

可用动作是 `keep`、`replace`（同时传 `value`）和 `clear`。空字符串不能替代 `clear`。

## Host API

所有接口位于 `/api/dsh-mediaops`，继承插件的 loopback、localhost Host、same-origin、1 MiB 请求体和 `Cache-Control: no-store` 边界。

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/model-config` | 获取 Provider schema 和脱敏状态 |
| `PUT` | `/model-config/:group/:provider` | 更新普通字段及显式秘密变更 |
| `DELETE` | `/model-config/:group/:provider` | 删除该 Provider 的全部配置 |
| `POST` | `/model-config/:group/:provider/verify` | 离线验证启用状态、必填项和 URL 格式 |

`group` 为 `image`、`video`、`music` 或 `voice`。GET/写入响应的可引用字段包括：

- group：`id`、`label`、`description`、`selectedProvider`、`providers`；
- provider：`id`、`label`、`capabilities`、`enabled`、`selected`、`configured`、`ready`、`allowPrivateNetwork`、`missingRequired`、`updatedAt`；
- field：`key`、`label`、`required`、`secret`、`kind`、`choices`、`placeholder`、`help`；
- 非秘密 field 额外包含 `value`；秘密 field 只包含 `configured`，永远没有 `value`。

## Bundled skill 执行

远程媒体脚本不能从 bundled skill 直接通过 bash 启动。模型应调用：

```text
mediaops_run_model_script(script, argv)
```

`script` 只允许 `ai-image`、`ai-video`、`ai-music` 和 `voice-clone`；`argv` 第一项是相应脚本的允许子命令。Host 随后：

1. 从当前 DSH 会话取得绝对 workspace；
2. 校验固定脚本、子命令、flag 和参数数量，不接受 `--env-file`、shell 片段或 `--model` 覆盖；
3. 要求输入是 workspace 内的普通文件，图像和声音样本均有 Host 大小上限；输出根必须是实际目录而非符号链接，且只允许写入真实 workspace 的 `outputs/`；Host 把 workspace 与 `outputs/` 的 device/inode 身份注入受管子进程；
4. 读取选中 Provider，只投影该 Provider 的白名单环境变量；
5. 禁止受控进程自动合并 workspace `.env`；
6. 在审批与执行之间重新核对 Provider、实际模型、endpoint、私网开关、完整白名单环境、Python executable、参数和本地输入摘要；任一项变化即拒绝；
7. 对图像数量/质量/尺寸/分辨率、视频/音乐时长、轮询间隔/超时、语速设置 Host 范围；
8. 显示不含 prompt/Key 的 DSH 原生费用审批：Provider、实际模型、数量/时长/规格、输入 basename/字节数/SHA-256；声音 `enroll` 还必须明确提示上传样本与授权确认；
9. 把批准记录绑定到同一个 DSH exec 对象并一次性消费；执行时把本地输入复制到私有 staging，复制后的字节数与 SHA-256 必须等于批准值，脚本只读取只读 snapshot；
10. 先写入带 owner 进程身份和目录 inode 的非秘密 v2 pending 记录，再使用 `shell: false` 启动固定 Python 脚本；脚本必须在任何 Provider 请求前以 `O_NOFOLLOW`、`dir_fd` 复核并固定 workspace、`outputs/` 与目标父目录；
11. 对 stdout、stderr 和错误做精确 Key 替换、临时凭证字段脱敏，并对任何 HTTP(S) URL 去除 userinfo/query/fragment 后再返回。

### 远程响应与媒体下载

- 携带 Provider 鉴权的创建/轮询 API 不跟随 HTTP redirect，避免跨域转发 Authorization/API Key；
- 不携带 Provider 鉴权 header 的媒体下载最多跟随 3 次 redirect，每一跳都重新检查协议、URL 凭证、DNS 和私网/metadata 策略；Provider 的私网开关只授权其 API endpoint，供应商返回的媒体 URL 始终必须解析到公网地址；
- JSON 与错误体有独立字节上限；base64 先按编码长度拒绝超限；直返二进制同样流式限制；
- 图像、音频、视频上限分别为 64 MiB、256 MiB、1 GiB。下载同时检查 `Content-Length` 和流式累计；临时文件以 run ID 命名并通过已固定父目录的 `dir_fd` 创建，提交前复核其 inode，`fsync` 后再相对同一描述符原子替换。目标路径在慢速 Provider 请求期间被替换，也不会把产物写入替换后的目录；
- 受管语音转码把 FFmpeg 输出到预先打开、可 seek 的普通文件描述符，再走同一 fd-relative 原子提交；不会用不可 seek 的管道冒充 M4A/MP4 等容器输出；
- Python 异常和 SIGTERM 会清理本次 partial。模型子进程遭 SIGKILL、但 Host 与已批准目录身份保持正常时，Host 的 `finally` 会按本次 run ID 精确删除新旧 partial 并移除 pending 记录；
- 如果 Host 本身崩溃，启动/后续清理和定时 janitor 只会依据可信的 v2 pending 记录恢复：必须能明确判定记录中的 owner 进程已经死亡，并且 workspace 与 `outputs/` 的 device/inode 仍与记录一致。owner 仍活跃或身份无法确认时不会清理；v1、截断或畸形记录会保守保留，也不会读取其中的路径。因而这不是“任何 SIGKILL 残留都必然自动消失”的承诺；
- 所有受控模型 HTTP 请求都禁用环境代理，DNS 校验得到的地址就是实际连接地址；HTTPS 仍使用原始主机名完成 SNI 和证书校验。

### v0.2 bundled skill 集成限制

`ai-image-gen`、`ai-video-gen`、`ai-music` 和 `voice-clone` 已改为只使用上述受管工具。`tts-voiceover`、`multi-voice-dubbing` 的云端步骤必须按段/按行分别调用并审批；它们原有的内部批量 TTS 路径在 managed 模式不可用。`short-drama` 的 `drama_ops.py generate` 和 `dubbing.py align/dub` 尚未能映射为每个远程生成步骤独立的安全 argv+审批，因此 v0.2 的 DSH managed 模式仅支持其策划/剧本/分镜等不联网阶段，不宣称全自动远程批量生成已接入。

`mediaops_model_status` 可在对话中查看与设置页相同的脱敏状态。真实联网和计费只发生在用户批准的 `mediaops_run_model_script` 调用中；“离线验证”不代表供应商账号、余额或模型权限一定可用。
