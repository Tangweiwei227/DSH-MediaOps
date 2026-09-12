import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { API_PREFIX, makeRoutes } from '../src/routes.ts'
import type { MediaOpsService } from '../src/service.ts'
import type { TrendService } from '../src/trends.ts'
import type { MediaOpsState } from '../src/types.ts'

function stateFixture(): MediaOpsState {
  return {
    version: 5,
    topics: [{ id: 'topic-1', title: 'AI 选题', angle: '角度', summary: '', content: '', tags: [], platforms: [], status: 'idea', sourceViralIds: [], references: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    viralItems: [],
    drafts: [],
    publications: [{
      id: 'publication-1', draftId: 'draft-1', platform: 'zhihu', status: 'published', skillName: 'skill-zhihu-publisher', idempotencyKey: 'do-not-leak-idem', confirmationTokenHash: '', executionLeaseId: '', executionLeaseExpiresAt: '', expiresAt: '2026-01-01T00:00:00.000Z',
      snapshot: {
        draftId: 'draft-1', draftRevision: 3, draftUpdatedAt: '2026-01-01T00:00:00.000Z', workspaceRoot: '/private/workspace', title: '已发布标题', body: 'private frozen body', bodyPath: '/private/body.md', bodySha256: 'a'.repeat(64), assets: ['/private/a.png'], assetManifest: [{ source: '/source/a.png', frozenPath: '/private/a.png', sha256: 'b'.repeat(64), sizeBytes: 1 }], platform: 'zhihu', accountLabel: '私密账号', accountIdentity: 'c'.repeat(64), scheduledAt: '', preflightEvidence: 'private evidence', publisherOptions: { secret: 'private option' }, payloadDigest: 'd'.repeat(64),
      },
      externalUrl: 'https://www.zhihu.com/pin/1', resultEvidence: 'private result', error: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    }],
  }
}

async function invoke(path: string, state = stateFixture()) {
  const service = { state: vi.fn().mockResolvedValue(state) } as unknown as MediaOpsService
  const route = makeRoutes(service, {} as TrendService, 2_000)[0]
  if (!route) throw new Error('route missing')
  const request = {
    method: 'GET',
    url: `${API_PREFIX}${path}`,
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
  let status = 0
  let raw = ''
  const response = {
    writeHead(code: number) { status = code; return response },
    end(value?: unknown) { raw = value === undefined ? '' : String(value); return response },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return { status, payload: raw === '' ? undefined : JSON.parse(raw) as Record<string, unknown>, service }
}

describe('reference HTTP endpoints', () => {
  it('searches all kinds through one state read', async () => {
    const result = await invoke('/references?q=AI&limit=20')

    expect(result.status).toBe(200)
    expect(result.service.state).toHaveBeenCalledTimes(1)
    expect(result.payload?.items).toEqual([expect.objectContaining({ kind: 'topic', id: 'topic-1', label: 'AI 选题' })])
  })

  it('returns a redacted publication envelope and a 404 for missing references', async () => {
    const found = await invoke('/reference/publication/publication-1')
    const serialized = JSON.stringify(found.payload)

    expect(found.status).toBe(200)
    expect(serialized).toContain('已发布标题')
    for (const secret of ['/private/workspace', '/private/body.md', 'private frozen body', '私密账号', 'private option', 'private evidence', 'private result', 'do-not-leak-idem', 'c'.repeat(64)]) {
      expect(serialized).not.toContain(secret)
    }

    const missing = await invoke('/reference/draft/missing')
    expect(missing.status).toBe(404)
    expect(missing.payload).toMatchObject({ ok: false, error: '引用记录不存在' })
  })
})
