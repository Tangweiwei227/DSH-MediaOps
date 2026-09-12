import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertModelEndpointNetworkPolicy, ModelConfigStore, validateModelBaseUrl } from '../src/model-config.ts'
import { buildModelRunApprovalReason, ModelScriptRunner, redactModelOutput } from '../src/model-runner.ts'
import { makeRoutes } from '../src/routes.ts'
import { normalizeModelConfig, updateModelProvider } from '../src/client/api.ts'
import type { MediaOpsService } from '../src/service.ts'
import type { TrendService } from '../src/trends.ts'

const cleanup: string[] = []

async function fixture(): Promise<{ root: string; dataDir: string; store: ModelConfigStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mediaops-models-'))
  cleanup.push(root)
  const dataDir = join(root, 'data')
  const store = new ModelConfigStore(dataDir)
  await store.ready
  return { root, dataDir, store }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Host multimodal model configuration', () => {
  it('stores secrets outside state with private modes and only exposes redacted DTOs', async () => {
    const { dataDir, store } = await fixture()
    const secret = 'model-key-alpha-omega'
    const view = await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      setAsDefault: true,
      values: { IMG_BASE_URL: 'https://api.example.com/v1/', IMG_MODEL: 'image-model-1' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: secret } },
    })
    expect(JSON.stringify(view)).not.toContain(secret)
    expect(view.groups.find(item => item.id === 'image')?.providers[0]).toMatchObject({ ready: true, selected: true })
    expect(view.groups.find(item => item.id === 'image')?.providers[0]?.fields.find(item => item.key === 'IMG_API_KEY')).toEqual(expect.objectContaining({ configured: true }))
    expect(view.groups.find(item => item.id === 'image')?.providers[0]?.fields.find(item => item.key === 'IMG_API_KEY')).not.toHaveProperty('value')

    const secretFile = join(dataDir, 'secrets', 'multimodal-models.json')
    expect(await readFile(secretFile, 'utf8')).toContain(secret)
    await expect(access(join(dataDir, 'state.json'))).rejects.toThrow()
    if (process.platform !== 'win32') {
      expect((await stat(join(dataDir, 'secrets'))).mode & 0o777).toBe(0o700)
      expect((await stat(secretFile)).mode & 0o777).toBe(0o600)
    }
  })

  it('requires explicit keep, replace, and clear semantics for secrets', async () => {
    const { dataDir, store } = await fixture()
    const secret = 'keep-this-key-123'
    await store.updateProvider('image', 'openai-compatible', {
      values: { IMG_BASE_URL: 'https://api.example.com/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: secret } },
    })
    await store.updateProvider('image', 'openai-compatible', {
      values: { IMG_MODEL: 'image-model-2' },
      secretChanges: { IMG_API_KEY: { action: 'keep' } },
    })
    expect(await readFile(join(dataDir, 'secrets', 'multimodal-models.json'), 'utf8')).toContain(secret)
    const cleared = await store.updateProvider('image', 'openai-compatible', {
      secretChanges: { IMG_API_KEY: { action: 'clear' } },
    })
    expect(JSON.stringify(cleared)).not.toContain(secret)
    expect(cleared.groups[0]?.providers[0]?.ready).toBe(false)
    expect(await readFile(join(dataDir, 'secrets', 'multimodal-models.json'), 'utf8')).not.toContain(secret)
    await expect(store.updateProvider('image', 'openai-compatible', {
      secretChanges: { IMG_API_KEY: { action: 'replace', value: '' } },
    })).rejects.toThrow('非空值')
  })

  it('enforces public HTTPS by default and makes private-network access explicit', async () => {
    expect(validateModelBaseUrl('https://api.example.com/v1/', false)).toBe('https://api.example.com/v1')
    expect(() => validateModelBaseUrl('http://localhost:8800/v1', false)).toThrow('HTTPS')
    expect(() => validateModelBaseUrl('http://api.example.com/v1', false)).toThrow('HTTPS')
    expect(() => validateModelBaseUrl('https://192.168.1.8/v1', false)).toThrow('私有网络')
    expect(() => validateModelBaseUrl('https://service.internal/v1', false)).toThrow('私有网络')
    expect(validateModelBaseUrl('http://192.168.1.8/v1', true)).toBe('http://192.168.1.8/v1')
    expect(() => validateModelBaseUrl('http://93.184.216.34/v1', true)).toThrow(/HTTP.*loopback\/RFC1918\/ULA/u)
    expect(() => validateModelBaseUrl('http://api.example.com/v1', true)).toThrow(/公网形态域名.*HTTPS/u)
    await expect(assertModelEndpointNetworkPolicy(
      'http://public-name.internal/v1', true, async () => [{ address: '93.184.216.34' }],
    )).rejects.toThrow(/HTTP.*全部解析/u)
    await expect(assertModelEndpointNetworkPolicy(
      'http://localhost/v1', true, async () => [{ address: '93.184.216.34' }],
    )).rejects.toThrow(/HTTP.*全部解析/u)
    await expect(assertModelEndpointNetworkPolicy(
      'http://private-name.internal/v1', true, async () => [{ address: '192.168.1.8' }],
    )).resolves.toBeUndefined()
    await expect(assertModelEndpointNetworkPolicy(
      'https://public-name.example/v1', true, async () => [{ address: '93.184.216.34' }],
    )).resolves.toBeUndefined()
    expect(() => validateModelBaseUrl('http://169.254.169.254/latest', true)).toThrow('云元数据')
    expect(() => validateModelBaseUrl('http://[fd00:ec2::254]/latest', true)).toThrow('云元数据')

    const { store } = await fixture()
    await expect(store.updateProvider('image', 'openai-compatible', {
      values: { IMG_BASE_URL: 'http://192.168.1.8/v1' },
    })).rejects.toThrow('HTTPS')
    await expect(store.updateProvider('image', 'openai-compatible', {
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://192.168.1.8/v1' },
    })).resolves.toMatchObject({ ok: true })
    await expect(store.updateProvider('image', 'openai-compatible', {
      allowPrivateNetwork: false,
    })).rejects.toThrow(/HTTPS|私网/u)
  })

  it('rejects a symlinked secrets directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mediaops-models-'))
    cleanup.push(root)
    const dataDir = join(root, 'data')
    const outside = join(root, 'outside')
    await Promise.all([writeFile(join(root, 'marker'), 'safe'), rm(dataDir, { force: true }), rm(outside, { force: true })])
    await import('node:fs/promises').then(({ mkdir }) => Promise.all([mkdir(dataDir), mkdir(outside)]))
    await symlink(outside, join(dataDir, 'secrets'))
    const store = new ModelConfigStore(dataDir)
    await expect(store.ready).rejects.toThrow('不能是符号链接')
    expect((await lstat(outside)).isDirectory()).toBe(true)
  })

  it('handles the first secrets-directory creation concurrently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mediaops-model-race-'))
    cleanup.push(root)
    const dataDir = join(root, 'data')
    const stores = Array.from({ length: 8 }, () => new ModelConfigStore(dataDir))
    await expect(Promise.all(stores.map(store => store.ready))).resolves.toHaveLength(8)
    expect((await stat(join(dataDir, 'secrets'))).isDirectory()).toBe(true)
  })

  it('runs only an allowlisted script/argv with Host-injected env and redacts key diagnostics', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
    const secret = 'alpha-super-secret-omega'
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://localhost:7777/v1', IMG_MODEL: 'fixture-image' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: secret } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const exec = {}
    await runner.prepareApproved(exec, 'ai-image', ['check'], workspace)
    const result = await runner.runApproved(exec, 'ai-image', ['check'], workspace)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('alp...ega')
    expect(result.stdout).toContain('[REDACTED]')
    await expect(runner.prepareApproved({}, 'ai-image', ['check', '--env-file', '.env'], workspace)).rejects.toThrow('不允许')
    await expect(runner.prepareApproved({}, 'ai-image', ['text2img', '--prompt', 'x', '--output', '../escape.png'], workspace)).rejects.toThrow('outputs/')
  })

  it('bounds paid arguments and creates a prompt-free, hashed approval summary', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
    const image = join(workspace, 'reference.png')
    await writeFile(image, 'reference-bytes')
    const secret = 'approval-secret-key'
    const prompt = 'private campaign prompt'
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'configured-image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: secret } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const summary = await runner.approvalSummary('ai-image', [
      'img2img', '--prompt', prompt, '--image', image, '--n', '2', '--quality', 'high',
      '--size', '1024x1024', '--resolution', '2k', '--output', 'outputs/result.png',
    ], workspace)
    expect(summary).toMatchObject({
      provider: 'openai-compatible', model: 'configured-image-model',
      operation: 'img2img', specifications: { n: 2, quality: 'high', size: '1024x1024', resolution: '2k' },
      inputs: [{ argument: '--image', basename: 'reference.png', bytes: 15 }],
    })
    expect(summary.inputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    const approval = buildModelRunApprovalReason(summary)
    expect(approval).not.toContain(prompt)
    expect(approval).not.toContain(secret)
    expect(approval).toContain('configured-image-model')
    await expect(runner.approvalSummary('ai-image', [
      'text2img', '--prompt', 'x', '--n', '9', '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow('1..8')
    await expect(runner.approvalSummary('ai-image', [
      'text2img', '--prompt', 'x', '--quality', 'ultra-unbounded', '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow('Host 允许的规格')
    await expect(runner.approvalSummary('ai-image', [
      'text2img', '--prompt', 'x', '--poll-interval', '0', '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow('1..60')
    await expect(runner.approvalSummary('ai-image', [
      'text2img', '--prompt', 'x', '--model', 'override', '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow('--model')
  })

  it('enforces video/music duration and voice speed limits at the Host boundary', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
    await store.updateProvider('video', 'openai-compatible', {
      enabled: true, allowPrivateNetwork: true,
      values: { VIDEO_BASE_URL: 'http://127.0.0.1:7777/v1', VIDEO_MODEL: 'video-model' },
      secretChanges: { VIDEO_API_KEY: { action: 'replace', value: 'video-test-key' } },
    })
    await store.updateProvider('music', 'suno-compatible', {
      enabled: true, allowPrivateNetwork: true,
      values: { MUSIC_BASE_URL: 'http://127.0.0.1:7777/v1', MUSIC_MODEL: 'music-model' },
      secretChanges: { MUSIC_API_KEY: { action: 'replace', value: 'music-test-key' } },
    })
    await store.updateProvider('voice', 'openai-compatible', {
      enabled: true, allowPrivateNetwork: true,
      values: { VOICE_BASE_URL: 'http://127.0.0.1:7777/v1', VOICE_MODEL: 'voice-model' },
      secretChanges: { VOICE_API_KEY: { action: 'replace', value: 'voice-test-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    await expect(runner.approvalSummary('ai-video', [
      'text2video', '--prompt', 'x', '--duration', '61', '--output', 'outputs/x.mp4',
    ], workspace)).rejects.toThrow('1..60')
    await expect(runner.approvalSummary('ai-music', [
      'generate', '--prompt', 'x', '--duration', '901', '--output', 'outputs/x.mp3',
    ], workspace)).rejects.toThrow('1..900')
    await expect(runner.approvalSummary('voice-clone', [
      'clone', '--text', 'x', '--speed', '2.1', '--output', 'outputs/x.mp3',
    ], workspace)).rejects.toThrow('0.5..2')
  })

  it('rejects oversized input files before a script can allocate or upload them', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
    const oversized = join(workspace, 'oversized.png')
    const handle = await open(oversized, 'w')
    await handle.truncate(64 * 1024 * 1024 + 1)
    await handle.close()
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'oversize-test-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    await expect(runner.approvalSummary('ai-image', [
      'img2img', '--prompt', 'x', '--image', oversized, '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow('67108864')
  })

  it('removes URL credentials, query, fragment and temporary credential fields from runner output', () => {
    const redacted = redactModelOutput([
      'download https://user:pass@cdn.example.com/media.png?X-Amz-Signature=signed-secret#fragment',
      '{"AccessKeyId":"ASIA-SECRET","SessionToken":"temporary-secret"}',
    ].join('\n'), [])
    expect(redacted).toContain('https://cdn.example.com/media.png')
    expect(redacted).not.toMatch(/user|pass|X-Amz|signed-secret|fragment|ASIA-SECRET|temporary-secret/u)
  })

  it('makes voice enrollment upload and authorization explicit in approval text', () => {
    const approval = buildModelRunApprovalReason({
      script: 'voice-clone', operation: 'enroll', provider: 'minimax', model: 'voice-clone',
      specifications: { output: '(voice-id)' },
      inputs: [{ argument: '--sample', basename: 'authorized.wav', bytes: 123, sha256: 'a'.repeat(64) }],
      uploadsVoiceSample: true, requiresVoiceAuthorization: true,
    })
    expect(approval).toMatch(/上传声音样本/u)
    expect(approval).toMatch(/明确授权/u)
  })

  it('binds approval to the exact exec identity and consumes it once', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'one-time-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const approvedExec = {}
    await runner.prepareApproved(approvedExec, 'ai-image', ['check'], workspace)
    expect(runner.hasPreparedApproval(approvedExec)).toBe(true)
    await expect(runner.runApproved({}, 'ai-image', ['check'], workspace)).rejects.toThrow('一次性审批')
    const controller = new AbortController()
    controller.abort()
    const result = await runner.runApproved(approvedExec, 'ai-image', ['check'], workspace, controller.signal)
    expect(result.aborted).toBe(true)
    expect(runner.hasPreparedApproval(approvedExec)).toBe(false)
    await expect(runner.runApproved(approvedExec, 'ai-image', ['check'], workspace)).rejects.toThrow('一次性审批')
  })

  it('rejects configuration, parameters, or local input changes after approval', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const image = join(workspace, 'reference.png')
    await writeFile(image, 'approved-image')
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'approval-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)

    const configExec = {}
    await runner.prepareApproved(configExec, 'ai-image', ['check'], workspace)
    await store.updateProvider('image', 'openai-compatible', { values: { IMG_MODEL: 'changed-model' } })
    await expect(runner.runApproved(configExec, 'ai-image', ['check'], workspace)).rejects.toThrow(/provider 或实际 model/u)

    await store.updateProvider('image', 'openai-compatible', { values: { IMG_MODEL: 'image-model' } })
    const endpointExec = {}
    await runner.prepareApproved(endpointExec, 'ai-image', ['check'], workspace)
    await store.updateProvider('image', 'openai-compatible', {
      values: { IMG_BASE_URL: 'http://127.0.0.1:8888/v1' },
    })
    await expect(runner.runApproved(endpointExec, 'ai-image', ['check'], workspace)).rejects.toThrow(/endpoint 或私网策略/u)

    await store.updateProvider('image', 'openai-compatible', {
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1' },
    })
    const environmentExec = {}
    await runner.prepareApproved(environmentExec, 'ai-image', ['check'], workspace)
    await store.updateProvider('image', 'openai-compatible', {
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'changed-approval-key' } },
    })
    await expect(runner.runApproved(environmentExec, 'ai-image', ['check'], workspace)).rejects.toThrow(/运行环境配置/u)

    const parameterExec = {}
    await runner.prepareApproved(parameterExec, 'ai-image', ['check'], workspace)
    await expect(runner.runApproved(parameterExec, 'ai-image', ['text2img', '--prompt', 'changed', '--output', 'outputs/x.png'], workspace))
      .rejects.toThrow(/参数或 workspace/u)

    const inputArgs = ['img2img', '--prompt', 'x', '--image', image, '--output', 'outputs/x.png']
    const inputExec = {}
    await runner.prepareApproved(inputExec, 'ai-image', inputArgs, workspace)
    await writeFile(image, 'tampered-image')
    await expect(runner.runApproved(inputExec, 'ai-image', inputArgs, workspace)).rejects.toThrow(/输入文件/u)
  })

  it('copies approved inputs into private staging and cleans the snapshot in finally', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const image = join(workspace, 'reference.png')
    await writeFile(image, 'approved-image')
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'snapshot-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const exec = {}
    const args = ['img2img', '--prompt', 'x', '--image', image, '--output', 'outputs/x.png']
    await runner.prepareApproved(exec, 'ai-image', args, workspace)
    const controller = new AbortController()
    controller.abort()
    await expect(runner.runApproved(exec, 'ai-image', args, workspace, controller.signal)).resolves.toMatchObject({ aborted: true })
    const staging = join(await import('node:fs/promises').then(api => api.realpath(dataDir)), 'model-staging')
    expect((await stat(staging)).mode & 0o777).toBe(0o700)
    expect(await readdir(staging)).toEqual([])
  })

  it('rejects an outputs symlink and janitor never follows nested symlinks', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const marker = join(outside, '.dsh-mediaops-outside-abcdefgh.part')
    await writeFile(marker, 'do-not-delete')
    await symlink(outside, join(workspace, 'outputs'))
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'outputs-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    await expect(runner.prepareApproved({}, 'ai-image', [
      'text2img', '--prompt', 'x', '--output', 'outputs/x.png',
    ], workspace)).rejects.toThrow(/outputs.*符号链接/u)
    expect(await readFile(marker, 'utf8')).toBe('do-not-delete')

    await rm(join(workspace, 'outputs'))
    const outputs = join(workspace, 'outputs')
    await mkdir(outputs)
    const freshPart = join(outputs, '.dsh-mediaops-fresh-abcdefgh.part')
    await writeFile(freshPart, 'fresh')
    await runner.cleanupTemporaryFiles(workspace)
    expect(await readFile(freshPart, 'utf8')).toBe('fresh')

    const localPart = join(outputs, '.dsh-mediaops-result-abcdefgh.part')
    await writeFile(localPart, 'stale')
    const old = new Date(Date.now() - 3 * 60 * 60_000)
    await utimes(localPart, old, old)
    await symlink(outside, join(outputs, 'escape'))
    await runner.cleanupTemporaryFiles(workspace)
    await expect(access(localPart)).rejects.toThrow()
    expect(await readFile(freshPart, 'utf8')).toBe('fresh')
    await utimes(freshPart, old, old)
    await runner.cleanupTemporaryFiles()
    await expect(access(freshPart)).rejects.toThrow()
    expect(await readFile(marker, 'utf8')).toBe('do-not-delete')

    const stagingRoot = join(await import('node:fs/promises').then(api => api.realpath(dataDir)), 'model-staging')
    const abandoned = join(stagingRoot, 'run-abandoned')
    await mkdir(abandoned)
    await writeFile(join(abandoned, '.dsh-mediaops-snapshot-abcdefgh.part'), 'partial')
    await symlink(outside, join(abandoned, 'outside-link'))
    // Startup mode removes every orphan staging directory, including a recent
    // SIGKILL remnant, while unlinking (never traversing) its symlink.
    await runner.cleanupTemporaryFiles(undefined, true)
    await expect(access(abandoned)).rejects.toThrow()
    expect(await readFile(marker, 'utf8')).toBe('do-not-delete')
  })

  it('rejects outputs swapped after approval, before the child can start', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'swap-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const args = ['text2img', '--prompt', 'x', '--output', 'outputs/result.png']

    const symlinkExec = {}
    await runner.prepareApproved(symlinkExec, 'ai-image', args, workspace)
    const originalOutputs = join(workspace, 'outputs-original')
    await import('node:fs/promises').then(api => api.rename(join(workspace, 'outputs'), originalOutputs))
    await symlink(outside, join(workspace, 'outputs'))
    await expect(runner.runApproved(symlinkExec, 'ai-image', args, workspace)).rejects.toThrow(/outputs.*符号链接/u)
    await expect(access(join(outside, 'result.png'))).rejects.toThrow()

    await rm(join(workspace, 'outputs'))
    await import('node:fs/promises').then(api => api.rename(originalOutputs, join(workspace, 'outputs')))
    const inodeExec = {}
    await runner.prepareApproved(inodeExec, 'ai-image', args, workspace)
    const approvedOutputs = join(workspace, 'outputs-approved')
    await import('node:fs/promises').then(api => api.rename(join(workspace, 'outputs'), approvedOutputs))
    await mkdir(join(workspace, 'outputs'))
    await expect(runner.runApproved(inodeExec, 'ai-image', args, workspace)).rejects.toThrow(/运行环境配置/u)
    await expect(access(join(workspace, 'outputs', 'result.png'))).rejects.toThrow()
  })

  it('allows ai-image to create and reuse a real extensionless output directory but rejects a directory symlink', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    await mkdir(join(workspace, 'outputs', 'existing-gallery'), { recursive: true })
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'directory-key' } },
    })
    const mockPython = join(root, 'mock-python-directory')
    await writeFile(mockPython, '#!/bin/sh\nexit 0\n')
    await chmod(mockPython, 0o700)
    const previousPython = process.env.DSH_MEDIAOPS_PYTHON
    process.env.DSH_MEDIAOPS_PYTHON = mockPython
    try {
      const runner = new ModelScriptRunner(store, dataDir)
      const existingArgs = ['text2img', '--prompt', 'x', '--output', 'outputs/existing-gallery']
      const existingExec = {}
      await runner.prepareApproved(existingExec, 'ai-image', existingArgs, workspace)
      await expect(runner.runApproved(existingExec, 'ai-image', existingArgs, workspace)).resolves.toMatchObject({ ok: true })

      const createdArgs = ['text2img', '--prompt', 'x', '--output', 'outputs/created-gallery']
      const createdExec = {}
      await runner.prepareApproved(createdExec, 'ai-image', createdArgs, workspace)
      expect((await lstat(join(workspace, 'outputs', 'created-gallery'))).isDirectory()).toBe(true)
      await expect(runner.runApproved(createdExec, 'ai-image', createdArgs, workspace)).resolves.toMatchObject({ ok: true })

      await symlink(outside, join(workspace, 'outputs', 'linked-gallery'))
      await expect(runner.prepareApproved(
        {}, 'ai-image', ['text2img', '--prompt', 'x', '--output', 'outputs/linked-gallery'], workspace,
      )).rejects.toThrow(/ai-image.*真实目录|符号链接/u)
    } finally {
      if (previousPython === undefined) delete process.env.DSH_MEDIAOPS_PYTHON
      else process.env.DSH_MEDIAOPS_PYTHON = previousPython
    }
  })

  it('removes this run fresh partials immediately and recovers them after Host restart', async () => {
    const { root, dataDir, store } = await fixture()
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await store.updateProvider('image', 'openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: 'partial-key' } },
    })
    const runner = new ModelScriptRunner(store, dataDir)
    const mockPython = join(root, 'mock-python')
    await writeFile(mockPython, [
      '#!/bin/sh',
      'touch "$DSH_MEDIAOPS_WORKSPACE/outputs/.dsh-mediaops-$DSH_MEDIAOPS_MODEL_RUN_ID-crash.part"',
      'kill -KILL $$',
    ].join('\n'))
    await chmod(mockPython, 0o700)
    const previousPython = process.env.DSH_MEDIAOPS_PYTHON
    process.env.DSH_MEDIAOPS_PYTHON = mockPython
    try {
      const exec = {}
      const args = ['text2img', '--prompt', 'x', '--output', 'outputs/result.png']
      await runner.prepareApproved(exec, 'ai-image', args, workspace)
      await expect(runner.runApproved(exec, 'ai-image', args, workspace)).resolves.toMatchObject({ ok: false })
      expect((await readdir(join(workspace, 'outputs'))).filter(name => name.endsWith('.part'))).toEqual([])
      expect(await readdir(join(await import('node:fs/promises').then(api => api.realpath(dataDir)), 'model-pending-runs'))).toEqual([])
    } finally {
      if (previousPython === undefined) delete process.env.DSH_MEDIAOPS_PYTHON
      else process.env.DSH_MEDIAOPS_PYTHON = previousPython
    }

    const outputs = join(workspace, 'outputs')
    const canonicalWorkspace = await import('node:fs/promises').then(api => api.realpath(workspace))
    const canonicalOutputs = join(canonicalWorkspace, 'outputs')
    const runId = '12345678-1234-4123-8123-123456789abc'
    const freshPart = join(outputs, `.dsh-mediaops-${runId}-restart.part`)
    await writeFile(freshPart, 'fresh-after-host-kill')
    const [workspaceInfo, outputsInfo] = await Promise.all([
      lstat(canonicalWorkspace, { bigint: true }),
      lstat(canonicalOutputs, { bigint: true }),
    ])
    const pendingRoot = join(await import('node:fs/promises').then(api => api.realpath(dataDir)), 'model-pending-runs')
    await writeFile(join(pendingRoot, `${runId}.json`), JSON.stringify({
      version: 2,
      runId,
      workspace: canonicalWorkspace,
      workspaceDev: String(workspaceInfo.dev),
      workspaceIno: String(workspaceInfo.ino),
      outputsDev: String(outputsInfo.dev),
      outputsIno: String(outputsInfo.ino),
      ownerPid: 2_147_483_647,
      ownerStartToken: '0'.repeat(64),
      ownerStartTokenVerified: true,
      createdAt: new Date().toISOString(),
    }), { mode: 0o600 })
    const restartedRunner = new ModelScriptRunner(store, dataDir)
    await restartedRunner.cleanupTemporaryFiles(undefined, true)
    await expect(access(freshPart)).rejects.toThrow()
    expect(await readdir(pendingRoot)).toEqual([])
  })
})

