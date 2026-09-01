import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { computeSnapshotDigest, makeSnapshot } from './publication.ts'
import { EMPTY_STATE, MEDIA_PLATFORMS, type MediaOpsState, type Publication, type PublicationStatus } from './types.ts'

const MAX_STATE_BYTES = 16 * 1024 * 1024
const LOCK_WAIT_MS = 20_000
const LOCK_STALE_MS = 10 * 60_000

export async function withDirectoryLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: { waitMs?: number; label?: string } = {},
): Promise<T> {
  const token = randomUUID()
  const ownerPath = join(lockPath, 'owner.json')
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS)
  while (true) {
    let created = false
    try {
      await mkdir(lockPath, { mode: 0o700 })
      created = true
      await writeFile(ownerPath, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (created) await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stale = false
      try {
        const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { pid?: unknown; createdAt?: unknown }
        const age = Date.now() - (typeof owner.createdAt === 'number' ? owner.createdAt : 0)
        let alive = true
        if (typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid)) {
          try { process.kill(owner.pid, 0) } catch (probeError) { alive = (probeError as NodeJS.ErrnoException).code !== 'ESRCH' }
        }
        // Never steal a lock from a live process; time only heals an
        // incomplete lock whose owner cannot be identified.
        stale = !alive || (typeof owner.pid !== 'number' && age > LOCK_STALE_MS)
      } catch {
        const info = await stat(lockPath).catch(() => undefined)
        stale = Boolean(info && Date.now() - info.mtimeMs > LOCK_STALE_MS)
      }
      if (stale) {
        const quarantine = `${lockPath}.stale-${randomUUID()}`
        try {
          await rename(lockPath, quarantine)
          await rm(quarantine, { recursive: true, force: true })
        } catch (moveError) {
          if ((moveError as NodeJS.ErrnoException).code !== 'ENOENT') throw moveError
        }
        continue
      }
      if (Date.now() >= deadline) throw new Error(`${options.label ?? 'MediaOps 资源'}正被另一个 Host 使用；等待锁超时，请稍后重试`)
      await new Promise(resolve => setTimeout(resolve, 40 + Math.floor(Math.random() * 40)))
    }
  }
  try {
    return await work()
  } finally {
    try {
      const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: unknown }
      if (owner.token === token) await rm(lockPath, { recursive: true, force: true })
    } catch {
      // A missing lock here means another recovery path already handled it.
    }
  }
}

function cloneState(state: MediaOpsState): MediaOpsState {
  return structuredClone(state)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'string') throw new Error(`MediaOps 数据字段 ${key} 无效`)
}

function requireStringArray(record: Record<string, unknown>, key: string): void {
  if (!Array.isArray(record[key]) || !(record[key] as unknown[]).every(item => typeof item === 'string')) {
    throw new Error(`MediaOps 数据字段 ${key} 无效`)
  }
}

function requireSafeId(record: Record<string, unknown>, key = 'id'): void {
  requireString(record, key)
  const value = record[key] as string
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === '.' || value === '..') {
    throw new Error(`MediaOps 数据字段 ${key} 不是安全 ID`)
  }
}

function requireIsoDate(record: Record<string, unknown>, key: string, allowEmpty = false): void {
  requireString(record, key)
  const value = record[key] as string
  if (allowEmpty && value === '') return
  if (value === '' || Number.isNaN(Date.parse(value))) throw new Error(`MediaOps 数据字段 ${key} 不是有效日期`)
}

function requirePlatformArray(record: Record<string, unknown>, key: string): void {
  requireStringArray(record, key)
  if (!(record[key] as string[]).every(item => MEDIA_PLATFORMS.includes(item as typeof MEDIA_PLATFORMS[number]))) {
    throw new Error(`MediaOps 数据字段 ${key} 含无效平台`)
  }
}

function assertTopic(value: unknown): void {
  if (!isRecord(value)) throw new Error('MediaOps topic 不是对象')
  requireSafeId(value)
  for (const key of ['id', 'title', 'angle', 'summary', 'content', 'status', 'createdAt', 'updatedAt']) requireString(value, key)
  for (const key of ['tags', 'sourceViralIds', 'references']) requireStringArray(value, key)
  requirePlatformArray(value, 'platforms')
  if (!['idea', 'researching', 'planned', 'drafting', 'ready', 'published', 'archived'].includes(value.status as string)) throw new Error('MediaOps topic 状态无效')
}

function assertViralItem(value: unknown): void {
  if (!isRecord(value)) throw new Error('MediaOps viral item 不是对象')
  requireSafeId(value)
  for (const key of ['id', 'platform', 'title', 'url', 'hot', 'author', 'summary', 'notes', 'source', 'firstSeenAt', 'lastSeenAt']) requireString(value, key)
  requireStringArray(value, 'tags')
}

