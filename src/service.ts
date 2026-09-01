import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, readdir, realpath, rm, statfs, utimes, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { computeSnapshotDigest, makeSnapshot, toPublicationView } from './publication.ts'
import { MEDIA_PLATFORMS, type Draft, type DraftStatus, type MediaOpsState, type MediaPlatform, type Publication, type Topic, type TopicStatus, type TrendItem, type ViralItem } from './types.ts'
import { MediaOpsStore, withDirectoryLock } from './store.ts'

export const PUBLISH_SKILLS: Record<MediaPlatform, string> = {
  xiaohongshu: 'skill-xhs-publisher',
  douyin: 'skill-douyin-upload',
  kuaishou: 'skill-kuaishou-upload',
  'wechat-channels': 'skill-channels-upload',
  'wechat-official': 'skill-wechat-publisher',
  zhihu: 'skill-zhihu-publisher',
  bilibili: 'skill-bilibili-upload',
}

const TOPIC_STATUSES: TopicStatus[] = ['idea', 'researching', 'planned', 'drafting', 'ready', 'published', 'archived']
const DRAFT_STATUSES: DraftStatus[] = ['draft', 'review', 'ready', 'partially_published', 'published', 'archived']
const MAX_FROZEN_ASSET_BYTES = 2 * 1024 * 1024 * 1024
const MAX_FROZEN_ASSET_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
const MAX_FROZEN_ASSETS = 20
const MAX_GLOBAL_STAGING_BYTES = 6 * 1024 * 1024 * 1024
const STAGING_DISK_RESERVE_BYTES = 256 * 1024 * 1024
const PREPARING_STAGE_LEASE_MS = 2 * 60_000
const STAGING_LOCK_WAIT_MS = 10 * 60_000

function now(): string {
  return new Date().toISOString()
}

