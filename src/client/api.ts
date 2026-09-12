import type {
  DraftItem,
  LibraryKind,
  Overview,
  PublicationItem,
  ReferenceItem,
  TopicItem,
  ViralItem,
  WorkbenchSnapshot,
  ModelConfigSnapshot,
  ModelFieldItem,
  ModelGroupItem,
  ModelProviderItem,
  ModelProviderUpdate,
  ModelValidationResult,
} from './contracts.ts'

export const API_PREFIX = '/api/dsh-mediaops'

const REFERENCE_LIMIT = 64_000

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((entry) => typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : [])
  return items.length > 0 ? items : undefined
}

function boolean(value: unknown): boolean {
  return value === true
}

function id(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function list(value: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value
  const top = record(value)
  if (top === undefined) return []
  for (const key of keys) {
    if (Array.isArray(top[key])) return top[key] as unknown[]
  }
  const data = record(top.data)
  if (data !== undefined) {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key] as unknown[]
    }
  }
  if (Array.isArray(top.data)) return top.data
  return []
}

function normalizeTopic(value: unknown): TopicItem | undefined {
  const item = record(value)
  const itemId = id(item?.id)
  const title = text(item?.title) ?? text(item?.name)
  if (item === undefined || itemId === undefined || title === undefined) return undefined
  return {
    id: itemId,
    title,
    angle: text(item.angle),
    summary: text(item.summary) ?? text(item.description),
    content: text(item.content),
    tags: stringArray(item.tags),
    platforms: stringArray(item.platforms),
    status: text(item.status),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
  }
}

function normalizeViral(value: unknown): ViralItem | undefined {
  const item = record(value)
  const itemId = id(item?.id)
  const title = text(item?.title) ?? text(item?.name)
  if (item === undefined || itemId === undefined || title === undefined) return undefined
  const hot = typeof item.hot === 'number' || typeof item.hot === 'string'
    ? item.hot
    : typeof item.hotScore === 'number' || typeof item.hotScore === 'string'
      ? item.hotScore
      : undefined
  return {
    id: itemId,
    title,
    platform: text(item.platform),
    author: text(item.author),
    summary: text(item.summary) ?? text(item.description),
    notes: text(item.notes),
    url: text(item.url),
    hot,
    tags: stringArray(item.tags),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
    lastSeenAt: text(item.lastSeenAt) ?? text(item.last_seen_at),
  }
}

function normalizeDraft(value: unknown): DraftItem | undefined {
  const item = record(value)
  const itemId = id(item?.id)
  const title = text(item?.title) ?? text(item?.name)
  if (item === undefined || itemId === undefined || title === undefined) return undefined
  return {
    id: itemId,
    title,
    topicId: id(item.topicId) ?? id(item.topic_id),
    body: text(item.body) ?? text(item.content),
    platforms: stringArray(item.platforms),
    status: text(item.status),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
  }
}

function normalizePublication(value: unknown): PublicationItem | undefined {
  const item = record(value)
  const itemId = id(item?.id)
  if (item === undefined || itemId === undefined) return undefined
  return {
    id: itemId,
    draftId: id(item.draftId) ?? id(item.draft_id),
    title: text(item.title),
    platform: text(item.platform),
    status: text(item.status),
    resultUrl: text(item.resultUrl) ?? text(item.result_url) ?? text(item.externalUrl),
    error: text(item.error),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
    createdAt: text(item.createdAt) ?? text(item.created_at),
  }
}

function normalizeOverview(value: unknown): Overview {
  const item = record(value) ?? {}
  const counts = record(item.counts) ?? {}
  const capabilities = record(item.capabilities) ?? {}
  const numeric = (key: string, fallbackKey = key): number | undefined => {
    const value = item[key] ?? counts[fallbackKey]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  return {
    skillCount: numeric('skillCount', 'skills')
      ?? (typeof capabilities.totalSkills === 'number' ? capabilities.totalSkills : undefined),
    topicCount: numeric('topicCount', 'topics'),
    viralCount: numeric('viralCount', 'viral')
      ?? (typeof counts.viralItems === 'number' ? counts.viralItems : undefined),
    draftCount: numeric('draftCount', 'drafts'),
    publicationCount: numeric('publicationCount', 'publications'),
    publishedCount: numeric('publishedCount', 'published'),
    version: text(item.version),
  }
}

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(options.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  })
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { error?: unknown; message?: unknown }
      detail = text(payload.error) ?? text(payload.message) ?? ''
    } catch {
      // Status text is enough when the host did not return JSON.
    }
    throw new Error(detail === '' ? `HTTP ${response.status}` : `${detail} (HTTP ${response.status})`)
  }
  if (response.status === 204) return undefined
  return response.json()
}