function assertDraft(value: unknown): void {
  if (!isRecord(value)) throw new Error('MediaOps draft 不是对象')
  requireSafeId(value)
  for (const key of ['id', 'topicId', 'title', 'body', 'status', 'createdAt', 'updatedAt']) requireString(value, key)
  requirePlatformArray(value, 'platforms')
  requireStringArray(value, 'assets')
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('MediaOps draft revision 无效')
  if (!['draft', 'review', 'ready', 'partially_published', 'published', 'archived'].includes(value.status as string)) throw new Error('MediaOps draft 状态无效')
}

function assertPublication(value: unknown): asserts value is Publication {
  if (!isRecord(value)) throw new Error('MediaOps publication 不是对象')
  requireSafeId(value)
  for (const key of ['id', 'draftId', 'platform', 'status', 'skillName', 'idempotencyKey', 'confirmationTokenHash', 'executionLeaseId', 'executionLeaseExpiresAt', 'expiresAt', 'externalUrl', 'resultEvidence', 'error', 'createdAt', 'updatedAt']) {
    requireString(value, key)
  }
  if (!MEDIA_PLATFORMS.includes(value.platform as typeof MEDIA_PLATFORMS[number])) throw new Error('MediaOps publication 平台无效')
  const statuses: PublicationStatus[] = ['preview', 'confirmed', 'publishing', 'submitted', 'draft_created', 'scheduled', 'published', 'failed', 'cancelled']
  if (!statuses.includes(value.status as PublicationStatus)) throw new Error('MediaOps publication 状态无效')
  requireIsoDate(value, 'expiresAt')
  requireIsoDate(value, 'createdAt')
  requireIsoDate(value, 'updatedAt')
  requireIsoDate(value, 'executionLeaseExpiresAt', true)
  const hasLeaseId = (value.executionLeaseId as string) !== ''
  const hasLeaseExpiry = (value.executionLeaseExpiresAt as string) !== ''
  if (hasLeaseId !== hasLeaseExpiry) throw new Error('MediaOps publication execution lease 不完整')
  if (hasLeaseId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.executionLeaseId as string)) throw new Error('MediaOps publication execution lease ID 无效')
  if (value.status !== 'publishing' && hasLeaseId) throw new Error('MediaOps publication 非 publishing 状态不能持有执行租约')
  if (value.status === 'preview' && !/^[a-f0-9]{64}$/.test(value.confirmationTokenHash as string)) throw new Error('MediaOps publication preview 确认令牌摘要无效')
  if (value.status !== 'preview' && value.confirmationTokenHash !== '') throw new Error('MediaOps publication 非 preview 状态不能持有确认令牌')
  if (!isRecord(value.snapshot)) throw new Error('MediaOps publication snapshot 缺失')
  for (const key of ['draftId', 'draftUpdatedAt', 'workspaceRoot', 'title', 'body', 'bodyPath', 'bodySha256', 'platform', 'accountLabel', 'accountIdentity', 'scheduledAt', 'preflightEvidence', 'payloadDigest']) {
    requireString(value.snapshot, key)
  }
  requireStringArray(value.snapshot, 'assets')
  requireIsoDate(value.snapshot, 'draftUpdatedAt')
  requireIsoDate(value.snapshot, 'scheduledAt', true)
  if (typeof value.snapshot.draftRevision !== 'number' || !Number.isSafeInteger(value.snapshot.draftRevision) || value.snapshot.draftRevision < 1) throw new Error('MediaOps publication draftRevision 无效')
  if (!Array.isArray(value.snapshot.assetManifest)) throw new Error('MediaOps assetManifest 无效')
  for (const rawAsset of value.snapshot.assetManifest) {
    if (!isRecord(rawAsset)) throw new Error('MediaOps frozen asset 不是对象')
    for (const key of ['source', 'frozenPath', 'sha256']) requireString(rawAsset, key)
    if (typeof rawAsset.sizeBytes !== 'number' || !Number.isSafeInteger(rawAsset.sizeBytes) || rawAsset.sizeBytes < 0) throw new Error('MediaOps frozen asset size 无效')
  }
  if (!isRecord(value.snapshot.publisherOptions)) throw new Error('MediaOps publisherOptions 无效')
  if (value.snapshot.draftId !== value.draftId || value.snapshot.platform !== value.platform) throw new Error('MediaOps publication snapshot 关联无效')
  if (!/^[a-f0-9]{64}$/.test(value.snapshot.payloadDigest as string)) throw new Error('MediaOps publication digest 无效')
  if (!/^[a-f0-9]{64}$/.test(value.snapshot.accountIdentity as string)) throw new Error('MediaOps publication 账号身份指纹无效')
  if (value.snapshot.bodySha256 !== computeSnapshotDigestForText(value.snapshot.body as string)) throw new Error('MediaOps publication body digest 无效')
  if (['preview', 'confirmed', 'publishing'].includes(value.status as string)) {
    if ((value.snapshot.bodyPath as string) === '') throw new Error('MediaOps publication 缺少冻结正文')
    const assets = value.snapshot.assets as string[]
    if (assets.length !== value.snapshot.assetManifest.length) throw new Error('MediaOps publication 素材清单不一致')
    for (let index = 0; index < assets.length; index += 1) {
      const asset = value.snapshot.assetManifest[index] as Record<string, unknown>
      if (asset.frozenPath !== assets[index] || !/^[a-f0-9]{64}$/.test(asset.sha256 as string)) throw new Error('MediaOps publication 素材未冻结')
    }
  }
  if (computeSnapshotDigest(value.snapshot as unknown as Publication['snapshot']) !== value.snapshot.payloadDigest) {
    throw new Error('MediaOps publication snapshot 完整性校验失败')
  }
}

