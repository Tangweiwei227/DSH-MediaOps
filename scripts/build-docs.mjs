import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { documents, docsDigest, root } from './docs-config.mjs'

const require = createRequire(resolve(root, 'website/package.json'))
const { Marked, Renderer } = await import(require.resolve('marked'))
const template = await readFile(resolve(root, 'website/templates/docs.html'), 'utf8')
const digest = await docsDigest()
const output = resolve(root, 'website/dist/docs')
const baseUrl = 'https://pages.xiaotangtevin.top/DSH-MediaOps/'
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const plain = value => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const search = []
const pagePath = item => `docs/${item.slug ? `${item.slug}/` : ''}`

for (const [index, item] of documents.entries()) {
  const prefix = item.slug ? '../../' : '../'
  const relative = target => `${prefix}${pagePath(target)}`
  const headings = []
  const used = new Map()
  const renderer = new Renderer()
  renderer.heading = function ({ tokens, depth }) {
    const html = this.parser.parseInline(tokens)
    const label = plain(html)
    const slug = label.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
    const count = used.get(slug) ?? 0
    used.set(slug, count + 1)
    const id = `${slug}${count ? `-${count}` : ''}`
    if (depth === 2 && label !== '目录') headings.push({ id, label })
    return `<h${depth} id="${escape(id)}">${html}</h${depth}>\n`
  }
  const rewrite = href => {
    if (href.startsWith('#')) return href
    let path = href
    const github = href.match(/^https:\/\/github\.com\/Tangweiwei227\/DSH-MediaOps\/blob\/main\/(.+)$/)
    if (github) path = github[1]
    else if (/^[a-z][a-z\d+.-]*:/i.test(href)) return /^(https?:|mailto:)/i.test(href) ? href : '#'
    const hashAt = path.indexOf('#')
    const hash = hashAt < 0 ? '' : path.slice(hashAt)
    const filename = decodeURIComponent(hashAt < 0 ? path : path.slice(0, hashAt))
    const source = github ? filename : posix.normalize(posix.join(posix.dirname(item.file), filename))
    const target = documents.find(doc => doc.file === source)
    if (target) return `${relative(target)}${hash}`
    if (source === 'README.md') return `${prefix}#top`
    if (filename.endsWith('.md')) throw new Error(`Unmapped documentation link in ${item.file}: ${href}`)
    return href
  }
  renderer.link = function ({ href, title, tokens }) {
    const url = rewrite(href)
    const external = /^https?:/i.test(url) && !url.startsWith(baseUrl)
    return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''}${external ? ' target="_blank" rel="noreferrer"' : ''}>${this.parser.parseInline(tokens)}</a>`
  }
  // The content is version-controlled Markdown; raw HTML is displayed as text.
  renderer.html = ({ text }) => escape(text)
  renderer.image = ({ text }) => escape(text)
  renderer.table = function (token) {
    return `<div class="doc-table" tabindex="0" role="region" aria-label="数据表格">${Renderer.prototype.table.call(this, token)}</div>`
  }
  const sourceText = await readFile(resolve(root, item.file), 'utf8')
  const markdown = item.plain ? `# ${item.title}\n\n\`\`\`text\n${sourceText}\n\`\`\`` : sourceText
  const parser = new Marked({ renderer, gfm: true })
  const content = parser.parse(markdown)
  const navLink = doc => `<a href="${relative(doc)}"${doc === item ? ' aria-current="page"' : ''}>${escape(doc.title)}</a>`
  const nav = documents.filter(doc => !doc.technical).map(navLink).join('\n')
  const more = documents.filter(doc => doc.technical).map(navLink).join('\n')
  const toc = headings.map(heading => `<a href="#${escape(heading.id)}">${escape(heading.label)}</a>`).join('\n')
  const previous = documents[index - 1]
  const next = documents[index + 1]
  const pager = `${previous ? `<a href="${relative(previous)}"><span aria-hidden="true">←</span> ${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${relative(next)}">${escape(next.title)} <span aria-hidden="true">→</span></a>` : ''}`
  const values = { title: escape(item.title), description: escape(item.description), prefix, nav, more, toc, content, pager, canonical: `${baseUrl}${pagePath(item)}`, technicalOpen: item.technical ? ' open' : '', digest }
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown template key ${key}`)
    return values[key]
  })
  const directory = resolve(output, item.slug)
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'index.html'), html)
  // Index by section so results link directly to the relevant paragraph.
  for (const section of content.split(/(?=<h2\b)/)) {
    const heading = section.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/)
    search.push({ title: item.title, heading: heading ? plain(heading[2]) : item.title, url: `${pagePath(item)}${heading ? `#${heading[1]}` : ''}`, text: plain(section).replace(/\s+/g, ' ').trim() })
  }
}
await writeFile(resolve(output, 'search-index.js'), `window.MEDIAOPS_DOCS = ${JSON.stringify(search).replace(/</g, '\\u003c')};\n`)
await writeFile(resolve(output, 'source-digest.txt'), `${digest}\n`)
console.log(`Built ${documents.length} documentation pages and ${search.length} searchable sections.`)
