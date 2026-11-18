import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docsDigest, documents } from './docs-config.mjs'

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

try {
  const saved = (await readFile(join(output, 'docs/source-digest.txt'), 'utf8')).trim()
  if (saved !== await docsDigest()) errors.push('文档源文件有更新，请运行 npm run build --prefix website')
} catch {
  errors.push('缺少文档生成产物，请运行 npm run build --prefix website')
}

async function htmlFiles(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await htmlFiles(path))
    else if (entry.name.endsWith('.html')) paths.push(path)
  }
  return paths
}
const pages = await htmlFiles(output)
const base = new URL('https://pages.xiaotangtevin.top/DSH-MediaOps/')
const contents = new Map(await Promise.all(pages.map(async path => [path, await readFile(path, 'utf8')])))
for (const [path, content] of contents) {
  const name = relative(output, path)
  const ids = [...content.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1])
  if (new Set(ids).size !== ids.length) errors.push(`${name}: 重复章节 ID`)
  if (!/<html\s+lang="zh-CN"/u.test(content) || !/<main\s+id="main"/u.test(content)) errors.push(`${name}: 缺少语义结构`)
  if ((content.match(/<h1\b/gu) ?? []).length !== 1) errors.push(`${name}: 必须有一个主标题`)
  if (name.startsWith('docs/') && !content.includes('aria-current="page"')) errors.push(`${name}: 导航缺少当前页`)
  for (const [, raw] of content.matchAll(/(?:href|src)="([^"]+)"/gu)) {
    if (/^https:\/\/(?:github\.com\/Tangweiwei227\/DSH-MediaOps\/blob\/|raw\.githubusercontent\.com\/Tangweiwei227\/DSH-MediaOps\/).*\.md(?:#|$)/iu.test(raw)) {
      errors.push(`${name}: 文档不应跳到 GitHub Markdown: ${raw}`)
      continue
    }
    const url = new URL(raw.replace(/&amp;/g, '&'), new URL(name, base))
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue
    let target = resolve(output, decodeURIComponent(url.pathname.slice(base.pathname.length)))
    try {
      if ((await stat(target)).isDirectory()) target = join(target, 'index.html')
      await access(target)
      if (url.hash && target.endsWith('.html')) {
        const targetHtml = contents.get(target) ?? await readFile(target, 'utf8')
        if (!targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) errors.push(`${name}: 章节不存在 ${raw}`)
      }
    } catch {
      errors.push(`${name}: 本地链接不存在 ${raw}`)
    }
  }
}
for (const item of documents) {
  const path = join(output, 'docs', item.slug, 'index.html')
  if (!contents.has(path)) errors.push(`文档缺失: ${item.title}`)
}

if (errors.length > 0) {
  console.error(errors.map(error => `- ${error}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Website check passed (${pages.length} pages, local assets and anchors, documentation freshness).`)
}