function computeSnapshotDigestForText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function migrateState(value: unknown): unknown {
  if (!isRecord(value) || ![1, 2, 3, 4].includes(value.version as number)) return value
  if (!Array.isArray(value.topics) || !Array.isArray(value.viralItems) || !Array.isArray(value.drafts) || !Array.isArray(value.publications)) return value
  const migratedDrafts = value.drafts.map(item => {
    if (!isRecord(item)) return item
    return { ...item, revision: typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 1 ? item.revision : 1 }
  })
  const drafts = new Map<string, Record<string, unknown>>()
  for (const item of migratedDrafts) {
    if (isRecord(item) && typeof item.id === 'string') drafts.set(item.id, item)
  }
  const publications = value.publications.map((raw): unknown => {
    if (!isRecord(raw) || typeof raw.draftId !== 'string' || typeof raw.platform !== 'string') return raw
    const draft = drafts.get(raw.draftId)
    const existingSnapshot = isRecord(raw.snapshot) ? raw.snapshot : undefined
    const platform = raw.platform as Publication['platform']
    const base = {
      draftId: raw.draftId,
      draftRevision: typeof existingSnapshot?.draftRevision === 'number' && Number.isSafeInteger(existingSnapshot.draftRevision) && existingSnapshot.draftRevision >= 1
        ? existingSnapshot.draftRevision
        : typeof draft?.revision === 'number' ? draft.revision : 1,
      draftUpdatedAt: typeof existingSnapshot?.draftUpdatedAt === 'string' ? existingSnapshot.draftUpdatedAt : typeof draft?.updatedAt === 'string' ? draft.updatedAt : '',
      workspaceRoot: '',
      title: typeof existingSnapshot?.title === 'string' ? existingSnapshot.title : typeof draft?.title === 'string' ? draft.title : '(legacy publication)',
      body: typeof existingSnapshot?.body === 'string' ? existingSnapshot.body : typeof draft?.body === 'string' ? draft.body : '',
      bodyPath: '',
      bodySha256: '',
      assets: Array.isArray(existingSnapshot?.assets) ? existingSnapshot.assets.filter((item): item is string => typeof item === 'string') : Array.isArray(draft?.assets) ? draft.assets.filter((item): item is string => typeof item === 'string') : [],
      assetManifest: [] as Array<{ source: string; frozenPath: string; sha256: string; sizeBytes: number }>,
      platform,
      accountLabel: typeof existingSnapshot?.accountLabel === 'string' ? existingSnapshot.accountLabel : '',
      accountIdentity: typeof existingSnapshot?.accountIdentity === 'string' && /^[a-f0-9]{64}$/.test(existingSnapshot.accountIdentity)
        ? existingSnapshot.accountIdentity
        : computeSnapshotDigestForText(`legacy:${String(raw.id ?? randomUUID())}`),
      scheduledAt: typeof existingSnapshot?.scheduledAt === 'string' ? existingSnapshot.scheduledAt : '',
      preflightEvidence: typeof existingSnapshot?.preflightEvidence === 'string' ? existingSnapshot.preflightEvidence : 'Legacy record migrated; original immutable preflight receipt unavailable.',
      publisherOptions: isRecord(existingSnapshot?.publisherOptions) ? existingSnapshot.publisherOptions : {},
    }
    base.bodySha256 = computeSnapshotDigestForText(base.body)
    base.assetManifest = base.assets.map(path => ({ source: path, frozenPath: path, sha256: '', sizeBytes: 0 }))
    const previousStatus = typeof raw.status === 'string' ? raw.status : 'cancelled'
    const status = ['published', 'failed', 'cancelled', 'submitted', 'draft_created', 'scheduled'].includes(previousStatus) ? previousStatus : 'cancelled'
    return {
      ...raw,
      status,
      confirmationTokenHash: '',
      executionLeaseId: '',
      executionLeaseExpiresAt: '',
      snapshot: makeSnapshot(base),
      externalUrl: typeof raw.externalUrl === 'string' ? raw.externalUrl : '',
      resultEvidence: typeof raw.resultEvidence === 'string' ? raw.resultEvidence : '',
      error: typeof raw.error === 'string' && raw.error !== '' ? raw.error : previousStatus === status ? '' : 'Legacy pending publication cancelled during schema migration.',
    }
  })
  return { ...value, version: 5, drafts: migratedDrafts, publications }
}

