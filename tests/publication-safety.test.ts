import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExecutionSpec, PublisherAdapter, runCommand } from '../src/adapter.ts'
import { MediaOpsService } from '../src/service.ts'
import { MediaOpsStore, withDirectoryLock } from '../src/store.ts'

const cleanup: string[] = []
const ACCOUNT_IDENTITY = 'b'.repeat(64)
const WECHAT_THEME_SHA256 = createHash('sha256').update(readFileSync(join(process.cwd(), 'skills/openclaw/skill-wechat-publisher/assets/themes/refined-blue.json'))).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mediaops-safety-'))
  cleanup.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await mkdir(workspace)
  return { root, workspace, dataDir, service: new MediaOpsService(new MediaOpsStore(dataDir)) }
}

function preflight(workspaceRoot: string) {
  return {
    accountLabel: '账号 A',
    accountIdentity: ACCOUNT_IDENTITY,
    preflightEvidence: 'Host account probe and argv dry-run passed',
    workspaceRoot,
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('immutable publication payloads', () => {
  it('aggregates only receipts from the same draft revision across platforms', async () => {
    const { workspace, service } = await fixture()
    const topic = await service.createTopic({ title: '跨平台发布' })
    const draft = await service.saveDraft({
      topicId: topic.id,
      title: '同一版稿件',
      body: '正文',
      platforms: ['xiaohongshu', 'douyin'],
      status: 'ready',
    })
    const xhs = await service.preparePublish(draft.id, 'xiaohongshu', preflight(workspace))
    const douyin = await service.preparePublish(draft.id, 'douyin', preflight(workspace))
    for (const [prepared, url] of [
      [xhs, 'https://www.xiaohongshu.com/explore/abc'],
      [douyin, 'https://www.douyin.com/video/123'],
    ] as const) {
      const digest = prepared.preview.payloadDigest as string
      await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, prepared.publication.id, digest)
      const execution = await service.beginPublishExecution(prepared.publication.id, digest)
      if (!execution.execute) throw new Error('expected a fresh execution lease')
      await service.recordPublishResult(prepared.publication.id, digest, 'published', url, '只读内容页回查命中标题与账号', '', execution.executionLeaseId)
    }
    const state = await service.state()
    expect(state.drafts[0]).toMatchObject({ status: 'published', revision: 1 })
    expect(state.topics[0]?.status).toBe('published')
  })

  it('freezes workspace assets, detects tampering, and removes staging on cancel', async () => {
    const { workspace, dataDir, service } = await fixture()
    const image = join(workspace, 'cover.png')
    await writeFile(image, 'original')
    const draft = await service.saveDraft({ title: '素材冻结', body: '正文', platforms: ['xiaohongshu'], assets: [image], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'xiaohongshu', preflight(workspace))
    expect(prepared.preview.assets).toEqual([expect.objectContaining({ name: 'cover.png', sizeBytes: 8, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })])
    const publication = (await service.state()).publications[0]
    expect(publication?.snapshot.assets[0]).toContain(join(dataDir, 'staging', publication!.id))
    await service.confirmPublish(publication!.id, prepared.confirmationToken, true, 'asset-test', publication!.snapshot.payloadDigest)
    await writeFile(publication!.snapshot.assets[0]!, 'tampered')
    await expect(service.beginPublishExecution(publication!.id, publication!.snapshot.payloadDigest)).rejects.toThrow('冻结素材已变化')
    await service.cancelPublication(publication!.id)
    await expect(access(dirname(publication!.snapshot.bodyPath))).rejects.toThrow()
  })

  it('rejects remote, escaping, and symlinked assets', async () => {
    const { root, workspace, service } = await fixture()
    const outside = join(root, 'outside.png')
    const linked = join(workspace, 'linked.png')
    await writeFile(outside, 'outside')
    await symlink(outside, linked)
    const draft = await service.saveDraft({ title: '路径守卫', body: '正文', platforms: ['xiaohongshu'], assets: ['https://example.test/a.png'], status: 'ready' })
    await expect(service.preparePublish(draft.id, 'xiaohongshu', preflight(workspace))).rejects.toThrow('远程素材')
    await service.saveDraft({ id: draft.id, assets: [outside] })
    await expect(service.preparePublish(draft.id, 'xiaohongshu', preflight(workspace))).rejects.toThrow('越出当前 DSH 工作区')
    await service.saveDraft({ id: draft.id, assets: [linked] })
    await expect(service.preparePublish(draft.id, 'xiaohongshu', preflight(workspace))).rejects.toThrow('符号链接')
  })

  it('rewrites every supported WeChat body image to locked staging and rejects unenumerated forms', async () => {
    const { workspace, service } = await fixture()
    const cover = join(workspace, 'cover.png')
    await writeFile(cover, 'wechat-image')
    const draft = await service.saveDraft({
      title: '微信草稿',
      body: '# 标题\n\n![封面](cover.png)',
      platforms: ['wechat-official'],
      assets: [cover],
      status: 'ready',
    })
    const wechatPreflight = { ...preflight(workspace), publisherOptions: { theme: 'refined-blue', author: '测试作者', _themeSha256: WECHAT_THEME_SHA256 } }
    const prepared = await service.preparePublish(draft.id, 'wechat-official', wechatPreflight)
    const preview = await service.readPublishPreview(prepared.publication.id, prepared.preview.payloadDigest as string)
    expect(preview.bodyChunk).toContain('/staging/')
    expect(preview.bodyChunk).not.toContain('](cover.png)')
    expect(preview.assets).toHaveLength(1)
    await service.cancelPublication(prepared.publication.id)

    await service.saveDraft({ id: draft.id, body: '![远程](https://example.test/a.png)' })
    await expect(service.preparePublish(draft.id, 'wechat-official', wechatPreflight)).rejects.toThrow('不能是 URL')
    await service.saveDraft({ id: draft.id, body: '![引用][cover]\n\n[cover]: cover.png' })
    await expect(service.preparePublish(draft.id, 'wechat-official', wechatPreflight)).rejects.toThrow('引用式')
  })

  it('paginates the complete immutable body without returning a fake full preview', async () => {
    const { workspace, service } = await fixture()
    const body = '甲'.repeat(25_050)
    const draft = await service.saveDraft({ title: '长稿', body, platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    expect(prepared.preview).toMatchObject({ bodyTruncated: true, bodyChars: body.length })
    const first = await service.readPublishPreview(prepared.publication.id, prepared.preview.payloadDigest as string, 0, 20_000)
    const second = await service.readPublishPreview(prepared.publication.id, prepared.preview.payloadDigest as string, first.nextOffset!, 20_000)
    expect(first.bodyChunk + second.bodyChunk).toBe(body)
    expect(second).toMatchObject({ complete: true, nextOffset: null })
  })
})

describe('publication outcomes and recovery', () => {
  it('does not call accepted work published until a read-only reconciliation receipt exists', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '待对账', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    const digest = prepared.preview.payloadDigest as string
    await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'submitted-key', digest)
    const execution = await service.beginPublishExecution(prepared.publication.id, digest)
    if (!execution.execute) throw new Error('expected a fresh execution lease')
    const accepted = await service.recordPublishResult(prepared.publication.id, digest, 'submitted', '', 'Host adapter exit=0; UI accepted the submission', '', execution.executionLeaseId)
    expect(accepted.status).toBe('submitted')
    expect((await service.state()).drafts[0]?.status).toBe('ready')
    expect((await service.recoverPublish(prepared.publication.id, digest)).nextAction).toBe('reconcile_read_only')
    const published = await service.recordPublishResult(prepared.publication.id, digest, 'published', 'https://zhuanlan.zhihu.com/p/123', '只读文章页命中账号、标题与发布时间')
    expect(published.status).toBe('published')
    expect((await service.state()).drafts[0]?.status).toBe('published')
  })

  it('requires evidence that no content exists before recording failed', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '失败对账', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    const digest = prepared.preview.payloadDigest as string
    await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'failed-key', digest)
    const execution = await service.beginPublishExecution(prepared.publication.id, digest)
    if (!execution.execute) throw new Error('expected a fresh execution lease')
    await expect(service.recordPublishResult(prepared.publication.id, digest, 'failed', '', '', '未发布', execution.executionLeaseId)).rejects.toThrow('只读平台对账证据')
    const failed = await service.recordPublishResult(prepared.publication.id, digest, 'failed', '', '内容管理页按账号、标题、时间查询无结果', '明确未产生内容', execution.executionLeaseId)
    expect(failed.status).toBe('failed')
  })

  it('requires timezone-qualified schedules', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '定时', body: '正文', platforms: ['bilibili'], status: 'ready' })
    await expect(service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), scheduledAt: '2030-01-01T12:00:00' })).rejects.toThrow('UTC offset')
    const scheduledAt = new Date(Date.now() + 5 * 60 * 60_000).toISOString()
    const prepared = await service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), scheduledAt })
    expect(prepared.preview.scheduledAt).toBe(scheduledAt)
  })
})

