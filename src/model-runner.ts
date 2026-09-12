import { constants, createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { BUNDLED_SKILLS_ROOT } from './skills.ts'
import { runCommand } from './adapter.ts'
import { assertModelEndpointNetworkPolicy, type ModelConfigStore, type ModelGroupId } from './model-config.ts'

export const MODEL_SCRIPT_IDS = ['ai-image', 'ai-video', 'ai-music', 'voice-clone'] as const
export type ModelScriptId = typeof MODEL_SCRIPT_IDS[number]

type PathKind = 'image-input' | 'audio-input' | 'output' | 'public-url'

interface NumericLimit {
  min: number
  max: number
  integer?: boolean
}

interface CommandPolicy {
  valueFlags: readonly string[]
  booleanFlags?: readonly string[]
  pathFlags?: Readonly<Record<string, PathKind>>
  numericFlags?: Readonly<Record<string, NumericLimit>>
  enumFlags?: Readonly<Record<string, readonly string[]>>
}

interface ScriptPolicy {
  group: ModelGroupId
  filename: string
  commands: Readonly<Record<string, CommandPolicy>>
}

const IMAGE_OUTPUT = { '--output': 'output', '-o': 'output' } as const
const IMAGE_COMMON = ['--prompt', '--quality', '--output', '-o', '--n', '--size', '--mode', '--resolution', '--format', '--poll-interval', '--timeout'] as const
const IMAGE_NUMERIC = {
  '--n': { min: 1, max: 8, integer: true },
  '--poll-interval': { min: 1, max: 60, integer: true },
  '--timeout': { min: 10, max: 1_800, integer: true },
} as const
const IMAGE_ENUMS = {
  '--quality': ['auto', 'low', 'medium', 'high', 'standard', 'hd'],
  '--size': [
    'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21',
    '1024x1024', '2048x2048', '1536x1024', '2048x1360', '1024x1536', '1360x2048',
    '1024x768', '2048x1536', '768x1024', '1536x2048', '1280x1024', '2560x2048',
    '1024x1280', '2048x2560', '1536x864', '2048x1152', '3840x2160', '864x1536',
    '1152x2048', '2160x3840', '2048x1024', '2688x1344', '3840x1920', '1024x2048',
    '1344x2688', '1920x3840', '2016x864', '2688x1152', '3840x1648', '864x2016',
    '1152x2688', '1648x3840',
  ],
  '--mode': ['sync', 'async'],
  '--resolution': ['1k', '2k', '4k'],
  '--format': ['png', 'jpeg', 'webp'],
} as const
const ASYNC_NUMERIC = {
  '--poll-interval': { min: 1, max: 60, integer: true },
  '--timeout': { min: 10, max: 1_800, integer: true },
} as const

export const MODEL_SCRIPT_POLICIES: Readonly<Record<ModelScriptId, ScriptPolicy>> = {
  'ai-image': {
    group: 'image',
    filename: 'ai_image.py',
    commands: {
      text2img: { valueFlags: IMAGE_COMMON, pathFlags: IMAGE_OUTPUT, numericFlags: IMAGE_NUMERIC, enumFlags: IMAGE_ENUMS },
      img2img: {
        valueFlags: [...IMAGE_COMMON, '--image', '--mask'],
        pathFlags: { ...IMAGE_OUTPUT, '--image': 'image-input', '--mask': 'image-input' },
        numericFlags: IMAGE_NUMERIC,
        enumFlags: IMAGE_ENUMS,
      },
      variations: {
        valueFlags: [...IMAGE_COMMON, '--image'],
        pathFlags: { ...IMAGE_OUTPUT, '--image': 'image-input' },
        numericFlags: IMAGE_NUMERIC,
        enumFlags: IMAGE_ENUMS,
      },
      check: { valueFlags: [] },
    },
  },
  'ai-video': {
    group: 'video',
    filename: 'ai_video.py',
    commands: {
      text2video: {
        valueFlags: ['--provider', '--prompt', '--duration', '--ratio', '--audio', '--output', '-o', '--poll-interval', '--timeout'],
        pathFlags: { '--output': 'output', '-o': 'output' },
        numericFlags: { '--duration': { min: 1, max: 60, integer: true }, ...ASYNC_NUMERIC },
        enumFlags: { '--ratio': ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], '--audio': ['auto', 'on', 'off'] },
      },
      image2video: {
        valueFlags: ['--provider', '--prompt', '--duration', '--ratio', '--audio', '--output', '-o', '--poll-interval', '--timeout', '--image'],
        pathFlags: { '--output': 'output', '-o': 'output', '--image': 'image-input' },
        numericFlags: { '--duration': { min: 1, max: 60, integer: true }, ...ASYNC_NUMERIC },
        enumFlags: { '--ratio': ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'], '--audio': ['auto', 'on', 'off'] },
      },
      check: { valueFlags: ['--provider'] },
      capabilities: { valueFlags: ['--provider'] },
    },
  },
  'ai-music': {
    group: 'music',
    filename: 'ai_music.py',
    commands: {
      check: { valueFlags: ['--provider'] },
      generate: {
        valueFlags: ['--provider', '--prompt', '--lyrics', '--duration', '--output', '-o', '--poll-interval', '--timeout'],
        booleanFlags: ['--instrumental'],
        pathFlags: { '--output': 'output', '-o': 'output' },
        numericFlags: { '--duration': { min: 1, max: 900, integer: true }, ...ASYNC_NUMERIC },
      },
    },
  },
  'voice-clone': {
    group: 'voice',
    filename: 'voice_clone.py',
    commands: {
      check: { valueFlags: ['--provider'] },
      enroll: {
        valueFlags: ['--provider', '--sample', '--sample-url', '--name'],
        pathFlags: { '--sample': 'audio-input', '--sample-url': 'public-url' },
      },
      clone: {
        valueFlags: ['--provider', '--text', '--voice-id', '--emotion', '--sample', '--sample-text', '--speed', '--output', '-o'],
        pathFlags: { '--sample': 'audio-input', '--output': 'output', '-o': 'output' },
        numericFlags: { '--speed': { min: 0.5, max: 2 } },
      },
    },
  },
}

const MAX_ARGS = 64
const MAX_ARG_CHARS = 65_536
const MAX_TOTAL_ARG_CHARS = 256_000
const MAX_RESULT_CHARS = 64_000
const MAX_IMAGE_INPUT_BYTES = 64 * 1024 * 1024
const MAX_AUDIO_INPUT_BYTES = 64 * 1024 * 1024
const MODEL_TEMP_MAX_AGE_MS = 2 * 60 * 60_000
const COPY_CHUNK_BYTES = 64 * 1024
const PART_FILE_NAME = /^\.dsh-mediaops-[A-Za-z0-9._-]+\.part(?:\.[A-Za-z0-9]{1,16})?$/u

function containment(root: string, target: string): boolean {
  const value = relative(root, target)
  return value !== '' && !value.startsWith('..') && !isAbsolute(value)
}

async function optionalLstat(path: string) {
  return lstat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
}

async function ensureExactDirectory(parent: string, name: string, mode = 0o700): Promise<string> {
  if (!name || name === '.' || name === '..' || name.includes(sep)) throw new Error('安全目录名称无效')
  const target = join(parent, name)
  let info = await optionalLstat(target)
  if (!info) {
    await mkdir(target, { mode }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    info = await lstat(target)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`安全目录不能是符号链接或非目录: ${target}`)
  if (await realpath(target) !== target) throw new Error(`安全目录 realpath 不匹配: ${target}`)
  await chmod(target, mode)
  return target
}

async function ensureOutputRoot(workspace: string): Promise<string> {
  const expected = join(workspace, 'outputs')
  let info = await optionalLstat(expected)
  if (!info) {
    await mkdir(expected, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    info = await lstat(expected)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('workspace outputs 必须是真实目录，不能是符号链接或非目录')
  }
  const canonical = await realpath(expected)
  if (canonical !== expected) throw new Error('workspace outputs 的 realpath 必须精确位于真实 workspace 下')
  return canonical
}

function extensionlessOutput(raw: string): boolean {
  // Match pathlib.Path.suffix used by ai_image.py: leading-only and trailing
  // dots do not make a file suffix (".hidden" and "image." are directories).
  const name = basename(raw)
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1
}

async function verifyOutputPath(
  workspace: string,
  raw: string,
  createParents: boolean,
  allowExtensionlessDirectory = false,
): Promise<string> {
  if (/\p{Cc}/u.test(raw)) throw new Error('模型输出路径不能包含控制字符')
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw)) throw new Error('模型输出必须是当前 workspace 内的本地路径')
  const outputRoot = await ensureOutputRoot(workspace)
  const requested = isAbsolute(raw) ? resolve(raw) : resolve(workspace, raw)
  if (!containment(outputRoot, requested)) throw new Error('模型输出必须位于当前 workspace 的 outputs/ 子目录')

  const parentRelative = relative(outputRoot, dirname(requested))
  const segments = parentRelative === '' ? [] : parentRelative.split(sep)
  let current = outputRoot
  for (const segment of segments) {
    const next = join(current, segment)
    let info = await optionalLstat(next)
    if (!info && createParents) {
      await mkdir(next, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      info = await lstat(next)
    }
    if (!info) throw new Error('模型输出父目录在执行前消失')
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(next) !== next) {
      throw new Error('模型输出路径不能经过符号链接或非目录条目')
    }
    current = next
  }
  const directoryOutput = allowExtensionlessDirectory && extensionlessOutput(requested)
  let target = await optionalLstat(requested)
  if (!target && directoryOutput && createParents) {
    await mkdir(requested, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    target = await lstat(requested)
  }
  if (directoryOutput) {
    if (!target) throw new Error('模型输出目录在执行前消失')
    if (target.isSymbolicLink() || !target.isDirectory() || await realpath(requested) !== requested) {
      throw new Error('ai-image 无扩展名输出必须是真实目录，不能是符号链接')
    }
  } else if (target && (target.isSymbolicLink() || !target.isFile())) {
    throw new Error('模型输出目标必须是普通文件且不能是符号链接')
  }
  // Recheck the root after all child operations. This closes replacement races
  // before the script starts and proves join(real workspace, "outputs") exactly.
  const rootInfo = await lstat(outputRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(outputRoot) !== join(workspace, 'outputs')) {
    throw new Error('workspace outputs 在执行前发生变化')
  }
  return requested
}

async function safeInputPath(workspace: string, raw: string, maxBytes: number): Promise<string> {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw)) throw new Error('模型输入路径不能包含控制字符')
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw)) throw new Error('模型输入必须先保存为当前 workspace 内的本地文件')
  const requested = isAbsolute(raw) ? raw : resolve(workspace, raw)
  const direct = await lstat(requested)
  if (direct.isSymbolicLink() || !direct.isFile()) throw new Error(`模型输入必须是普通文件且不能是符号链接: ${raw}`)
  if (direct.size <= 0 || direct.size > maxBytes) {
    throw new Error(`模型输入文件必须为 1..${maxBytes} 字节: ${raw}`)
  }
  const canonical = await realpath(requested)
  if (!containment(workspace, canonical)) throw new Error(`模型输入越出当前 workspace: ${raw}`)
  return canonical
}

