import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withDirectoryLock } from './store.ts'

export const MODEL_GROUP_IDS = ['image', 'video', 'music', 'voice'] as const
export type ModelGroupId = typeof MODEL_GROUP_IDS[number]

export interface ModelFieldDefinition {
  key: string
  label: string
  required: boolean
  secret: boolean
  kind: 'text' | 'url' | 'select' | 'boolean'
  choices?: readonly string[]
  placeholder?: string
  help?: string
}

export interface ModelProviderDefinition {
  id: string
  label: string
  capabilities: readonly string[]
  fields: readonly ModelFieldDefinition[]
}

export interface ModelGroupDefinition {
  id: ModelGroupId
  label: string
  description: string
  selectorEnv?: string
  providers: readonly ModelProviderDefinition[]
}

function field(
  key: string,
  label: string,
  options: Partial<Omit<ModelFieldDefinition, 'key' | 'label'>> = {},
): ModelFieldDefinition {
  return {
    key,
    label,
    required: options.required ?? false,
    secret: options.secret ?? false,
    kind: options.kind ?? 'text',
    ...(options.choices === undefined ? {} : { choices: options.choices }),
    ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
    ...(options.help === undefined ? {} : { help: options.help }),
  }
}

const apiKey = (key: string, label = 'API Key') => field(key, label, { required: true, secret: true })
const baseUrl = (key: string, required = false, label = 'API 根地址') => field(key, label, {
  required,
  kind: 'url',
  placeholder: 'https://api.example.com/v1',
  help: '默认只允许公网 HTTPS；localhost/RFC1918/ULA 也需显式开启私网，才可使用 HTTP。云 metadata 始终拒绝。',
})
const model = (key: string, label = '模型') => field(key, label, { placeholder: '服务商模型 ID' })

/**
 * Host-side allowlist matching the environment contract of bundled media scripts.
 * The browser receives this schema, never the values of fields marked secret.
 */
