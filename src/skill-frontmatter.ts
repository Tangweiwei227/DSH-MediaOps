/**
 * The bundled skill files only need top-level string fields, but block string
 * handling follows YAML 1.2's literal/folded and chomping rules. Keeping this
 * parser dependency-free lets the repository lint the vendored snapshot before
 * the plugin bundle is built.
 */

export interface SkillFrontmatterBlock {
  hasFrontmatter: boolean
  header: string
  body: string
}

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  content: string
  metadata: Readonly<Record<string, unknown>>
}

interface BlockHeader {
  style: 'folded' | 'literal'
  chomp: 'clip' | 'strip' | 'keep'
  indentation?: number
}

interface BlockLine {
  text: string
  moreIndented: boolean
}

export class SkillFrontmatterSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillFrontmatterSyntaxError'
  }
}

export function splitSkillFrontmatter(raw: string): SkillFrontmatterBlock {
  const opening = raw.match(/^\uFEFF?---[ \t]*(?:\r?\n|$)/)
  if (!opening) return { hasFrontmatter: false, header: '', body: raw.trim() }
  const rest = raw.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest)
  if (!closing) throw new SkillFrontmatterSyntaxError('frontmatter 缺少结束分隔符 ---')
  return {
    hasFrontmatter: true,
    header: rest.slice(0, closing.index),
    body: rest.slice(closing.index + closing[0].length).trim(),
  }
}

function indentationOf(line: string): number {
  const spaces = line.match(/^ */)?.[0].length ?? 0
  if (line[spaces] === '\t') throw new SkillFrontmatterSyntaxError('YAML 缩进不能使用制表符')
  return spaces
}

function parseBlockHeader(value: string): BlockHeader | undefined {
  const token = value.replace(/[ \t]+#.*$/u, '').trim()
  const match = /^([>|])([+\-1-9]?)([+\-1-9]?)$/u.exec(token)
  if (!match) return undefined
  const modifiers = [match[2] ?? '', match[3] ?? ''].filter(Boolean)
  const chomps = modifiers.filter(value => value === '+' || value === '-')
  const indentations = modifiers.filter(value => /^[1-9]$/u.test(value))
  if (chomps.length > 1 || indentations.length > 1) {
    throw new SkillFrontmatterSyntaxError(`无效的 YAML 块标量指示符: ${token}`)
  }
  const chomp = chomps[0] === '-' ? 'strip' : chomps[0] === '+' ? 'keep' : 'clip'
  const indentation = indentations[0] === undefined ? undefined : Number(indentations[0])
  return {
    style: match[1] === '|' ? 'literal' : 'folded',
    chomp,
    ...(indentation === undefined ? {} : { indentation }),
  }
}

function decodeInlineScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("'")) {
    let end = -1
    for (let index = 1; index < trimmed.length; index += 1) {
      if (trimmed[index] !== "'") continue
      if (trimmed[index + 1] === "'") {
        index += 1
        continue
      }
      end = index
      break
    }
    if (end < 0) throw new SkillFrontmatterSyntaxError('单引号 YAML 标量缺少结束引号')
    const suffix = trimmed.slice(end + 1).trim()
    if (suffix !== '' && !suffix.startsWith('#')) throw new SkillFrontmatterSyntaxError('引号 YAML 标量后只能跟注释')
    return trimmed.slice(1, end).replaceAll("''", "'")
  }
  if (trimmed.startsWith('"')) {
    let end = -1
    let escaped = false
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index]
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        end = index
        break
      }
    }
    if (end < 0) throw new SkillFrontmatterSyntaxError('双引号 YAML 标量缺少结束引号')
    const quoted = trimmed.slice(0, end + 1)
    const suffix = trimmed.slice(end + 1).trim()
    if (suffix !== '' && !suffix.startsWith('#')) throw new SkillFrontmatterSyntaxError('引号 YAML 标量后只能跟注释')
    try {
      return JSON.parse(quoted) as string
    } catch {
      return quoted.slice(1, -1)
    }
  }
  return trimmed.replace(/[ \t]+#.*$/u, '').trim()
}

function foldBlockLines(lines: readonly BlockLine[]): string {
  let value = ''
  let index = 0
  while (index < lines.length && lines[index]?.text === '') {
    value += '\n'
    index += 1
  }
  while (index < lines.length) {
    const current = lines[index]
    if (!current || current.text === '') {
      index += 1
      continue
    }
    value += current.text
    let nextIndex = index + 1
    while (nextIndex < lines.length && lines[nextIndex]?.text === '') nextIndex += 1
    const emptyLines = nextIndex - index - 1
    const next = lines[nextIndex]
    if (!next) {
      value += '\n'.repeat(emptyLines)
      break
    }
    if (current.moreIndented || next.moreIndented) {
      value += '\n'.repeat(emptyLines + 1)
    } else if (emptyLines > 0) {
      value += '\n'.repeat(emptyLines)
    } else {
      value += ' '
    }
    index = nextIndex
  }
  return value
}

function applyChomping(value: string, chomp: BlockHeader['chomp'], hasContent: boolean): string {
  if (chomp === 'keep') return value
  const stripped = value.replace(/\n+$/u, '')
  if (chomp === 'strip' || !hasContent) return stripped
  return `${stripped}\n`
}

function blockScalar(lines: readonly string[], keyLine: number, header: BlockHeader): string {
  const collected: string[] = []
  for (let index = keyLine + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      collected.push(line)
      continue
    }
    const indentation = indentationOf(line)
    if (indentation === 0) break
    collected.push(line)
  }

  const firstContentLine = collected.find(line => line.trim() !== '')
  const contentIndent = header.indentation ?? (firstContentLine === undefined ? 1 : indentationOf(firstContentLine))
  const normalized: BlockLine[] = collected.map((line) => {
    if (line.trim() === '') return { text: '', moreIndented: false }
    const indentation = indentationOf(line)
    if (indentation < contentIndent) {
      throw new SkillFrontmatterSyntaxError(`块标量内容缩进至少需要 ${contentIndent} 个空格`)
    }
    return { text: line.slice(contentIndent), moreIndented: indentation > contentIndent }
  })
  const hasContent = normalized.some(line => line.text !== '')
  const value = header.style === 'literal'
    ? normalized.map(line => line.text).join('\n')
    : foldBlockLines(normalized)
  return applyChomping(value, header.chomp, hasContent)
}

export function frontmatterScalar(header: string, key: string): string {
  const lines = header.split(/\r?\n/u)
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[ \\t]*:`)
  const index = lines.findIndex(line => keyPattern.test(line))
  if (index < 0) return ''
  const line = lines[index] ?? ''
  const colon = line.indexOf(':')
  const first = line.slice(colon + 1).trim()
  const block = parseBlockHeader(first)
  return block === undefined ? decodeInlineScalar(first) : blockScalar(lines, index, block)
}

export function frontmatterKeyCounts(header: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const line of header.split(/\r?\n/u)) {
    const match = /^([A-Za-z][\w-]*)[ \t]*:/u.exec(line)
    if (!match?.[1]) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return counts
}

export function parseSkillFrontmatter(raw: string, fallbackName: string): ParsedSkillFrontmatter {
  const { header, body } = splitSkillFrontmatter(raw)
  const name = frontmatterScalar(header, 'name') || fallbackName
  const heading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? name
  const description = frontmatterScalar(header, 'description') || `DSH-MediaOps bundled skill: ${heading}`
  const layer = frontmatterScalar(header, 'layer')
  return {
    name,
    description,
    content: body,
    metadata: layer ? { layer } : {},
  }
}
