import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { MEDIA_PLATFORMS, type DraftStatus, type MediaPlatform, type TopicStatus } from './types.ts'
import { TREND_PLATFORMS, type TrendPlatform, TrendService } from './trends.ts'
import { MediaOpsService } from './service.ts'
import { PublisherAdapter } from './adapter.ts'

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const jsonOutput = { schema: { type: 'json' } as const, render: renderJson }

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function keepDefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

export function mediaOpsTools(service: MediaOpsService, trends: TrendService, adapter: PublisherAdapter) {
  return [
    defineTool({
      name: 'mediaops_capabilities',
      description: '查看 DSH-MediaOps 的媒体运营能力、112 个 bundled skills 分类、选题/爆款/草稿/发布队列统计和真实发布连接器。Triggers: 能做什么, MediaOps 状态, 媒体运营能力。',
      parameters: {},
      output: jsonOutput,
      async execute() {
        return jsonValue(await service.overview())
      },
    }),
    defineTool({
      name: 'mediaops_discover_trends',
      description: '从公益聚合源获取微博、抖音、知乎、头条、小红书、B站、百度、AI 或 IT 热点；可把结果直接收进爆款库。单源失败会降级并如实返回。Triggers: 拉爆款, 热搜, 热点, 找选题。',
      parameters: {
        platforms: { type: 'array', items: { type: 'string', enum: TREND_PLATFORMS }, description: '平台列表；默认微博、抖音、知乎、小红书' },
        limit: { type: 'integer', description: '每个平台条数，默认 10，最大 50' },
        saveToViral: { type: 'boolean', description: '是否将拉取结果保存到爆款库，默认 false' },
      },
      output: jsonOutput,
      timeoutMs: 70_000,
      async execute(args, exec) {
        const selected = (args.platforms?.length ? args.platforms : ['weibo', 'douyin', 'zhihu', 'rednote']) as TrendPlatform[]
        const result = await trends.discover(selected, args.limit ?? 10, exec.signal)
        if (args.saveToViral === true) {
          const items = result.groups.flatMap(group => group.items)
          const saved = await service.saveTrends(items)
          return jsonValue({ ...result, savedCount: saved.length, savedIds: saved.map(item => item.id) })
        }
        return jsonValue({ ...result, savedCount: 0, savedIds: [] })
      },
    }),
    defineTool({
      name: 'mediaops_search_library',
      description: '搜索选题库、爆款库、草稿或发布记录。适合用户在对话里说“找之前那个选题/爆款/草稿”。Triggers: 搜选题库, 搜爆款库, 查草稿, 查发布记录。',
      parameters: {
        query: { type: 'string', description: '关键词；空字符串返回最近内容' },
        kind: { type: 'string', enum: ['all', 'topics', 'viralItems', 'drafts', 'publications'], description: '内容类型，默认 all' },
        limit: { type: 'integer', description: '每类上限，默认 20，最大 100' },
      },
      output: jsonOutput,
      async execute(args) {
        const kinds = args.kind && args.kind !== 'all' ? [args.kind] : ['topics', 'viralItems', 'drafts', 'publications'] as const
        const entries = await Promise.all(kinds.map(async kind => [kind, await service.list(kind, args.query ?? '', args.limit ?? 20)] as const))
        return jsonValue({ ok: true, results: Object.fromEntries(entries) })
      },
    }),
    defineTool({
      name: 'mediaops_save_viral',
      description: '把对话中发现的一条爆款内容整理进爆款库；相同 URL 或同平台同标题会合并更新。Triggers: 收进爆款库, 收藏这个爆款, 保存案例。',
      parameters: {
        platform: { type: 'string', required: true, description: '来源平台' },
        title: { type: 'string', required: true, description: '爆款标题' },
        url: { type: 'string', description: '原始链接' },
        hot: { type: 'string', description: '热度或互动量' },
        author: { type: 'string', description: '作者' },
        summary: { type: 'string', description: '内容摘要' },
        notes: { type: 'string', description: '爆款机制/钩子/结构等拆解笔记' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        source: { type: 'string', description: '数据来源说明' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue({ ok: true, viralItem: await service.saveViral(args) })
      },
    }),
    defineTool({
      name: 'mediaops_save_topic',
      description: '把对话中的灵感、爆款拆解或研究结果整理成结构化选题并放入选题库。Triggers: 放入选题库, 保存选题, 整理成选题。',
      parameters: {
        title: { type: 'string', required: true, description: '选题标题' },
        angle: { type: 'string', description: '核心切入角度' },
        summary: { type: 'string', description: '选题摘要' },
        content: { type: 'string', description: '研究材料、提纲或完整内容' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        platforms: { type: 'array', items: { type: 'string', enum: MEDIA_PLATFORMS }, description: '目标发布平台' },
        status: { type: 'string', enum: ['idea', 'researching', 'planned', 'drafting', 'ready', 'archived'], description: '选题状态，默认 idea；published 只能由真实发布回执写入' },
        sourceViralIds: { type: 'array', items: { type: 'string' }, description: '来源爆款 ID' },
        references: { type: 'array', items: { type: 'string' }, description: '参考链接或资料标识' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue({ ok: true, topic: await service.createTopic(args) })
      },
    }),
    defineTool({
      name: 'mediaops_update_topic',
      description: '更新选题库中的标题、角度、摘要、材料、标签、平台或状态。Triggers: 更新选题, 补充选题, 标记选题状态。',
      parameters: {
        id: { type: 'string', required: true, description: '选题 ID' },
        title: { type: 'string' },
        angle: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        platforms: { type: 'array', items: { type: 'string', enum: MEDIA_PLATFORMS } },
        status: { type: 'string', enum: ['idea', 'researching', 'planned', 'drafting', 'ready', 'archived'], description: 'published 只能由真实发布回执写入，且不可回退' },
        sourceViralIds: { type: 'array', items: { type: 'string' } },
        references: { type: 'array', items: { type: 'string' } },
      },
      output: jsonOutput,
      async execute(args) {
        const { id, ...rawPatch } = args
        const patch = keepDefined(rawPatch) as { status?: TopicStatus } & Record<string, unknown>
        return jsonValue({ ok: true, topic: await service.updateTopic(id, patch) })
      },
    }),
    defineTool({
      name: 'mediaops_promote_viral',
      description: '将爆款库中的一条内容整理为选题，自动保留来源关系和链接。Triggers: 把这个爆款变成选题, 从爆款生成选题。',
      parameters: {
        viralId: { type: 'string', required: true, description: '爆款 ID' },
        title: { type: 'string', description: '重写后的选题标题' },
        angle: { type: 'string', description: '你的差异化切入角度' },
        summary: { type: 'string', description: '选题摘要' },
        content: { type: 'string', description: '研究材料或提纲' },
        tags: { type: 'array', items: { type: 'string' } },
        platforms: { type: 'array', items: { type: 'string', enum: MEDIA_PLATFORMS } },
      },
      output: jsonOutput,
      async execute(args) {
        const { viralId, ...patch } = args
        return jsonValue({ ok: true, topic: await service.promoteViral(viralId, patch) })
      },
    }),
    defineTool({
      name: 'mediaops_save_draft',
      description: '保存或更新跨平台内容草稿，可关联选题并记录素材路径。Triggers: 保存草稿, 把这版存下来, 更新稿件。',
      parameters: {
        id: { type: 'string', description: '已有草稿 ID；省略则新建' },
        topicId: { type: 'string', description: '关联选题 ID' },
        title: { type: 'string', description: '草稿标题；新建时必填' },
        body: { type: 'string', description: '草稿正文；新建时必填' },
        platforms: { type: 'array', items: { type: 'string', enum: MEDIA_PLATFORMS }, description: '目标平台' },
        assets: { type: 'array', items: { type: 'string' }, description: '图片、视频等素材路径或 URL' },
        status: { type: 'string', enum: ['draft', 'review', 'ready', 'archived'], description: '草稿状态，默认 draft；partially_published/published 只能由真实发布回执写入' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue({ ok: true, draft: await service.saveDraft(args as typeof args & { status?: DraftStatus }) })
      },
    }),
    defineTool({
      name: 'mediaops_prepare_publish',
      description: '由 Host adapter 执行不带 --exec 的只读 dry-run，通过后冻结 ready 草稿、正文与本地素材，生成有时效的发布预览和一次性令牌；不会实际发布。Triggers: 准备发布, 预览发布。',
      parameters: {
        draftId: { type: 'string', required: true, description: '待发布草稿 ID' },
        platform: { type: 'string', enum: MEDIA_PLATFORMS, required: true, description: '目标平台' },
        accountKey: { type: 'string', required: true, description: '浏览器平台填 whoami 可读取的准确昵称；微信公众号填 YAML 账号 key。不得填模糊显示标签或猜测' },
        scheduledAt: { type: 'string', description: '定时发布时间（ISO 8601）；即时发布留空' },
        publisherOptions: { type: 'json', description: '分区、标签、声明等已预检的平台参数对象' },
      },
      output: jsonOutput,
      timeoutMs: 5 * 60_000,
      async execute(args, exec) {
        const platform = args.platform as MediaPlatform
        const draft = await service.draftForPreflight(args.draftId, platform)
        const publisherOptions = args.publisherOptions && typeof args.publisherOptions === 'object' && !Array.isArray(args.publisherOptions)
          ? args.publisherOptions as Record<string, unknown>
          : {}
        const accountKey = args.accountKey.trim()
        if (!accountKey) throw new Error('目标账号不能为空')
        const workspaceRoot = exec.agent?.session.header.cwd
        if (!workspaceRoot) throw new Error('发布必须在有绝对工作区的 DSH 会话中进行')
        const checked = await adapter.preflight(draft, platform, accountKey, workspaceRoot, args.scheduledAt ?? '', publisherOptions, exec.signal)
        const preflight = keepDefined({
          accountLabel: checked.accountLabel,
          accountIdentity: checked.accountIdentity,
          preflightEvidence: checked.evidence,
          workspaceRoot: checked.workspaceRoot,
          expectedDraftRevision: checked.expectedDraftRevision,
          scheduledAt: args.scheduledAt,
          publisherOptions: checked.publisherOptions,
        }) as { accountLabel: string; accountIdentity: string; preflightEvidence: string; workspaceRoot: string; expectedDraftRevision?: number; scheduledAt?: string; publisherOptions?: unknown }
        return jsonValue({ ok: true, ...(await service.preparePublish(args.draftId, platform, preflight, exec.signal)) })
      },
    }),
    defineTool({
      name: 'mediaops_read_publish_preview',
      description: '分页读取已冻结发布预览的完整正文与素材哈希。正文超过首屏时必须读完并让用户能核对后才可确认。只读。Triggers: 查看完整发布预览, 继续读预览。',
      parameters: {
        publicationId: { type: 'string', required: true },
        payloadDigest: { type: 'string', required: true },
        offset: { type: 'integer', description: '字符偏移，默认 0' },
        limit: { type: 'integer', description: '每页字符数，默认 10000，最大 20000' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue(await service.readPublishPreview(args.publicationId, args.payloadDigest, args.offset ?? 0, args.limit ?? 10_000))
      },
    }),
    defineTool({
      name: 'mediaops_confirm_publish',
      description: '在用户看过不可变预览并明确确认后授权一次 Host adapter 执行；本工具本身不触网、不运行 publisher。同一计划只授权一次。Triggers: 确认发布, 取消发布。',
      parameters: {
        publicationId: { type: 'string', required: true, description: '发布计划 ID' },
        confirmationToken: { type: 'string', required: true, description: 'prepare 返回的一次性令牌' },
        confirm: { type: 'boolean', required: true, description: '用户是否明确确认' },
        idempotencyKey: { type: 'string', required: true, description: '本次发布唯一幂等键；重试时保持不变' },
        payloadDigest: { type: 'string', required: true, description: 'prepare 预览中的 payloadDigest；确认时必须逐字一致' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue(await service.confirmPublish(args.publicationId, args.confirmationToken, args.confirm, args.idempotencyKey, args.payloadDigest))
      },
    }),
    defineTool({
      name: 'mediaops_cancel_publish',
      description: '取消仍处于 preview 或 confirmed、尚未启动 adapter 的发布计划并销毁授权。已进入 publishing 或终态的计划不会被改写。Triggers: 取消发布计划, 不发了。',
      parameters: {
        publicationId: { type: 'string', required: true, description: '发布计划 ID' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue({ ok: true, publication: await service.cancelPublication(args.publicationId) })
      },
    }),
    defineTool({
      name: 'mediaops_execute_publish',
      description: '消费已确认的 publicationId + payloadDigest，由 Host 从 state 读取冻结载荷、复核文件哈希并以无 shell 的 argv 执行唯一平台 adapter。该调用会触发 DSH 原生高风险审批；同一计划只会启动一次。Triggers: 执行已确认发布。',
      parameters: {
        publicationId: { type: 'string', required: true },
        payloadDigest: { type: 'string', required: true },
      },
      output: jsonOutput,
      timeoutMs: 30 * 60_000,
      async execute(args, exec) {
        const begun = await service.beginPublishExecution(args.publicationId, args.payloadDigest)
        if (!begun.execute) return jsonValue({ ok: true, alreadyStarted: true, nextAction: 'mediaops_recover_publish', publication: begun.publication })
        let result
        try {
          result = await adapter.execute(begun.publication, exec.signal)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const publication = await service.recordPublishResult(args.publicationId, args.payloadDigest, 'failed', '', 'Host adapter failed before publisher process creation.', `adapter did not start: ${message}`, begun.executionLeaseId)
          return jsonValue({ ok: false, publication, error: message })
        }
        if (!result.started) {
          const error = result.error || result.stderr || 'publisher process failed before start'
          const publication = await service.recordPublishResult(args.publicationId, args.payloadDigest, 'failed', '', result.evidence, error, begun.executionLeaseId)
          return jsonValue({ ok: false, publication, error })
        }
        if (result.code === 0 && !result.timedOut && !result.aborted && result.outcome !== 'uncertain') {
          try {
            const publication = await service.recordPublishResult(args.publicationId, args.payloadDigest, result.outcome, result.externalUrl, result.evidence, '', begun.executionLeaseId)
            return jsonValue({ ok: true, publication, outcome: result.outcome, receipt: result.evidence, nextAction: result.outcome === 'published' ? 'none' : 'mediaops_recover_publish' })
          } catch (error) {
            // The external platform may already have accepted the post. Never turn a
            // receipt-persistence failure into `failed`, because that enables a duplicate retry.
            const message = error instanceof Error ? error.message : String(error)
            return jsonValue({ ok: false, uncertain: true, nextAction: 'mediaops_recover_publish', error: `平台已接受请求，但本地回执落盘失败：${message}` })
          }
        }
        const reason = result.aborted ? 'publisher process aborted after start' : result.timedOut ? 'publisher process timed out after start' : `publisher exited ${String(result.code)} after start`
        try {
          const publication = await service.markPublishUncertain(args.publicationId, args.payloadDigest, begun.executionLeaseId, reason, result.evidence)
          return jsonValue({ ok: false, uncertain: true, publication, nextAction: 'mediaops_recover_publish', error: reason })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return jsonValue({ ok: false, uncertain: true, nextAction: 'mediaops_recover_publish', error: `${reason}；本地待对账状态写入失败：${message}` })
        }
      },
    }),
    defineTool({
      name: 'mediaops_recover_publish',
      description: '读取卡在 publishing 的一次性发布尝试，返回只读对账说明、账号/标题/时间/幂等键和素材哈希；绝不自动重发。Triggers: 恢复发布, 发布卡住, 对账。',
      parameters: {
        publicationId: { type: 'string', required: true },
        payloadDigest: { type: 'string', required: true },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue(await service.recoverPublish(args.publicationId, args.payloadDigest))
      },
    }),
    defineTool({
      name: 'mediaops_record_publish_result',
      description: '仅用于 publishing 中断后的人工/只读平台对账回填；正常 Host adapter 会自动回填。该调用会触发 DSH 原生审批。Triggers: 对账后记录发布结果。',
      parameters: {
        publicationId: { type: 'string', required: true, description: '发布计划 ID' },
        payloadDigest: { type: 'string', required: true, description: '冻结预览 digest' },
        status: { type: 'string', enum: ['published', 'failed'], required: true, description: '只读平台对账确认的真实终态' },
        externalUrl: { type: 'string', description: '发布成功后的内容链接' },
        resultEvidence: { type: 'string', required: true, description: '只读平台对账证据；published 填公开内容/稿件回执，failed 必须明确证明未产生内容' },
        error: { type: 'string', description: '失败原因' },
      },
      output: jsonOutput,
      async execute(args) {
        return jsonValue({ ok: true, publication: await service.recordPublishResult(
          args.publicationId, args.payloadDigest, args.status as 'published' | 'failed', args.externalUrl, args.resultEvidence, args.error,
        ) })
      },
    }),
  ]
}
