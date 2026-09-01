import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaOpsStore } from '../src/store.ts'
import { MediaOpsService } from '../src/service.ts'

const cleanup: string[] = []
const ACCOUNT_IDENTITY = 'a'.repeat(64)

async function fixture(): Promise<{ dir: string; service: MediaOpsService }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mediaops-test-'))
  cleanup.push(dir)
  return { dir, service: new MediaOpsService(new MediaOpsStore(dir)) }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('MediaOps local state', () => {
  it('persists topics atomically with private file permissions', async () => {
    const { dir, service } = await fixture()
    const topic = await service.createTopic({ title: 'AI 搜索正在重写内容分发', tags: ['AI', 'SEO'] })
    expect(topic.status).toBe('idea')

    const reloaded = new MediaOpsService(new MediaOpsStore(dir))
    expect((await reloaded.list('topics'))).toMatchObject([{ id: topic.id, title: topic.title }])
    const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as { version: number }
    expect(raw.version).toBe(5)
    if (process.platform !== 'win32') {
      expect((await stat(join(dir, 'state.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('deduplicates viral items and promotes one into a sourced topic', async () => {
    const { dir, service } = await fixture()
    const first = await service.saveViral({ platform: 'douyin', title: '三秒钩子', url: 'https://example.test/v/1', hot: '10w' })
    const second = await service.saveViral({ platform: 'douyin', title: '三秒钩子', url: 'https://example.test/v/1', hot: '20w', notes: '反常识开场' })
    expect(second.id).toBe(first.id)
    expect((await service.list('viralItems'))).toHaveLength(1)

    const topic = await service.promoteViral(first.id, { angle: '拆解后转为 B2B 场景' })
    expect(topic.sourceViralIds).toEqual([first.id])
    expect(topic.references).toEqual(['https://example.test/v/1'])
  })

  it('migrates legacy pending publications into a non-executable cancelled audit record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mediaops-test-'))
    cleanup.push(dir)
    const timestamp = new Date().toISOString()
    await writeFile(join(dir, 'state.json'), JSON.stringify({
      version: 1,
      topics: [],
      viralItems: [],
      drafts: [{ id: 'draft-1', topicId: '', title: '旧草稿', body: '旧正文', platforms: ['douyin'], assets: [], status: 'ready', createdAt: timestamp, updatedAt: timestamp }],
      publications: [{
        id: 'publication-1', draftId: 'draft-1', platform: 'douyin', status: 'preview',
        skillName: 'skill-douyin-upload', idempotencyKey: '', confirmationTokenHash: 'legacy',
        expiresAt: timestamp, externalUrl: '', error: '', createdAt: timestamp, updatedAt: timestamp,
      }],
    }))
    const service = new MediaOpsService(new MediaOpsStore(dir))
    const state = await service.state()
    expect(state.version).toBe(5)
    expect(state.publications[0]).toMatchObject({ status: 'cancelled', confirmationTokenHash: '', resultEvidence: '' })
    expect(state.publications[0]?.snapshot.payloadDigest).toMatch(/^[a-f0-9]{64}$/)
    expect((JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as { version: number }).version).toBe(5)
  })
})

describe('confirmed publish workflow', () => {
  it('requires the one-time token and keeps repeat confirmation idempotent', async () => {
    const { dir, service } = await fixture()
    const topic = await service.createTopic({ title: '发布测试' })
    const draft = await service.saveDraft({
      topicId: topic.id,
      title: '这是标题',
      body: '这是已经人工复核的正文。',
      platforms: ['xiaohongshu'],
      status: 'ready',
    })
    const prepared = await service.preparePublish(draft.id, 'xiaohongshu', {
      accountLabel: '测试账号',
      accountIdentity: ACCOUNT_IDENTITY,
      preflightEvidence: 'skill-xhs-publisher check: 已登录；plan: 图文发布',
      workspaceRoot: dir,
      publisherOptions: { tags: ['AI'] },
    })
    expect(prepared.publication).not.toHaveProperty('confirmationTokenHash')
    expect(prepared.publication).not.toHaveProperty('snapshot')
    const listed = await service.list('publications') as Array<Record<string, unknown>>
    expect(JSON.stringify(listed)).not.toContain('这是已经人工复核的正文。')
    for (const hidden of ['accountIdentity', 'publisherOptions', 'assetSources', 'workspaceRoot', 'idempotencyKey']) {
      expect(listed[0]).not.toHaveProperty(hidden)
    }

    await expect(service.confirmPublish(prepared.publication.id, 'wrong', true, 'publish-001', prepared.preview.payloadDigest as string)).rejects.toThrow('令牌无效')
    await expect(service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'publish-001', `${prepared.preview.payloadDigest as string}0`)).rejects.toThrow('digest')
    const confirmed = await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, ' publish-001 ', prepared.preview.payloadDigest as string)
    expect(confirmed).toMatchObject({
      ok: true,
      nextAction: 'call_mediaops_execute_publish',
      publication: { status: 'confirmed', title: '这是标题', accountLabel: '测试账号' },
    })
    expect(confirmed).not.toHaveProperty('immutableSnapshot')
    await expect(service.saveDraft({ id: draft.id, title: '确认后篡改', body: '确认后篡改' })).rejects.toThrow('草稿有 confirmed 发布计划')
    const repeated = await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'publish-001', prepared.preview.payloadDigest as string)
    expect(repeated).toMatchObject({ ok: true, alreadyProcessed: true, nextAction: 'none' })
    expect(repeated).not.toHaveProperty('immutableSnapshot')
    await expect(service.confirmPublish(prepared.publication.id, prepared.confirmationToken, false, 'publish-001', prepared.preview.payloadDigest as string)).rejects.toThrow('不能通过确认工具取消')

    const execution = await service.beginPublishExecution(prepared.publication.id, prepared.preview.payloadDigest as string)
    if (!execution.execute) throw new Error('expected a fresh execution lease')
    const recorded = await service.recordPublishResult(prepared.publication.id, prepared.preview.payloadDigest as string, 'published', 'https://www.xiaohongshu.com/explore/1', 'platform post id: 1', '', execution.executionLeaseId)
    expect(recorded.status).toBe('published')
    expect((await service.state()).topics[0]?.status).toBe('published')
    await expect(service.recordPublishResult(prepared.publication.id, prepared.preview.payloadDigest as string, 'failed', '', '', 'late failure')).rejects.toThrow('终态 published 不可改写')
  })

  it('refuses unreviewed drafts and can cancel only a preview', async () => {
    const { dir, service } = await fixture()
    const draft = await service.saveDraft({
      title: '未审稿',
      body: '正文',
      platforms: ['douyin'],
      status: 'review',
    })
    const preflight = { accountLabel: '账号 A', accountIdentity: ACCOUNT_IDENTITY, preflightEvidence: '已登录，dry-run 完成', workspaceRoot: dir }
    await expect(service.preparePublish(draft.id, 'douyin', preflight)).rejects.toThrow('必须是 ready')

    const ready = await service.saveDraft({
      id: draft.id,
      title: draft.title,
      body: draft.body,
      platforms: ['douyin'],
      status: 'ready',
    })
    await expect(service.preparePublish(ready.id, 'bilibili', preflight)).rejects.toThrow('未经过 bilibili 平台审阅')
    const prepared = await service.preparePublish(ready.id, 'douyin', preflight)
    const cancelled = await service.cancelPublication(prepared.publication.id)
    expect(cancelled.status).toBe('cancelled')
    await expect(service.cancelPublication(prepared.publication.id)).rejects.toThrow('只有 preview 或 confirmed 状态可取消')
  })

  it('supersedes older previews and reserves published states for actual receipts', async () => {
    const { dir, service } = await fixture()
    await expect(service.createTopic({ title: '伪造选题', status: 'published' })).rejects.toThrow('发布回执')
    await expect(service.saveDraft({ title: '伪造草稿', body: '正文', platforms: ['douyin'], status: 'published' })).rejects.toThrow('发布回执')
    const topic = await service.createTopic({ title: '真实流程' })
    const draft = await service.saveDraft({ topicId: topic.id, title: '稿件', body: '正文', platforms: ['douyin'], status: 'ready' })
    const check = { accountLabel: '账号 A', accountIdentity: ACCOUNT_IDENTITY, preflightEvidence: '调用方报告：check/plan 已完成', workspaceRoot: dir }
    const first = await service.preparePublish(draft.id, 'douyin', check)
    const second = await service.preparePublish(draft.id, 'douyin', check)
    const state = await service.state()
    expect(state.publications.find(item => item.id === first.publication.id)?.status).toBe('cancelled')
    await expect(service.confirmPublish(first.publication.id, first.confirmationToken, true, 'old-key', first.preview.payloadDigest as string)).rejects.toThrow('不能再次交接')
    await service.confirmPublish(second.publication.id, second.confirmationToken, true, 'new-key', second.preview.payloadDigest as string)
    const execution = await service.beginPublishExecution(second.publication.id, second.preview.payloadDigest as string)
    if (!execution.execute) throw new Error('expected a fresh execution lease')
    await service.recordPublishResult(second.publication.id, second.preview.payloadDigest as string, 'published', 'https://www.douyin.com/video/2', 'post id: 2', '', execution.executionLeaseId)
    await expect(service.preparePublish(draft.id, 'douyin', check)).rejects.toThrow('当前为 published')
    await expect(service.saveDraft({ id: draft.id, title: '篡改', body: '篡改' })).rejects.toThrow('已开始跨平台发布的草稿不可直接修改')
    await expect(service.updateTopic(topic.id, { status: 'archived' })).rejects.toThrow('状态不可回退')
  })
})
