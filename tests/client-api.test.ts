import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_PREFIX, fetchReferences } from '../src/client/api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MediaOps client API', () => {
  it('uses one unified reference request and rejects malformed candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [
        { kind: 'topic', id: 'topic-1', label: '选题', description: ' 摘要 ', hint: ' planned ' },
        { kind: 'draft', id: 'draft-1', label: '草稿', updated_at: '2026-01-01T00:00:00.000Z' },
        { kind: 'publication', id: 'publication-1', title: '发布记录' },
        { kind: 'secret', id: 'bad-1', label: '未知种类' },
        { kind: 'viral', id: '', label: '空 ID' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await expect(fetchReferences('  AI  ', signal)).resolves.toEqual([
      { kind: 'topic', id: 'topic-1', label: '选题', description: '摘要', hint: 'planned', updatedAt: undefined },
      { kind: 'draft', id: 'draft-1', label: '草稿', updatedAt: '2026-01-01T00:00:00.000Z' },
      { kind: 'publication', id: 'publication-1', label: '发布记录', updatedAt: undefined },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${API_PREFIX}/references?limit=48&q=AI`, expect.objectContaining({
      credentials: 'same-origin', signal,
    }))
  })
})
