import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, readFileSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import type { Draft, MediaPlatform, Publication } from './types.ts'
import { BUNDLED_SKILLS_ROOT } from './skills.ts'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const OUTPUT_LIMIT = 1024 * 1024
const SENSITIVE_TEMP_MAX_AGE_MS = 2 * 60 * 60_000

export interface CommandSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export interface RunResult {
  started: boolean
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  error?: string
}

export interface AdapterResult extends RunResult {
  commandDigest: string
  outputDigest: string
  externalUrl: string
  evidence: string
  outcome: 'submitted' | 'draft_created' | 'scheduled' | 'published' | 'uncertain'
}

interface AccountObservation {
  label: string
  identity: string
  author: string
  theme: string
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function privateSubdirectory(dataRoot: string, segments: string[]): Promise<string> {
  let current = await realpath(dataRoot)
  for (const segment of segments) {
    current = join(current, segment)
    let info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!info) {
      await mkdir(current, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      info = await lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`MediaOps 敏感临时目录必须是真实目录，不能是符号链接: ${current}`)
    }
    await chmod(current, 0o700)
    if (await realpath(current) !== current) {
      throw new Error(`MediaOps 敏感临时目录不能经过符号链接: ${current}`)
    }
  }
  return current
}

async function securePreflightRun(directory: string): Promise<void> {
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      await rm(path, { force: true })
    } else if (info.isFile()) {
      await chmod(path, 0o600)
    } else {
      throw new Error(`MediaOps preflight 临时目录包含非预期条目: ${path}`)
    }
  }
}

async function cleanupPrefixedSensitiveEntries(
  root: string,
  pattern: RegExp,
  expected: 'directory' | 'file',
  nowMs: number,
): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!pattern.test(entry.name)) continue
    const path = join(root, entry.name)
    const info = await lstat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (!info) continue
    if (info.isSymbolicLink()) {
      // Unlink only the link itself. Never recurse through an attacker-controlled target.
      await rm(path, { force: true })
      continue
    }
    const validKind = expected === 'directory' ? info.isDirectory() : info.isFile()
    if (!validKind) throw new Error(`MediaOps 敏感临时条目类型异常: ${path}`)
    if (nowMs - info.mtimeMs >= SENSITIVE_TEMP_MAX_AGE_MS) {
      await rm(path, { recursive: expected === 'directory', force: true })
      continue
    }
    if (expected === 'directory') await securePreflightRun(path)
    else await chmod(path, 0o600)
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function stringList(value: unknown, max = 20): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : []
  return [...new Set(source.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))].slice(0, max)
}

