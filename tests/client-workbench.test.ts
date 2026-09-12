import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MediaOpsWorkbench, referenceClipboardText } from '../src/client/MediaOpsWorkbench.tsx'

describe('MediaOps workbench reference search', () => {
  it('renders one entry point covering all four reference libraries', () => {
    const markup = renderToStaticMarkup(createElement(MediaOpsWorkbench))

    expect(markup).toContain('aria-label="统一引用搜索"')
    expect(markup).toContain('搜索选题、爆款、草稿和发布记录')
    expect(markup).toContain('搜索引用')
  })

  it('creates a safe copyable locator for publication results', () => {
    expect(referenceClipboardText({ kind: 'publication', id: 'publication/1', label: '发布\n[记录](危险)' })).toBe(
      '@[发布 记录 危险](dsh-mediaops:publication:publication%2F1)',
    )
  })
})