async function callModelRoute(store: ModelConfigStore, method: string, path: string, body?: unknown, origin = 'http://localhost:3000') {
  const route = makeRoutes({} as MediaOpsService, {} as TrendService, 12_000, store)[0]
  if (!route) throw new Error('route missing')
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  Object.assign(request, {
    method,
    url: `/api/dsh-mediaops${path}`,
    headers: { host: 'localhost:3000', origin, 'sec-fetch-site': origin.includes('localhost') ? 'same-origin' : 'cross-site' },
    socket: { remoteAddress: '127.0.0.1' },
  })
  let status = 0
  let raw = ''
  const response = {
    writeHead(code: number) { status = code },
    end(value?: string) { raw += value ?? '' },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return { status, body: JSON.parse(raw) as unknown, raw }
}

describe('multimodal configuration routes', () => {
  it('writes via same-origin loopback and never returns a submitted secret', async () => {
    const { store } = await fixture()
    const secret = 'route-secret-value-987'
    const updated = await callModelRoute(store, 'PUT', '/model-config/image/openai-compatible', {
      enabled: true,
      allowPrivateNetwork: true,
      values: { IMG_BASE_URL: 'http://127.0.0.1:7777/v1', IMG_MODEL: 'image-model' },
      secretChanges: { IMG_API_KEY: { action: 'replace', value: secret } },
    })
    expect(updated.status).toBe(200)
    expect(updated.raw).not.toContain(secret)
    const read = await callModelRoute(store, 'GET', '/model-config')
    expect(read.status).toBe(200)
    expect(read.raw).not.toContain(secret)
    const verified = await callModelRoute(store, 'POST', '/model-config/image/openai-compatible/verify')
    expect(verified.body).toMatchObject({ ok: true, ready: true })
    const denied = await callModelRoute(store, 'GET', '/model-config', undefined, 'https://attacker.example')
    expect(denied.status).toBe(403)
  })
})

describe('browser model-config client', () => {
  it('drops secret-looking values even if a malformed Host marks them non-secret', () => {
    const normalized = normalizeModelConfig({
      version: 1,
      groups: [{
        id: 'image', label: '图像', providers: [{
          id: 'x', label: 'x', fields: [
            { key: 'IMG_API_KEY', label: 'key', kind: 'text', secret: false, value: 'must-not-survive' },
            { key: 'IMG_MODEL', label: 'model', kind: 'text', secret: false, value: 'safe-model' },
          ],
        }],
      }],
    })
    const fields = normalized.groups[0]?.providers[0]?.fields ?? []
    expect(fields[0]).toMatchObject({ secret: true, configured: false })
    expect(fields[0]).not.toHaveProperty('value')
    expect(fields[1]).toMatchObject({ value: 'safe-model' })
    expect(JSON.stringify(normalized)).not.toContain('must-not-survive')
  })

  it('sends explicit keep/replace/clear mutations without reflecting secrets', async () => {
    const secret = 'client-secret-123'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: 1, groups: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const result = await updateModelProvider('voice', 'gemini', {
      secretChanges: {
        GEMINI_API_KEY: { action: 'replace', value: secret },
        OLD_SECRET: { action: 'clear' },
        PRESERVED_SECRET: { action: 'keep' },
      },
    })
    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      secretChanges: {
        GEMINI_API_KEY: { action: 'replace', value: secret },
        OLD_SECRET: { action: 'clear' },
        PRESERVED_SECRET: { action: 'keep' },
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