export async function fetchTopics(query = '', signal?: AbortSignal): Promise<TopicItem[]> {
  const params = new URLSearchParams({ limit: '50' })
  if (query.trim() !== '') params.set('q', query.trim())
  const payload = await request(`/topics?${params}`, signal === undefined ? {} : { signal })
  return list(payload, ['items', 'topics']).flatMap((item) => {
    const normalized = normalizeTopic(item)
    return normalized === undefined ? [] : [normalized]
  })
}

export async function fetchViral(query = '', signal?: AbortSignal): Promise<ViralItem[]> {
  const params = new URLSearchParams({ limit: '50' })
  if (query.trim() !== '') params.set('q', query.trim())
  const payload = await request(`/viral?${params}`, signal === undefined ? {} : { signal })
  return list(payload, ['items', 'viralItems', 'viral']).flatMap((item) => {
    const normalized = normalizeViral(item)
    return normalized === undefined ? [] : [normalized]
  })
}

const REFERENCE_KINDS = new Set<LibraryKind>(['topic', 'viral', 'draft', 'publication'])

function normalizeReference(value: unknown): ReferenceItem | undefined {
  const item = record(value)
  const kind = text(item?.kind)
  const itemId = id(item?.id)
  const label = text(item?.label) ?? text(item?.title)
  if (item === undefined || kind === undefined || !REFERENCE_KINDS.has(kind as LibraryKind) || itemId === undefined || label === undefined) return undefined
  if (itemId.length > 512 || label.length > 512) return undefined
  const description = text(item.description)?.slice(0, 2_000)
  const hint = text(item.hint)?.slice(0, 512)
  return {
    kind: kind as LibraryKind,
    id: itemId,
    label,
    ...(description === undefined ? {} : { description }),
    ...(hint === undefined ? {} : { hint }),
    updatedAt: text(item.updatedAt) ?? text(item.updated_at),
  }
}

/** Search all referenceable MediaOps records with a single Host request. */
export async function fetchReferences(query = '', signal?: AbortSignal): Promise<ReferenceItem[]> {
  const params = new URLSearchParams({ limit: '48' })
  if (query.trim() !== '') params.set('q', query.trim())
  const payload = await request(`/references?${params}`, signal === undefined ? {} : { signal })
  return list(payload, ['items', 'references']).flatMap(item => normalizeReference(item) ?? [])
}

export async function fetchWorkbench(signal?: AbortSignal): Promise<WorkbenchSnapshot> {
  const options: RequestInit = signal === undefined ? {} : { signal }
  const settled = await Promise.allSettled([
    request('/overview', options),
    request('/topics?limit=200', options),
    request('/viral?limit=200', options),
    request('/drafts?limit=200', options),
    request('/publications?limit=200', options),
  ])
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
  const errors = settled.flatMap((entry) => entry.status === 'rejected' ? [entry.reason] : [])
  if (errors.length === settled.length) throw errors[0]
  const value = (index: number): unknown => {
    const entry = settled[index]
    return entry?.status === 'fulfilled' ? entry.value : undefined
  }
  return {
    overview: normalizeOverview(value(0)),
    topics: list(value(1), ['items', 'topics']).flatMap((item) => normalizeTopic(item) ?? []),
    viral: list(value(2), ['items', 'viralItems', 'viral']).flatMap((item) => normalizeViral(item) ?? []),
    drafts: list(value(3), ['items', 'drafts']).flatMap((item) => normalizeDraft(item) ?? []),
    publications: list(value(4), ['items', 'publications']).flatMap((item) => normalizePublication(item) ?? []),
  }
}

