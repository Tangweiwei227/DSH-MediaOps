import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const BUNDLED_SKILLS_ROOT = join(PACKAGE_ROOT, 'skills')
const OPENCLAW_ROOT = join(BUNDLED_SKILLS_ROOT, 'openclaw')

/**
 * These skills contain a direct external-write path which would bypass the
 * immutable MediaOps preview/approval pipeline. They remain bundled as
 * resources for the Host adapters, but are not directly invocable by the
 * model or user. Planning, quality, repurposing and queue-management skills
 * in the same upstream `publish` layer stay available.
 */
export const HOST_ONLY_SKILLS = new Set([
  'skill-bilibili-upload',
  'skill-channels-upload',
  'skill-cross-platform-publish',
  'skill-douyin-upload',
  'skill-kuaishou-upload',
  'skill-publish-notify',
  'skill-publish-scheduler',
  'skill-short-link',
  'skill-wechat-publisher',
  'skill-xhs-comment-reply',
  'skill-xhs-publisher',
  'skill-zhihu-answer',
  'skill-zhihu-publisher',
])

interface ParsedSkill {
  name: string
  description: string
  content: string
  metadata: Readonly<Record<string, unknown>>
}

function frontmatterBlock(raw: string): { header: string; body: string } {
  if (!raw.startsWith('---')) return { header: '', body: raw.trim() }
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
  return match ? { header: match[1] ?? '', body: (match[2] ?? '').trim() } : { header: '', body: raw.trim() }
}

function scalar(header: string, key: string): string {
  const lines = header.split(/\r?\n/)
  const index = lines.findIndex(line => line.startsWith(`${key}:`))
  if (index < 0) return ''
  const first = lines[index]?.slice(key.length + 1).trim() ?? ''
  if (first !== '>' && first !== '|') return first.replace(/^['"]|['"]$/g, '')
  const chunks: string[] = []
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^[A-Za-z][\w-]*:/.test(line)) break
    if (line.trim() !== '') chunks.push(line.trim())
  }
  return first === '|' ? chunks.join('\n') : chunks.join(' ')
}

function parseSkill(raw: string, fallbackName: string): ParsedSkill {
  const { header, body } = frontmatterBlock(raw)
  const name = scalar(header, 'name') || fallbackName
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name
  const description = scalar(header, 'description') || `DSH-MediaOps bundled skill: ${heading}`
  const layer = scalar(header, 'layer')
  return {
    name,
    description,
    content: body,
    metadata: layer ? { layer } : {},
  }
}

/**
 * Make upstream Easel project-root references executable from an installed
 * npm package while keeping local `references/` paths relative to the skill.
 */