async function safeOutputPath(workspace: string, raw: string, allowExtensionlessDirectory: boolean): Promise<string> {
  return verifyOutputPath(workspace, raw, true, allowExtensionlessDirectory)
}

async function safePublicUrl(raw: string): Promise<string> {
  // A sample URL is fetched by the remote provider, not by the Host, but keep
  // local/private targets out of generated requests and approval records.
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('远程样本必须是有效 URL') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('远程样本必须是不含凭据的 HTTPS URL')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') throw new Error('远程样本不能指向本机地址')
  await assertModelEndpointNetworkPolicy(`${url.protocol}//${url.host}`, false)
  return url.toString()
}

async function validateArgs(policy: ScriptPolicy, argv: readonly string[], workspace: string, selectedProvider: string): Promise<string[]> {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGS) throw new Error(`argv 必须包含 1..${MAX_ARGS} 项`)
  if (argv.some(item => typeof item !== 'string' || item.includes('\0') || item.length > MAX_ARG_CHARS)) throw new Error('argv 含无效或过长参数')
  if (argv.reduce((sum, item) => sum + item.length, 0) > MAX_TOTAL_ARG_CHARS) throw new Error('argv 总长度超过安全上限')
  const command = argv[0]
  if (!command || command.startsWith('-')) throw new Error('argv 第一项必须是允许的脚本子命令')
  const commandPolicy = policy.commands[command]
  if (!commandPolicy) throw new Error(`不允许执行模型脚本子命令: ${command}`)
  if (argv.includes('--model')) throw new Error('Host 受控运行不允许用 --model 覆盖已配置模型')
  const valueFlags = new Set(commandPolicy.valueFlags)
  const booleanFlags = new Set(commandPolicy.booleanFlags ?? [])
  const seen = new Set<string>()
  const normalized = [command]
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag || flag.includes('=') || (!valueFlags.has(flag) && !booleanFlags.has(flag))) {
      throw new Error(`不允许的模型脚本参数: ${flag || '(empty)'}`)
    }
    const canonicalFlag = flag === '-o' ? '--output' : flag
    if (seen.has(canonicalFlag)) throw new Error(`模型脚本参数不能重复: ${canonicalFlag}`)
    seen.add(canonicalFlag)
    if (booleanFlags.has(flag)) {
      normalized.push(flag)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`模型脚本参数缺少值: ${flag}`)
    index += 1
    let safeValue = value
    const pathKind = commandPolicy.pathFlags?.[flag]
    if (pathKind === 'image-input') safeValue = await safeInputPath(workspace, value, MAX_IMAGE_INPUT_BYTES)
    else if (pathKind === 'audio-input') safeValue = await safeInputPath(workspace, value, MAX_AUDIO_INPUT_BYTES)
    else if (pathKind === 'output') safeValue = await safeOutputPath(workspace, value, policy.group === 'image')
    else if (pathKind === 'public-url') safeValue = await safePublicUrl(value)
    const numeric = commandPolicy.numericFlags?.[flag]
    if (numeric) {
      const parsed = Number(safeValue)
      if (!Number.isFinite(parsed) || numeric.integer && !Number.isInteger(parsed)
        || parsed < numeric.min || parsed > numeric.max) {
        throw new Error(`${flag} 必须在 ${numeric.min}..${numeric.max} 范围内${numeric.integer ? '且为整数' : ''}`)
      }
      safeValue = String(parsed)
    }
    const choices = commandPolicy.enumFlags?.[flag]
    if (choices && !choices.includes(safeValue)) throw new Error(`${flag} 不是 Host 允许的规格`)
    if (flag === '--provider' && safeValue !== selectedProvider) {
      throw new Error(`本次运行只允许已选中的 provider ${selectedProvider}`)
    }
    normalized.push(flag, safeValue)
  }
  if (Object.values(commandPolicy.pathFlags ?? {}).includes('output') && !seen.has('--output')) {
    throw new Error('Host 受控生成必须显式提供 --output，并位于 workspace outputs/ 下')
  }
  return normalized
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => digest.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolvePromise)
  })
  return digest.digest('hex')
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sortedEnvironment(env: NodeJS.ProcessEnv): [string, string][] {
  return Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
}

