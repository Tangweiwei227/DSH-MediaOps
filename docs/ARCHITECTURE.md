# DSH-MediaOps 架构

DSH-MediaOps 是一个同时包含 Host、浏览器 Client 和 112 个 bundled skills 的原生 DSH 插件。对话是主界面；本地状态、外部网络和真实发布等副作用由 Host 控制。

## 总体结构

```text
DSH Client
  ├─ @：选题库 / 爆款库
  ├─ /：五个对话工作流
  └─ MediaOps 工作台：概览 / 选题 / 爆款 / 草稿 / 发布队列
              │ same-origin loopback API
              ▼
DSH Host
  ├─ 参数化 Agent tools + system prompt
  ├─ 三处 tools/pre-execute 原生审批
  ├─ MediaOpsService + schema v5 state machine
  ├─ PublisherAdapter（账号探针、dry-run、无 shell 执行）
  ├─ TrendService（第三方热榜、缓存、归一化）
  ├─ MediaOpsStore（跨 Host 文件锁 + 原子 JSON）
  └─ SkillProvider（112 个 Easel skills）
              │
              ▼
冻结载荷 → 账号复核 → 平台/API/浏览器 → 已接受状态 → 只读对账 → published
```

`cordis.patch.yml` 插入 `id: mediaops`、`name: dsh-mediaops`。Host 入口是 `lib/index.js`，浏览器入口是 `lib/client.js`；React 与 DSH 客户端服务由宿主提供。

## Host 组件

`src/index.ts` 注册：

1. bundled Skill provider；
2. 热点、资料库、草稿与发布工具；
3. `/api/dsh-mediaops` 本地 API；
4. `tools/pre-execute` 审批 hook；
5. Agent system prompt；
6. 每五分钟运行一次的 staging janitor。

审批 hook 对三类动作返回 `ask`：

- `mediaops_confirm_publish(confirm=true)`：签发一次性发布授权，但不触网；
- `mediaops_execute_publish`：运行真实平台 adapter；
- `mediaops_record_publish_result`：在中断或平台已接受后人工对账回填。

审批说明从 Host 中的冻结记录生成，包含平台、账号标签与身份指纹、workspace、标题、正文字符数/哈希/预览、素材的安全工作区相对路径（越界时仅 basename）/大小/哈希、定时、平台参数和 `payloadDigest`。所有展示字段会移除控制符与双向文本控制字符并限长，末尾固定重复动作与 `payloadDigest`；模型不能用自报说明替换这些字段。下游策略拒绝时保持拒绝；否则必须得到本次 DSH 原生一次性批准，拒绝、超时或当前表层无法完成审批时不会静默放行。

### MediaOpsService

业务服务负责：

- 爆款按 URL 或「平台 + 标题」合并；
- 爆款转选题并保留 `sourceViralIds` 与来源链接；
- 选题、草稿与跨平台关系；
- 草稿 revision 与待发布预览失效；
- Host 权威 workspace、素材冻结与摘要；
- 发布令牌、幂等键、执行租约与状态机；
- 同一草稿 revision 的多平台 `partially_published` / `published` 汇总，避免旧回执改写新稿；
- 过期预览与孤儿 staging 清理。

普通保存工具不能直接写入选题/草稿的发布完成状态。只有有证据的发布结果能推进这些状态。

### PublisherAdapter

Adapter 将 7 个平台映射到固定 Python 脚本与参数数组。它不接受任意命令，不使用 shell，不把长正文放进 argv，而是传入冻结的 `body.md` 路径。环境变量采用 allowlist，并限制 Publisher stdout/stderr 大小、执行时间和终止流程；常见凭证格式会被脱敏。

预检阶段先运行平台账号探针，再运行去掉 `--exec` 的同一 adapter dry-run。执行阶段再次探测账号，并要求稳定的非敏感 SHA-256 身份指纹与预览完全一致，之后才启动 Publisher 进程。

平台成功退出仅说明平台接受了请求：

| 条件 | 记录状态 |
|---|---|
| 小红书、抖音、快手、视频号、知乎、Bilibili 即时投稿 | `submitted` |
| 微信公众号返回草稿 `media_id` | `draft_created` |
| Bilibili 带冻结定时时间 | `scheduled` |
| 后续只读对账取得公开内容或正式平台证据 | `published` |

