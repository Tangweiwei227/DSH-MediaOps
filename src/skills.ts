import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { parseSkillFrontmatter } from './skill-frontmatter.ts'

export { parseSkillFrontmatter } from './skill-frontmatter.ts'

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
图像、视频、音乐和云端语音凭证由 Host 的“多模态模型”设置页单独保管；不得读取该秘密文件、索要或回显 API Key。调用 ai_image.py、ai_video.py、ai_music.py 或 voice_clone.py 的远程能力时，必须使用 mediaops_run_model_script，把脚本逻辑名和原有子命令/参数放入该工具；不要通过 bash 直接运行这些脚本，也不要传 --env-file。Host 会绑定当前 workspace、注入所选 provider 的白名单环境并在计费调用前请求原生审批。
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
        const parsed = parseSkillFrontmatter(await readFile(file.path, 'utf8'), file.name)
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
        const parsed = parseSkillFrontmatter(await readFile(locator, 'utf8'), fallback)
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