function endpointEnvironment(env: NodeJS.ProcessEnv): [string, string][] {
  return sortedEnvironment(env).filter(([key, value]) => /(?:BASE|URL)/u.test(key) || /^https?:\/\//iu.test(value))
}

function parsedArguments(policy: CommandPolicy, argv: readonly string[]): { values: Map<string, string>; booleans: Set<string> } {
  const values = new Map<string, string>()
  const booleans = new Set<string>()
  const booleanFlags = new Set(policy.booleanFlags ?? [])
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index] as string
    if (booleanFlags.has(flag)) {
      booleans.add(flag)
      continue
    }
    const value = argv[index + 1]
    if (value !== undefined) values.set(flag === '-o' ? '--output' : flag, value)
    index += 1
  }
  return { values, booleans }
}

function effectiveModel(group: ModelGroupId, provider: string, command: string, env: NodeJS.ProcessEnv): string {
  if (group === 'image') return env.IMG_MODEL || '(missing)'
  if (group === 'video') {
    if (provider === 'dashscope') return env.DASHSCOPE_VIDEO_MODEL || 'wan2.1-t2v-turbo'
    if (provider === 'ark') return env.ARK_MODEL || 'doubao-seedance-1-0-lite-t2v'
    if (provider === 'kling') return env.KLING_MODEL || 'kling-v1'
    if (provider === 'openai-compatible') return env.VIDEO_MODEL || 'sora-1'
    if (provider === 'xhs-maas') return command === 'image2video'
      ? env.XHS_MAAS_I2V_MODEL || 'happyhorse-1.0-i2v'
      : env.XHS_MAAS_T2V_MODEL || 'happyhorse-1.0-t2v'
    if (provider === 'agnes') return env.AGNES_MODEL || 'agnes-video-2.5-flash'
  }
  if (group === 'music') return provider === 'dashscope'
    ? env.DASHSCOPE_MUSIC_MODEL || 'audio-generation'
    : env.MUSIC_MODEL || 'music-1'
  if (provider === 'dashscope') return command === 'enroll' ? 'voice-enrollment' : env.DASHSCOPE_TTS_MODEL || 'cosyvoice-v2'
  if (provider === 'minimax') return command === 'enroll' ? 'voice-clone' : env.MINIMAX_MODEL || 'speech-01'
  if (provider === 'fish-audio') return 'fish-audio reference/tts'
  if (provider === 'openai-compatible') return env.VOICE_MODEL || 'tts-1'
  if (provider === 'gemini') return env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
  return 'provider-default'
}

export interface ModelRunApprovalInput {
  argument: '--image' | '--mask' | '--sample'
  basename: string
  bytes: number
  sha256: string
}

export interface ModelRunApprovalSummary {
  script: ModelScriptId
  operation: string
  provider: string
  model: string
  specifications: Record<string, string | number | boolean>
  inputs: ModelRunApprovalInput[]
  remoteSampleHost?: string
  uploadsVoiceSample: boolean
  requiresVoiceAuthorization: boolean
}

