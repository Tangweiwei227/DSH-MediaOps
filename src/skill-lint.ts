import { frontmatterKeyCounts, frontmatterScalar, parseSkillFrontmatter, splitSkillFrontmatter } from './skill-frontmatter.ts'

export const SKILL_LAYERS = new Set(['attribute', 'discover', 'general', 'plan', 'produce', 'publish'])

export interface SkillFrontmatterSource {
  path: string
  fallbackName: string
  raw: string
}

export interface SkillFrontmatterLintError {
  path: string
  message: string
}

export function lintSkillFrontmatterSources(sources: readonly SkillFrontmatterSource[]): SkillFrontmatterLintError[] {
  const errors: SkillFrontmatterLintError[] = []
  const names = new Map<string, string>()
  for (const source of sources) {
    try {
      const block = splitSkillFrontmatter(source.raw)
      if (!block.hasFrontmatter) {
        errors.push({ path: source.path, message: '缺少 YAML frontmatter' })
        continue
      }
      const counts = frontmatterKeyCounts(block.header)
      for (const key of ['name', 'description', 'layer']) {
        if (counts.get(key) !== 1) errors.push({ path: source.path, message: `${key} 必须恰好出现一次` })
      }
      const declaredName = frontmatterScalar(block.header, 'name').trim()
      const declaredDescription = frontmatterScalar(block.header, 'description').trim()
      const layer = frontmatterScalar(block.header, 'layer').trim()
      if (declaredName === '') errors.push({ path: source.path, message: 'name 不能为空' })
      if (declaredDescription === '' || /^[>|][+-]?$/u.test(declaredDescription)) {
        errors.push({ path: source.path, message: 'description 不能为空，且不能是未解析的块标量指示符' })
      }
      if (!SKILL_LAYERS.has(layer)) {
        errors.push({ path: source.path, message: `layer 必须是 ${[...SKILL_LAYERS].join(' / ')}` })
      }
      const parsed = parseSkillFrontmatter(source.raw, source.fallbackName)
      const previous = names.get(parsed.name)
      if (previous !== undefined) {
        errors.push({ path: source.path, message: `name 重复: ${parsed.name}（首次出现于 ${previous}）` })
      } else {
        names.set(parsed.name, source.path)
      }
    } catch (error) {
      errors.push({ path: source.path, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return errors
}
