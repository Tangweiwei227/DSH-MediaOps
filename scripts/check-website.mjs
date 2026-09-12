import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const website = join(root, 'website')
const output = join(website, 'dist')
const htmlPath = join(output, 'index.html')

const html = await readFile(htmlPath, 'utf8')
const hosting = JSON.parse(await readFile(join(website, '.openai', 'hosting.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(output, 'site.webmanifest'), 'utf8'))

const errors = []
if (hosting.static?.directory !== 'dist') errors.push('website/.openai/hosting.json 必须把 static.directory 设为 dist')
if (typeof hosting.project_id !== 'string' || hosting.project_id.trim() === '') errors.push('website/.openai/hosting.json 缺少 Sites project_id')
if (!/<html\s+lang="zh-CN"/u.test(html)) errors.push('首页缺少 zh-CN 文档语言')
if (!/<meta\s+name="description"\s+content="[^"]+"/u.test(html)) errors.push('首页缺少 description 元数据')
if (!/<main\s+id="main"/u.test(html) || !/<h1\b/u.test(html)) errors.push('首页缺少 main 或 h1 语义结构')
if (manifest.name !== 'DSH-MediaOps') errors.push('site.webmanifest 名称错误')

const references = [...html.matchAll(/(?:href|src)="\.\/([^"?#]+)(?:[?#][^"]*)?"/gu)].map(match => match[1])
for (const reference of new Set(references)) {
  try {
    await access(join(output, reference))
  } catch {
    errors.push(`首页本地资源不存在: ${reference}`)
  }
}

if (errors.length > 0) {
  console.error(errors.map(error => `- ${error}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Website check passed (${new Set(references).size} local assets).`)
}