function assertState(value: unknown): asserts value is MediaOpsState {
  if (!isRecord(value)) throw new Error('MediaOps 数据文件不是对象')
  const state = value as Partial<MediaOpsState>
  if (state.version !== 5) throw new Error(`不支持的 MediaOps 数据版本: ${String(state.version)}`)
  for (const key of ['topics', 'viralItems', 'drafts', 'publications'] as const) {
    if (!Array.isArray(state[key])) throw new Error(`MediaOps 数据字段 ${key} 无效`)
  }
  for (const item of state.topics ?? []) assertTopic(item)
  for (const item of state.viralItems ?? []) assertViralItem(item)
  for (const item of state.drafts ?? []) assertDraft(item)
  for (const item of state.publications ?? []) assertPublication(item)
  for (const collection of [state.topics ?? [], state.viralItems ?? [], state.drafts ?? [], state.publications ?? []]) {
    const ids = collection.map(item => (item as { id: string }).id)
    if (new Set(ids).size !== ids.length) throw new Error('MediaOps 数据包含重复 ID')
  }
}

export class MediaOpsStore {
  readonly dataDir: string
  readonly statePath: string
  readonly lockPath: string
  private state: MediaOpsState = cloneState(EMPTY_STATE)
  readonly ready: Promise<void>
  private tail: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.statePath = join(dataDir, 'state.json')
    this.lockPath = join(dataDir, '.state.lock')
    this.ready = this.initialize()
    // Mark the initialization promise handled immediately so a bad data path
    // cannot become an unhandled rejection before Cordis awaits apply().
    void this.ready.catch(() => undefined)
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    await chmod(this.dataDir, 0o700).catch(() => undefined)
    await this.withFileLock(async () => {
      try {
        const loaded = await this.loadStateFile()
        this.state = cloneState(loaded.state)
        if (loaded.migrated) await this.persist(this.state)
        await chmod(this.statePath, 0o600).catch(() => undefined)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.persist(this.state)
      }
    })
  }

  private async loadStateFile(): Promise<{ state: MediaOpsState; migrated: boolean }> {
    const info = await stat(this.statePath)
    if (info.size > MAX_STATE_BYTES) throw new Error('MediaOps 数据文件超过 16 MiB 安全上限')
    const parsed: unknown = JSON.parse(await readFile(this.statePath, 'utf8'))
    const migratedValue = migrateState(parsed)
    assertState(migratedValue)
    return { state: cloneState(migratedValue), migrated: isRecord(parsed) && [1, 2, 3, 4].includes(parsed.version as number) }
  }

  private async withFileLock<T>(work: () => Promise<T>): Promise<T> {
    return withDirectoryLock(this.lockPath, work, { label: 'MediaOps 数据库' })
  }

  private async persist(state: MediaOpsState): Promise<void> {
    const serialized = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error('MediaOps 数据超过 16 MiB 安全上限')
    const temporary = join(this.dataDir, `.state-${process.pid}-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.statePath)
      await chmod(this.statePath, 0o600).catch(() => undefined)
      // The rename is the commit point. A directory-fsync failure must not be
      // reported as a rolled-back mutation (callers might then delete payloads
      // referenced by the already committed state). Durability is best effort.
      try {
        const directory = await open(this.dataDir, 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch {
        // Some filesystems/platforms do not support syncing directories.
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async read(): Promise<MediaOpsState> {
    await this.ready
    await this.tail
    const loaded = await this.loadStateFile()
    this.state = cloneState(loaded.state)
    return cloneState(this.state)
  }

  async mutate<T>(change: (draft: MediaOpsState) => T | Promise<T>): Promise<T> {
    await this.ready
    let result!: T
    const operation = this.tail.then(async () => {
      await this.withFileLock(async () => {
        // After initialization, a missing state file is corruption—not an
        // invitation to recreate EMPTY_STATE and lose a publishing latch.
        const current = (await this.loadStateFile()).state
        const draft = cloneState(current)
        result = await change(draft)
        assertState(draft)
        await this.persist(draft)
        this.state = draft
      })
    })
    this.tail = operation.catch(() => undefined)
    await operation
    return structuredClone(result)
  }
}