微信公众号不自动群发；Bilibili 定时必须至少提前 4 小时。其他受控 adapter 不接受 `scheduledAt`。

### TrendService

支持微博、抖音、知乎、头条、小红书、B站、百度、AI 新闻和 IT 新闻。每个平台独立尝试来源并归一化为：

```text
platform, title, url, hot, author, summary, rank, source
```

缓存只存在 Host 内存中。单个平台失败不掩盖其他结果；第三方热榜内容始终是不可信候选数据。

### 本地 API

Client 通过 `/api/dsh-mediaops` 访问 Host。HTTP 边界：

- 仅允许 loopback 地址和 localhost/loopback Host；
- 浏览器请求必须 same-origin，拒绝 cross-site；
- JSON 请求体上限 1 MiB；
- 响应使用 JSON、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`；
- API 不暴露确认令牌摘要、执行租约 ID、完整正文或冻结文件路径。

发布列表使用最小化的 `PublicationView`，只包含安全展示所需的状态、平台、标题、账号标签、正文摘要与哈希、素材数量、冻结载荷摘要和结果；账号身份指纹、workspace、素材来源、平台私有参数、幂等键与冻结文件路径不会经本地 API 暴露。

## Client

Client 只负责交互和展示，不持有权威状态，也不直接访问状态文件或发布平台。

### `@` 引用

`mediaops-library` 并行搜索选题库与爆款库。输入框保存稳定引用；消息提交时才由 Host 序列化为 `<mediaops_reference>`：

- 所有字段 XML 转义；
- 每条引用受 `maxReferenceChars` 限制；
- 带 provenance 声明，明确它是资料而非指令；
- 被删除或损坏的引用显式报错。

只有从 DSH `@` 候选中选择的条目才具有该结构化引用身份；手工键入或粘贴形似 `@标题` 的普通文本不会被提升为资料库引用。

### `/` 工作流

`mediaops-actions` 提供热点发现、爆款转选题、基于选题创作、审核发布和每日盘点五个自然语言模板。模板只启动对话，不绕过工具验证或审批。

### 工作台

同一 `MediaOpsWorkbench` 挂载到 `conversation.view` 和 `settings.section`，展示概览、选题、爆款、草稿和发布队列；复杂研究、创作和真实发布仍走对话工具。

## Bundled skills

112 个 Easel Skill 位于 `skills/openclaw/`，共享脚本和资料位于 `skills/shared/`。Provider 惰性读取定义，用户/项目的同名 Skill 以更高 rank 覆写 bundled 版本。

运行时约定：

- `resourceBase` 只读，用于代码、references 与 assets；
- 相对 Skill 路径由 provider 展开为安装包中的绝对路径；
- 一般业务脚本在当前对话 workspace 运行，产物写 `outputs/`；
- `DSH_MEDIAOPS_DATA_DIR` 指向 Host 解析后的 data root；
- Cookie、Token、配置和浏览器 profile 只能写 data root，不能写 npm 安装目录；
- 发布层中 13 个带外部写入或派发路径的 Host-only Skill，其 `modelInvocable` 与 `userInvocable` 都为 `false`；7 个只读/生成型 Skill 保持可用。平台 Publisher 脚本只能由 Host adapter 使用，不能从 Skill 文本自行添加 `--exec`。

上游来源中的旧根目录与旧 profile 约定仅是历史背景；DSH-MediaOps runtime 约定优先。

## 路径与持久化

### Workspace

普通 bundled Skill 按下列顺序解析 workspace：

1. `DSH_MEDIAOPS_WORKSPACE`；
2. `EASEL_ROOT`（上游兼容）；
3. 当前进程 `cwd`。

真实发布使用当前 DSH Agent 会话的绝对 `session.header.cwd`，而不是模型参数。预检对该路径做 `realpath`，要求发布素材是 workspace 内的普通文件、绝对路径且非符号链接。

### Data root

1. `config.dataDir`；
2. `DSH_MEDIAOPS_DATA_DIR`；
3. `$DSH_HOME/mediaops`；
4. `~/.dsh/mediaops`。

data root 包含 schema v5 `state.json`、`staging/`、`preflight/`、`wechat-publisher.yaml`、`credentials/` 和 `browser-profiles/`。插件尽力保持目录 `0700`、文件 `0600`。

### Schema v5

| 实体 | 关键关系 | 状态 |
|---|---|---|
| `Topic` | `sourceViralIds`、参考资料 | `idea → researching → planned → drafting → ready → published`，或 `archived` |
| `ViralItem` | 来源、URL、热度、拆解 | 用 `firstSeenAt` / `lastSeenAt` 跟踪重复发现 |
| `Draft` | revision、`topicId`、多个平台、素材 | `draft → review → ready → partially_published → published`，或 `archived` |
| `Publication` | 草稿 revision、平台、快照、digest、账号身份、租约 | `preview / confirmed / publishing / submitted / draft_created / scheduled / published / failed / cancelled` |

Store 每次读取都校验深层结构、状态、ID 唯一性和 snapshot digest。mutation 先取得跨 Host 文件锁、重新读取最新文件、在副本上校验，再通过唯一临时文件、fsync 与 rename 提交；状态文件上限 16 MiB。它仍是单机 JSON store，不是多用户数据库，也没有字段级加密或云同步。

v1-v4 状态会迁移到 v5。`published`、`failed`、`cancelled` 以及已接受的 `submitted`、`draft_created`、`scheduled` 保留；旧 `preview`、`confirmed`、`publishing` 因缺少完整可信冻结信息而变为 `cancelled`，旧令牌和执行租约被清空。

## 不可变发布载荷

`mediaops_prepare_publish` 的 workspace 来自 DSH 会话。它先读取草稿 revision，完成账号探针/dry-run，再冻结：

- 草稿 ID、revision 与 `updatedAt`；
- workspace realpath；
- 标题和完整正文；
- 冻结 `body.md` 与 SHA-256；
- 每个素材的来源路径、冻结路径、大小和 SHA-256；
- 平台、账号标签和稳定身份指纹；
- 定时、Host 预检证据和白名单化的 `publisherOptions`；
- 稳定 JSON 的 SHA-256 `payloadDigest`。

素材限制：绝对本地路径、workspace 内、普通文件、非 symlink；最多 20 个，单个不超过 2 GiB、单次合计不超过 4 GiB，并保留 256 MiB 空间。跨预览 staging 由跨进程目录锁串行分配，总量上限 6 GiB；staging 根目录及条目拒绝 symlink。复制后会复核源文件 inode/大小/mtime，执行前再复核冻结文件大小和哈希。

微信公众号正文只接受可枚举的本地 Markdown 图片 `![说明](路径)`；远程/data URI、引用式图片和原始 HTML `<img>` 被拒绝。正文图片会一并冻结并改写。内置 theme 名称、author 和 theme 文件 SHA-256 也进入快照；执行时 theme 文件摘要变化会停止发布。

## 发布状态机

```text
ready / partially_published draft
    │ Host account probe + fixed argv dry-run
    ▼