function approvalSpecifications(
  group: ModelGroupId,
  operation: string,
  args: { values: Map<string, string>; booleans: Set<string> },
): Record<string, string | number | boolean> {
  const value = (flag: string) => args.values.get(flag)
  if (group === 'image') return {
    n: Number(value('--n') ?? 1),
    quality: value('--quality') ?? 'provider-default',
    size: value('--size') ?? '1024x1024',
    resolution: value('--resolution') ?? '2k',
    mode: value('--mode') ?? 'auto',
    output: basename(value('--output') ?? '(none)'),
  }
  if (group === 'video') return {
    durationSeconds: value('--duration') ? Number(value('--duration')) : 'provider-default',
    ratio: value('--ratio') ?? 'provider-default',
    audio: value('--audio') ?? 'auto',
    output: basename(value('--output') ?? '(none)'),
  }
  if (group === 'music') return {
    durationSeconds: value('--duration') ? Number(value('--duration')) : 'provider-default',
    instrumental: args.booleans.has('--instrumental'),
    output: basename(value('--output') ?? '(none)'),
  }
  return {
    speed: value('--speed') ? Number(value('--speed')) : 1,
    output: operation === 'clone' ? basename(value('--output') ?? '(none)') : '(voice-id)',
  }
}

export function buildModelRunApprovalReason(summary: ModelRunApprovalSummary): string {
  const specifications = Object.entries(summary.specifications).map(([key, value]) => `${key}=${String(value)}`).join('、')
  const inputs = summary.inputs.length > 0
    ? summary.inputs.map(input => `${input.argument} ${input.basename} (${input.bytes} bytes, sha256=${input.sha256})`).join('\n')
    : '无本地输入文件'
  const remote = summary.remoteSampleHost ? `\n远程声音样本主机：${summary.remoteSampleHost}（不显示 URL 路径/query）` : ''
  const voice = summary.requiresVoiceAuthorization
    ? '\n重要：本操作会上传声音样本并创建可复用音色。仅在你拥有该声音权利，或已获得被采集者明确授权时批准。'
    : summary.uploadsVoiceSample ? '\n本次会向 provider 上传/内联参考声音样本，请确认你具有使用权。' : ''
  return `DSH-MediaOps 将调用外部多模态模型，可能创建远程任务并产生费用。\nProvider：${summary.provider}\n实际模型：${summary.model}\n操作：${summary.script} / ${summary.operation}\n规格：${specifications}\n输入：\n${inputs}${remote}${voice}\nPrompt 和 API Key 不会出现在审批摘要中。`
}

function runtimeEnvironment(dataDir: string, workspace: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    DSH_MEDIAOPS_DATA_DIR: dataDir,
    DSH_MEDIAOPS_WORKSPACE: workspace,
    DSH_MEDIAOPS_MANAGED_MODEL_CONFIG: '1',
    EASEL_ROOT: workspace,
    PYTHONUNBUFFERED: '1',
  }
  // Deliberate runtime allowlist. Values outside it cannot enter the child.
  for (const key of [
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

function stripHttpUrlSecrets(raw: string): string {
  let candidate = raw
  let trailing = ''
  while (/[),.;\]}]$/u.test(candidate)) {
    trailing = `${candidate.slice(-1)}${trailing}`
    candidate = candidate.slice(0, -1)
  }
  try {
    const url = new URL(candidate)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.toString()}${trailing}`
  } catch {
    return `[REDACTED URL]${trailing}`
  }
}

export function redactModelOutput(text: string, secrets: readonly string[]): string {
  let result = text
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret) result = result.split(secret).join('[REDACTED]')
  }
  return result
    .replace(/https?:\/\/[^\s<>"'`]+/giu, stripHttpUrlSecrets)
    .split(/\r?\n/u)
    .map(line => /(?:API[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?KEY|ACCESSKEYID|SECRETACCESSKEY|SESSIONTOKEN|SECURITY[_-]?TOKEN|TOKEN|PASSWORD|CREDENTIAL|SIGNATURE|PRIVATE[_-]?KEY|SIGNED[_-]?URL|\bPOLICY\b)/iu.test(line)
      ? `${line.match(/[A-Za-z][A-Za-z0-9_-]*(?:KEY|TOKEN|PASSWORD|CREDENTIAL|SIGNATURE|POLICY|URL)[A-Za-z0-9_-]*/iu)?.[0] ?? 'SECRET'}: [REDACTED]`
      : line)
    .join('\n')
    .replace(/(https?:\/\/)[^@\s/:]+:[^@\s]+@/giu, '$1[REDACTED]@')
    .replace(/("(?:access[_-]?token|secret|api[_-]?key|authorization)"\s*:\s*")[^"]+/giu, '$1[REDACTED]')
    .replace(/((?:access[_-]?token|secret|api[_-]?key|authorization)\s*(?:[=:]\s*|\s+))[^\s&"']+/giu, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .slice(0, MAX_RESULT_CHARS)
}

export interface ModelRunResult {
  ok: boolean
  script: ModelScriptId
  provider: string
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

interface ModelExecutionProjection {
  providerId: string
  env: NodeJS.ProcessEnv
  secrets: string[]
  allowPrivateNetwork: boolean
}

interface BuiltRunPlan {
  scriptId: ModelScriptId
  policy: ScriptPolicy
  operation: string
  workspace: string
  args: string[]
  projection: ModelExecutionProjection
  executionEnv: NodeJS.ProcessEnv
  pythonCommand: string
  runId: string
  hasOutput: boolean
  summary: ModelRunApprovalSummary
  argumentFingerprint: string
  inputFingerprint: string
  endpointFingerprint: string
  environmentFingerprint: string
  executableFingerprint: string
}

interface PreparedRun {
  scriptId: ModelScriptId
  operation: string
  workspace: string
  provider: string
  model: string
  allowPrivateNetwork: boolean
  argumentFingerprint: string
  inputFingerprint: string
  endpointFingerprint: string
  environmentFingerprint: string
  executableFingerprint: string
  runId: string
  summary: ModelRunApprovalSummary
}

interface PendingModelRunRecord {
  version: 2
  runId: string
  workspace: string
  workspaceDev: string
  workspaceIno: string
  outputsDev: string
  outputsIno: string
  ownerPid: number
  ownerStartToken: string
  ownerStartTokenVerified: boolean
  createdAt: string
}

function parsePendingRunRecord(raw: string, expectedRunId: string): PendingModelRunRecord {
  if (Buffer.byteLength(raw) > 8 * 1024) throw new Error('模型 pending run 记录过大')
  const value = JSON.parse(raw) as Partial<PendingModelRunRecord>
  const decimal = (item: unknown) => typeof item === 'string' && /^(?:0|[1-9][0-9]{0,31})$/u.test(item)
  if (value.version !== 2 || value.runId !== expectedRunId
    || typeof value.workspace !== 'string' || !isAbsolute(value.workspace) || value.workspace.length > 4_096
    || !decimal(value.workspaceDev) || !decimal(value.workspaceIno)
    || !decimal(value.outputsDev) || !decimal(value.outputsIno)
    || !Number.isSafeInteger(value.ownerPid) || (value.ownerPid ?? 0) <= 0
    || typeof value.ownerStartToken !== 'string' || !/^[0-9a-f]{64}$/u.test(value.ownerStartToken)
    || typeof value.ownerStartTokenVerified !== 'boolean'
    || typeof value.createdAt !== 'string') {
    throw new Error('模型 pending run 记录格式无效')
  }
  return value as PendingModelRunRecord
}

function hashProcessStartToken(platform: string, ...parts: string[]): string {
  const digest = createHash('sha256')
  digest.update(platform)
  for (const part of parts) digest.update('\0').update(part)
  return digest.digest('hex')
}

async function processStartToken(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  if (process.platform === 'linux') {
    try {
      const [stat, bootId] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      ])
      // The command name is parenthesized and may itself contain spaces or `)`.
      // Fields after the last `)` begin at field 3; index 19 is field 22,
      // process start time in clock ticks since this boot.
      const commandEnd = stat.lastIndexOf(')')
      if (commandEnd < 0) return undefined
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u)
      const startTime = fields[19]
      const boot = bootId.trim()
      if (!startTime || !/^[0-9]+$/u.test(startTime) || !/^[0-9a-f-]{16,64}$/iu.test(boot)) return undefined
      return hashProcessStartToken('linux', boot.toLowerCase(), startTime)
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    const started = await new Promise<string | undefined>(resolvePromise => {
      try {
        execFile('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
          timeout: 5_000,
          maxBuffer: 16 * 1024,
        }, (error, stdout) => {
          const value = typeof stdout === 'string' ? stdout.trim() : ''
          resolvePromise(error || !value ? undefined : value)
        })
      } catch {
        resolvePromise(undefined)
      }
    })
    // LC_ALL=C makes this stable English process-table data. Hash the raw
    // normalized value instead of parsing it in the Host's current timezone;
    // a timezone setting change must not make a live owner look stale.
    return started ? hashProcessStartToken('darwin', started.replace(/\s+/gu, ' ')) : undefined
  }
  return undefined
}