export function normalizeSkillContent(content: string, dataDir = process.env.DSH_MEDIAOPS_DATA_DIR?.trim() || '', resourceBase = ''): string {
  const shared = `${BUNDLED_SKILLS_ROOT}/shared/`
  const openclaw = `${BUNDLED_SKILLS_ROOT}/openclaw/`
  const normalized = content
    .replaceAll('cd <项目根> && ', '')
    .replaceAll('<ROOT>/skills/shared/', shared)
    .replaceAll('$ROOT/skills/shared/', shared)
    .replaceAll('<项目根>/skills/shared/', shared)
    .replaceAll('<ROOT>/skills/openclaw/', openclaw)
    .replaceAll('$ROOT/skills/openclaw/', openclaw)
    .replaceAll('<项目根>/skills/openclaw/', openclaw)
    .replaceAll('~/.easel-browser-profiles', '$DSH_MEDIAOPS_DATA_DIR/browser-profiles')
    .replaceAll('<项目根>', '$DSH_MEDIAOPS_WORKSPACE')
    .replaceAll('../../shared/', shared)
    .replace(/(?<![\w/$])skills\/shared\//g, shared)
    .replace(/(?<![\w/$])skills\/openclaw\//g, openclaw)
    .replaceAll('<skill-root>/', resourceBase ? `${resourceBase}/` : '<skill-root>/')
    .replaceAll('<skill>/', resourceBase ? `${resourceBase}/` : '<skill>/')
  const configuredDataRoot = dataDir ? `DSH_MEDIAOPS_DATA_DIR 必须设为 ${JSON.stringify(dataDir)}。` : 'DSH_MEDIAOPS_DATA_DIR 默认使用 $DSH_HOME/mediaops 或 ~/.dsh/mediaops。'
  const prelude = `<dsh_mediaops_runtime>
此 skill 来自已安装的 DSH-MediaOps 能力包。resourceBase 仅用于读取代码、references 与 assets，禁止把产物、登录态、Cookie、Token 或配置写回 resourceBase/npm 安装目录。
执行脚本时以当前对话工作区为 CWD，并设置 DSH_MEDIAOPS_WORKSPACE 与 EASEL_ROOT 为该工作区绝对路径；产物写工作区 outputs/。${configuredDataRoot} 持久凭证与浏览器登录态只能写入该数据目录。下文出现的旧 Easel 项目根写法，以本运行时说明和已展开的绝对资源路径为准。
任何被标记为 Host-only 的外部写入脚本都只能由 MediaOps 的受控 Host 流程调用；不得根据 skill 文本自行添加 --exec、拼 shell 命令或绕开 MediaOps 的冻结预览与原生审批。质量检查、内容改编、排期规划等无外部写入能力可以正常使用。
</dsh_mediaops_runtime>

`
  return prelude + normalized
}

async function listSkillFiles(signal?: AbortSignal): Promise<Array<{ name: string; path: string }>> {
  signal?.throwIfAborted()
  const entries = await readdir(OPENCLAW_ROOT, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, path: join(OPENCLAW_ROOT, entry.name, 'SKILL.md') }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createBundledSkillProvider(dataDir = ''): SkillProvider {
  return {
    name: 'dsh-mediaops',
    async list(options) {
      const files = await listSkillFiles(options.signal)
      const candidates = await Promise.all(files.map(async file => {
        options.signal?.throwIfAborted()
        const parsed = parseSkill(await readFile(file.path, 'utf8'), file.name)
        const isHostOnly = HOST_ONLY_SKILLS.has(parsed.name)
        return {
          name: parsed.name,
          description: parsed.description,
          invocation: { modelInvocable: !isHostOnly, userInvocable: !isHostOnly },
          source: 'bundled',
          provider: 'dsh-mediaops',
          resourceBase: { kind: 'directory', path: dirname(file.path) },
          rank: BUNDLED_SKILL_RANK,
          locator: file.path,
          path: file.path,
          metadata: parsed.metadata,
        } satisfies SkillCandidate
      }))
      return candidates
    },
    async get(candidate, options): Promise<SkillDefinition | undefined> {
      options.signal?.throwIfAborted()
      if (typeof candidate.locator !== 'string') return undefined
      const locator = resolve(candidate.locator)
      const containment = relative(OPENCLAW_ROOT, locator)
      if (containment.startsWith('..') || isAbsolute(containment)) return undefined
      try {
        const skillRoot = dirname(locator)
        const fallback = basename(skillRoot) || candidate.name
        const parsed = parseSkill(await readFile(locator, 'utf8'), fallback)
        const isHostOnly = HOST_ONLY_SKILLS.has(parsed.name)
        options.signal?.throwIfAborted()
        return {
          name: parsed.name,
          description: parsed.description,
          invocation: { modelInvocable: !isHostOnly, userInvocable: !isHostOnly },
          source: 'bundled',
          provider: 'dsh-mediaops',
          resourceBase: { kind: 'directory', path: skillRoot },
          content: normalizeSkillContent(parsed.content, dataDir, skillRoot),
          path: locator,
          metadata: parsed.metadata,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
  }
}