function optionString(options: Record<string, unknown>, key: string, max = 500): string {
  const value = options[key]
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function optionInteger(options: Record<string, unknown>, key: string): number | undefined {
  const value = options[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function safeEnv(dataDir: string, workspaceRoot: string): NodeJS.ProcessEnv {
  const workspace = workspaceRoot || process.env.DSH_MEDIAOPS_WORKSPACE?.trim() || process.env.EASEL_ROOT?.trim() || process.cwd()
  const env: NodeJS.ProcessEnv = {
    DSH_MEDIAOPS_DATA_DIR: dataDir,
    DSH_MEDIAOPS_WORKSPACE: workspace,
    EASEL_ROOT: workspace,
    PYTHONUNBUFFERED: '1',
  }
  for (const key of [
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec',
    'DSH_HOME', 'DSH_MEDIAOPS_WECHAT_CONFIG', 'PLAYWRIGHT_BROWSERS_PATH',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

function python(script: string, args: string[], dataDir: string, workspaceRoot = ''): CommandSpec {
  const workspace = workspaceRoot || process.env.DSH_MEDIAOPS_WORKSPACE?.trim() || process.env.EASEL_ROOT?.trim() || process.cwd()
  return {
    command: process.env.DSH_MEDIAOPS_PYTHON?.trim() || 'python3',
    args: [script, ...args],
    cwd: workspace,
    env: safeEnv(dataDir, workspace),
  }
}

function applyNetworkOptions(spec: CommandSpec, options: Record<string, unknown>): CommandSpec {
  if (options.noProxy !== true) return spec
  const env = { ...spec.env }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) delete env[key]
  return { ...spec, env }
}

function sharedScript(name: string): string {
  return join(BUNDLED_SKILLS_ROOT, 'shared', 'scripts', name)
}

function skillScript(skill: string, name: string): string {
  return join(BUNDLED_SKILLS_ROOT, 'openclaw', skill, 'scripts', name)
}

function wechatThemeDigest(theme: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(theme)) throw new Error('微信公众号主题只能是内置主题名，不能是路径')
  const path = join(BUNDLED_SKILLS_ROOT, 'openclaw', 'skill-wechat-publisher', 'assets', 'themes', `${theme}.json`)
  try {
    return sha256(readFileSync(path))
  } catch {
    throw new Error(`找不到微信公众号内置主题 ${theme}`)
  }
}

function classifyAssets(paths: string[]): { videos: string[]; images: string[]; unsupported: string[] } {
  const videos: string[] = []
  const images: string[] = []
  const unsupported: string[] = []
  for (const path of paths) {
    const extension = extname(path).toLowerCase()
    if (VIDEO_EXTENSIONS.has(extension)) videos.push(path)
    else if (IMAGE_EXTENSIONS.has(extension)) images.push(path)
    else unsupported.push(path)
  }
  return { videos, images, unsupported }
}

function browserOptions(options: Record<string, unknown>, dataDir: string): string[] {
  const args = ['--profile-base', join(dataDir, 'browser-profiles')]
  const proxy = optionString(options, 'proxy', 2_000)
  if (options.noProxy === true) args.push('--no-proxy')
  else if (proxy) args.push('--proxy', proxy)
  return args
}

function tags(options: Record<string, unknown>): string[] {
  return stringList(options.tags)
}

function ensureTitle(title: string, platform: MediaPlatform): void {
  if (title.trim() === '') throw new Error(`${platform} 发布标题不能为空`)
}

export function buildExecutionSpec(publication: Publication, dataDir: string): CommandSpec {
  const snapshot = publication.snapshot
  const options = snapshot.publisherOptions
  const media = classifyAssets(snapshot.assets)
  if (media.unsupported.length > 0) throw new Error(`受控 adapter 不支持素材类型: ${media.unsupported.join(', ')}`)
  ensureTitle(snapshot.title, publication.platform)
  const tagValues = tags(options)

  if (publication.platform === 'xiaohongshu' || publication.platform === 'douyin') {
    if ((media.videos.length === 0) === (media.images.length === 0)) throw new Error(`${publication.platform} 必须且只能选择图文或单视频一种素材形态`)
    if (media.videos.length > 1) throw new Error(`${publication.platform} 视频发布只允许一个视频`)
    const script = sharedScript(publication.platform === 'xiaohongshu' ? 'xhs_publish.py' : 'douyin_publish.py')
    const command = media.videos.length === 1 ? 'publish-video' : 'publish'
    const args = [
      command,
      '--title', snapshot.title,
      '--content-file', snapshot.bodyPath,
      '--expected-account-identity', snapshot.accountIdentity,
    ]
    if (media.videos[0]) args.push('--video', media.videos[0])
    else args.push('--images', media.images.join(','))
    if (tagValues.length > 0) args.push('--tags', tagValues.join(','))
    args.push(...browserOptions(options, dataDir), '--exec')
    return applyNetworkOptions(python(script, args, dataDir, snapshot.workspaceRoot), options)
  }

  if (publication.platform === 'kuaishou' || publication.platform === 'wechat-channels' || publication.platform === 'zhihu') {
    const platform = publication.platform === 'wechat-channels' ? 'weixin-channels' : publication.platform
    const args = [
      'publish',
      '--platform', platform,
      '--title', snapshot.title,
      '--desc-file', snapshot.bodyPath,
      '--expected-account-identity', snapshot.accountIdentity,
    ]
    if (publication.platform !== 'zhihu') {
      if (media.videos.length !== 1 || media.images.length !== 0) throw new Error(`${publication.platform} 受控发布只接受一个视频`)
      args.push('--media', media.videos[0] as string)
    } else if (snapshot.assets.length > 0) {
      throw new Error('知乎受控发布当前不接受附件；请把图片转为正文内可审阅内容')
    }
    if (tagValues.length > 0) args.push('--tags', tagValues.map(item => `#${item.replace(/^#/, '')}`).join(' '))
    args.push(...browserOptions(options, dataDir), '--exec')
    return applyNetworkOptions(python(sharedScript('web_publisher.py'), args, dataDir, snapshot.workspaceRoot), options)
  }

  if (publication.platform === 'wechat-official') {
    if (media.images.length === 0) throw new Error('微信公众号发布至少需要一张已冻结图片作为封面')
    if (media.videos.length > 0) throw new Error('微信公众号受控 adapter 当前不接受视频附件')
    const args = [
      '--input', snapshot.bodyPath,
      '--title', snapshot.title,
      '--cover', media.images[0] as string,
      '--account', snapshot.accountLabel,
      '--expected-account-identity', snapshot.accountIdentity,
    ]
    const digest = optionString(options, 'digest', 120)
    const sourceUrl = optionString(options, 'sourceUrl', 2_000)
    const theme = optionString(options, 'theme', 100)
    const author = optionString(options, 'author', 100)
    const expectedThemeDigest = optionString(options, '_themeSha256', 64)
    if (!theme || !expectedThemeDigest || wechatThemeDigest(theme) !== expectedThemeDigest) throw new Error('微信公众号冻结主题缺失或已变化，请重新生成预览')
    args.push('--expected-theme-sha256', expectedThemeDigest)
    if (digest) args.push('--digest', digest)
    if (sourceUrl) args.push('--source-url', sourceUrl)
    if (theme) args.push('--theme', theme)
    if (author) args.push('--author', author)
    args.push('--exec')
    const spec = python(skillScript('skill-wechat-publisher', 'publish.py'), args, dataDir, snapshot.workspaceRoot)
    spec.env.DSH_MEDIAOPS_LOCKED_STAGING = dirname(snapshot.bodyPath)
    return spec
  }

  if (publication.platform === 'bilibili') {
    if (media.videos.length !== 1) throw new Error('Bilibili 发布必须且只能包含一个视频')
    const args = [
      'upload',
      '--video', media.videos[0] as string,
      '--title', snapshot.title,
      '--desc-file', snapshot.bodyPath,
      '--expected-account-identity', snapshot.accountIdentity,
    ]
    if (media.images.length > 1) throw new Error('Bilibili 发布最多包含一张封面图')
    if (media.images[0]) args.push('--cover', media.images[0])
    if (tagValues.length > 0) args.push('--tag', tagValues.join(','))
    const tid = optionInteger(options, 'tid')
    const partition = optionString(options, 'partition', 100)
    if (tid !== undefined) args.push('--tid', String(tid))
    else if (partition) args.push('--partition', partition)
    const copyright = optionInteger(options, 'copyright')
    if (copyright === 1 || copyright === 2) args.push('--copyright', String(copyright))
    const source = optionString(options, 'source', 2_000)
    if (copyright === 2 && !source) throw new Error('Bilibili 转载必须提供 publisherOptions.source')
    if (source) args.push('--source', source)
    const proxy = optionString(options, 'proxy', 2_000)
    if (options.noProxy !== true && proxy) args.push('--proxy', proxy)
    if (snapshot.scheduledAt) args.push('--dtime', String(Math.floor(new Date(snapshot.scheduledAt).getTime() / 1_000)))
    args.push('--cookie', join(dataDir, 'credentials', 'bilibili', 'cookies.json'), '--exec')
    return applyNetworkOptions(python(skillScript('skill-bilibili-upload', 'bili_upload.py'), args, dataDir, snapshot.workspaceRoot), options)
  }

  throw new Error(`没有 ${publication.platform} 的受控发布 adapter`)
}

function pushLimited(chunks: Buffer[], chunk: Buffer, used: number): number {
  if (used >= OUTPUT_LIMIT) return used
  const accepted = chunk.subarray(0, OUTPUT_LIMIT - used)
  chunks.push(accepted)
  return used + accepted.length
}

export async function runCommand(spec: CommandSpec, signal?: AbortSignal, timeoutMs = 30 * 60_000): Promise<RunResult> {
  if (signal?.aborted) {
    return { started: false, code: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: true, error: 'aborted before publisher start' }
  }
  return new Promise(resolve => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let started = false
    let settled = false
    let timedOut = false
    let aborted = false
    let stdoutBytes = 0
    let stderrBytes = 0
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let child
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      resolve({ started: false, code: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    const finish = (result: Omit<RunResult, 'stdout' | 'stderr' | 'started' | 'timedOut' | 'aborted'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ ...result, started, timedOut, aborted, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    }
    const terminate = () => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: false, windowsHide: true })
        killer.once('error', () => child.kill())
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
      } else child.kill('SIGTERM')
      if (!forceTimer) {
        forceTimer = setTimeout(() => {
          if (process.platform === 'win32' && child.pid) {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: false, windowsHide: true })
            killer.once('error', () => child.kill('SIGKILL'))
          } else if (child.pid) {
            try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
          } else child.kill('SIGKILL')
        }, 5_000)
      }
    }
    const onAbort = () => {
      aborted = true
      terminate()
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.once('spawn', () => {
      started = true
      if (aborted || timedOut) terminate()
    })
    child.stdout?.on('data', chunk => { stdoutBytes = pushLimited(stdout, Buffer.from(chunk), stdoutBytes) })
    child.stderr?.on('data', chunk => { stderrBytes = pushLimited(stderr, Buffer.from(chunk), stderrBytes) })
    child.once('error', error => finish({ code: null, signal: null, error: error.message }))
    child.once('close', (code, closeSignal) => finish({ code, signal: closeSignal }))
  })
}

