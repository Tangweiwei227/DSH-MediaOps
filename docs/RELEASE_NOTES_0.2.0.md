# DSH-MediaOps 0.2.0

DSH-MediaOps 0.2.0 把多模态生产、四类资料引用和工程发布门禁接入现有的 AI 原生媒体运营闭环。

## 新增

- 在 DSH 设置页统一配置图像、视频、音乐和云端语音四组模型；覆盖 14 个 Provider 适配项，每类可保存多个配置并明确选择一个默认项。运行时不自动故障转移，当前不含受管 ASR/语音转写组。
- API Key 采用 Host-only 存储和 `keep / replace / clear` 更新语义；浏览器、工具参数、审批和正常日志不回传密钥。
- 新增 `mediaops_model_status` 与受控 `mediaops_run_model_script`，固定脚本、子命令和参数范围，计费或数据外发前显示 DSH 原生审批。
- `@选题库 / @爆款库 / @草稿 / @发布记录` 使用一次统一查询；草稿有长度上限与来源声明，发布记录只暴露脱敏安全投影。
- 新增完整中文插件说明书和独立官网源码。

## 修复与加固

- 修复 YAML frontmatter 的 folded/literal block scalar、chomping、显式缩进、CRLF 和 quoted `#` 解析，并把 112 个 bundled Skills 纳入 lint。
- 为上游 Easel 快照增加确定性内容摘要、离线发布门禁、每周 drift 检查和只生成候选报告的安全同步流程。
- 多模态网络访问增加 URL、DNS、私网和云元数据边界；公网 HTTP 始终拒绝，只有显式 opt-in 且全部解析到 loopback/RFC1918/ULA 时才允许私网 HTTP。请求禁用环境代理并固定一次解析得到的已验证 IP，HTTPS 保留原主机名校验；API 请求禁止重定向，媒体下载逐跳重新固定公网 HTTPS 目标且永不继承 Provider 私网许可。
- 模型 runner 禁止任意模型覆盖和 shell 执行，限制数量、规格、时长、轮询、超时及输入文件大小；审批与同一 exec 一次性绑定，执行前重验配置/参数/输入，并以获批大小与 SHA-256 创建只读输入 snapshot。
- Host 在 Provider 请求前把 workspace/`outputs/` device/inode 注入脚本；脚本用 `O_NOFOLLOW`、逐级 `dir_fd` 固定目标父目录，partial 的创建、复核、`fsync`、替换与删除都相对该描述符执行。受管 FFmpeg 转码使用预先打开、可 seek 的输出 fd。
- 失败或 SIGTERM 保留旧产物并清理 partial；模型子进程遭 SIGKILL、Host 与已批准目录身份保持正常时由 `finally` 按 run ID 精确清理。Host 崩溃后的恢复仅信任 v2 pending 记录，并且只在 owner 明确死亡且目录 inode 仍匹配时执行；活跃/身份未知 owner 以及 v1/畸形记录会保守保留。
- 发布 adapter 在所有执行边界统一脱敏 stdout、stderr 和错误。
- 新增 adapter、路由、引用、客户端触发器、模型配置、上游摘要和 frontmatter 测试。

## GitHub Issues

- 关闭 #1：frontmatter 块标量解析已修复并回归测试。
- #5：交付四库统一 `@` 引用；完整层级按需展开仍受当前 DSH provider 协议限制，Issue 保持开放。
- #6：交付 parser、adapter、client、上游快照与漂移门禁切片；routes smoke 与持久化迁移继续在 Issue 中跟踪。
- #2、#3、#4 已完成可行性审查和安全拆分，不把模糊回查、无人值守未来授权或任意数据源 URL 冒充已完成能力。

完整边界与后续顺序见 [`ISSUE_TRIAGE_2026-09-12.md`](https://github.com/Tangweiwei227/DSH-MediaOps/blob/main/docs/ISSUE_TRIAGE_2026-09-12.md)。

## 升级

要求 Node.js 22.19+ 或 24+，以及可从 `PATH` 找到的 pnpm。

```sh
dsh plugin --profile desktop add github:Tangweiwei227/DSH-MediaOps
```

升级后完全退出并重启 DSH Desktop。已有 MediaOps 状态保留；模型 API Key 需要在新设置页单独配置。