export const MODEL_GROUPS: readonly ModelGroupDefinition[] = [
  {
    id: 'image',
    label: '图像生成',
    description: '文生图、图生图、局部编辑与图片变体。',
    providers: [{
      id: 'openai-compatible',
      label: 'OpenAI 兼容 / API 聚合服务',
      capabilities: ['文生图', '图生图', '图片变体'],
      fields: [
        apiKey('IMG_API_KEY'),
        baseUrl('IMG_BASE_URL', true),
        field('IMG_MODEL', '图片模型', { required: true, placeholder: 'gpt-image-1' }),
        field('IMG_API_KEY_HEADER', '鉴权头名', { placeholder: 'Authorization（默认）' }),
        field('IMG_API_VERSION', 'API Version'),
        field('IMG_NO_PROXY', '绕过 Host 代理', { kind: 'boolean' }),
      ],
    }],
  },
  {
    id: 'video',
    label: '视频生成',
    description: '文生视频、图生视频与模型原生音频。',
    selectorEnv: 'VIDEO_PROVIDER',
    providers: [
      {
        id: 'dashscope', label: '阿里通义万相 Wan', capabilities: ['文生视频', '图生视频'], fields: [
          apiKey('DASHSCOPE_API_KEY'), model('DASHSCOPE_VIDEO_MODEL', '视频模型'), baseUrl('DASHSCOPE_BASE_URL'),
        ],
      },
      {
        id: 'ark', label: '火山引擎 Seedance', capabilities: ['文生视频', '图生视频', '原生音频'], fields: [
          apiKey('ARK_API_KEY'), model('ARK_MODEL', '视频模型'), baseUrl('ARK_BASE_URL'),
        ],
      },
      {
        id: 'kling', label: '快手可灵', capabilities: ['文生视频', '图生视频'], fields: [
          apiKey('KLING_ACCESS_KEY', 'Access Key'), apiKey('KLING_SECRET_KEY', 'Secret Key'),
          model('KLING_MODEL', '视频模型'), baseUrl('KLING_BASE_URL'),
        ],
      },
      {
        id: 'openai-compatible', label: 'OpenAI 兼容 /videos', capabilities: ['文生视频', '图生视频'], fields: [
          apiKey('VIDEO_API_KEY'), baseUrl('VIDEO_BASE_URL', true), model('VIDEO_MODEL', '视频模型'),
        ],
      },
      {
        id: 'xhs-maas', label: '自托管 MaaS', capabilities: ['文生视频', '图生视频'], fields: [
          apiKey('XHS_MAAS_API_KEY'), baseUrl('XHS_MAAS_VIDEO_BASE', true),
          model('XHS_MAAS_T2V_MODEL', '文生视频模型'), model('XHS_MAAS_I2V_MODEL', '图生视频模型'),
          field('XHS_MAAS_RESOLUTION', '分辨率'),
        ],
      },
      {
        id: 'agnes', label: 'Agnes Video', capabilities: ['文生视频', '图生视频'], fields: [
          apiKey('AGNES_API_KEY'), baseUrl('AGNES_BASE_URL', false, '任务创建 API 根地址'),
          baseUrl('AGNES_POLL_BASE', false, '任务轮询 API 根地址'),
          model('AGNES_MODEL', '视频模型'), field('AGNES_SIZE', '分辨率'),
        ],
      },
    ],
  },
  {
    id: 'music',
    label: '音乐生成',
    description: '文生音乐、BGM 与带歌词歌曲。',
    selectorEnv: 'MUSIC_PROVIDER',
    providers: [
      {
        id: 'dashscope', label: '阿里 DashScope', capabilities: ['文生音乐', 'BGM'], fields: [
          apiKey('DASHSCOPE_API_KEY'), model('DASHSCOPE_MUSIC_MODEL', '音乐模型'), baseUrl('DASHSCOPE_BASE_URL'),
        ],
      },
      {
        id: 'suno-compatible', label: 'Suno 类兼容 API', capabilities: ['文生音乐', '歌曲'], fields: [
          apiKey('MUSIC_API_KEY'), baseUrl('MUSIC_BASE_URL', true), model('MUSIC_MODEL', '音乐模型'),
        ],
      },
    ],
  },
  {
    id: 'voice',
    label: '语音与声音克隆',
    description: '文本转语音、预置音色与授权声音克隆。',
    selectorEnv: 'VOICE_PROVIDER',
    providers: [
      {
        id: 'dashscope', label: '阿里 CosyVoice', capabilities: ['文本转语音', '声音克隆'], fields: [
          apiKey('DASHSCOPE_API_KEY'), model('DASHSCOPE_TTS_MODEL', 'TTS 模型'), baseUrl('DASHSCOPE_BASE_URL'),
        ],
      },
      {
        id: 'minimax', label: 'MiniMax', capabilities: ['文本转语音', '声音克隆'], fields: [
          apiKey('MINIMAX_API_KEY'), field('MINIMAX_GROUP_ID', 'Group ID', { required: true }),
          model('MINIMAX_MODEL', 'TTS 模型'), baseUrl('MINIMAX_BASE_URL'),
        ],
      },
      {
        id: 'fish-audio', label: 'Fish Audio', capabilities: ['文本转语音', '参考音频克隆'], fields: [
          apiKey('FISH_API_KEY'), baseUrl('FISH_BASE_URL'),
        ],
      },
      {
        id: 'openai-compatible', label: 'OpenAI 兼容 /audio/speech', capabilities: ['文本转语音'], fields: [
          apiKey('VOICE_API_KEY'), baseUrl('VOICE_BASE_URL', true), model('VOICE_MODEL', 'TTS 模型'),
          field('VOICE_INSTRUCT_MODE', '情感指令模式', { kind: 'select', choices: ['field', 'inline'] }),
          field('VOICE_INSTRUCT_DELIM', '内联指令分隔符'),
        ],
      },
      {
        id: 'gemini', label: 'Google Gemini TTS', capabilities: ['文本转语音', '预置音色'], fields: [
          apiKey('GEMINI_API_KEY'), model('GEMINI_TTS_MODEL', 'TTS 模型'), field('GEMINI_VOICE', '预置音色'),
          baseUrl('GEMINI_BASE_URL'), field('GEMINI_TTS_RATE', '采样率'),
        ],
      },
    ],
  },
] as const

interface StoredProviderConfig {
  enabled: boolean
  allowPrivateNetwork: boolean
  values: Record<string, string>
  updatedAt: string
}

interface StoredModelConfig {
  version: 1
  selected: Partial<Record<ModelGroupId, string>>
  providers: Partial<Record<ModelGroupId, Record<string, StoredProviderConfig>>>
}