preview（30 分钟令牌；完整分页预览）
    │ 用户明确确认 + DSH 原生审批
    ▼
confirmed
    │ DSH 再审批 + 冻结哈希复核 + 执行租约 + 账号身份复核
    ▼
publishing
    ├─ publisher 未启动且有明确错误 ─────────────► failed
    ├─ 平台接受 ─► submitted / draft_created / scheduled
    │                 └─ 只读平台证据 + 原生审批 ─► published
    └─ 启动后超时/中断/非零/回执落盘失败 ──────► publishing（待对账）

preview / confirmed ─► cancelled
```

### 1. 预检与冻结

浏览器平台的 `accountKey` 必须与 `whoami` 返回名称精确一致；微信公众号使用 YAML account key。探针必须返回 64 位非敏感身份指纹。Host dry-run 不能带 `--exec`，预检期间草稿 revision 变化会使准备失败。

同一草稿/平台的新 preview 会取消旧 preview；存在 `confirmed`、`publishing`、已接受或 `published` 计划时不允许再创建同平台计划。发布所用正文与素材来自冻结副本，不会因原草稿后续修改而变化。

### 2. 确认授权

用户必须看到预览（长正文分页读完）并明确授权。`mediaops_confirm_publish` 校验明文一次性令牌的 hash、`payloadDigest` 与全局唯一幂等键，然后在原生审批后将 `preview` 变为 `confirmed`。确认本身不触网，也不返回完整执行快照。

重复相同幂等键只返回无副作用结果；不同键或跨计划复用会拒绝。`preview` 与 `confirmed` 可取消，过期后 janitor 会取消并删除 staging。

### 3. 执行

`mediaops_execute_publish` 只能接受 publication ID 和 digest。原生审批通过后，Host：

1. 校验 snapshot digest；
2. 校验所有冻结路径、正文和素材哈希；
3. 检查同平台是否已有任何 `publishing` 计划；若有则阻止新执行，直到人工对账写入终态；
4. 签发 40 分钟 Host-only execution lease；
5. 再次查询账号并比较身份指纹；
6. 以固定 argv、`shell: false` 启动 adapter。

同一计划只能启动一次；同一平台有任何 `publishing` 计划时不能启动另一计划。当前计划的有效租约期间也不能并行执行或人工回填；租约结束后仍须先人工对账到终态，不能盲目重发。

### 4. 已接受、恢复与人工对账

`submitted`、`draft_created`、`scheduled` 表示平台已接受，不是失败，也不允许直接重发。执行进程启动后出现超时、中断、非零退出或本地回执持久化失败时，保持 `publishing`；这避免把「可能已经发出」误判为失败后重复发布。

`mediaops_recover_publish` 只返回对账说明和安全元数据，绝不重跑 Publisher。执行租约仍有效时只能等待；租约结束后，按账号身份、标题、时间、幂等键与素材哈希在平台只读查询。人工回填 `published`/`failed` 需要原生审批：成功需官方域名链接或结果证据；失败需错误和明确证明未产生内容的证据。已接受状态只能推进到 `published`。

## 信任边界

| 边界 | 控制 |
|---|---|
| Browser Client → Host | loopback、Host/same-origin、cross-site 拒绝、请求体上限、no-store |
| 选题/爆款/趋势/正文/平台输出 → 模型 | 全部视为不可信数据；XML 转义、provenance、字符上限、显式错误 |
| Agent → 状态 | 仅参数化工具；服务层校验；普通工具不能伪造发布完成 |
| Agent → workspace | 发布 workspace 由当前 DSH 会话提供；素材 realpath containment |
| Agent → 发布平台 | Host-only 写入 Skill 不可直接调用；冻结快照、两次审批、固定 argv、账号复核、执行租约 |
| 平台 → 结果状态 | accepted 与 published 分离；官方域名/回执证据；不确定时只读对账，禁止盲重试 |
| Bundled Skill → 文件 | 安装目录只读；业务产物进 workspace，秘密进 data root |
| 本地磁盘 | `0700/0600` 最佳努力；明文数据由 OS 加密、权限与备份保护 |

这些控制不能替代平台权限、验证码、审核、内容合规或服务条款。账号身份 hash 与 `payloadDigest` 不是签名；日志脱敏也不能替代秘密管理。

## 配置优先级

DSH 从低到高组合 profile bundle、profile patch、DSH home patch 和命令行 `--patch`。后层按 `id` 覆盖前层；`mediaops.config` 整体替换而非深度合并，因此覆写时应重述全部需要保留的字段。

```sh
dsh --profile desktop --dump-config
```

## 分发与许可边界

GitHub 仓库：[Tangweiwei227/DSH-MediaOps](https://github.com/Tangweiwei227/DSH-MediaOps)。安装包包含 Host/Client 构建产物、112 个 Skill、共享资源、文档和来源声明；用户产物与秘密位于 workspace/data root，不写入版本化包。

项目不宣称已进入 DSH 插件市场。Easel Skill 的归属、第三方依赖和待核实许可证见 `NOTICE`、`THIRD_PARTY_NOTICES.md` 与各 Skill 的 `EASEL-META.md`。
