# GitHub Issues 可行性审查（2026-09-12）

审查基线：`main@7482ba7`。本轮对仓库现有 #1–#6 做了代码复现、当前 DSH 协议核对和发布安全评估。结论用于安排实现顺序，不改变 Issue 原始验收要求。

## 结论

| Issue | 可行性 | 本轮动作 | 后续 |
|---|---|---|---|
| [#1 Skill frontmatter 块标量](https://github.com/Tangweiwei227/DSH-MediaOps/issues/1) | 明确可复现，可直接修复 | v0.2 修复 `>` / `|` 的 chomping/indent 解析，补专项测试与 `pnpm check` lint | 完成验证后关闭 |
| [#6 工程健壮性](https://github.com/Tangweiwei227/DSH-MediaOps/issues/6) | 可实施；原 Issue 部分描述已过时 | v0.2 补 parser、adapter、client trigger 测试；加入固定上游快照、离线门禁、每周 drift 检查和人工同步报告 | routes/Workbench smoke 与 store 迁移按收益继续拆分 |
| [#5 Skills 路由与交互](https://github.com/Tangweiwei227/DSH-MediaOps/issues/5) | `@草稿/@发布记录` 可直接做；真正层级按需展开受 DSH 核心限制 | v0.2 增加四库统一引用搜索和安全投影 | 层级路由需 DSH provider 协议或独立 router 设计 |
| [#4 热点健壮性](https://github.com/Tangweiwei227/DSH-MediaOps/issues/4) | 可实施，但应拆为“安全多源”和“时效/缓存” | 完成现状核对和安全设计 | 下一轮实现安全源配置、持久 stale cache、freshness 字段与 UI |
| [#2 发布后自动回查](https://github.com/Tangweiwei227/DSH-MediaOps/issues/2) | 技术可行，但必须按平台拆分 | 明确结构化回执、probe、租约和指标快照边界 | 先选一个能返回稳定 post ID/URL 的平台做垂直切片 |
| [#3 连接器增强](https://github.com/Tangweiwei227/DSH-MediaOps/issues/3) | 三项需求应拆开；公众号群发和无人值守定时风险高 | 复用已有跨平台独立状态，形成分阶段设计 | 先做组合发布视图；定时先确定授权语义；公众号群发最后做人测门禁 |

## 关键证据

### #1

旧解析器只识别精确的 `>` 与 `|`，会把 `>-` 当成普通字符串。快照中有 45 个 `description: >-`，其中 36 个属于模型可见 Skill，因此错误会直接污染模型看到的能力描述。

验收必须保持：112 个 Skills、13 个 Host-only、99 个 model-visible，且 name/description 非空、name 唯一、layer 合法。

### #5

当前 DSH `0.1.1-rc.2` 的 Skill provider 只有 list/load 语义；模型上下文会固定包含所有 model-invocable Skill 的名称和描述，没有 group/expand/query/session 协议。仅修改本插件 metadata 无法实现真正的“先注入一级目录、命中后二级展开”。

本轮可安全交付的部分是：

- `@选题 / @爆款 / @草稿 / @发布记录` 四类统一搜索；
- 一次查询只读取 state 一次；
- 草稿正文使用有来源声明、XML 转义和总长度上限的引用；
- 发布记录只使用显式 allowlist，排除账号指纹、workspace、冻结路径、publisher options、幂等键和原始回执。

### #4

现状不是“全部平台单源”：微博、抖音、B站和百度已有硬编码 failover；知乎、头条、小红书、AI、IT 仍为单源。真正缺口是安全可配置的数据源、跨重启缓存和保存后的时效信息。

可配置 URL 会引入 SSRF，因此至少需要 HTTPS、可信 host 或私网阻断、禁止 URL credentials、拒绝 redirect、JSON Content-Type、响应上限和每平台候选源数量上限。`窗口期 / 已过热` 应按 `sourceFetchedAt` 运行时计算，不持久化会自然过期的派生标签。

### #2

现有状态机已经允许 `submitted / draft_created / scheduled → published`，但依赖人工对账。自动化前必须先有结构化的 `platformPostId / platformReceiptId`、精确匹配 probe、轮询 claim lease 和有上限的指标快照。

标题、时间、昵称等模糊匹配只能生成“待人工确认”建议，不能自动把状态改为 `published`。只读浏览器抓取仍会遇到登录态冲突、DOM 漂移、限流和平台条款风险。

### #3

- **组合发布**：现有 `draftId + revision` 已能聚合部分平台结果，先做派生视图无需迁移；若每个平台允许独立改稿，再引入正式 PublicationGroup。
- **Host 定时**：需要独立 SchedulePlan，不能复用表示“平台已接受定时”的 `scheduled`。必须明确“计划时批准未来外部写入”还是“到点重新批准”，并处理休眠补偿、时区、租约、幂等和 staging 配额。
- **公众号群发**：创建草稿、发布文章和群发给受众是三种不同副作用。群发必须有独立 action、受众与人数预览、配额提示、默认关闭、单独审批和真人测试环境。

## 推荐顺序

1. 发布 v0.2：#1、#6 可验证切片、#5 四库引用、多模态模型配置、说明书和官网。
2. #4：安全多源 + 持久 stale cache + freshness。
3. 结构化平台回执，再实现 #3 组合发布视图。
4. #2 选择单个平台打通精确对账和 T+1 指标，再扩展 T+3/T+7。
5. 在授权语义确定后实现 Host 定时；公众号群发保留真人测试门禁。
6. #5 完整层级路由等待 DSH 核心能力，或另立 router/load 架构提案。

原则：不以降低审批、身份确认、载荷冻结或证据标准来换取“功能完成”；不能安全自动化时，明确保留人工确认。