function requiredText(value: unknown, label: string, max = 20_000): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不能为空`)
  return value.trim().slice(0, max)
}

function optionalText(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown, limit = 50, itemLimit = 500): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    .slice(0, limit)
    .map(item => item.slice(0, itemLimit))
}

function platforms(value: unknown): MediaPlatform[] {
  const allowed = new Set<string>(MEDIA_PLATFORMS)
  return strings(value, MEDIA_PLATFORMS.length, 40).filter((item): item is MediaPlatform => allowed.has(item))
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function safeAssetName(path: string, index: number): string {
  const clean = basename(path).replaceAll(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'asset'
  return `${String(index + 1).padStart(3, '0')}-${clean}`
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('publisherOptions 必须是 JSON 对象')
  const serialized = JSON.stringify(value)
  if (serialized.length > 20_000) throw new Error('publisherOptions 超过 20,000 字符')
  return JSON.parse(serialized) as Record<string, unknown>
}

function publisherOptionsForPlatform(platform: MediaPlatform, value: unknown): Record<string, unknown> {
  const options = jsonObject(value)
  const platformKeys: Record<MediaPlatform, string[]> = {
    xiaohongshu: ['tags', 'proxy', 'noProxy'],
    douyin: ['tags', 'proxy', 'noProxy'],
    kuaishou: ['tags', 'proxy', 'noProxy'],
    'wechat-channels': ['tags', 'proxy', 'noProxy'],
    'wechat-official': ['digest', 'sourceUrl', 'theme', 'author', '_themeSha256'],
    zhihu: ['tags', 'proxy', 'noProxy'],
    bilibili: ['tags', 'proxy', 'noProxy', 'tid', 'partition', 'copyright', 'source'],
  }
  const allowed = new Set(platformKeys[platform])
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`${platform} 不支持 publisherOptions.${key}`)
  }
  if (options.tags !== undefined) {
    if (typeof options.tags !== 'string' && !Array.isArray(options.tags)) throw new Error('publisherOptions.tags 必须是字符串或字符串数组')
    if (Array.isArray(options.tags) && options.tags.some(item => typeof item !== 'string')) throw new Error('publisherOptions.tags 只能包含字符串')
    const normalizedTags = typeof options.tags === 'string'
      ? options.tags.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)
      : options.tags.map(item => (item as string).trim()).filter(Boolean)
    if (normalizedTags.length > 20 || normalizedTags.some(item => item.length > 80)) throw new Error('publisherOptions.tags 最多 20 个，每个最多 80 字符')
    options.tags = [...new Set(normalizedTags)]
  }
  if (options.noProxy !== undefined && typeof options.noProxy !== 'boolean') throw new Error('publisherOptions.noProxy 必须是 boolean')
  if (options.proxy !== undefined) {
    if (typeof options.proxy !== 'string') throw new Error('publisherOptions.proxy 必须是 URL 字符串')
    try {
      const url = new URL(options.proxy)
      if (!['http:', 'https:', 'socks5:'].includes(url.protocol)) throw new Error('unsupported protocol')
      if (url.username || url.password) throw new Error('credentials forbidden')
    } catch {
      throw new Error('publisherOptions.proxy 必须是不含用户名/密码的 http(s)/socks5 URL；代理凭据请放 Host 环境变量')
    }
  }
  const boundedString = (key: string, max: number, required = false): string => {
    const current = options[key]
    if (current === undefined && !required) return ''
    if (typeof current !== 'string' || (required && current.trim() === '') || current.length > max || /[\0\r\n]/.test(current)) {
      throw new Error(`publisherOptions.${key} 必须是${required ? '非空' : ''}单行字符串，最多 ${max} 字符`)
    }
    options[key] = current.trim()
    return options[key] as string
  }
  if (platform === 'wechat-official') {
    if (typeof options.theme !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(options.theme)) throw new Error('微信公众号预检必须冻结有效内置 theme 名称')
    if (typeof options.author !== 'string' || options.author.trim() === '' || options.author.length > 100) throw new Error('微信公众号预检必须冻结 author')
    if (typeof options._themeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(options._themeSha256)) throw new Error('微信公众号预检缺少主题文件摘要')
    boundedString('digest', 120)
    const sourceUrl = boundedString('sourceUrl', 2_000)
    if (sourceUrl) {
      try {
        const url = new URL(sourceUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid source URL')
      } catch {
        throw new Error('publisherOptions.sourceUrl 必须是不含用户名/密码的 http(s) URL')
      }
    }
  }
  if (platform === 'bilibili') {
    if (options.tid !== undefined && (typeof options.tid !== 'number' || !Number.isSafeInteger(options.tid) || options.tid < 1 || options.tid > 1_000_000)) {
      throw new Error('publisherOptions.tid 必须是 1..1000000 的整数')
    }
    const partition = boundedString('partition', 100)
    if (options.tid !== undefined && partition) throw new Error('publisherOptions.tid 与 partition 只能提供一个')
    if (options.copyright !== undefined && options.copyright !== 1 && options.copyright !== 2) throw new Error('publisherOptions.copyright 只能是 1（自制）或 2（转载）')
    const source = boundedString('source', 2_000)
    if (options.copyright === 2 && !source) throw new Error('Bilibili 转载必须提供 publisherOptions.source')
    if (source && options.copyright !== 2) throw new Error('publisherOptions.source 仅能用于 copyright=2 的转载内容')
  }
  return options
}

function tokenMatches(value: string, digest: string): boolean {
  const actual = Buffer.from(hashToken(value), 'hex')
  const expected = Buffer.from(digest, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function urlAllowedForPlatform(platform: MediaPlatform, value: string): boolean {
  const hosts: Record<MediaPlatform, RegExp> = {
    xiaohongshu: /(^|\.)xiaohongshu\.com$/i,
    douyin: /(^|\.)douyin\.com$/i,
    kuaishou: /(^|\.)kuaishou\.com$/i,
    'wechat-channels': /(^|\.)weixin\.qq\.com$/i,
    'wechat-official': /(^|\.)weixin\.qq\.com$|(^|\.)qq\.com$/i,
    zhihu: /(^|\.)zhihu\.com$/i,
    bilibili: /(^|\.)bilibili\.com$/i,
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && hosts[platform].test(url.hostname)
  } catch {
    return false
  }
}

function byNewest(a: unknown, b: unknown): number {
  const leftItem = a as { updatedAt?: string; lastSeenAt?: string; createdAt?: string }
  const rightItem = b as { updatedAt?: string; lastSeenAt?: string; createdAt?: string }
  const left = leftItem.updatedAt ?? leftItem.lastSeenAt ?? leftItem.createdAt ?? ''
  const right = rightItem.updatedAt ?? rightItem.lastSeenAt ?? rightItem.createdAt ?? ''
  return right.localeCompare(left)
}

export class MediaOpsService {
  constructor(readonly store: MediaOpsStore) {}

  private async stagingRoot(): Promise<string> {
    const dataRoot = await realpath(this.store.dataDir)
    const configured = join(dataRoot, 'staging')
    try {
      const info = await lstat(configured)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('MediaOps staging 路径必须是数据目录内的真实目录，不能是符号链接')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(configured, { mode: 0o700 })
    }
    await chmod(configured, 0o700).catch(() => undefined)
    const canonical = await realpath(configured)
    if (canonical !== configured) throw new Error('MediaOps staging 路径解析到数据目录之外或经过符号链接')
    return canonical
  }

  private async stagingBytes(root: string, stopAfter = MAX_GLOBAL_STAGING_BYTES): Promise<number> {
    let total = 0
    const pending = [root]
    while (pending.length > 0) {
      const directory = pending.pop() as string
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        const info = await lstat(path)
        if (info.isSymbolicLink()) throw new Error(`MediaOps staging 包含不安全的符号链接: ${path}`)
        if (info.isDirectory()) pending.push(path)
        else if (info.isFile()) total += info.size
        if (total > stopAfter) return total
      }
    }
    return total
  }

  private async removeStageDirectory(stagingRoot: string, publicationId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(publicationId) || publicationId === '.' || publicationId === '..') return
    const target = resolve(stagingRoot, publicationId)
    const containment = relative(stagingRoot, target)
    if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) return
    const targetInfo = await lstat(target).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!targetInfo) return
    if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) throw new Error(`拒绝清理不安全的 staging 条目: ${target}`)
    await rm(target, { recursive: true, force: true })
  }

  private async cleanupStage(publicationId: string): Promise<void> {
    const stagingRoot = await this.stagingRoot()
    await withDirectoryLock(join(await realpath(this.store.dataDir), '.staging.lock'), async () => {
      await this.removeStageDirectory(stagingRoot, publicationId)
    }, { waitMs: STAGING_LOCK_WAIT_MS, label: 'MediaOps staging' })
  }

  async cleanupExpiredAndOrphanedStaging(): Promise<void> {
    const state = await this.store.read()
    const expired = state.publications
      .filter(item => (item.status === 'preview' || item.status === 'confirmed') && new Date(item.expiresAt).getTime() < Date.now())
      .map(item => item.id)
    if (expired.length > 0) {
      const expiredSet = new Set(expired)
      await this.store.mutate(current => {
        for (const publication of current.publications) {
          if (!expiredSet.has(publication.id) || (publication.status !== 'preview' && publication.status !== 'confirmed')) continue
          publication.status = 'cancelled'
          publication.confirmationTokenHash = ''
          publication.error = 'Preview/authorization expired before execution.'
          publication.updatedAt = now()
        }
      })
    }
    const stagingRoot = await this.stagingRoot()
    await withDirectoryLock(join(await realpath(this.store.dataDir), '.staging.lock'), async () => {
      const entries = await readdir(stagingRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const directory = join(stagingRoot, entry.name)
        const marker = await lstat(join(directory, '.preparing')).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        })
        if (marker?.isSymbolicLink()) throw new Error(`拒绝使用符号链接 staging 准备标记: ${directory}`)
        if (marker && Date.now() - marker.mtimeMs < PREPARING_STAGE_LEASE_MS) continue
        const directoryInfo = await lstat(directory).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        })
        if (!marker && directoryInfo && Date.now() - directoryInfo.mtimeMs < 60_000) continue
        // Re-read state only while holding the global staging lock and as the
        // final check before deletion. A payload can be copied before its
        // publication record commits, so an earlier live-ID snapshot is unsafe.
        const latest = await this.store.read()
        const live = latest.publications.some(item => item.id === entry.name && ['preview', 'confirmed', 'publishing'].includes(item.status))
        if (live) continue
        await this.removeStageDirectory(stagingRoot, entry.name)
      }
    }, { waitMs: STAGING_LOCK_WAIT_MS, label: 'MediaOps staging' })
  }

  private async freezePayload(publicationId: string, workspaceRoot: string, platform: MediaPlatform, body: string, assets: string[], signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (!isAbsolute(workspaceRoot)) throw new Error('发布必须绑定 DSH 会话的绝对工作区')
    const workspace = await realpath(workspaceRoot)
    const bodyReferences: Array<{ raw: string; source: string }> = []
    if (platform === 'wechat-official') {
      if (/<img\b/i.test(body)) throw new Error('微信公众号受控发布不接受原始 HTML <img>；请改为本地 Markdown 图片引用')
      const withoutInlineImages = body.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      if (/!\[/.test(withoutInlineImages)) throw new Error('微信公众号受控发布不接受引用式或无法枚举的 Markdown 图片；请改为 ![说明](本地路径)')
      for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        const raw = (match[2] ?? '').trim()
        if (!raw || /\s/.test(raw) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
          throw new Error(`微信公众号正文图片必须是无空格的本地工作区路径，不能是 URL/data URI: ${raw || '(empty)'}`)
        }
        bodyReferences.push({ raw, source: isAbsolute(raw) ? raw : resolve(workspace, raw) })
      }
    }
    const requestedAssets = [...assets, ...bodyReferences.map(item => item.source)]
    if (requestedAssets.length > MAX_FROZEN_ASSETS) throw new Error(`正文图片与附件合计最多冻结 ${MAX_FROZEN_ASSETS} 个素材`)
    const prepared: Array<{ source: string; size: number; dev: number; ino: number; mtimeMs: number }> = []
    const canonicalByInput = new Map<string, string>()
    const seen = new Set<string>()
    let totalBytes = Buffer.byteLength(body)
    for (const source of requestedAssets) {
      signal?.throwIfAborted()
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) {
        throw new Error(`远程素材不能作为不可变发布载荷: ${source}；请先下载到当前工作区`)
      }
      if (!isAbsolute(source)) throw new Error(`发布素材必须是当前工作区内的本地绝对路径: ${source}`)
      const linkInfo = await lstat(source)
      if (linkInfo.isSymbolicLink()) throw new Error(`发布素材不能是符号链接: ${source}`)
      const canonical = await realpath(source)
      canonicalByInput.set(source, canonical)
      const containment = relative(workspace, canonical)
      if (containment.startsWith('..') || isAbsolute(containment) || containment === '') throw new Error(`发布素材越出当前 DSH 工作区: ${source}`)
      if (seen.has(canonical)) continue
      seen.add(canonical)
      const sourceInfo = await lstat(canonical)
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error(`发布素材必须是普通文件: ${source}`)
      if (sourceInfo.size > MAX_FROZEN_ASSET_BYTES) throw new Error(`单个发布素材超过 2 GiB 上限: ${source}`)
      totalBytes += sourceInfo.size
      if (totalBytes > MAX_FROZEN_ASSET_TOTAL_BYTES) throw new Error('单次发布冻结载荷总计超过 4 GiB 上限')
      prepared.push({ source: canonical, size: sourceInfo.size, dev: sourceInfo.dev, ino: sourceInfo.ino, mtimeMs: sourceInfo.mtimeMs })
    }
    const disk = await statfs(this.store.dataDir, { bigint: true })
    const available = disk.bavail * disk.bsize
    if (available < BigInt(totalBytes + STAGING_DISK_RESERVE_BYTES)) throw new Error('MediaOps 数据盘可用空间不足，无法安全冻结发布载荷')
    const stagingRoot = await this.stagingRoot()
    return withDirectoryLock(join(await realpath(this.store.dataDir), '.staging.lock'), async () => {
      const existingBytes = await this.stagingBytes(stagingRoot)
      if (existingBytes + totalBytes > MAX_GLOBAL_STAGING_BYTES) throw new Error('MediaOps 全局 staging 配额不足；请取消旧预览或等待过期清理后重试')
      const stageDir = join(stagingRoot, publicationId)
      await mkdir(stageDir, { mode: 0o700 })
      await chmod(stageDir, 0o700).catch(() => undefined)
      const preparingMarker = join(stageDir, '.preparing')
      await writeFile(preparingMarker, String(process.pid), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      const heartbeat = setInterval(() => {
        const tick = new Date()
        void utimes(preparingMarker, tick, tick).catch(() => undefined)
      }, 30_000)
      heartbeat.unref?.()
      try {
        const manifest: Array<{ source: string; frozenPath: string; sha256: string; sizeBytes: number }> = []
        for (const [index, source] of prepared.entries()) {
          signal?.throwIfAborted()
          const frozenPath = join(stageDir, safeAssetName(source.source, index))
          await pipeline(createReadStream(source.source), createWriteStream(frozenPath, { flags: 'wx', mode: 0o600 }), { signal })
          await chmod(frozenPath, 0o600).catch(() => undefined)
          const afterCopy = await lstat(source.source)
          if (afterCopy.dev !== source.dev || afterCopy.ino !== source.ino || afterCopy.size !== source.size || afterCopy.mtimeMs !== source.mtimeMs) {
            throw new Error(`素材在冻结期间发生变化: ${source.source}`)
          }
          const frozenInfo = await lstat(frozenPath)
          manifest.push({ source: source.source, frozenPath, sha256: await hashFile(frozenPath), sizeBytes: frozenInfo.size })
        }
        const frozenBySource = new Map(manifest.map(item => [item.source, item.frozenPath]))
        let frozenBody = body
        if (platform === 'wechat-official' && bodyReferences.length > 0) {
          const frozenByRaw = new Map(bodyReferences.map(item => {
            const canonical = canonicalByInput.get(item.source)
            const frozen = canonical ? frozenBySource.get(canonical) : undefined
            if (!frozen) throw new Error(`无法冻结微信公众号正文图片: ${item.raw}`)
            return [item.raw, frozen]
          }))
          frozenBody = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt: string, rawValue: string) => {
            const frozen = frozenByRaw.get(rawValue.trim())
            return frozen ? `![${alt}](${frozen})` : full
          })
        }
        const bodyPath = join(stageDir, 'body.md')
        signal?.throwIfAborted()
        await writeFile(bodyPath, frozenBody, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        return {
          stageDir,
          body: frozenBody,
          bodyPath,
          bodySha256: hashToken(frozenBody),
          assets: manifest.map(item => item.frozenPath),
          assetManifest: manifest,
          preparingMarker,
        }
      } finally {
        clearInterval(heartbeat)
      }
    }, { waitMs: STAGING_LOCK_WAIT_MS, label: 'MediaOps staging' })
  }

  async overview() {
    const state = await this.store.read()
    return {
      ok: true,
      counts: {
        topics: state.topics.length,
        viralItems: state.viralItems.length,
        drafts: state.drafts.length,
        publications: state.publications.length,
        readyDrafts: state.drafts.filter(item => item.status === 'ready').length,
        pendingPublications: state.publications.filter(item => ['preview', 'confirmed', 'publishing'].includes(item.status)).length,
      },
      capabilities: { totalSkills: 112, general: 6, discover: 9, plan: 16, produce: 50, publish: 20, attribute: 11 },
      publisherSkills: PUBLISH_SKILLS,
    }
  }

  async list(kind: 'topics' | 'viralItems' | 'drafts' | 'publications', query = '', limit = 100): Promise<unknown[]> {
    const state = await this.store.read()
    const needle = query.trim().toLocaleLowerCase()
    const source: unknown[] = kind === 'publications' ? state.publications.map(toPublicationView) : state[kind]
    const rows = source.filter(item => needle === '' || JSON.stringify(item).toLocaleLowerCase().includes(needle))
    return structuredClone(rows.sort(byNewest).slice(0, Math.max(1, Math.min(Math.trunc(limit), 500))))
  }

  async state(): Promise<MediaOpsState> {
    return this.store.read()
  }

  async draftForPreflight(draftId: string, platform: MediaPlatform): Promise<Draft> {
    const state = await this.store.read()
    const draft = state.drafts.find(item => item.id === draftId)
    if (!draft) throw new Error(`找不到草稿 ${draftId}`)
    if (draft.status !== 'ready' && draft.status !== 'partially_published') throw new Error(`草稿状态必须是 ready 或 partially_published，当前为 ${draft.status}`)
    if (!draft.platforms.includes(platform)) throw new Error(`草稿未经过 ${platform} 平台审阅`)
    return structuredClone(draft)
  }

  async createTopic(input: Partial<Topic>): Promise<Topic> {
    if (input.status === 'published') throw new Error('published 状态只能由有证据的发布回执写入')
    const timestamp = now()
    return this.store.mutate(state => {
      const topic: Topic = {
        id: randomUUID(),
        title: requiredText(input.title, '选题标题', 300),
        angle: optionalText(input.angle, 2_000),
        summary: optionalText(input.summary, 5_000),
        content: optionalText(input.content, 100_000),
        tags: strings(input.tags),
        platforms: platforms(input.platforms),
        status: TOPIC_STATUSES.includes(input.status as TopicStatus) && input.status !== 'published' ? input.status as TopicStatus : 'idea',
        sourceViralIds: strings(input.sourceViralIds, 100, 100),
        references: strings(input.references, 100, 2_000),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.topics.push(topic)
      return topic
    })
  }

  async updateTopic(id: string, patch: Partial<Topic>): Promise<Topic> {
    return this.store.mutate(state => {
      const topic = state.topics.find(item => item.id === id)
      if (!topic) throw new Error(`找不到选题 ${id}`)
      if (patch.title !== undefined) topic.title = requiredText(patch.title, '选题标题', 300)
      if (patch.angle !== undefined) topic.angle = optionalText(patch.angle, 2_000)
      if (patch.summary !== undefined) topic.summary = optionalText(patch.summary, 5_000)
      if (patch.content !== undefined) topic.content = optionalText(patch.content, 100_000)
      if (patch.tags !== undefined) topic.tags = strings(patch.tags)
      if (patch.platforms !== undefined) topic.platforms = platforms(patch.platforms)
      if (patch.sourceViralIds !== undefined) topic.sourceViralIds = strings(patch.sourceViralIds, 100, 100)
      if (patch.references !== undefined) topic.references = strings(patch.references, 100, 2_000)
      if (patch.status !== undefined) {
        if (!TOPIC_STATUSES.includes(patch.status)) throw new Error(`无效选题状态 ${patch.status}`)
        if (patch.status === 'published') throw new Error('published 状态只能由有证据的发布回执写入')
        if (topic.status === 'published') throw new Error('已发布选题的状态不可回退；请创建新选题版本')
        topic.status = patch.status
      }
      topic.updatedAt = now()
      return topic
    })
  }

  async saveViral(input: Partial<ViralItem>): Promise<ViralItem> {
    return this.store.mutate(state => {
      const title = requiredText(input.title, '爆款标题', 500)
      const platform = requiredText(input.platform, '平台', 80)
      const url = optionalText(input.url, 2_000)
      const existing = state.viralItems.find(item => (url !== '' && item.url === url) || (item.platform === platform && item.title === title))
      if (existing) {
        existing.hot = optionalText(input.hot, 100) || existing.hot
        existing.author = optionalText(input.author, 300) || existing.author
        existing.summary = optionalText(input.summary, 5_000) || existing.summary
        existing.notes = optionalText(input.notes, 10_000) || existing.notes
        existing.tags = [...new Set([...existing.tags, ...strings(input.tags)])]
        existing.lastSeenAt = now()
        return existing
      }
      const timestamp = now()
      const viral: ViralItem = {
        id: randomUUID(),
        platform,
        title,
        url,
        hot: optionalText(input.hot, 100),
        author: optionalText(input.author, 300),
        summary: optionalText(input.summary, 5_000),
        notes: optionalText(input.notes, 10_000),
        tags: strings(input.tags),
        source: optionalText(input.source, 2_000),
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      }
      state.viralItems.push(viral)
      return viral
    })
  }

  async saveTrends(items: readonly TrendItem[]): Promise<ViralItem[]> {
    const saved: ViralItem[] = []
    for (const item of items) {
      saved.push(await this.saveViral({ ...item }))
    }
    return saved
  }

  async promoteViral(id: string, patch: Partial<Topic> = {}): Promise<Topic> {
    const state = await this.store.read()
    const viral = state.viralItems.find(item => item.id === id)
    if (!viral) throw new Error(`找不到爆款 ${id}`)
    return this.createTopic({
      title: patch.title || viral.title,
      angle: patch.angle || viral.notes,
      summary: patch.summary || viral.summary,
      content: patch.content || '',
      tags: patch.tags?.length ? patch.tags : viral.tags,
      platforms: patch.platforms || [],
      status: patch.status || 'idea',
      sourceViralIds: [viral.id],
      references: [viral.url].filter(Boolean),
    })
  }

  async saveDraft(input: Partial<Draft> & { id?: string }): Promise<Draft> {
    if (!input.id && (input.status === 'published' || input.status === 'partially_published')) throw new Error('发布状态只能由有证据的发布回执写入')
    const invalidatedPreviews: string[] = []
    const result = await this.store.mutate(state => {
      const timestamp = now()
      const existing = input.id ? state.drafts.find(item => item.id === input.id) : undefined
      if (input.id && !existing) throw new Error(`找不到草稿 ${input.id}`)
      if (existing) {
        if (existing.status === 'published' || existing.status === 'partially_published') throw new Error('已开始跨平台发布的草稿不可直接修改；如需改稿，请复制为新草稿')
        const inFlight = state.publications.find(item => item.draftId === existing.id && (item.status === 'confirmed' || item.status === 'publishing'))
        if (inFlight) throw new Error(`草稿有 ${inFlight.status} 发布计划 ${inFlight.id}，必须先完成或对账，不能修改`)
        for (const publication of state.publications) {
          if (publication.draftId !== existing.id || publication.status !== 'preview') continue
          publication.status = 'cancelled'
          publication.confirmationTokenHash = ''
          publication.error = 'Draft revision changed; immutable preview invalidated.'
          publication.updatedAt = timestamp
          invalidatedPreviews.push(publication.id)
        }
        if (input.topicId !== undefined) existing.topicId = optionalText(input.topicId, 100)
        if (input.title !== undefined) existing.title = requiredText(input.title, '草稿标题', 300)
        if (input.body !== undefined) existing.body = requiredText(input.body, '草稿正文', 200_000)
        if (input.platforms !== undefined) existing.platforms = platforms(input.platforms)
        if (input.assets !== undefined) existing.assets = strings(input.assets, 100, 2_000)
        if (input.status !== undefined) {
          if (!DRAFT_STATUSES.includes(input.status)) throw new Error(`无效草稿状态 ${input.status}`)
          if (input.status === 'published' || input.status === 'partially_published') throw new Error('发布状态只能由有证据的发布回执写入')
          existing.status = input.status
        }
        existing.revision += 1
        existing.updatedAt = timestamp
        return existing
      }
      const draft: Draft = {
        id: randomUUID(),
        revision: 1,
        topicId: optionalText(input.topicId, 100),
        title: requiredText(input.title, '草稿标题', 300),
        body: requiredText(input.body, '草稿正文', 200_000),
        platforms: platforms(input.platforms),
        assets: strings(input.assets, 100, 2_000),
        status: DRAFT_STATUSES.includes(input.status as DraftStatus) && input.status !== 'published' && input.status !== 'partially_published' ? input.status as DraftStatus : 'draft',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.drafts.push(draft)
      return draft
    })
    await Promise.all(invalidatedPreviews.map(id => this.cleanupStage(id)))
    return result
  }

  async preparePublish(
    draftId: string,
    platform: MediaPlatform,
    preflight: { accountLabel: string; accountIdentity: string; preflightEvidence: string; workspaceRoot: string; expectedDraftRevision?: number; scheduledAt?: string; publisherOptions?: unknown },
    signal?: AbortSignal,
  ) {
    await this.cleanupExpiredAndOrphanedStaging()
    signal?.throwIfAborted()
    if (!MEDIA_PLATFORMS.includes(platform)) throw new Error(`不支持发布平台 ${platform}`)
    const accountLabel = requiredText(preflight.accountLabel, '预检账号', 500)
    const accountIdentity = requiredText(preflight.accountIdentity, '账号身份指纹', 64)
    if (!/^[a-f0-9]{64}$/.test(accountIdentity)) throw new Error('账号身份指纹格式无效')
    const preflightEvidence = requiredText(preflight.preflightEvidence, '发布 skill 预检结果', 5_000)
    const rawSchedule = optionalText(preflight.scheduledAt, 100)
    if (rawSchedule !== '' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(rawSchedule)) throw new Error('scheduledAt 必须是明确包含 Z 或 UTC offset 的 ISO 8601 时间')
    if (rawSchedule !== '' && Number.isNaN(new Date(rawSchedule).getTime())) throw new Error('scheduledAt 必须是含时区的有效 ISO 8601 时间')
    const scheduledAt = rawSchedule === '' ? '' : new Date(rawSchedule).toISOString()
    if (scheduledAt !== '' && platform !== 'bilibili') throw new Error(`${platform} 受控 adapter 不支持定时发布；请留空或改为平台内人工定时`)
    if (scheduledAt !== '' && new Date(scheduledAt).getTime() < Date.now() + 4 * 60 * 60_000) throw new Error('Bilibili 定时发布时间必须至少晚于当前 4 小时')
    const publisherOptions = publisherOptionsForPlatform(platform, preflight.publisherOptions)
    const requestedWorkspaceRoot = requiredText(preflight.workspaceRoot, 'DSH 会话工作区', 4_000)
    if (!isAbsolute(requestedWorkspaceRoot)) throw new Error('DSH 会话工作区必须是绝对路径')
    const workspaceRoot = await realpath(requestedWorkspaceRoot)
    if (!(await lstat(workspaceRoot)).isDirectory()) throw new Error('DSH 会话工作区必须是真实目录')
    const token = randomBytes(24).toString('base64url')
    const timestamp = now()
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const publicationId = randomUUID()
    const superseded: string[] = []
    try {
      const before = await this.store.read()
      const sourceDraft = before.drafts.find(item => item.id === draftId)
      if (!sourceDraft) throw new Error(`找不到草稿 ${draftId}`)
      if (sourceDraft.status !== 'ready' && sourceDraft.status !== 'partially_published') throw new Error(`草稿状态必须是 ready 或 partially_published，当前为 ${sourceDraft.status}`)
      if (preflight.expectedDraftRevision !== undefined && sourceDraft.revision !== preflight.expectedDraftRevision) throw new Error('草稿在只读预检后已变化，请重新预检')
      if (!sourceDraft.platforms.includes(platform)) throw new Error(`草稿未经过 ${platform} 平台审阅，请先把平台加入草稿并重新标记 ready`)
      for (const previous of before.publications) {
        if (previous.draftId !== draftId || previous.platform !== platform) continue
        if (['confirmed', 'publishing', 'submitted', 'draft_created', 'scheduled', 'published'].includes(previous.status)) {
          throw new Error(`草稿在 ${platform} 已有 ${previous.status} 发布计划 ${previous.id}；如需再次发布，请复制为新草稿`)
        }
      }
      const frozen = await this.freezePayload(publicationId, workspaceRoot, platform, sourceDraft.body, sourceDraft.assets, signal)
      const result = await this.store.mutate(state => {
      const draft = state.drafts.find(item => item.id === draftId)
      if (!draft) throw new Error(`找不到草稿 ${draftId}`)
      if (draft.status !== 'ready' && draft.status !== 'partially_published') throw new Error(`草稿状态必须是 ready 或 partially_published，当前为 ${draft.status}`)
      if (draft.revision !== sourceDraft.revision || (preflight.expectedDraftRevision !== undefined && draft.revision !== preflight.expectedDraftRevision)) throw new Error('草稿在载荷冻结期间已变化，请重新预检')
      if (!draft.platforms.includes(platform)) throw new Error(`草稿未经过 ${platform} 平台审阅，请先把平台加入草稿并重新标记 ready`)
      for (const previous of state.publications) {
        if (previous.draftId !== draftId || previous.platform !== platform) continue
        if (['confirmed', 'publishing', 'submitted', 'draft_created', 'scheduled', 'published'].includes(previous.status)) {
          throw new Error(`草稿在 ${platform} 已有 ${previous.status} 发布计划 ${previous.id}；如需再次发布，请复制为新草稿`)
        }
      }
      const snapshot = makeSnapshot({
        draftId: draft.id,
        draftRevision: draft.revision,
        draftUpdatedAt: draft.updatedAt,
        workspaceRoot,
        title: draft.title,
        body: frozen.body,
        bodyPath: frozen.bodyPath,
        bodySha256: frozen.bodySha256,
        assets: frozen.assets,
        assetManifest: frozen.assetManifest,
        platform,
        accountLabel,
        accountIdentity,
        scheduledAt,
        preflightEvidence,
        publisherOptions,
      })
      for (const previous of state.publications) {
        if (previous.draftId !== draftId || previous.platform !== platform) continue
        if (previous.status === 'preview') {
          previous.status = 'cancelled'
          previous.confirmationTokenHash = ''
          previous.error = 'Superseded by a newer immutable preview.'
          previous.updatedAt = timestamp
          superseded.push(previous.id)
        }
      }
      const publication: Publication = {
        id: publicationId,
        draftId,
        platform,
        status: 'preview',
        skillName: PUBLISH_SKILLS[platform],
        idempotencyKey: '',
        confirmationTokenHash: hashToken(token),
        executionLeaseId: '',
        executionLeaseExpiresAt: '',
        expiresAt,
        snapshot,
        externalUrl: '',
        resultEvidence: '',
        error: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.publications.push(publication)
      return {
        publication: toPublicationView(publication),
        confirmationToken: token,
        preview: {
          title: snapshot.title,
          bodyPreview: snapshot.body.slice(0, 5_000),
          bodyChars: snapshot.body.length,
          assets: snapshot.assetManifest.map(item => ({ name: basename(item.source), sizeBytes: item.sizeBytes, sha256: item.sha256 })),
          platform,
          accountLabel,
          scheduledAt,
          publisherOptions,
          preflightEvidence,
          payloadDigest: snapshot.payloadDigest,
          skillName: publication.skillName,
          bodyTruncated: snapshot.body.length > 5_000,
          readFullPreviewWith: 'mediaops_read_publish_preview',
          warning: '这是有外部副作用的发布操作。长正文必须分页核对；确认后只能由 Host 受控 adapter 消费这份冻结载荷。',
          expiresAt,
        },
      }
      })
      await rm(frozen.preparingMarker, { force: true }).catch(() => undefined)
      await Promise.all(superseded.map(id => this.cleanupStage(id)))
      return result
    } catch (error) {
      await this.cleanupStage(publicationId)
      throw error
    }
  }

  async readPublishPreview(publicationId: string, payloadDigest: string, offset = 0, limit = 10_000) {
    const state = await this.store.read()
    const publication = state.publications.find(item => item.id === publicationId)
    if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
    this.assertSnapshotIntegrity(publication, payloadDigest)
    const start = Math.max(0, Math.min(Math.trunc(offset), publication.snapshot.body.length))
    const size = Math.max(1, Math.min(Math.trunc(limit), 20_000))
    const end = Math.min(start + size, publication.snapshot.body.length)
    return {
      ok: true,
      publication: toPublicationView(publication),
      bodyChunk: publication.snapshot.body.slice(start, end),
      offset: start,
      nextOffset: end < publication.snapshot.body.length ? end : null,
      totalChars: publication.snapshot.body.length,
      complete: end >= publication.snapshot.body.length,
      assets: publication.snapshot.assetManifest.map(item => ({ name: basename(item.source), sizeBytes: item.sizeBytes, sha256: item.sha256 })),
    }
  }

  async publishApprovalSummary(publicationId: string, payloadDigest: string) {
    const state = await this.store.read()
    const publication = state.publications.find(item => item.id === publicationId)
    if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
    this.assertSnapshotIntegrity(publication, payloadDigest)
    return {
      ...toPublicationView(publication),
      accountIdentity: publication.snapshot.accountIdentity,
      publisherOptions: structuredClone(publication.snapshot.publisherOptions),
      assetSources: publication.snapshot.assetManifest.map(item => ({ source: item.source, sizeBytes: item.sizeBytes, sha256: item.sha256 })),
      workspaceRoot: publication.snapshot.workspaceRoot,
      idempotencyKey: publication.idempotencyKey,
      bodyPreview: publication.snapshot.body.slice(0, 2_000),
      bodySha256: publication.snapshot.bodySha256,
    }
  }

  async confirmPublish(publicationId: string, confirmationToken: string, confirm: boolean, idempotencyKey: string, payloadDigest: string) {
    await this.cleanupExpiredAndOrphanedStaging()
    let cancelled = false
    const result = await this.store.mutate(state => {
      const publication = state.publications.find(item => item.id === publicationId)
      if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
      this.assertSnapshotIntegrity(publication, payloadDigest)
      if (!confirm) {
        if (publication.status !== 'preview') throw new Error(`发布计划已是 ${publication.status}，不能通过确认工具取消`)
        if (!tokenMatches(confirmationToken, publication.confirmationTokenHash)) throw new Error('发布确认令牌无效')
        publication.status = 'cancelled'
        publication.confirmationTokenHash = ''
        publication.updatedAt = now()
        cancelled = true
        return { ok: true, cancelled: true, nextAction: 'none', publication: toPublicationView(publication) }
      }
      const normalizedKey = requiredText(idempotencyKey, '幂等键', 200)
      if (publication.status !== 'preview') {
        if (publication.idempotencyKey === normalizedKey) {
          return { ok: true, alreadyProcessed: true, nextAction: 'none', publication: toPublicationView(publication) }
        }
        throw new Error(`发布计划已是 ${publication.status}，不能再次交接`)
      }
      if (new Date(publication.expiresAt).getTime() < Date.now()) throw new Error('发布确认已过期，请重新生成预览')
      if (!tokenMatches(confirmationToken, publication.confirmationTokenHash)) throw new Error('发布确认令牌无效')
      const duplicate = state.publications.find(item => item.id !== publication.id && item.idempotencyKey === normalizedKey)
      if (duplicate) throw new Error(`幂等键已被发布计划 ${duplicate.id} 使用`)
      publication.idempotencyKey = normalizedKey
      publication.status = 'confirmed'
      publication.confirmationTokenHash = ''
      publication.updatedAt = now()
      return {
        ok: true,
        idempotent: false,
        publication: toPublicationView(publication),
        nextAction: 'call_mediaops_execute_publish',
        instruction: '只能把 publicationId 与 payloadDigest 交给 mediaops_execute_publish；不得自行拼接或运行 publisher 命令。',
      }
    })
    if (cancelled) await this.cleanupStage(publicationId)
    return result
  }

  private assertSnapshotIntegrity(publication: Publication, suppliedDigest: string): void {
    const expected = computeSnapshotDigest(publication.snapshot)
    if (expected !== publication.snapshot.payloadDigest) throw new Error('发布快照完整性校验失败，请重新生成预览')
    if (typeof suppliedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedDigest) || suppliedDigest !== expected) {
      throw new Error('payload digest 与不可变预览不匹配')
    }
  }

  private async verifyFrozenPayload(publication: Publication): Promise<void> {
    const snapshot = publication.snapshot
    const stageRoot = join(await this.stagingRoot(), publication.id)
    const stageInfo = await lstat(stageRoot)
    if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory() || await realpath(stageRoot) !== stageRoot) throw new Error('发布计划 staging 目录不安全')
    const isStaged = (path: string) => {
      const containment = relative(stageRoot, resolve(path))
      return containment !== '' && !containment.startsWith('..') && !isAbsolute(containment)
    }
    if (resolve(snapshot.bodyPath) !== join(stageRoot, 'body.md')) throw new Error('冻结正文不在该发布计划的 staging 目录')
    if (!snapshot.assetManifest.every(asset => isStaged(asset.frozenPath))) throw new Error('冻结素材不在该发布计划的 staging 目录')
    const bodyInfo = await lstat(snapshot.bodyPath)
    if (!bodyInfo.isFile() || bodyInfo.isSymbolicLink() || await hashFile(snapshot.bodyPath) !== snapshot.bodySha256) {
      throw new Error('冻结正文文件已变化，请取消并重新生成预览')
    }
    for (const asset of snapshot.assetManifest) {
      const info = await lstat(asset.frozenPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.sizeBytes || await hashFile(asset.frozenPath) !== asset.sha256) {
        throw new Error(`冻结素材已变化: ${basename(asset.source)}；请取消并重新生成预览`)
      }
    }
  }

  async beginPublishExecution(publicationId: string, payloadDigest: string) {
    await this.cleanupExpiredAndOrphanedStaging()
    const before = await this.store.read()
    const candidate = before.publications.find(item => item.id === publicationId)
    if (!candidate) throw new Error(`找不到发布计划 ${publicationId}`)
    this.assertSnapshotIntegrity(candidate, payloadDigest)
    if (candidate.status === 'publishing') return { execute: false as const, alreadyStarted: true, publication: toPublicationView(candidate) }
    if (candidate.status !== 'confirmed') throw new Error(`只有 confirmed 状态可执行，当前为 ${candidate.status}`)
    if (new Date(candidate.expiresAt).getTime() <= Date.now()) throw new Error('发布授权已过期，请重新生成预览')
    await this.verifyFrozenPayload(candidate)
    return this.store.mutate(state => {
      const publication = state.publications.find(item => item.id === publicationId)
      if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
      this.assertSnapshotIntegrity(publication, payloadDigest)
      if (publication.status === 'publishing') return { execute: false as const, alreadyStarted: true, publication: toPublicationView(publication) }
      if (publication.status !== 'confirmed') throw new Error(`只有 confirmed 状态可执行，当前为 ${publication.status}`)
      if (new Date(publication.expiresAt).getTime() <= Date.now()) throw new Error('发布授权已过期，请重新生成预览')
      const conflicting = state.publications.find(item => item.id !== publication.id
        && item.status === 'publishing'
        && item.platform === publication.platform)
      if (conflicting) throw new Error(`同一平台共享登录资源已有未完成的 publishing 计划 ${conflicting.id}；请先完成只读对账并记录终态`)
      const executionLeaseId = randomUUID()
      publication.status = 'publishing'
      publication.executionLeaseId = executionLeaseId
      publication.executionLeaseExpiresAt = new Date(Date.now() + 40 * 60_000).toISOString()
      publication.updatedAt = now()
      return { execute: true as const, executionLeaseId, publication: structuredClone(publication) }
    })
  }

  async recoverPublish(publicationId: string, payloadDigest: string) {
    const state = await this.store.read()
    const publication = state.publications.find(item => item.id === publicationId)
    if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
    this.assertSnapshotIntegrity(publication, payloadDigest)
    if (!['publishing', 'submitted', 'draft_created', 'scheduled'].includes(publication.status)) throw new Error(`只有 publishing/submitted/draft_created/scheduled 状态需要恢复，当前为 ${publication.status}`)
    const activeExecution = publication.status === 'publishing' && publication.executionLeaseId !== '' && Date.parse(publication.executionLeaseExpiresAt) > Date.now()
    return {
      ok: true,
      nextAction: activeExecution ? 'wait_for_active_execution' : 'reconcile_read_only',
      publication: toPublicationView(publication),
      accountIdentity: publication.snapshot.accountIdentity,
      idempotencyKey: publication.idempotencyKey,
      assetHashes: publication.snapshot.assetManifest.map(item => ({ name: basename(item.source), sha256: item.sha256, sizeBytes: item.sizeBytes })),
      instruction: activeExecution
        ? `Host publisher 执行租约仍有效至 ${publication.executionLeaseExpiresAt}；不得并行回填、取消或重发，请等待本次执行返回。`
        : `使用 ${publication.skillName} 对应平台的只读查询、内容管理页或平台回执，按账号身份、标题、时间和幂等键核对。找到公开内容则以证据回填 published；只有 publishing 且明确未产生任何内容时才可回填 failed 后重新走预览；submitted/draft_created/scheduled 均表示平台已接受，禁止直接重发。无法确认时保持当前状态并请求人工对账。`,
    }
  }

  async markPublishUncertain(publicationId: string, payloadDigest: string, executionLeaseId: string, error: string, evidence = '') {
    return this.store.mutate(state => {
      const publication = state.publications.find(item => item.id === publicationId)
      if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
      this.assertSnapshotIntegrity(publication, payloadDigest)
      if (publication.status !== 'publishing') throw new Error(`只有 publishing 状态可记录待对账结果，当前为 ${publication.status}`)
      if (publication.executionLeaseId !== executionLeaseId) throw new Error('发布执行租约不匹配')
      publication.executionLeaseId = ''
      publication.executionLeaseExpiresAt = ''
      publication.error = requiredText(error, '待对账原因', 10_000)
      publication.resultEvidence = optionalText(evidence, 10_000)
      publication.updatedAt = now()
      return toPublicationView(publication)
    })
  }

  async cancelPublication(publicationId: string) {
    const result = await this.store.mutate(state => {
      const publication = state.publications.find(item => item.id === publicationId)
      if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
      if (publication.status !== 'preview' && publication.status !== 'confirmed') throw new Error(`只有 preview 或 confirmed 状态可取消，当前为 ${publication.status}`)
      publication.status = 'cancelled'
      publication.confirmationTokenHash = ''
      publication.updatedAt = now()
      return toPublicationView(publication)
    })
    await this.cleanupStage(publicationId)
    return result
  }

  async recordPublishResult(
    publicationId: string,
    payloadDigest: string,
    status: 'published' | 'failed' | 'submitted' | 'draft_created' | 'scheduled',
    externalUrl = '',
    resultEvidence = '',
    error = '',
    executionLeaseId = '',
  ) {
    const result = await this.store.mutate(state => {
      const publication = state.publications.find(item => item.id === publicationId)
      if (!publication) throw new Error(`找不到发布计划 ${publicationId}`)
      this.assertSnapshotIntegrity(publication, payloadDigest)
      if (publication.status === 'published' || publication.status === 'failed') {
        if (publication.status === status) return toPublicationView(publication)
        throw new Error(`终态 ${publication.status} 不可改写为 ${status}`)
      }
      const accepted = publication.status === 'submitted' || publication.status === 'draft_created' || publication.status === 'scheduled'
      if (publication.status !== 'publishing' && !(accepted && status === 'published')) {
        throw new Error(`当前 ${publication.status} 状态不能记录为 ${status}`)
      }
      if (publication.status === 'publishing' && publication.executionLeaseId !== '') {
        const active = Date.parse(publication.executionLeaseExpiresAt) > Date.now()
        if (executionLeaseId !== publication.executionLeaseId && active) throw new Error(`Host publisher 仍在执行，租约有效至 ${publication.executionLeaseExpiresAt}；禁止人工回填`)
        if (executionLeaseId !== '' && executionLeaseId !== publication.executionLeaseId) throw new Error('发布执行租约不匹配')
      }
      const cleanUrl = optionalText(externalUrl, 2_000)
      const cleanEvidence = optionalText(resultEvidence, 10_000)
      const cleanError = optionalText(error, 10_000)
      if (status !== 'failed' && cleanUrl === '' && cleanEvidence === '') throw new Error(`${status} 结果必须提供 externalUrl 或 resultEvidence`)
      if (cleanUrl !== '' && !urlAllowedForPlatform(publication.platform, cleanUrl)) throw new Error(`externalUrl 必须是 ${publication.platform} 官方域名的 http(s) 链接`)
      if (status === 'failed' && cleanError === '') throw new Error('发布失败必须提供 error')
      if (status === 'failed' && cleanEvidence === '') throw new Error('发布失败必须提供只读平台对账证据，证明未产生内容后才能允许重试')
      publication.status = status
      publication.executionLeaseId = ''
      publication.executionLeaseExpiresAt = ''
      publication.externalUrl = cleanUrl
      publication.resultEvidence = cleanEvidence
      publication.error = cleanError
      publication.updatedAt = now()
      const draft = state.drafts.find(item => item.id === publication.draftId)
      if (draft && draft.revision === publication.snapshot.draftRevision) {
        if (status === 'published') {
          const publishedPlatforms = new Set(state.publications
            .filter(item => item.draftId === draft.id && item.status === 'published' && item.snapshot.draftRevision === publication.snapshot.draftRevision)
            .map(item => item.platform))
          const allPublished = draft.platforms.length > 0 && draft.platforms.every(item => publishedPlatforms.has(item))
          draft.status = allPublished ? 'published' : 'partially_published'
        }
        if (status === 'published' && draft.status === 'published' && draft.topicId) {
          const topic = state.topics.find(item => item.id === draft.topicId)
          if (topic) {
            topic.status = 'published'
            topic.updatedAt = now()
          }
        }
      }
      return toPublicationView(publication)
    })
    await this.cleanupStage(publicationId)
    return result
  }
}