export type SecretChange =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' }

export interface ProviderUpdate {
  enabled?: boolean
  allowPrivateNetwork?: boolean
  setAsDefault?: boolean
  values?: Record<string, unknown>
  secretChanges?: Record<string, SecretChange>
}

export interface ModelFieldView extends ModelFieldDefinition {
  value?: string
  configured?: boolean
}

export interface ModelProviderView {
  id: string
  label: string
  capabilities: readonly string[]
  enabled: boolean
  selected: boolean
  configured: boolean
  ready: boolean
  allowPrivateNetwork: boolean
  missingRequired: string[]
  fields: ModelFieldView[]
  updatedAt?: string
}

export interface ModelGroupView {
  id: ModelGroupId
  label: string
  description: string
  selectedProvider?: string
  providers: ModelProviderView[]
}

export interface ModelConfigView {
  ok: true
  version: 1
  groups: ModelGroupView[]
}

const MAX_CONFIG_BYTES = 512 * 1024
const MAX_VALUE_CHARS = 8_192
const MAX_SECRET_CHARS = 32_768
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const PLACEHOLDER_SECRET = /^(?:x{3,}|replace[_ -]?me|your[_ -]?(?:api[_ -]?)?key|<[^>]+>|\.{3})$/iu

function emptyConfig(): StoredModelConfig {
  return { version: 1, selected: {}, providers: {} }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function getModelGroup(groupId: string): ModelGroupDefinition {
  const group = MODEL_GROUPS.find(item => item.id === groupId)
  if (!group) throw new Error(`不支持的模型类别: ${groupId}`)
  return group
}

export function getModelProvider(groupId: string, providerId: string): { group: ModelGroupDefinition; provider: ModelProviderDefinition } {
  const group = getModelGroup(groupId)
  const provider = group.providers.find(item => item.id === providerId)
  if (!provider) throw new Error(`${group.label} 不支持 provider: ${providerId}`)
  return { group, provider }
}

function normalizeString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${label} 超过 ${max} 字符`)
  if (CONTROL_CHARACTERS.test(normalized)) throw new Error(`${label} 不能包含控制字符`)
  return normalized
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = 0, b = 0] = parts
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 192 && b === 2) || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0) || a >= 224
}

function isPrivateAddress(address: string): boolean {
  const ipVersion = isIP(address)
  if (ipVersion === 4) return isPrivateIPv4(address)
  if (ipVersion !== 6) return false
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^(?:fe[89ab])/u.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')
    || normalized.startsWith('::ffff:') && isPrivateIPv4(normalized.slice('::ffff:'.length))
}

function isExplicitPrivateAddress(address: string): boolean {
  const ipVersion = isIP(address)
  if (ipVersion === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
  }
  if (ipVersion !== 6) return false
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
}

function isMetadataTarget(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '')
  return ['metadata', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal',
    '169.254.169.254', '169.254.170.2', 'fd00:ec2::254'].includes(host)
    || host.endsWith('.metadata.google.internal')
}

/** Validate the static half of the outbound-network policy. */
export function validateModelBaseUrl(raw: string, allowPrivateNetwork: boolean): string {
  const value = normalizeString(raw, 'API 根地址', MAX_VALUE_CHARS)
  if (!value) return ''
  let url: URL
  try { url = new URL(value) } catch { throw new Error('API 根地址必须是有效 URL') }
  if (url.username || url.password) throw new Error('API 根地址不能包含用户名或密码')
  if (url.search || url.hash) throw new Error('API 根地址不能包含 query 或 fragment')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isMetadataTarget(host)) throw new Error('API 根地址不能指向云元数据服务')
  if (url.protocol !== 'https:' && !(allowPrivateNetwork && url.protocol === 'http:')) {
    throw new Error('API 根地址必须使用 HTTPS；显式允许的私网端点才可使用 HTTP')
  }
  const localName = isLoopbackHost(host) || !host.includes('.') || /(?:^|\.)(?:local|localhost|internal|lan|home|test)$/iu.test(host)
  if (!allowPrivateNetwork && ((isIP(host) !== 0 && isPrivateAddress(host)) || localName)) {
    throw new Error('API 根地址指向私有网络；如确有需要，请显式开启“允许私有网络地址”')
  }
  if (url.protocol === 'http:' && isIP(host) !== 0 && !isExplicitPrivateAddress(host)) {
    throw new Error('HTTP API 根地址只允许显式放行的 loopback/RFC1918/ULA 私网地址')
  }
  if (url.protocol === 'http:' && isIP(host) === 0 && !localName) {
    throw new Error('HTTP API 根地址只允许显式私网 IP 或明确的本地主机名；公网形态域名必须使用 HTTPS')
  }
  if (isIP(host) !== 0 && allowPrivateNetwork && isPrivateAddress(host) && !isExplicitPrivateAddress(host)) {
    throw new Error('API 根地址不是可显式放行的 loopback/RFC1918/ULA 地址')
  }
  return url.toString().replace(/\/$/u, '')
}

type EndpointLookup = (hostname: string) => Promise<readonly { address: string }[]>

/** Resolve hostnames immediately before execution to stop private-IP DNS rebinding by default. */
export async function assertModelEndpointNetworkPolicy(
  raw: string,
  allowPrivateNetwork: boolean,
  resolveAddresses: EndpointLookup = async hostname => lookup(hostname, { all: true, verbatim: true }),
): Promise<void> {
  const normalized = validateModelBaseUrl(raw, allowPrivateNetwork)
  if (!normalized) return
  const url = new URL(normalized)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const privateHttp = url.protocol === 'http:'
  if (isMetadataTarget(hostname)) throw new Error('API 根地址不能指向云元数据服务')
  if (isIP(hostname) !== 0) {
    if (privateHttp && !(allowPrivateNetwork && isExplicitPrivateAddress(hostname))) {
      throw new Error('HTTP API 根地址只允许解析到显式 loopback/RFC1918/ULA 私网地址')
    }
    if (isPrivateAddress(hostname) && !(allowPrivateNetwork && isExplicitPrivateAddress(hostname))) throw new Error('API 根地址解析到私有或保留地址')
    return
  }
  const addresses = await resolveAddresses(hostname)
  if (privateHttp && (addresses.length === 0 || !allowPrivateNetwork
    || addresses.some(item => !isExplicitPrivateAddress(item.address) || isMetadataTarget(item.address)))) {
    throw new Error('HTTP API 根地址 DNS 必须全部解析到显式 loopback/RFC1918/ULA 私网地址')
  }
  if (!privateHttp && (addresses.length === 0 || addresses.some(item => isMetadataTarget(item.address)
    || isPrivateAddress(item.address) && !(allowPrivateNetwork && isExplicitPrivateAddress(item.address))))) {
    throw new Error('API 根地址 DNS 解析到私有或保留地址；如确有需要，请显式允许私网')
  }
}

function validateFieldValue(fieldDefinition: ModelFieldDefinition, raw: unknown, allowPrivateNetwork: boolean): string {
  if (fieldDefinition.kind === 'boolean') {
    if (raw === '' || raw === false || raw === undefined || raw === null || raw === '0' || raw === 'false') return ''
    if (raw === true || raw === '1' || raw === 'true') return '1'
    throw new Error(`${fieldDefinition.label} 必须是 boolean`)
  }
  const value = normalizeString(raw, fieldDefinition.label, fieldDefinition.secret ? MAX_SECRET_CHARS : MAX_VALUE_CHARS)
  if (fieldDefinition.secret && value && PLACEHOLDER_SECRET.test(value)) throw new Error(`${fieldDefinition.label} 看起来仍是占位符`)
  if (fieldDefinition.kind === 'url') return validateModelBaseUrl(value, allowPrivateNetwork)
  if (fieldDefinition.kind === 'select' && value && !fieldDefinition.choices?.includes(value)) {
    throw new Error(`${fieldDefinition.label} 不是允许的选项`)
  }
  if (fieldDefinition.key.endsWith('_API_KEY_HEADER') && value && !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(value)) {
    throw new Error(`${fieldDefinition.label} 不是有效的 HTTP header 名`)
  }
  return value
}

function assertStoredProvider(raw: unknown, provider: ModelProviderDefinition): asserts raw is StoredProviderConfig {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean' || typeof raw.allowPrivateNetwork !== 'boolean'
    || !isRecord(raw.values) || typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) {
    throw new Error(`模型 provider ${provider.id} 的本地配置损坏`)
  }
  const allowed = new Map(provider.fields.map(item => [item.key, item]))
  for (const [key, value] of Object.entries(raw.values)) {
    const definition = allowed.get(key)
    if (!definition) throw new Error(`模型 provider ${provider.id} 含未知字段 ${key}`)
    validateFieldValue(definition, value, raw.allowPrivateNetwork)
  }
}

function parseStored(raw: unknown): StoredModelConfig {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.selected) || !isRecord(raw.providers)) {
    throw new Error('多模态模型配置文件格式无效')
  }
  const output = emptyConfig()
  for (const group of MODEL_GROUPS) {
    const selected = raw.selected[group.id]
    if (selected !== undefined) {
      if (typeof selected !== 'string' || !group.providers.some(item => item.id === selected)) throw new Error(`${group.label} 默认 provider 无效`)
      output.selected[group.id] = selected
    }
    const rawProviders = raw.providers[group.id]
    if (rawProviders === undefined) continue
    if (!isRecord(rawProviders)) throw new Error(`${group.label} provider 配置无效`)
    const providers: Record<string, StoredProviderConfig> = {}
    for (const [providerId, value] of Object.entries(rawProviders)) {
      const provider = group.providers.find(item => item.id === providerId)
      if (!provider) throw new Error(`${group.label} 含未知 provider ${providerId}`)
      assertStoredProvider(value, provider)
      providers[providerId] = clone(value)
    }
    output.providers[group.id] = providers
  }
  return output
}

function providerView(group: ModelGroupDefinition, provider: ModelProviderDefinition, stored: StoredProviderConfig | undefined, selected: string | undefined): ModelProviderView {
  const values = stored?.values ?? {}
  const missingRequired = provider.fields.filter(item => item.required && !values[item.key]).map(item => item.label)
  const configured = Object.keys(values).length > 0
  return {
    id: provider.id,
    label: provider.label,
    capabilities: [...provider.capabilities],
    enabled: stored?.enabled ?? false,
    selected: selected === provider.id,
    configured,
    ready: Boolean(stored?.enabled && missingRequired.length === 0),
    allowPrivateNetwork: stored?.allowPrivateNetwork ?? false,
    missingRequired,
    fields: provider.fields.map(item => item.secret
      ? { ...item, configured: Boolean(values[item.key]) }
      : { ...item, value: values[item.key] ?? '' }),
    ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  }
}

function toView(state: StoredModelConfig): ModelConfigView {
  return {
    ok: true,
    version: 1,
    groups: MODEL_GROUPS.map(group => {
      const selected = state.selected[group.id]
      return {
        id: group.id,
        label: group.label,
        description: group.description,
        ...(selected ? { selectedProvider: selected } : {}),
        providers: group.providers.map(provider => providerView(group, provider, state.providers[group.id]?.[provider.id], selected)),
      }
    }),
  }
}

export class ModelConfigStore {
  readonly dataDir: string
  readonly secretsDir: string
  readonly configPath: string
  readonly lockPath: string
  readonly ready: Promise<void>
  private tail: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.secretsDir = join(dataDir, 'secrets')
    this.configPath = join(this.secretsDir, 'multimodal-models.json')
    this.lockPath = join(this.secretsDir, '.multimodal-models.lock')
    this.ready = this.initialize()
    void this.ready.catch(() => undefined)
  }

  private async ensurePrivateDirectory(): Promise<void> {
    const root = await realpath(this.dataDir)
    const expected = join(root, 'secrets')
    let info = await lstat(expected).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!info) {
      await mkdir(expected, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      info = await lstat(expected)
    }
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(expected) !== expected) {
      throw new Error('多模态模型秘密目录必须是 dataDir 内的真实目录，不能是符号链接')
    }
    await chmod(expected, 0o700)
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    await chmod(this.dataDir, 0o700).catch(() => undefined)
    await this.ensurePrivateDirectory()
    await this.withLock(async () => {
      try {
        await this.load()
        await chmod(this.configPath, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.persist(emptyConfig())
      }
    })
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    await this.ensurePrivateDirectory()
    const existing = await lstat(this.lockPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) {
      throw new Error('多模态模型配置锁不能是符号链接或普通文件')
    }
    return withDirectoryLock(this.lockPath, work, { label: '多模态模型配置' })
  }

  private async load(): Promise<StoredModelConfig> {
    const info = await lstat(this.configPath)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('多模态模型配置必须是普通文件，不能是符号链接')
    if (info.size > MAX_CONFIG_BYTES) throw new Error('多模态模型配置超过 512 KiB 安全上限')
    return parseStored(JSON.parse(await readFile(this.configPath, 'utf8')))
  }

  private async persist(state: StoredModelConfig): Promise<void> {
    const serialized = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(serialized) > MAX_CONFIG_BYTES) throw new Error('多模态模型配置超过 512 KiB 安全上限')
    const temporary = join(this.secretsDir, `.multimodal-models-${process.pid}-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.configPath)
      await chmod(this.configPath, 0o600)
      try {
        const directory = await open(this.secretsDir, 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch {
        // Directory fsync is unavailable on some filesystems.
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async readState(): Promise<StoredModelConfig> {
    await this.ready
    await this.tail
    return this.load()
  }

  private async mutate<T>(change: (state: StoredModelConfig) => T | Promise<T>): Promise<T> {
    await this.ready
    let result!: T
    const operation = this.tail.then(async () => {
      await this.withLock(async () => {
        const state = await this.load()
        result = await change(state)
        await this.persist(state)
      })
    })
    this.tail = operation.catch(() => undefined)
    await operation
    return result
  }

  async view(): Promise<ModelConfigView> {
    return toView(await this.readState())
  }

  async updateProvider(groupId: string, providerId: string, update: ProviderUpdate): Promise<ModelConfigView> {
    const { group, provider } = getModelProvider(groupId, providerId)
    for (const key of Object.keys(update)) {
      if (!['enabled', 'allowPrivateNetwork', 'setAsDefault', 'values', 'secretChanges'].includes(key)) throw new Error(`模型配置更新含未知字段 ${key}`)
    }
    if (update.enabled !== undefined && typeof update.enabled !== 'boolean') throw new Error('enabled 必须是 boolean')
    if (update.allowPrivateNetwork !== undefined && typeof update.allowPrivateNetwork !== 'boolean') throw new Error('allowPrivateNetwork 必须是 boolean')
    if (update.setAsDefault !== undefined && typeof update.setAsDefault !== 'boolean') throw new Error('setAsDefault 必须是 boolean')
    if (update.values !== undefined && !isRecord(update.values)) throw new Error('values 必须是 JSON 对象')
    if (update.secretChanges !== undefined && !isRecord(update.secretChanges)) throw new Error('secretChanges 必须是 JSON 对象')
    const enabled = update.enabled
    const allowPrivateNetwork = update.allowPrivateNetwork

    return this.mutate(state => {
      const existing = state.providers[group.id]?.[provider.id]
      const next: StoredProviderConfig = existing ? clone(existing) : {
        enabled: false,
        allowPrivateNetwork: false,
        values: {},
        updatedAt: new Date().toISOString(),
      }
      if (enabled !== undefined) next.enabled = enabled
      if (allowPrivateNetwork !== undefined) next.allowPrivateNetwork = allowPrivateNetwork
      const definitions = new Map(provider.fields.map(item => [item.key, item]))
      for (const [key, raw] of Object.entries(update.values ?? {})) {
        const definition = definitions.get(key)
        if (!definition || definition.secret) throw new Error(`${provider.label} 不允许通过 values 更新字段 ${key}`)
        const value = validateFieldValue(definition, raw, next.allowPrivateNetwork)
        if (value) next.values[key] = value
        else delete next.values[key]
      }
      for (const [key, rawChange] of Object.entries(update.secretChanges ?? {})) {
        const definition = definitions.get(key)
        if (!definition?.secret) throw new Error(`${provider.label} 不允许通过 secretChanges 更新字段 ${key}`)
        if (!isRecord(rawChange) || !['keep', 'replace', 'clear'].includes(String(rawChange.action))) {
          throw new Error(`${definition.label} 的 secretChanges 必须明确指定 keep、replace 或 clear`)
        }
        if (rawChange.action === 'keep') {
          if (Object.keys(rawChange).length !== 1) throw new Error(`${definition.label} keep 不能携带 value`)
          continue
        }
        if (rawChange.action === 'clear') {
          if (Object.keys(rawChange).length !== 1) throw new Error(`${definition.label} clear 不能携带 value`)
          delete next.values[key]
          continue
        }
        if (rawChange.action !== 'replace' || Object.keys(rawChange).some(item => !['action', 'value'].includes(item))) {
          throw new Error(`${definition.label} replace 格式无效`)
        }
        const value = validateFieldValue(definition, rawChange.value, next.allowPrivateNetwork)
        if (!value) throw new Error(`${definition.label} replace 必须提供非空值；清除请使用 clear`)
        next.values[key] = value
      }
      // Re-check URLs if the private-network opt-in was switched off.
      for (const definition of provider.fields) {
        const value = next.values[definition.key]
        if (definition.kind === 'url' && value) next.values[definition.key] = validateModelBaseUrl(value, next.allowPrivateNetwork)
      }
      next.updatedAt = new Date().toISOString()
      const providers = state.providers[group.id] ?? {}
      providers[provider.id] = next
      state.providers[group.id] = providers
      if (update.setAsDefault === true || !state.selected[group.id]) state.selected[group.id] = provider.id
      return toView(state)
    })
  }

  async clearProvider(groupId: string, providerId: string): Promise<ModelConfigView> {
    const { group } = getModelProvider(groupId, providerId)
    return this.mutate(state => {
      const providers = state.providers[group.id]
      if (providers) delete providers[providerId]
      if (state.selected[group.id] === providerId) {
        const fallback = group.providers.find(item => providers?.[item.id]?.enabled)
        if (fallback) state.selected[group.id] = fallback.id
        else delete state.selected[group.id]
      }
      return toView(state)
    })
  }

  async validateProvider(groupId: string, providerId: string): Promise<{ ok: true; configured: boolean; ready: boolean; errors: string[] }> {
    const { group, provider } = getModelProvider(groupId, providerId)
    const state = await this.readState()
    const stored = state.providers[group.id]?.[provider.id]
    const errors: string[] = []
    if (!stored) errors.push('尚未保存配置')
    else {
      if (!stored.enabled) errors.push('provider 尚未启用')
      for (const definition of provider.fields) {
        const value = stored.values[definition.key]
        if (definition.required && !value) errors.push(`缺少 ${definition.label}`)
        if (definition.kind === 'url' && value) {
          try { await assertModelEndpointNetworkPolicy(value, stored.allowPrivateNetwork) } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
        }
      }
    }
    return { ok: true, configured: Boolean(stored && Object.keys(stored.values).length > 0), ready: errors.length === 0, errors }
  }

  /** Host-only environment projection. Callers must never serialize its return value. */
  async executionEnvironment(groupId: ModelGroupId, requestedProvider?: string): Promise<{
    providerId: string
    env: NodeJS.ProcessEnv
    secrets: string[]
    allowPrivateNetwork: boolean
  }> {
    const group = getModelGroup(groupId)
    const state = await this.readState()
    const providerId = requestedProvider || state.selected[group.id]
    if (!providerId) throw new Error(`${group.label} 尚未选择默认 provider`)
    const { provider } = getModelProvider(group.id, providerId)
    const stored = state.providers[group.id]?.[providerId]
    if (!stored?.enabled) throw new Error(`${provider.label} 尚未启用`)
    const missing = provider.fields.filter(item => item.required && !stored.values[item.key])
    if (missing.length > 0) throw new Error(`${provider.label} 缺少必填配置: ${missing.map(item => item.label).join('、')}`)
    for (const definition of provider.fields) {
      const value = stored.values[definition.key]
      if (definition.kind === 'url' && value) await assertModelEndpointNetworkPolicy(value, stored.allowPrivateNetwork)
    }
    const env: NodeJS.ProcessEnv = {}
    for (const definition of provider.fields) {
      const value = stored.values[definition.key]
      if (value) env[definition.key] = value
    }
    if (group.selectorEnv) env[group.selectorEnv] = provider.id
    return {
      providerId,
      env,
      secrets: provider.fields.filter(item => item.secret).flatMap(item => stored.values[item.key] ? [stored.values[item.key] as string] : []),
      allowPrivateNetwork: stored.allowPrivateNetwork,
    }
  }
}
