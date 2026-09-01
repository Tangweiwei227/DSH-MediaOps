# DSH-MediaOps

DSH-MediaOps 是一个原生 DeepSeek Harness（DSH）插件，把 [Easel](https://github.com/ZJU-REAL/Easel) 的完整媒体运营能力重新组织成「对话即工作台」的 AI-native 体验。

你可以在对话框里 `@` 选题或爆款、拉取热点、把候选收进爆款库、整理为选题、生成跨平台草稿，并在逐项核对与 DSH 原生审批后由 Host 受控发布。插件也提供 MediaOps 工作台，用于查看选题、爆款、草稿和发布队列。

## 对话里的完整闭环

1. 说「拉取今天微博、抖音和小红书的热点，先给我 10 条候选」。
2. 说「把第 2、5 条收进爆款库，并拆解钩子和结构」。
3. 说「把这个爆款整理成适合我的小红书选题」，来源关系会被保留。
4. 在输入框键入 `@`，从「选题库」或「爆款库」选择资料，再让 Agent 创作。
5. 审稿后保存为 `ready` 草稿；发布时，Host 先核验账号、做 dry-run，再冻结正文、素材和平台参数。
6. 读完不可变预览后明确确认，并依次通过「授权」与「真实执行」两次 DSH 原生审批。
7. 平台接受内容后，记录会先进入 `submitted`、`draft_created` 或 `scheduled`；只有取得可核验证据后才标为 `published`。

输入 `/` 还可使用五个快捷工作流：拉取今日爆款、爆款整理成选题、基于选题创作、审核并发布、今日内容盘点。

## AI-native 交互

- `@选题库 / @爆款库`：通过 DSH 输入源候选选择条目后，客户端保存稳定引用；消息提交时才序列化为有长度限制、带来源声明的上下文。手工输入类似 `@标题` 的普通文本、或从剪贴板粘贴标题，不会自动变成结构化引用。
- 对话式入库：保存爆款、创建或更新选题、保存草稿都由参数化工具完成；工具没有成功写入时，Agent 不会声称「已经入库」。
- 对话式热点发现：支持微博、抖音、知乎、头条、小红书、B站、百度、AI 与 IT 热点，并按平台如实报告源错误。
- 可追踪生产链路：选题保留来源爆款，草稿关联选题、目标平台和素材。
- 受控发布：从账号探针、不可变预览到执行与对账都留在 Host 边界，不让模型自行拼命令或替换载荷。
- 原生工作台：在 DSH 对话视图和设置中查看概览、选题库、爆款库、草稿与发布队列，也可把爆款整理成选题。

## 112 个 Easel Skills

插件内置 Easel 的 112 个 Skill 及其共享资源：

| 能力层 | 数量 | 覆盖内容 |
|---|---:|---|
| 通用 | 6 | 资料、模板、批处理、资产等基础能力 |
| 发现 | 9 | 热点、竞品、内容缺口、UGC、算法变化等 |
| 策划 | 16 | 定位、受众、选题、内容矩阵、排期、活动等 |
| 创作 | 50 | 文案、图像、卡片、音频、视频、短剧与复合内容 |
| 发布 | 20 | 平台适配、质量与风险检查、排期、互动、真实发布 |
| 归因 | 11 | 数据记录、评论洞察、复盘、ROI 与策略迭代 |
| 合计 | **112** | 从发现到归因的完整闭环 |

完整逐项说明见 [能力目录](docs/CAPABILITIES.md)。

这些 Skill 由 DSH bundled provider 惰性加载；用户或项目的同名 Skill 优先。发布层中的质量检查、内容改编、人设检查、SEO、版权风险与评论策略等 7 个只读/生成型 Skill 可正常调用；13 个包含真实平台写入、批量派发、通知、短链或排期派发路径的 Host-only Skill 不开放模型或用户直接调用。真实平台脚本只能由 `mediaops_execute_publish` 的 Host adapter 以固定 argv 执行。

## 7 个发布连接器

| 平台 | MediaOps 标识 | 受控实现 | 成功启动后的首个状态 |
|---|---|---|---|
| 小红书 | `xiaohongshu` | `skill-xhs-publisher` | `submitted` |
| 抖音 | `douyin` | `skill-douyin-upload` | `submitted` |
| 快手 | `kuaishou` | `skill-kuaishou-upload` | `submitted` |
| 微信视频号 | `wechat-channels` | `skill-channels-upload` | `submitted` |
| 微信公众号 | `wechat-official` | `skill-wechat-publisher` | `draft_created` |
| 知乎 | `zhihu` | `skill-zhihu-publisher` | `submitted` |
| 哔哩哔哩 | `bilibili` | `skill-bilibili-upload` | 即时 `submitted`；定时 `scheduled` |

`submitted` 表示平台已接受提交，不等于已公开；内容仍可能处于审核中。微信公众号只创建草稿箱条目，不自动群发。Bilibili 是当前唯一由受控 adapter 支持定时参数的平台，时间必须带时区且至少晚于当前 4 小时。

平台可能需要登录态、Cookie、Playwright/Chromium、微信公众号 API 凭证、`biliup`、代理或人工验证码。插件不会自动绕过平台风控、审核或账号权限。

## 发布安全协议

发布链路由 Host 控制，并在三处使用 DSH 原生审批：确认授权、真实执行、人工对账回填。

1. **Host 账号探针与 dry-run**：`mediaops_prepare_publish` 从当前 DSH 会话取得权威绝对 workspace，读取 `ready`（或跨平台部分完成后的 `partially_published`）草稿。Host 用精确 `accountKey` 查询账号，要求返回稳定的非敏感 SHA-256 身份指纹，再以固定 argv 执行不带 `--exec` 的 dry-run。浏览器平台要求账号名称精确匹配；微信公众号使用 YAML 账号 key。
2. **不可变冻结**：Host 把正文和本地素材复制到 data root 的私有 staging 目录，记录正文/素材 SHA-256、草稿 revision、账号身份、平台参数、预检证据和 `payloadDigest`。微信公众号还冻结内置 theme 名称与 theme 文件摘要，并把本地 Markdown 图片改写到冻结副本。预览令牌 30 分钟有效；长正文必须用 `mediaops_read_publish_preview` 分页读完。
3. **明确确认 + 原生审批**：只有用户核对预览后明确说「确认发布」，Agent 才能调用 `mediaops_confirm_publish`。Host 复核令牌、digest 与唯一幂等键，DSH 显示可信摘要并要求一次性批准；通过后状态只变为 `confirmed`，此步不触网。
4. **真实执行 + 再次审批**：`mediaops_execute_publish` 再显示平台、账号身份、正文哈希、素材的安全工作区相对路径（越界时仅 basename）及大小/哈希、参数和 digest。批准后，Host 复核冻结文件、签发 40 分钟执行租约、重新探测账号身份，并用 `shell: false` 的 argv 启动唯一 adapter。模型不能读取完整执行快照、改变载荷或自行运行发布脚本。
5. **结果与对账**：平台明确接受后进入 `submitted`、`draft_created` 或 `scheduled`；取得官方域名链接或平台回执后才进入 `published`。执行进程启动后若超时、中断、崩溃或结果不确定，状态保持 `publishing`，必须先用 `mediaops_recover_publish` 做只读对账，禁止盲目重发。人工回填还需一次 DSH 原生审批；只有证据明确表明未产生内容时，才可记录 `failed`。

状态流如下：

```text
preview → confirmed → publishing → submitted ─┐
                              ├→ draft_created ├→ published
                              └→ scheduled ────┘
             └──────────────→ failed（仅有未产生内容的证据）
preview/confirmed → cancelled
```

同一平台只要存在任何 `publishing` 计划，就阻止新的真实执行，直到人工对账写入终态。终态不能互相翻转；已接受状态不能回退为失败，也不能直接重发。跨平台草稿在同一 revision 的部分平台发布后为 `partially_published`，全部目标平台均有 `published` 证据后才变为 `published`，关联选题随后同步完成；草稿已改版时，旧 revision 的回执不会误改新稿状态。

## 安装

要求：可运行的 DSH Desktop / `dsh` CLI、Node.js 22.19+ 或 24+，以及可从 `PATH` 找到的 pnpm。建议使用与仓库 `packageManager` 一致的 pnpm 11.7.x；可先运行 `pnpm --version` 检查。`dsh plugin` 安装流程需要 pnpm，即使当前发行包已包含构建后的 `lib/`。

从 GitHub 安装到 Desktop profile：

```sh
dsh plugin --profile desktop add github:Tangweiwei227/DSH-MediaOps
```

安装后完全退出并重启 DSH Desktop。在对话视图中应能看到 `MediaOps`，输入 `@` 或 `/` 可验证入口。

当前包没有依赖安装时的 `prepare` 构建脚本。若后续版本或新增依赖引入需要执行的构建脚本，应在对应 DSH profile workspace 的 pnpm `allowBuilds` 中逐项允许可信包；不要全局放开未知依赖脚本。

卸载：

```sh
dsh plugin --profile desktop remove dsh-mediaops
```

卸载插件不会删除 data root 中的状态、凭证或登录态。

## 外部运行依赖

基础资料库和对话界面随插件可用；具体 Skill/平台连接器可能还需要：

- Python 3；
- 小红书、抖音、快手、视频号、知乎：`playwright` 与 Chromium，以及已登录的浏览器 profile；
- 微信公众号：`requests`、`PyYAML`、`wechat-publisher.yaml`、有效 `app_id/app_secret` 与 IP 白名单；
- Bilibili：`biliup` CLI 与已登录 Cookie；
- 音视频和部分创作 Skill：FFmpeg、Pillow、模型服务或第三方 API，详见对应 `SKILL.md`。

不要把密钥写入草稿、`publisherOptions`、命令行参数或 Git。代理 URL 不能包含用户名/密码；代理凭证应放在 Host 环境变量中。

## 使用示例

```text
拉取微博、抖音和小红书今天的热榜，每个平台 10 条；按与我的账号定位匹配度排序，先不要入库。
```

```text
把刚才第 1 和第 4 条收进爆款库，补充钩子、受众、内容结构和可复用点。
```

```text
把 @某条爆款 整理成 3 个差异化选题，展示后等我选择，再放进选题库。
```

```text
基于 @某个选题 写一版小红书图文稿，做质量检查，保存为 ready 草稿，但不要发布。
```

```text
准备把这份 ready 草稿发布到小红书账号「准确昵称」。先展示完整冻结预览；等我明确确认后再申请授权和执行审批。
```

## 运行时目录

DSH-MediaOps 区分业务工作区与持久敏感数据区。

### Workspace root

一般 Skill 的 workspace root 使用首个非空值：

1. `DSH_MEDIAOPS_WORKSPACE`
2. `EASEL_ROOT`（兼容上游）
3. 当前进程工作目录

`outputs/`、业务产物和 `profiles/` 位于该 workspace。真实发布不接受模型或环境变量另报目录：Host 直接使用当前 DSH 会话的绝对 `session.header.cwd`，并要求所有素材都是该目录内的普通文件。

### Data root

结构化状态、冻结载荷、平台凭证和浏览器登录态使用：

1. 插件 `config.dataDir`
2. `DSH_MEDIAOPS_DATA_DIR`
3. `$DSH_HOME/mediaops`
4. `~/.dsh/mediaops`

主要内容：

- `state.json`：schema v5 的选题、爆款、草稿和发布记录；
- `staging/<publication-id>/`：确认前/执行中的冻结正文与素材；
- `wechat-publisher.yaml`：微信公众号外置账号配置；
- `credentials/*`：token、Cookie 等凭证；
- `browser-profiles/*`：平台登录态。

data root 与敏感文件尽力设置为 `0700/0600`。状态写入使用进程内串行、跨 Host 文件锁、临时文件原子替换与最佳努力 fsync；单个状态文件上限 16 MiB。v1-v4 会迁移到 v5：可确认的终态/已接受状态保留，无法安全恢复的待处理发布会被取消并销毁旧授权。

状态和凭证都是本地明文，不由插件加密。请使用操作系统磁盘加密、限制目录访问并做好安全备份；不要提交到 Git。

## 配置

插件行 ID 为 `mediaops`：

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `dataDir` | 空字符串 | data root；空值依次回退到 `DSH_MEDIAOPS_DATA_DIR`、`$DSH_HOME/mediaops`、`~/.dsh/mediaops` |
| `trendCacheTtlMs` | `60000` | 热榜内存缓存时间，范围 5 秒至 1 小时 |
| `trendTimeoutMs` | `10000` | 单个热榜请求超时，范围 1 至 60 秒 |
| `maxReferenceChars` | `12000` | 每条 `@` 引用提交给模型的最大字符数，范围 1,000 至 50,000 |

DSH 的 id 定向 patch 会整体替换该行 `config`，不是逐字段深度合并：

```yaml
- id: mediaops
  name: dsh-mediaops
  config:
    dataDir: /Users/you/Documents/dsh-mediaops-data
    trendCacheTtlMs: 120000
    trendTimeoutMs: 15000
    maxReferenceChars: 16000
```

配置覆盖与组件说明见 [架构文档](docs/ARCHITECTURE.md)。

## 本地开发

```sh
git clone https://github.com/Tangweiwei227/DSH-MediaOps.git
cd DSH-MediaOps
pnpm install
pnpm check
```

安装当前工作树：

```sh
dsh plugin --profile desktop add file:/absolute/path/to/DSH-MediaOps
```

生产安装使用 `lib/index.js` 与 `lib/client.js`；修改 `src/` 后必须重新构建。

## 安全边界与限制

- 本地 API 只接受 loopback，并检查 localhost Host、浏览器 same-origin 与 cross-site 标记；它不是局域网或公网服务。
- 选题、爆款、趋势源、平台输出、搜索结果、正文、评论、错误和回执都按不可信数据处理。`@` 引用会 XML 转义、限制长度并标明来源，但这不是提示注入的绝对防护。
- 发布素材必须是 Host 权威 workspace 内的绝对路径、普通文件且不能是符号链接或远程 URL。正文与附件合计最多 20 个文件，单文件上限 2 GiB、单次总量上限 4 GiB，并预留 256 MiB 磁盘空间；跨预览 staging 使用跨进程锁和 6 GiB 全局配额。
- `payloadDigest`、正文/素材哈希和账号身份指纹用于一致性检查，不是数字签名、平台回执或账号所有权证明。
- 确认、真实执行和人工对账都依赖 DSH 原生审批；审批被拒、超时或当前表层无法完成审批时，动作不会静默放行。
- Publisher 输出会做有界收集与常见秘密脱敏，但不要依赖日志脱敏替代正确的秘密管理。
- 平台选择器、接口、审核与风控会变化；`submitted`、`draft_created`、`scheduled` 都不等于公开发布成功。
- 13 个带外部写入或派发路径的 Host-only bundled Skill 在 DSH 中不可直接调用；发布层的 7 个只读/生成型 Skill 仍可用。拥有本机文件和进程权限的用户仍可在 DSH 之外手工运行脚本，那属于插件安全边界之外。
- 插件没有字段级加密、多人权限控制、云同步或云端备份；它面向单机个人工作流。
- 项目通过 GitHub 分发，不代表已经上架 DSH 插件市场。
- 安全问题请按 [SECURITY.md](SECURITY.md) 通过 GitHub 私密报告，不要在公开 issue 中粘贴 cookie、密钥、浏览器 profile 或未发布内容。

## 来源与许可

DSH-MediaOps 以 Apache License 2.0 发布。112 个 bundled skills 来自 [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel) 的固定源码快照；归属与逐项来源保留在 `EASEL-META.md`、[NOTICE](NOTICE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。相对该快照修改的文本文件均携带简短修改声明；`lucasygu/redbook` 与 `white0dew/XiaohongshuSkills` 的 MIT 全文位于 [`third_party_licenses/`](third_party_licenses/)。

Easel 记录的 43 条参考项目没有在本仓逐一完成许可证核验；除上面明确列为 vendored 的项目外，这些名称主要是方法引用或需要另行安装的外部依赖，并不表示其源码随 npm 包分发。部分上游元数据仍将许可证状态标为「待核实」。公开再分发或生产使用前，请独立复核适用 Skill、运行时依赖和外部服务的当前许可证及服务条款。