type PendingOwnerState = 'alive' | 'stale' | 'unknown'

async function pendingOwnerState(record: PendingModelRunRecord): Promise<PendingOwnerState> {
  const observed = await processStartToken(record.ownerPid)
  if (record.ownerStartTokenVerified && observed) {
    return observed === record.ownerStartToken ? 'alive' : 'stale'
  }
  try {
    process.kill(record.ownerPid, 0)
    // The PID exists but its start identity could not be read. Failing closed
    // avoids deleting a live Host's run on permission or transient ps errors.
    return 'unknown'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'stale' : 'unknown'
  }
}

async function optionalBigIntLstat(path: string) {
  return lstat(path, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
}

async function secureRemoveTree(root: string, target: string): Promise<void> {
  if (target !== root && !containment(root, target)) throw new Error('拒绝清理安全根目录之外的路径')
  const info = await optionalLstat(target)
  if (!info) return
  if (info.isSymbolicLink() || !info.isDirectory()) {
    await rm(target, { force: true })
    return
  }
  if (await realpath(target) !== target) throw new Error('拒绝递归清理 realpath 不一致的目录')
  for (const entry of await readdir(target)) await secureRemoveTree(root, join(target, entry))
  if (target !== root) await rmdir(target)
}

function isRunPartFile(name: string, runId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(runId)
    && name.startsWith(`.dsh-mediaops-${runId}-`)
    && PART_FILE_NAME.test(name)
}

function isProtectedRunPartFile(name: string, protectedRunIds: ReadonlySet<string>): boolean {
  for (const runId of protectedRunIds) {
    if (isRunPartFile(name, runId)) return true
  }
  return false
}

async function cleanPartFiles(
  root: string,
  nowMs: number,
  runId?: string,
  protectedRunIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(root) !== root) {
    throw new Error('拒绝扫描不安全的 outputs 根目录')
  }
  const visit = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      if (!containment(root, path)) throw new Error('outputs 清理路径越界')
      const info = await optionalLstat(path)
      if (!info || info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        if (await realpath(path) !== path) continue
        await visit(path)
      } else if (info.isFile() && (runId ? isRunPartFile(name, runId)
        : PART_FILE_NAME.test(name) && nowMs - info.mtimeMs >= MODEL_TEMP_MAX_AGE_MS
          && !isProtectedRunPartFile(name, protectedRunIds))) {
        await rm(path, { force: true })
      }
    }
  }
  await visit(root)
}

export class ModelScriptRunner {
  private readonly approved = new WeakMap<object, PreparedRun>()
  private readonly activeStaging = new Set<string>()
  private readonly activePendingRuns = new Set<string>()
  private readonly knownWorkspaces = new Set<string>()
  private janitorTail: Promise<void> = Promise.resolve()
  private ownerIdentityPromise: Promise<{ startToken: string; verified: boolean }> | undefined

  constructor(readonly config: ModelConfigStore, readonly dataDir: string) {}

  private ownerIdentity(): Promise<{ startToken: string; verified: boolean }> {
    this.ownerIdentityPromise ??= (async () => {
      const startToken = await processStartToken(process.pid)
      if (startToken) return { startToken, verified: true }
      // Some sandboxes deny process-table inspection. The opaque per-runner
      // identity still permits its finally block to recover its own record;
      // foreign janitors then require ESRCH and never infer staleness from it.
      return { startToken: hashProcessStartToken('opaque', randomUUID(), String(process.pid)), verified: false }
    })()
    return this.ownerIdentityPromise
  }

