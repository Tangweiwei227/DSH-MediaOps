import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchReferences: vi.fn(),
  fetchReference: vi.fn(),
}))

vi.mock('../src/client/api.ts', () => api)

import { ACTION_SOURCE, createActionSource, createMentionSource, MENTION_SOURCE } from '../src/client/triggers.ts'

const signal = new AbortController().signal

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchReferences.mockResolvedValue([])
})

describe('MediaOps input triggers', () => {
  it('searches four libraries once and creates stable structured references', async () => {
    api.fetchReferences.mockResolvedValue([
      { kind: 'topic', id: 'topic/1', label: '选题（测试）', description: '  第一行\n第二行  ', hint: 'planned' },
      { kind: 'viral', id: 'viral:1', label: '爆款', hint: 'douyin · 热度 999' },
      { kind: 'draft', id: 'draft:1', label: '待审草稿', description: '正文摘要', hint: 'v2 · review' },
      { kind: 'publication', id: 'publication:1', label: '发布记录', hint: 'zhihu · submitted' },
    ])
    const source = createMentionSource()

    const candidates = await source.candidates(undefined as never, { query: '测试', signal } as never)

    expect(api.fetchReferences).toHaveBeenCalledTimes(1)
    expect(api.fetchReferences).toHaveBeenCalledWith('测试', signal)
    expect(source).toMatchObject({ trigger: '@', name: MENTION_SOURCE })
    expect(candidates).toEqual([
      expect.objectContaining({ name: '选题（测试）', description: '第一行 第二行', section: '选题库' }),
      expect.objectContaining({ name: '爆款', hint: 'douyin · 热度 999', section: '爆款库' }),
      expect.objectContaining({ name: '待审草稿', section: '草稿库' }),
      expect.objectContaining({ name: '发布记录', section: '发布记录' }),
    ])
    const picked = source.onPick?.({ candidate: candidates[0] } as never)
    expect(picked).toEqual({ insert: expect.objectContaining({ source: MENTION_SOURCE, label: '选题（测试）' }) })
    expect((picked as { insert: { clipboardText: string } }).insert.clipboardText).toBe('@[选题（测试）](dsh-mediaops:topic:topic%2F1)')
    const publicationPick = source.onPick?.({ candidate: candidates[3] } as never)
    expect(publicationPick).toEqual({ insert: expect.objectContaining({
      ref: JSON.stringify({ kind: 'publication', id: 'publication:1', label: '发布记录' }),
      clipboardText: '@[发布记录](dsh-mediaops:publication:publication%3A1)',
    }) })
  })

  it('serializes references at submit time and fails closed for malformed values', async () => {
    const source = createMentionSource()
    const reference = JSON.stringify({ kind: 'publication', id: 'publication-1', label: '脱敏发布记录' })
    api.fetchReference.mockResolvedValue('<mediaops_reference>safe</mediaops_reference>')

    await expect(source.codec?.serialize(reference, signal)).resolves.toBe('<mediaops_reference>safe</mediaops_reference>')
    expect(api.fetchReference).toHaveBeenCalledWith('publication', 'publication-1', signal)
    await expect(source.codec?.serialize('{broken', signal)).rejects.toThrow('引用已损坏')
    expect(source.codec?.clipboardText('{broken')).toContain('引用无效')
  })

  it('fails closed when unified search fails and honors abort', async () => {
    api.fetchReferences.mockRejectedValue(new Error('reference API down'))
    const source = createMentionSource()
    await expect(source.candidates(undefined as never, { query: '', signal } as never)).resolves.toEqual([])

    const controller = new AbortController()
    controller.abort()
    await expect(source.candidates(undefined as never, { query: '', signal: controller.signal } as never)).resolves.toEqual([])
  })

  it('keeps slash actions leading-only, searchable, and editable after insertion', async () => {
    const source = createActionSource()
    expect(source).toMatchObject({ trigger: '/', name: ACTION_SOURCE })
    await expect(source.candidates(undefined as never, { query: '', position: 'inline', signal } as never)).resolves.toEqual([])
    const candidates = await source.candidates(undefined as never, { query: '发布', position: 'leading', signal } as never)
    expect(candidates.map(candidate => candidate.name)).toContain('审核并发布')
    expect(source.onPick?.({ candidate: candidates.find(candidate => candidate.name === '审核并发布') } as never)).toEqual({
      text: expect.stringContaining('只有在我明确确认发布后才执行'),
      continue: true,
    })
  })
})