function redact(text: string): string {
  return text
    .replace(/(https?:\/\/)[^@\s/:]+:[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/("(?:access[_-]?token|app[_-]?secret|api[_-]?key|cookie|authorization)"\s*:\s*")[^"]+/gi, '$1[REDACTED]')
    .replace(/(access[_-]?token|app[_-]?secret|api[_-]?key|cookie|authorization)(\s*[=:]\s*|\s+)[^\s&"']+/gi, '$1$2[REDACTED]')
    .replace(/([?&]access_token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
}

function allowedUrl(platform: MediaPlatform, text: string): string {
  const hosts: Record<MediaPlatform, RegExp> = {
    xiaohongshu: /(^|\.)xiaohongshu\.com$/i,
    douyin: /(^|\.)douyin\.com$/i,
    kuaishou: /(^|\.)kuaishou\.com$/i,
    'wechat-channels': /(^|\.)weixin\.qq\.com$/i,
    'wechat-official': /(^|\.)weixin\.qq\.com$|(^|\.)qq\.com$/i,
    zhihu: /(^|\.)zhihu\.com$/i,
    bilibili: /(^|\.)bilibili\.com$/i,
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0])
      if (hosts[platform].test(url.hostname)) {
        url.username = ''
        url.password = ''
        url.hash = ''
        const allowedParameters = platform === 'wechat-official'
          ? new Set(['__biz', 'mid', 'idx', 'sn', 'chksm'])
          : platform === 'bilibili' ? new Set(['p']) : new Set<string>()
        for (const key of [...url.searchParams.keys()]) if (!allowedParameters.has(key)) url.searchParams.delete(key)
        return url.toString()
      }
    } catch {
      // Ignore malformed output URLs.
    }
  }
  return ''
}

function lastJsonObject(text: string): Record<string, unknown> | undefined {
  for (const line of [...text.split(/\r?\n/)].reverse()) {
    try {
      const value = JSON.parse(line) as unknown
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // Publisher probes may emit diagnostics before their final JSON record.
    }
  }
  return undefined
}

function parseAccountObservation(platform: MediaPlatform, expectedLabel: string, output: string): AccountObservation {
  const account = lastJsonObject(output)
  if (!account) throw new Error(`账号探针没有返回结构化身份记录: ${output.slice(-800)}`)
  const identity = typeof account.accountIdentity === 'string' ? account.accountIdentity.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error('账号探针无法提供稳定的非敏感身份指纹；为避免发错号，受控发布已停止')
  if (platform === 'wechat-official') {
    const observed = typeof account.account === 'string' ? account.account.trim() : ''
    if (account.ok !== true || account.credentialValid !== true) throw new Error('微信公众号凭据探针未通过')
    if (observed !== expectedLabel) throw new Error(`账号不匹配：预览指定「${expectedLabel}」，配置实际为「${observed || '(unknown)'}」`)
    return {
      label: observed,
      identity,
      author: typeof account.author === 'string' ? account.author.trim().slice(0, 100) : '',
      theme: typeof account.theme === 'string' ? account.theme.trim().slice(0, 100) : '',
    }
  }
  if (account.loggedIn !== true) throw new Error(`账号未登录或发布态不可用: ${output.slice(-800)}`)
  const observed = typeof account.name === 'string' ? account.name.trim() : ''
  if (!observed) throw new Error('账号探针虽显示已登录，但无法读取账号名；为避免发错号，受控发布已停止')
  if (observed !== expectedLabel) throw new Error(`账号不匹配：预览指定「${expectedLabel}」，登录态实际为「${observed}」`)
  return { label: observed, identity, author: '', theme: '' }
}

export class PublisherAdapter {
  constructor(readonly dataDir: string) {}

  async cleanupSensitiveTemporaryFiles(): Promise<void> {
    const dataRoot = await realpath(this.dataDir)
    const preflightRoot = await privateSubdirectory(dataRoot, ['preflight'])
    const biliAttemptRoot = await privateSubdirectory(dataRoot, ['credentials', 'bilibili', 'attempt-cookies'])
    const nowMs = Date.now()
    await cleanupPrefixedSensitiveEntries(preflightRoot, /^run-[A-Za-z0-9_-]+$/, 'directory', nowMs)
    await cleanupPrefixedSensitiveEntries(biliAttemptRoot, /^attempt-[A-Za-z0-9_-]+\.json$/, 'file', nowMs)
  }

  async preflight(draft: Draft, platform: MediaPlatform, accountKey: string, workspaceRoot: string, scheduledAt: string, publisherOptions: Record<string, unknown>, signal?: AbortSignal) {
    if (!isAbsolute(workspaceRoot)) throw new Error('发布预检必须绑定绝对 DSH 工作区')
    const workspace = await realpath(workspaceRoot)
    for (const asset of draft.assets) {
      if (!isAbsolute(asset) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(asset)) throw new Error(`发布素材必须先保存为本地绝对路径: ${asset}`)
      if ((platform === 'xiaohongshu' || platform === 'douyin') && asset.includes(',')) throw new Error(`该平台的素材路径不能包含逗号，请先重命名: ${asset}`)
      const linkInfo = await lstat(asset)
      if (linkInfo.isSymbolicLink()) throw new Error(`发布素材不能是符号链接: ${asset}`)
      const canonical = await realpath(asset)
      const containment = relative(workspace, canonical)
      if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) throw new Error(`发布素材越出当前 DSH 工作区: ${asset}`)
      const info = await lstat(canonical)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`发布素材必须是普通文件: ${asset}`)
    }
    const preflightRoot = await privateSubdirectory(this.dataDir, ['preflight'])
    const temporary = await mkdtemp(join(preflightRoot, 'run-'))
    await chmod(temporary, 0o700)
    const bodyPath = join(temporary, 'body.md')
    await writeFile(bodyPath, draft.body, { encoding: 'utf8', mode: 0o600 })
    await chmod(bodyPath, 0o600)
    const fake: Publication = {
      id: 'preflight',
      draftId: draft.id,
      platform,
      status: 'preview',
      skillName: '',
      idempotencyKey: '',
      confirmationTokenHash: '',
      executionLeaseId: '',
      executionLeaseExpiresAt: '',
      expiresAt: '',
      snapshot: {
        draftId: draft.id,
        draftRevision: draft.revision,
        draftUpdatedAt: draft.updatedAt,
        workspaceRoot: workspace,
        title: draft.title,
        body: draft.body,
        bodyPath,
        bodySha256: sha256(draft.body),
        assets: [...draft.assets],
        assetManifest: [],
        platform,
        accountLabel: accountKey,
        accountIdentity: '0'.repeat(64),
        scheduledAt,
        preflightEvidence: '',
        publisherOptions,
        payloadDigest: '',
      },
      externalUrl: '',
      resultEvidence: '',
      error: '',
      createdAt: '',
      updatedAt: '',
    }
    try {
      const probe = this.accountProbe(platform, accountKey, workspace, publisherOptions)
      const probeResult = await runCommand(probe, signal, 120_000)
      const probeOutput = redact(`${probeResult.stdout}\n${probeResult.stderr}`.trim())
      if (!probeResult.started || probeResult.code !== 0 || probeResult.timedOut || probeResult.aborted) throw new Error(`账号探针未通过（以下为不可信 publisher 诊断）: ${probeOutput.slice(-1_500) || probeResult.error || `exit ${String(probeResult.code)}`}`)
      const observed = parseAccountObservation(platform, accountKey, probeOutput)
      fake.snapshot.accountIdentity = observed.identity
      const effectiveOptions = { ...publisherOptions }
      if (platform === 'wechat-official') {
        const theme = optionString(publisherOptions, 'theme', 100) || observed.theme || 'refined-blue'
        const author = optionString(publisherOptions, 'author', 100) || observed.author || '飞哥'
        effectiveOptions.theme = theme
        effectiveOptions.author = author
        effectiveOptions._themeSha256 = wechatThemeDigest(theme)
      }
      fake.snapshot.publisherOptions = effectiveOptions
      const spec = buildExecutionSpec(fake, this.dataDir)
      const dryRunArgs = spec.args.filter(item => item !== '--exec')
      const result = await runCommand({ ...spec, args: dryRunArgs }, signal, 120_000)
      const output = redact(`${result.stdout}\n${result.stderr}`.trim())
      if (!result.started || result.code !== 0 || result.timedOut || result.aborted) throw new Error(`publisher adapter 只读 dry-run 未通过（以下为不可信 publisher 诊断）: ${output.slice(-1_500) || result.error || `exit ${String(result.code)}`}`)
      const combined = `${probeOutput}\n${output}`
      return {
        expectedDraftRevision: draft.revision,
        workspaceRoot: workspace,
        accountLabel: observed.label,
        accountIdentity: observed.identity,
        publisherOptions: effectiveOptions,
        evidence: `Host account probe and argv dry-run passed; commandDigest=${sha256(JSON.stringify([spec.command, dryRunArgs]))}; outputDigest=${sha256(combined)}; account=${accountKey}; accountIdentity=${observed.identity}`,
      }
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private accountProbe(platform: MediaPlatform, accountKey: string, workspaceRoot: string, options: Record<string, unknown>): CommandSpec {
    const profile = browserOptions(options, this.dataDir)
    if (platform === 'xiaohongshu') return applyNetworkOptions(python(sharedScript('xhs_publish.py'), ['whoami', ...profile], this.dataDir, workspaceRoot), options)
    if (platform === 'douyin') return applyNetworkOptions(python(sharedScript('douyin_publish.py'), ['whoami', ...profile], this.dataDir, workspaceRoot), options)
    if (platform === 'kuaishou' || platform === 'wechat-channels' || platform === 'zhihu') {
      const target = platform === 'wechat-channels' ? 'weixin-channels' : platform
      return applyNetworkOptions(python(sharedScript('web_publisher.py'), ['whoami', '--platform', target, ...profile], this.dataDir, workspaceRoot), options)
    }
    if (platform === 'bilibili') {
      return applyNetworkOptions(python(sharedScript('bili_login.py'), ['whoami', '--cookie', join(this.dataDir, 'credentials', 'bilibili', 'cookies.json')], this.dataDir, workspaceRoot), options)
    }
    return python(skillScript('skill-wechat-publisher', 'wechat_api.py'), ['--account', accountKey, 'token'], this.dataDir, workspaceRoot)
  }

  async execute(publication: Publication, signal?: AbortSignal): Promise<AdapterResult> {
    const expected = publication.snapshot
    const probeSpec = this.accountProbe(publication.platform, expected.accountLabel, expected.workspaceRoot, expected.publisherOptions)
    const probeResult = await runCommand(probeSpec, signal, 120_000)
    const probeOutput = redact(`${probeResult.stdout}\n${probeResult.stderr}`.trim())
    let observation: AccountObservation
    try {
      if (!probeResult.started || probeResult.code !== 0 || probeResult.timedOut || probeResult.aborted) {
        throw new Error(`执行前账号探针未通过: ${probeOutput.slice(-1_000) || probeResult.error || `exit ${String(probeResult.code)}`}`)
      }
      observation = parseAccountObservation(publication.platform, expected.accountLabel, probeOutput)
      if (observation.identity !== expected.accountIdentity) throw new Error('执行前账号身份已变化；为避免发错号，publisher 未启动')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const outputDigest = sha256(probeOutput)
      return {
        started: false,
        code: null,
        signal: null,
        stdout: '',
        stderr: probeOutput,
        timedOut: probeResult.timedOut,
        aborted: probeResult.aborted,
        error: message,
        commandDigest: sha256(JSON.stringify([probeSpec.command, probeSpec.args])),
        outputDigest,
        externalUrl: '',
        outcome: 'uncertain',
        evidence: `host-account-recheck; publisherStarted=false; outputDigest=${outputDigest}; error=${redact(message)}`,
      }
    }
    await this.verifyFrozenPayload(publication)
    const spec = buildExecutionSpec(publication, this.dataDir)
    const result = await runCommand(spec, signal)
    const output = redact(`${result.stdout}\n${result.stderr}`.trim())
    const commandDigest = sha256(JSON.stringify([spec.command, spec.args]))
    const outputDigest = sha256(output)
    const externalUrl = allowedUrl(publication.platform, output)
    const successful = result.started && result.code === 0 && !result.timedOut && !result.aborted
    const outcome: AdapterResult['outcome'] = !successful
      ? 'uncertain'
      : publication.platform === 'wechat-official' && /(?:草稿\s*media_id|"media_id"\s*:)/i.test(output)
        ? 'draft_created'
        : publication.platform === 'bilibili' && publication.snapshot.scheduledAt
          ? 'scheduled'
          : 'submitted'
    return {
      ...result,
      commandDigest,
      outputDigest,
      externalUrl,
      outcome,
      evidence: `host-adapter; attemptId=${publication.id}; idempotencyKey=${publication.idempotencyKey}; accountIdentity=${observation.identity}; exit=${String(result.code)}; outcome=${outcome}; commandDigest=${commandDigest}; outputDigest=${outputDigest}${externalUrl ? `; url=${externalUrl}` : ''}`,
    }
  }

  private async verifyFrozenPayload(publication: Publication): Promise<void> {
    const dataRoot = await realpath(this.dataDir)
    const stagingRoot = join(dataRoot, 'staging')
    const stagingInfo = await lstat(stagingRoot)
    if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory() || await realpath(stagingRoot) !== stagingRoot) {
      throw new Error('执行前 staging 根目录不安全，publisher 未启动')
    }
    const stageRoot = join(stagingRoot, publication.id)
    const stageInfo = await lstat(stageRoot)
    if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory() || await realpath(stageRoot) !== stageRoot) {
      throw new Error('执行前发布 staging 目录不安全，publisher 未启动')
    }
    const staged = (path: string): boolean => {
      const containment = relative(stageRoot, path)
      return containment !== '' && !containment.startsWith('..') && !isAbsolute(containment)
    }
    const body = publication.snapshot.bodyPath
    if (body !== join(stageRoot, 'body.md') || !staged(body)) throw new Error('执行前冻结正文路径不属于发布 staging')
    const bodyInfo = await lstat(body)
    if (!bodyInfo.isFile() || bodyInfo.isSymbolicLink() || await sha256File(body) !== publication.snapshot.bodySha256) throw new Error('执行前冻结正文校验失败，publisher 未启动')
    for (const asset of publication.snapshot.assetManifest) {
      if (!staged(asset.frozenPath)) throw new Error('执行前冻结素材路径不属于发布 staging')
      const info = await lstat(asset.frozenPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.sizeBytes || await sha256File(asset.frozenPath) !== asset.sha256) {
        throw new Error(`执行前冻结素材校验失败: ${asset.source}，publisher 未启动`)
      }
    }
  }
}
