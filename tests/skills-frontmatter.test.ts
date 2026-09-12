import { describe, expect, it } from 'vitest'
import { createBundledSkillProvider, parseSkillFrontmatter } from '../src/skills.ts'
import { lintSkillFrontmatterSources } from '../src/skill-lint.ts'

describe('bundled skill frontmatter', () => {
  it('folds chomping block descriptions instead of exposing the YAML indicator', async () => {
    const provider = createBundledSkillProvider()
    const result = await provider.list({})
    const candidates = 'candidates' in result ? result.candidates : result

    expect(candidates).toHaveLength(112)
    expect(candidates.find(item => item.name === 'video-editing')?.description).toMatch(/video/i)
    expect(candidates.map(item => item.description)).not.toContain('>-')
  })

  it.each([
    ['>', 'first line second line\nthird paragraph\n'],
    ['>-', 'first line second line\nthird paragraph'],
    ['>+', 'first line second line\nthird paragraph\n\n\n'],
    ['|', 'first line\nsecond line\n\nthird paragraph\n'],
    ['|-', 'first line\nsecond line\n\nthird paragraph'],
    ['|+', 'first line\nsecond line\n\nthird paragraph\n\n\n'],
  ])('implements YAML %s block style and chomping semantics', (indicator, expected) => {
    const parsed = parseSkillFrontmatter(`---\nname: fixture\ndescription: ${indicator}\n  first line\n  second line\n\n  third paragraph\n\n\n---\n# Fixture\n`, 'fallback')
    expect(parsed.description).toBe(expected)
  })

  it('preserves paragraph, leading blank, and more-indented line semantics', () => {
    const parsed = parseSkillFrontmatter('---\r\nname: fixture\r\ndescription: >-\r\n\r\n  first\r\n  second\r\n\r\n    code a\r\n    code b\r\n\r\n  after\r\n---\r\n# Fixture\r\n', 'fallback')
    expect(parsed.description).toBe('\nfirst second\n\n  code a\n  code b\n\nafter')
  })

  it.each([
    ['|2-', '    four\n  two\n', '  four\ntwo'],
    ['>2-', '  one\n  two\n', 'one two'],
    ['|-2', '    four\n  two\n', '  four\ntwo'],
  ])('supports explicit block indentation in %s', (indicator, content, expected) => {
    const parsed = parseSkillFrontmatter(`---\nname: fixture\ndescription: ${indicator}\n${content}---\n# Fixture\n`, 'fallback')
    expect(parsed.description).toBe(expected)
  })

  it('reports missing, duplicate, unresolved, and invalid frontmatter fields', () => {
    const errors = lintSkillFrontmatterSources([
      { path: 'one/SKILL.md', fallbackName: 'one', raw: '---\nname: duplicate\ndescription: >-\nlayer: unknown\n---\n# One\n' },
      { path: 'two/SKILL.md', fallbackName: 'two', raw: '---\nname: duplicate\nname: duplicate\ndescription:\nlayer: plan\n---\n# Two\n' },
      { path: 'three/SKILL.md', fallbackName: 'three', raw: '# No frontmatter' },
    ])
    expect(errors.map(error => error.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('description 不能为空'),
      expect.stringContaining('layer 必须是'),
      expect.stringContaining('name 必须恰好出现一次'),
      expect.stringContaining('name 重复'),
      expect.stringContaining('缺少 YAML frontmatter'),
    ]))
  })

  it('keeps the provider fallback for legacy files while lint rejects them', () => {
    expect(parseSkillFrontmatter('# Legacy heading\n\nBody', 'legacy')).toMatchObject({
      name: 'legacy',
      description: 'DSH-MediaOps bundled skill: Legacy heading',
      content: '# Legacy heading\n\nBody',
    })
  })

  it('parses quoted and plain single-line fields without swallowing comments', () => {
    expect(parseSkillFrontmatter('---\nname: \'quoted\'\ndescription: "one line" # maintainer note\nlayer: plan\n---\nBody\n', 'fallback')).toMatchObject({
      name: 'quoted',
      description: 'one line',
      metadata: { layer: 'plan' },
    })
  })

  it.each([
    ['"C# # topic" # maintainer note', 'C# # topic'],
    ["'C# # topic' # maintainer note", 'C# # topic'],
  ])('keeps # inside a quoted scalar: %s', (source, expected) => {
    const parsed = parseSkillFrontmatter(`---\nname: fixture\ndescription: ${source}\nlayer: plan\n---\nBody\n`, 'fallback')
    expect(parsed.description).toBe(expected)
  })
})