  private async buildPlan(
    scriptId: ModelScriptId,
    argv: readonly string[],
    workspaceRoot: string,
    runId: string = randomUUID(),
  ): Promise<BuiltRunPlan> {
    const policy = MODEL_SCRIPT_POLICIES[scriptId]
    if (!policy) throw new Error(`不允许的模型脚本: ${String(scriptId)}`)
    if (!isAbsolute(workspaceRoot)) throw new Error('模型脚本必须绑定 DSH 会话的绝对 workspace')
    const workspace = await realpath(workspaceRoot)
    this.knownWorkspaces.add(workspace)
    const projection = await this.config.executionEnvironment(policy.group)
    const safeArgs = await validateArgs(policy, argv, workspace, projection.providerId)
    const command = safeArgs[0] as string
    const commandPolicy = policy.commands[command] as CommandPolicy
    const parsed = parsedArguments(commandPolicy, safeArgs)
    const inputs: ModelRunApprovalInput[] = []
    for (const [argument, path] of parsed.values) {
      const kind = commandPolicy.pathFlags?.[argument]
      if (kind !== 'image-input' && kind !== 'audio-input') continue
      const info = await lstat(path)
      inputs.push({
        argument: argument as ModelRunApprovalInput['argument'],
        basename: basename(path),
        bytes: info.size,
        sha256: await sha256File(path),
      })
    }
    const remoteSample = parsed.values.get('--sample-url')
    const uploadsVoiceSample = policy.group === 'voice' && Boolean(parsed.values.get('--sample') || remoteSample)
    const modelName = effectiveModel(policy.group, projection.providerId, command, projection.env)
    const summary: ModelRunApprovalSummary = {
      script: scriptId,
      operation: command,
      provider: projection.providerId,
      model: modelName,
      specifications: approvalSpecifications(policy.group, command, parsed),
      inputs,
      ...(remoteSample ? { remoteSampleHost: new URL(remoteSample).hostname } : {}),
      uploadsVoiceSample,
      requiresVoiceAuthorization: policy.group === 'voice' && command === 'enroll',
    }
    const outputIdentityEnv: NodeJS.ProcessEnv = {}
    const hasOutput = [...parsed.values].some(([flag]) => commandPolicy.pathFlags?.[flag] === 'output')
    if (hasOutput) {
      const outputs = await ensureOutputRoot(workspace)
      const [workspaceInfo, outputsInfo] = await Promise.all([
        lstat(workspace, { bigint: true }),
        lstat(outputs, { bigint: true }),
      ])
      if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()
        || outputsInfo.isSymbolicLink() || !outputsInfo.isDirectory()) {
        throw new Error('模型输出 workspace/outputs 身份无效')
      }
      outputIdentityEnv.DSH_MEDIAOPS_OUTPUT_WORKSPACE_DEV = String(workspaceInfo.dev)
      outputIdentityEnv.DSH_MEDIAOPS_OUTPUT_WORKSPACE_INO = String(workspaceInfo.ino)
      outputIdentityEnv.DSH_MEDIAOPS_OUTPUTS_DEV = String(outputsInfo.dev)
      outputIdentityEnv.DSH_MEDIAOPS_OUTPUTS_INO = String(outputsInfo.ino)
    }
    const executionEnv: NodeJS.ProcessEnv = {
      ...runtimeEnvironment(this.dataDir, workspace),
      ...projection.env,
      ...(projection.allowPrivateNetwork ? { DSH_MEDIAOPS_ALLOW_PRIVATE_NETWORK: '1' } : {}),
      DSH_MEDIAOPS_MODEL_RUN_ID: runId,
      ...outputIdentityEnv,
    }
    const pythonCommand = process.env.DSH_MEDIAOPS_PYTHON?.trim() || 'python3'
    return {
      scriptId,
      policy,
      operation: command,
      workspace,
      args: safeArgs,
      projection,
      executionEnv,
      pythonCommand,
      runId,
      hasOutput,
      summary,
      argumentFingerprint: digestJson(safeArgs),
      inputFingerprint: digestJson(inputs),
      endpointFingerprint: digestJson(endpointEnvironment(projection.env)),
      environmentFingerprint: digestJson(sortedEnvironment(executionEnv)),
      executableFingerprint: digestJson(pythonCommand),
    }
  }

  async approvalSummary(scriptId: ModelScriptId, argv: readonly string[], workspaceRoot: string): Promise<ModelRunApprovalSummary> {
    return (await this.buildPlan(scriptId, argv, workspaceRoot)).summary
  }

  async prepareApproved(exec: object, scriptId: ModelScriptId, argv: readonly string[], workspaceRoot: string): Promise<ModelRunApprovalSummary> {
    if (this.approved.has(exec)) throw new Error('同一模型调用不能重复准备审批')
    const runId = randomUUID()
    const plan = await this.buildPlan(scriptId, argv, workspaceRoot, runId)
    await this.cleanupTemporaryFiles(plan.workspace)
    this.approved.set(exec, {
      scriptId,
      operation: plan.operation,
      workspace: plan.workspace,
      provider: plan.summary.provider,
      model: plan.summary.model,
      allowPrivateNetwork: plan.projection.allowPrivateNetwork,
      argumentFingerprint: plan.argumentFingerprint,
      inputFingerprint: plan.inputFingerprint,
      endpointFingerprint: plan.endpointFingerprint,
      environmentFingerprint: plan.environmentFingerprint,
      executableFingerprint: plan.executableFingerprint,
      runId,
      summary: plan.summary,
    })
    return plan.summary
  }

  private assertPlanMatchesApproval(prepared: PreparedRun, current: BuiltRunPlan): void {
    if (prepared.scriptId !== current.scriptId || prepared.operation !== current.operation
      || prepared.workspace !== current.workspace || prepared.argumentFingerprint !== current.argumentFingerprint) {
      throw new Error('模型调用参数或 workspace 在审批后发生变化，已拒绝执行')
    }
    if (prepared.provider !== current.summary.provider || prepared.model !== current.summary.model) {
      throw new Error('模型 provider 或实际 model 在审批后发生变化，已拒绝执行')
    }
    if (prepared.allowPrivateNetwork !== current.projection.allowPrivateNetwork
      || prepared.endpointFingerprint !== current.endpointFingerprint) {
      throw new Error('模型 endpoint 或私网策略在审批后发生变化，已拒绝执行')
    }
    if (prepared.environmentFingerprint !== current.environmentFingerprint
      || prepared.executableFingerprint !== current.executableFingerprint) {
      throw new Error('模型运行环境配置在审批后发生变化，已拒绝执行')
    }
    if (prepared.inputFingerprint !== current.inputFingerprint) {
      throw new Error('本地模型输入文件在审批后发生变化，已拒绝执行')
    }
  }

  private async stagingRoot(): Promise<string> {
    const dataRoot = await realpath(this.dataDir)
    const info = await lstat(dataRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('模型 staging 数据根目录不安全')
    return ensureExactDirectory(dataRoot, 'model-staging')
  }

  private async pendingRoot(): Promise<string> {
    const dataRoot = await realpath(this.dataDir)
    const info = await lstat(dataRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('模型 pending run 数据根目录不安全')
    return ensureExactDirectory(dataRoot, 'model-pending-runs')
  }

  private async writePendingRun(plan: BuiltRunPlan): Promise<string | undefined> {
    if (!plan.hasOutput) return undefined
    const value = (key: string) => {
      const item = plan.executionEnv[key]
      if (typeof item !== 'string' || !/^[0-9]{1,32}$/u.test(item)) throw new Error(`模型输出身份缺少 ${key}`)
      return item
    }
    const ownerIdentity = await this.ownerIdentity()
    const record: PendingModelRunRecord = {
      version: 2,
      runId: plan.runId,
      workspace: plan.workspace,
      workspaceDev: value('DSH_MEDIAOPS_OUTPUT_WORKSPACE_DEV'),
      workspaceIno: value('DSH_MEDIAOPS_OUTPUT_WORKSPACE_INO'),
      outputsDev: value('DSH_MEDIAOPS_OUTPUTS_DEV'),
      outputsIno: value('DSH_MEDIAOPS_OUTPUTS_INO'),
      ownerPid: process.pid,
      ownerStartToken: ownerIdentity.startToken,
      ownerStartTokenVerified: ownerIdentity.verified,
      createdAt: new Date().toISOString(),
    }
    const root = await this.pendingRoot()
    const path = join(root, `${plan.runId}.json`)
    this.activePendingRuns.add(plan.runId)
    let complete = false
    try {
      const handle = await open(path, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => undefined)
        await rm(path, { force: true }).catch(() => undefined)
        throw error
      }
      await handle.close()
      await chmod(path, 0o600)
      try {
        const directory = await open(root, 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch {
        // Directory fsync is not supported on every Host filesystem.
      }
      complete = true
      return path
    } catch (error) {
      await rm(path, { force: true }).catch(() => undefined)
      throw error
    } finally {
      if (!complete) this.activePendingRuns.delete(plan.runId)
    }
  }

  private async readPendingRun(path: string, expectedRunId: string): Promise<PendingModelRunRecord> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const handle = await open(path, constants.O_RDONLY | noFollow)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > 8 * 1024) throw new Error('模型 pending run 必须是小型普通文件')
      return parsePendingRunRecord(await handle.readFile('utf8'), expectedRunId)
    } finally {
      await handle.close()
    }
  }

  private async recoverPendingRun(path: string, runId: string, forceOwnedRun = false): Promise<boolean> {
    const info = await optionalLstat(path)
    if (!info) return true
    if (info.isSymbolicLink()) {
      await rm(path, { force: true })
      return true
    }
    let record: PendingModelRunRecord
    try {
      record = await this.readPendingRun(path, runId)
    } catch {
      // Owner-less v1, truncated, or otherwise malformed records provide no
      // proof that their creator is dead. Preserve them and never scan a path
      // taken from them; an operator may quarantine them explicitly.
      return false
    }
    if (forceOwnedRun) {
      const ownerIdentity = await this.ownerIdentity()
      if (!this.activePendingRuns.has(runId) || record.ownerPid !== process.pid
        || ownerIdentity.startToken !== record.ownerStartToken
        || ownerIdentity.verified !== record.ownerStartTokenVerified) {
        return false
      }
    } else {
      // A janitor in this runner can race its own run between the durable
      // record write and finally. A second Host can race the same shared data
      // directory. Only a positively stale owner authorizes recovery.
      if (this.activePendingRuns.has(runId) || await pendingOwnerState(record) !== 'stale') return false
    }
    const workspaceInfo = await optionalBigIntLstat(record.workspace)
    if (!workspaceInfo) {
      await rm(path, { force: true })
      return true
    }
    if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()
      || await realpath(record.workspace) !== record.workspace
      || String(workspaceInfo.dev) !== record.workspaceDev || String(workspaceInfo.ino) !== record.workspaceIno) {
      return false
    }
    this.knownWorkspaces.add(record.workspace)
    const outputs = join(record.workspace, 'outputs')
    const outputsInfo = await optionalBigIntLstat(outputs)
    if (!outputsInfo) {
      await rm(path, { force: true })
      return true
    }
    if (outputsInfo.isSymbolicLink() || !outputsInfo.isDirectory() || await realpath(outputs) !== outputs
      || String(outputsInfo.dev) !== record.outputsDev || String(outputsInfo.ino) !== record.outputsIno) {
      return false
    }
    await cleanPartFiles(outputs, Date.now(), runId)
    await rm(path, { force: true })
    return true
  }

  private async recoverAllPendingRuns(): Promise<Set<string>> {
    const protectedRunIds = new Set<string>()
    const root = await this.pendingRoot()
    for (const name of await readdir(root)) {
      const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/iu.exec(name)
      if (!match?.[1]) continue
      if (!await this.recoverPendingRun(join(root, name), match[1])) protectedRunIds.add(match[1])
    }
    return protectedRunIds
  }

  private async makeRunStaging(): Promise<string> {
    const root = await this.stagingRoot()
    const directory = await mkdtemp(join(root, 'run-'))
    try {
      await chmod(directory, 0o700)
      const info = await lstat(directory)
      if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory) {
        throw new Error('模型运行 staging 目录不安全')
      }
      this.activeStaging.add(directory)
      return directory
    } catch (error) {
      await secureRemoveTree(root, directory).catch(() => undefined)
      throw error
    }
  }

  private async copyApprovedInput(sourcePath: string, targetPath: string, approved: ModelRunApprovalInput, maxBytes: number): Promise<void> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const source = await open(sourcePath, constants.O_RDONLY | noFollow)
    let destination
    try {
      const sourceInfo = await source.stat()
      if (!sourceInfo.isFile() || sourceInfo.size <= 0 || sourceInfo.size > maxBytes) throw new Error('执行时模型输入不是允许大小的普通文件')
      destination = await open(targetPath, 'wx', 0o600)
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES)
      let total = 0
      while (true) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        total += bytesRead
        if (total > maxBytes) throw new Error('执行时模型输入超过 Host 大小上限')
        hash.update(buffer.subarray(0, bytesRead))
        let written = 0
        while (written < bytesRead) {
          const result = await destination.write(buffer, written, bytesRead - written)
          written += result.bytesWritten
        }
      }
      await destination.sync()
      const digest = hash.digest('hex')
      if (total !== approved.bytes || digest !== approved.sha256) {
        throw new Error('本地模型输入复制后与审批的 size/hash 不一致，已拒绝执行')
      }
    } finally {
      await destination?.close().catch(() => undefined)
      await source.close().catch(() => undefined)
    }
    const copied = await lstat(targetPath)
    if (copied.isSymbolicLink() || !copied.isFile() || await realpath(targetPath) !== targetPath) {
      throw new Error('模型输入 snapshot 不是 staging 内普通文件')
    }
    await chmod(targetPath, 0o400)
  }

  private async snapshotInputs(plan: BuiltRunPlan, staging: string): Promise<string[]> {
    const result = [...plan.args]
    const commandPolicy = plan.policy.commands[plan.operation] as CommandPolicy
    const approvedByArgument = new Map(plan.summary.inputs.map(input => [input.argument, input]))
    for (let index = 1; index < result.length; index += 1) {
      const flag = result[index] as string
      if ((commandPolicy.booleanFlags ?? []).includes(flag)) continue
      const kind = commandPolicy.pathFlags?.[flag]
      if (kind === 'image-input' || kind === 'audio-input') {
        const approved = approvedByArgument.get(flag as ModelRunApprovalInput['argument'])
        if (!approved) throw new Error('模型输入缺少审批快照')
        const suffix = extname(approved.basename).match(/^\.[A-Za-z0-9]{1,16}$/u)?.[0] ?? ''
        const target = join(staging, `input-${index}-${randomUUID()}${suffix}`)
        await this.copyApprovedInput(result[index + 1] as string, target, approved,
          kind === 'image-input' ? MAX_IMAGE_INPUT_BYTES : MAX_AUDIO_INPUT_BYTES)
        result[index + 1] = target
      }
      index += 1
    }
    return result
  }

  private async recheckOutputs(plan: BuiltRunPlan, args: readonly string[]): Promise<void> {
    const commandPolicy = plan.policy.commands[plan.operation] as CommandPolicy
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index] as string
      if ((commandPolicy.booleanFlags ?? []).includes(flag)) continue
      if (commandPolicy.pathFlags?.[flag] === 'output') {
        const checked = await verifyOutputPath(
          plan.workspace,
          args[index + 1] as string,
          false,
          plan.policy.group === 'image',
        )
        if (checked !== args[index + 1]) throw new Error('模型输出路径在审批后发生变化')
      }
      index += 1
    }
  }

  async runApproved(
    exec: object,
    scriptId: ModelScriptId,
    argv: readonly string[],
    workspaceRoot: string,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const prepared = this.approved.get(exec)
    this.approved.delete(exec) // One approval is consumed even when a later recheck fails.
    if (!prepared) throw new Error('模型调用缺少与本次 exec 绑定的一次性审批')
    const plan = await this.buildPlan(scriptId, argv, workspaceRoot, prepared.runId)
    this.assertPlanMatchesApproval(prepared, plan)
    const staging = plan.summary.inputs.length > 0 ? await this.makeRunStaging() : undefined
    let pendingRunPath: string | undefined
    try {
      const safeArgs = staging ? await this.snapshotInputs(plan, staging) : plan.args
      await this.recheckOutputs(plan, safeArgs)
      // Durable before spawn: a Host SIGKILL leaves enough non-secret identity
      // to remove this run's fresh partials on the next startup.
      pendingRunPath = await this.writePendingRun(plan)
      const result = await runCommand({
        command: plan.pythonCommand,
        args: [join(BUNDLED_SKILLS_ROOT, 'shared', 'scripts', plan.policy.filename), ...safeArgs],
        cwd: plan.workspace,
        env: plan.executionEnv,
      }, signal, 30 * 60_000)
      const secrets = plan.projection.secrets
      return {
        ok: result.started && result.code === 0 && !result.timedOut && !result.aborted,
        script: scriptId,
        provider: plan.projection.providerId,
        code: result.code,
        stdout: redactModelOutput(result.stdout, secrets),
        stderr: redactModelOutput(result.stderr || result.error || '', secrets),
        timedOut: result.timedOut,
        aborted: result.aborted,
      }
    } finally {
      if (pendingRunPath) await this.recoverPendingRun(pendingRunPath, plan.runId, true).catch(() => false)
      this.activePendingRuns.delete(plan.runId)
      if (staging) {
        this.activeStaging.delete(staging)
        const root = await this.stagingRoot()
        await secureRemoveTree(root, staging)
      }
      await this.cleanupTemporaryFiles().catch(() => undefined)
    }
  }

  async cleanupTemporaryFiles(workspaceRoot?: string, removeAllOrphanStaging = false): Promise<void> {
    if (workspaceRoot) this.knownWorkspaces.add(await realpath(workspaceRoot))
    const operation = this.janitorTail.then(async () => {
      const now = Date.now()
      const protectedRunIds = await this.recoverAllPendingRuns()
      const stagingRoot = await this.stagingRoot()
      for (const name of await readdir(stagingRoot)) {
        if (!/^run-[A-Za-z0-9_-]+$/u.test(name)) continue
        const path = join(stagingRoot, name)
        if (this.activeStaging.has(path)) continue
        const info = await optionalLstat(path)
        if (!info) continue
        if (info.isSymbolicLink()) {
          await rm(path, { force: true })
          continue
        }
        if (!info.isDirectory()) throw new Error(`模型 staging 临时条目类型异常: ${path}`)
        if (removeAllOrphanStaging || now - info.mtimeMs >= MODEL_TEMP_MAX_AGE_MS) {
          await secureRemoveTree(stagingRoot, path)
        }
      }
      for (const workspace of this.knownWorkspaces) {
        const outputs = join(workspace, 'outputs')
        const info = await optionalLstat(outputs)
        if (!info) continue
        if (info.isSymbolicLink() || !info.isDirectory() || await realpath(outputs) !== outputs) {
          throw new Error('拒绝清理被替换或符号链接的 outputs 根目录')
        }
        await cleanPartFiles(outputs, now, undefined, protectedRunIds)
      }
    })
    this.janitorTail = operation.catch(() => undefined)
    return operation
  }

  /** Test-only visibility without exposing any prepared configuration data. */
  hasPreparedApproval(exec: object): boolean {
    return this.approved.has(exec)
  }
}