describe('store and process safety', () => {
  it('serializes writes from two Store instances without losing updates', async () => {
    const { dataDir } = await fixture()
    const first = new MediaOpsService(new MediaOpsStore(dataDir))
    const second = new MediaOpsService(new MediaOpsStore(dataDir))
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? first : second).createTopic({ title: `topic-${index}` })))
    expect(await first.list('topics')).toHaveLength(12)
    expect(await second.list('topics')).toHaveLength(12)
  })

  it('rejects unsafe IDs before janitor paths can be derived', async () => {
    const { dataDir, service } = await fixture()
    await service.createTopic({ title: 'valid' })
    const path = join(dataDir, 'state.json')
    const state = JSON.parse(await readFile(path, 'utf8')) as { topics: Array<{ id: string }> }
    state.topics[0]!.id = '../../outside'
    await writeFile(path, JSON.stringify(state))
    const reloaded = new MediaOpsService(new MediaOpsStore(dataDir))
    await expect(reloaded.state()).rejects.toThrow('安全 ID')
  })

  it('removes only orphan staging directories', async () => {
    const { dataDir, service } = await fixture()
    const orphan = join(dataDir, 'staging', 'orphan-safe-id')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, 'body.md'), 'orphan')
    const old = new Date(Date.now() - 5 * 60_000)
    await utimes(orphan, old, old)
    await service.cleanupExpiredAndOrphanedStaging()
    await expect(stat(orphan)).rejects.toThrow()
  })

  it('rechecks live publication IDs after waiting for the global staging lock', async () => {
    const { dataDir, workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '清理竞态', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    const original = (await service.store.read()).publications.find(item => item.id === prepared.publication.id)!
    const stage = dirname(original.snapshot.bodyPath)
    await service.store.mutate(state => {
      const publication = state.publications.find(item => item.id === original.id)!
      publication.status = 'cancelled'
      publication.confirmationTokenHash = ''
    })
    const old = new Date(Date.now() - 5 * 60_000)
    await utimes(stage, old, old)

    let janitor = Promise.resolve()
    await withDirectoryLock(join(dataDir, '.staging.lock'), async () => {
      janitor = service.cleanupExpiredAndOrphanedStaging()
      // Let the janitor take its initial state snapshot and block on this lock.
      await new Promise(resolve => setTimeout(resolve, 75))
      await service.store.mutate(state => {
        const index = state.publications.findIndex(item => item.id === original.id)
        state.publications[index] = structuredClone(original)
      })
    }, { label: 'test staging' })
    await janitor

    expect((await stat(stage)).isDirectory()).toBe(true)
  })

  it('refuses a symlinked staging root instead of writing to or deleting from its target', async () => {
    const { root, dataDir, workspace, service } = await fixture()
    await service.createTopic({ title: 'initialize data root' })
    const outside = join(root, 'outside-staging')
    await mkdir(outside)
    await symlink(outside, join(dataDir, 'staging'))
    const draft = await service.saveDraft({ title: '父路径守卫', body: '正文', platforms: ['zhihu'], status: 'ready' })
    await expect(service.preparePublish(draft.id, 'zhihu', preflight(workspace))).rejects.toThrow('不能是符号链接')
    expect((await stat(outside)).isDirectory()).toBe(true)
  })

  it('enforces a cross-publication global staging quota before copying another payload', async () => {
    const { dataDir, workspace, service } = await fixture()
    await service.createTopic({ title: 'initialize data root' })
    const staging = join(dataDir, 'staging')
    await mkdir(staging)
    const sparse = await open(join(staging, 'quota-reservation.bin'), 'w', 0o600)
    try {
      await sparse.truncate(6 * 1024 * 1024 * 1024 + 1)
    } finally {
      await sparse.close()
    }
    const draft = await service.saveDraft({ title: '配额', body: '正文', platforms: ['zhihu'], status: 'ready' })
    await expect(service.preparePublish(draft.id, 'zhihu', preflight(workspace))).rejects.toThrow('全局 staging 配额不足')
  })

  it('never spawns a command for a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runCommand({ command: '/usr/bin/printf', args: ['unsafe'], cwd: tmpdir(), env: {} }, controller.signal)
    expect(result).toMatchObject({ started: false, aborted: true, stdout: '' })
  })

  it('builds argv with staged content files and the frozen workspace cwd', async () => {
    const { workspace, dataDir, service } = await fixture()
    const image = join(workspace, 'image.png')
    await writeFile(image, 'image')
    const draft = await service.saveDraft({ title: 'argv', body: 'BODY_MUST_NOT_BE_ARGV', platforms: ['xiaohongshu'], assets: [image], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'xiaohongshu', { ...preflight(workspace), publisherOptions: { tags: ['AI'] } })
    const publication = (await service.state()).publications.find(item => item.id === prepared.publication.id)!
    const spec = buildExecutionSpec(publication, dataDir)
    expect(spec.cwd).toBe(await realpath(workspace))
    expect(spec.args).toContain('--content-file')
    expect(spec.args).toContain(publication.snapshot.bodyPath)
    expect(spec.args[spec.args.indexOf('--expected-account-identity') + 1]).toBe(publication.snapshot.accountIdentity)
    expect(spec.args).not.toContain('BODY_MUST_NOT_BE_ARGV')
  })

  it('passes the frozen identity to web, WeChat, and Bilibili publishers', async () => {
    const { workspace, dataDir, service } = await fixture()
    const image = join(workspace, 'cover.png')
    const video = join(workspace, 'video.mp4')
    await writeFile(image, 'image')
    await writeFile(video, 'video')
    const zhihu = await service.saveDraft({ title: '知乎身份', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const wechat = await service.saveDraft({ title: '微信身份', body: '正文', platforms: ['wechat-official'], assets: [image], status: 'ready' })
    const bili = await service.saveDraft({ title: 'B站身份', body: '正文', platforms: ['bilibili'], assets: [video], status: 'ready' })
    const prepared = [
      await service.preparePublish(zhihu.id, 'zhihu', preflight(workspace)),
      await service.preparePublish(wechat.id, 'wechat-official', {
        ...preflight(workspace),
        publisherOptions: { theme: 'refined-blue', author: '测试作者', _themeSha256: WECHAT_THEME_SHA256 },
      }),
      await service.preparePublish(bili.id, 'bilibili', preflight(workspace)),
    ]
    const state = await service.state()
    for (const item of prepared) {
      const publication = state.publications.find(candidate => candidate.id === item.publication.id)!
      const spec = buildExecutionSpec(publication, dataDir)
      expect(spec.args[spec.args.indexOf('--expected-account-identity') + 1]).toBe(ACCOUNT_IDENTITY)
    }
  })

  it('removes stale sensitive remnants, preserves fresh ones, and enforces private modes', async () => {
    const { dataDir, service } = await fixture()
    await service.state()
    const preflightRoot = join(dataDir, 'preflight')
    const attemptRoot = join(dataDir, 'credentials', 'bilibili', 'attempt-cookies')
    const oldRun = join(preflightRoot, 'run-old123')
    const freshRun = join(preflightRoot, 'run-fresh123')
    const oldCookie = join(attemptRoot, 'attempt-old123.json')
    const freshCookie = join(attemptRoot, 'attempt-fresh123.json')
    await mkdir(oldRun, { recursive: true, mode: 0o755 })
    await mkdir(freshRun, { recursive: true, mode: 0o755 })
    await mkdir(attemptRoot, { recursive: true, mode: 0o755 })
    await writeFile(join(oldRun, 'body.md'), 'old', { mode: 0o644 })
    await writeFile(join(freshRun, 'body.md'), 'fresh', { mode: 0o644 })
    await writeFile(oldCookie, 'old-cookie', { mode: 0o644 })
    await writeFile(freshCookie, 'fresh-cookie', { mode: 0o644 })
    const old = new Date(Date.now() - 3 * 60 * 60_000)
    await utimes(oldRun, old, old)
    await utimes(oldCookie, old, old)

    await new PublisherAdapter(dataDir).cleanupSensitiveTemporaryFiles()

    await expect(access(oldRun)).rejects.toThrow()
    await expect(access(oldCookie)).rejects.toThrow()
    expect((await stat(preflightRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(attemptRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(freshRun)).mode & 0o777).toBe(0o700)
    expect((await stat(join(freshRun, 'body.md'))).mode & 0o777).toBe(0o600)
    expect((await stat(freshCookie)).mode & 0o777).toBe(0o600)
  })

  it('refuses symlinked sensitive temporary roots', async () => {
    const { root, dataDir, service } = await fixture()
    await service.state()
    const outside = join(root, 'outside-preflight')
    await mkdir(outside)
    await symlink(outside, join(dataDir, 'preflight'))
    await expect(new PublisherAdapter(dataDir).cleanupSensitiveTemporaryFiles()).rejects.toThrow('不能是符号链接')
    expect((await stat(outside)).isDirectory()).toBe(true)
  })

  it('freezes the canonical workspace instead of a redirectable session symlink', async () => {
    const { root, workspace, dataDir, service } = await fixture()
    const alias = join(root, 'workspace-alias')
    const other = join(root, 'other-workspace')
    await mkdir(other)
    await symlink(workspace, alias)
    const draft = await service.saveDraft({ title: '工作区', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(alias))
    await rm(alias, { force: true })
    await symlink(other, alias)
    const publication = (await service.state()).publications.find(item => item.id === prepared.publication.id)!
    expect(publication.snapshot.workspaceRoot).toBe(await realpath(workspace))
    expect(buildExecutionSpec(publication, dataDir).cwd).toBe(await realpath(workspace))
  })

  it('strictly validates and canonicalizes platform publisher options', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '参数', body: '正文', platforms: ['bilibili'], status: 'ready' })
    await expect(service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), publisherOptions: { author: 'unexpected' } })).rejects.toThrow('不支持')
    await expect(service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), publisherOptions: { tid: 3.5 } })).rejects.toThrow('整数')
    await expect(service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), publisherOptions: { copyright: 2 } })).rejects.toThrow('转载必须提供')
    const prepared = await service.preparePublish(draft.id, 'bilibili', { ...preflight(workspace), publisherOptions: { tags: 'AI, 工具,AI', copyright: 1 } })
    expect(prepared.preview.publisherOptions).toMatchObject({ tags: ['AI', '工具'], copyright: 1 })
  })

  it('invalidates an unconfirmed preview and deletes its staged payload when the draft changes', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '旧稿', body: '旧正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    const state = await service.state()
    const stage = dirname(state.publications[0]!.snapshot.bodyPath)
    await service.saveDraft({ id: draft.id, title: '新稿' })
    expect((await service.state()).publications[0]?.status).toBe('cancelled')
    await expect(access(stage)).rejects.toThrow()
    await expect(service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'stale', prepared.preview.payloadDigest as string)).rejects.toThrow('不能再次交接')
  })

  it('blocks manual reconciliation while a Host execution lease is active', async () => {
    const { workspace, service } = await fixture()
    const draft = await service.saveDraft({ title: '租约', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const prepared = await service.preparePublish(draft.id, 'zhihu', preflight(workspace))
    const digest = prepared.preview.payloadDigest as string
    await service.confirmPublish(prepared.publication.id, prepared.confirmationToken, true, 'lease-key', digest)
    const execution = await service.beginPublishExecution(prepared.publication.id, digest)
    if (!execution.execute) throw new Error('expected a fresh execution lease')
    await expect(service.recordPublishResult(prepared.publication.id, digest, 'published', 'https://zhuanlan.zhihu.com/p/1', '人工对账')).rejects.toThrow('租约有效')
    const otherDraft = await service.saveDraft({ title: '另一账号', body: '正文', platforms: ['zhihu'], status: 'ready' })
    const other = await service.preparePublish(otherDraft.id, 'zhihu', { ...preflight(workspace), accountIdentity: 'c'.repeat(64), accountLabel: '账号 B' })
    const otherDigest = other.preview.payloadDigest as string
    await service.confirmPublish(other.publication.id, other.confirmationToken, true, 'other-account-key', otherDigest)
    await expect(service.beginPublishExecution(other.publication.id, otherDigest)).rejects.toThrow('共享登录资源')
    await service.markPublishUncertain(prepared.publication.id, digest, execution.executionLeaseId, '进程返回不确定')
    await expect(service.beginPublishExecution(other.publication.id, otherDigest)).rejects.toThrow('未完成的 publishing')
    await service.cancelPublication(other.publication.id)
    const recorded = await service.recordPublishResult(prepared.publication.id, digest, 'published', 'https://zhuanlan.zhihu.com/p/1', '只读文章页已确认')
    expect(recorded.status).toBe('published')
  })

})
