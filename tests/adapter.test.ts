import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyAdapterOutcome, PublisherAdapter, type CommandSpec, type RunResult } from '../src/adapter.ts'
import { MEDIA_PLATFORMS, type Draft, type Publication } from '../src/types.ts'

const cleanup: string[] = []
const identity = 'a'.repeat(64)

function result(stdout = '', overrides: Partial<RunResult> = {}): RunResult {
  return {
    started: true,
    code: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    aborted: false,
    ...overrides,
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mediaops-adapter-'))
  cleanup.push(root)
  const dataDir = join(root, 'data')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(dataDir), mkdir(workspace)])
  const draft: Draft = {
    id: 'draft-1',
    revision: 1,
    topicId: '',
    title: '测试稿件',
    body: '正文',
    platforms: ['zhihu'],
    assets: [],
    status: 'ready',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  }
  return { dataDir, workspace, draft }
}

async function frozenPublication(dataDir: string, workspace: string, expectedIdentity = identity): Promise<Publication> {
  const stage = join(await realpath(dataDir), 'staging', 'publication-1')
  await mkdir(stage, { recursive: true })
  const bodyPath = join(stage, 'body.md')
  await writeFile(bodyPath, '正文')
  return {
    id: 'publication-1',
    draftId: 'draft-1',
    platform: 'zhihu',
    status: 'publishing',
    skillName: 'skill-zhihu-publisher',
    idempotencyKey: 'idempotency-1',
    confirmationTokenHash: '',
    executionLeaseId: 'lease-1',
    executionLeaseExpiresAt: '2026-09-12T01:00:00.000Z',
    expiresAt: '2026-09-12T01:00:00.000Z',
    snapshot: {
      draftId: 'draft-1',
      draftRevision: 1,
      draftUpdatedAt: '2026-09-12T00:00:00.000Z',
      workspaceRoot: workspace,
      title: '测试稿件',
      body: '正文',
      bodyPath,
      bodySha256: createHash('sha256').update('正文').digest('hex'),
      assets: [],
      assetManifest: [],
      platform: 'zhihu',
      accountLabel: '账号 A',
      accountIdentity: expectedIdentity,
      scheduledAt: '',
      preflightEvidence: 'passed',
      publisherOptions: {},
      payloadDigest: 'digest',
    },
    externalUrl: '',
    resultEvidence: '',
    error: '',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('PublisherAdapter runner contract', () => {
  it('classifies every platform receipt without overstating platform acceptance as publication', () => {
    for (const platform of MEDIA_PLATFORMS) {
      const output = platform === 'wechat-official' ? '{"media_id":"draft-1"}' : '{"ok":true}'
      const scheduledAt = platform === 'bilibili' ? '2026-09-13T00:00:00.000Z' : ''
      const expected = platform === 'wechat-official' ? 'draft_created' : platform === 'bilibili' ? 'scheduled' : 'submitted'
      expect(classifyAdapterOutcome(platform, scheduledAt, output, result(output))).toBe(expected)
    }
    expect(classifyAdapterOutcome('zhihu', '', '', result('', { code: 1 }))).toBe('uncertain')
  })

  it('uses an injected runner for account probing and a non-executing dry-run', async () => {
    const { dataDir, workspace, draft } = await fixture()
    const calls: CommandSpec[] = []
    const runner = vi.fn(async (spec: CommandSpec) => {
      calls.push(spec)
      return calls.length === 1
        ? result(JSON.stringify({ loggedIn: true, name: '账号 A', accountIdentity: identity }))
        : result('{"ok":true}')
    })
    const adapter = new PublisherAdapter(dataDir, runner)

    const preflight = await adapter.preflight(draft, 'zhihu', '账号 A', workspace, '', {})

    expect(preflight).toMatchObject({ accountLabel: '账号 A', accountIdentity: identity })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['whoami', '--platform', 'zhihu']))
    expect(calls[1]?.args).not.toContain('--exec')
    expect(calls[1]?.args).toEqual(expect.arrayContaining(['--expected-account-identity', identity]))
  })

  it('rechecks account identity before execution and interprets a successful publisher receipt', async () => {
    const { dataDir, workspace } = await fixture()
    const publication = await frozenPublication(dataDir, workspace)
    const runner = vi.fn()
      .mockResolvedValueOnce(result(JSON.stringify({ loggedIn: true, name: '账号 A', accountIdentity: identity })))
      .mockResolvedValueOnce(result('api_key=supersecret accepted https://zhuanlan.zhihu.com/p/123?token=secret'))
    const adapter = new PublisherAdapter(dataDir, runner)

    const executed = await adapter.execute(publication)

    expect(runner).toHaveBeenCalledTimes(2)
    expect(executed).toMatchObject({ started: true, outcome: 'submitted', externalUrl: 'https://zhuanlan.zhihu.com/p/123' })
    expect(executed.stdout).toContain('api_key=[REDACTED]')
    expect(executed.stdout).not.toContain('supersecret')
    expect((runner.mock.calls[1]?.[0] as CommandSpec).args).toContain('--exec')

    const changed = await frozenPublication(dataDir, workspace, 'b'.repeat(64))
    const mismatchRunner = vi.fn().mockResolvedValue(result(JSON.stringify({ loggedIn: true, name: '账号 A', accountIdentity: identity })))
    const refused = await new PublisherAdapter(dataDir, mismatchRunner).execute(changed)
    expect(mismatchRunner).toHaveBeenCalledTimes(1)
    expect(refused).toMatchObject({ started: false, outcome: 'uncertain', error: expect.stringContaining('身份已变化') })
    expect(refused.evidence).toContain('publisherStarted=false')
  })
})