export async function createTopic(input: { title: string; angle?: string | undefined; tags?: string[] | undefined }): Promise<TopicItem> {
  const payload = await request('/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const top = record(payload)
  const normalized = normalizeTopic(top?.topic ?? top?.item ?? payload)
  if (normalized === undefined) throw new Error('Host 未返回有效选题')
  return normalized
}

export async function promoteViral(id: string): Promise<TopicItem> {
  const payload = await request(`/viral/${encodeURIComponent(id)}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const top = record(payload)
  const normalized = normalizeTopic(top?.topic ?? top?.item ?? payload)
  if (normalized === undefined) throw new Error('Host 未返回整理后的选题')
  return normalized
}

export async function fetchReference(kind: LibraryKind, id: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${API_PREFIX}/reference/${kind}/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json, text/plain' },
    signal,
  })
  if (!response.ok) throw new Error(`MediaOps 引用读取失败 (HTTP ${response.status})`)
  const contentType = response.headers.get('content-type') ?? ''
  let serialized: string
  if (contentType.includes('application/json')) {
    const payload = await response.json() as unknown
    const item = record(payload)
    serialized = text(item?.text) ?? text(item?.reference) ?? text(item?.content) ?? ''
  } else {
    serialized = await response.text()
  }
  if (serialized.trim() === '') throw new Error('MediaOps 引用内容为空')
  return serialized.length > REFERENCE_LIMIT
    ? `${serialized.slice(0, REFERENCE_LIMIT)}\n[MediaOps reference truncated]`
    : serialized
}

const MODEL_GROUPS = new Set(['image', 'video', 'music', 'voice'])
const MODEL_FIELD_KINDS = new Set(['text', 'url', 'select', 'boolean'])
const SENSITIVE_FIELD_NAME = /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|ACCESS[_-]?KEY)/iu

function normalizeModelField(value: unknown): ModelFieldItem | undefined {
  const item = record(value)
  const key = text(item?.key)
  const label = text(item?.label)
  const kind = text(item?.kind)
  if (!item || !key || !label || !kind || !MODEL_FIELD_KINDS.has(kind)) return undefined
  const secret = boolean(item.secret) || SENSITIVE_FIELD_NAME.test(key)
  return {
    key,
    label,
    required: boolean(item.required),
    secret,
    kind: kind as ModelFieldItem['kind'],
    choices: stringArray(item.choices),
    placeholder: text(item.placeholder),
    help: text(item.help),
    ...(secret ? { configured: boolean(item.configured) } : { value: typeof item.value === 'string' ? item.value : '' }),
  }
}

function normalizeModelProvider(value: unknown): ModelProviderItem | undefined {
  const item = record(value)
  const itemId = text(item?.id)
  const label = text(item?.label)
  if (!item || !itemId || !label || !Array.isArray(item.fields)) return undefined
  return {
    id: itemId,
    label,
    capabilities: stringArray(item.capabilities) ?? [],
    enabled: boolean(item.enabled),
    selected: boolean(item.selected),
    configured: boolean(item.configured),
    ready: boolean(item.ready),
    allowPrivateNetwork: boolean(item.allowPrivateNetwork),
    missingRequired: stringArray(item.missingRequired) ?? [],
    fields: item.fields.flatMap(entry => normalizeModelField(entry) ?? []),
    updatedAt: text(item.updatedAt),
  }
}

function normalizeModelGroup(value: unknown): ModelGroupItem | undefined {
  const item = record(value)
  const itemId = text(item?.id)
  const label = text(item?.label)
  if (!item || !itemId || !MODEL_GROUPS.has(itemId) || !label || !Array.isArray(item.providers)) return undefined
  return {
    id: itemId as ModelGroupItem['id'],
    label,
    description: text(item.description) ?? '',
    selectedProvider: text(item.selectedProvider),
    providers: item.providers.flatMap(entry => normalizeModelProvider(entry) ?? []),
  }
}

/** Defense-in-depth normalizer: secret-looking fields never retain a value. */
export function normalizeModelConfig(value: unknown): ModelConfigSnapshot {
  const item = record(value)
  return {
    version: typeof item?.version === 'number' && Number.isSafeInteger(item.version) ? item.version : 1,
    groups: Array.isArray(item?.groups) ? item.groups.flatMap(entry => normalizeModelGroup(entry) ?? []) : [],
  }
}

export async function fetchModelConfig(signal?: AbortSignal): Promise<ModelConfigSnapshot> {
  return normalizeModelConfig(await request('/model-config', signal === undefined ? {} : { signal }))
}

export async function updateModelProvider(groupId: string, providerId: string, update: ModelProviderUpdate): Promise<ModelConfigSnapshot> {
  const payload = await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  return normalizeModelConfig(payload)
}

export async function clearModelProvider(groupId: string, providerId: string): Promise<ModelConfigSnapshot> {
  return normalizeModelConfig(await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}`, { method: 'DELETE' }))
}

export async function verifyModelProvider(groupId: string, providerId: string): Promise<ModelValidationResult> {
  const payload = record(await request(`/model-config/${encodeURIComponent(groupId)}/${encodeURIComponent(providerId)}/verify`, { method: 'POST' }))
  return {
    configured: boolean(payload?.configured),
    ready: boolean(payload?.ready),
    errors: stringArray(payload?.errors) ?? [],
  }
}
