const menu = document.querySelector('[data-doc-menu]')
const mobile = window.matchMedia('(max-width: 760px)')
const syncMenu = () => { if (menu) menu.open = !mobile.matches }
syncMenu()
mobile.addEventListener('change', syncMenu)

document.querySelectorAll('.doc-content pre').forEach((pre) => {
  const code = pre.querySelector('code')
  if (!code || code.classList.contains('language-text') && code.textContent.includes('→')) return
  const wrapper = document.createElement('div')
  wrapper.className = 'doc-code'
  pre.before(wrapper)
  wrapper.append(pre)
  const button = document.createElement('button')
  button.className = 'doc-copy'
  button.type = 'button'
  button.textContent = '复制'
  button.setAttribute('aria-label', '复制这段内容')
  let timer
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent.trim())
      button.textContent = '已复制'
    } catch {
      button.textContent = '请手动复制'
    }
    clearTimeout(timer)
    timer = setTimeout(() => { button.textContent = '复制' }, 1800)
  })
  wrapper.append(button)
})

const search = document.querySelector('[data-doc-search]')
const results = document.querySelector('#doc-results')
const nav = document.querySelector('.doc-nav')
const siteRoot = document.body.dataset.siteRoot
search?.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase()
  results.replaceChildren()
  results.hidden = !query
  nav.hidden = Boolean(query)
  if (!query) return
  const terms = query.split(/\s+/)
  const matches = (window.MEDIAOPS_DOCS ?? []).filter(item => terms.every(term => `${item.title} ${item.heading} ${item.text}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.heading.toLocaleLowerCase().includes(query)) - Number(a.heading.toLocaleLowerCase().includes(query)))
    .slice(0, 10)
  if (!matches.length) {
    const empty = document.createElement('p')
    empty.textContent = '没有找到相关内容，试试“安装”“配图”或“发布”。'
    results.append(empty)
  }
  matches.forEach((item) => {
    const link = document.createElement('a')
    link.href = `${siteRoot}${item.url}`
    const title = document.createElement('strong')
    title.textContent = item.heading === item.title ? item.title : `${item.title} · ${item.heading}`
    const snippet = document.createElement('p')
    const start = Math.max(0, item.text.toLocaleLowerCase().indexOf(terms[0]) - 18)
    snippet.textContent = `${start ? '…' : ''}${item.text.slice(start, start + 80)}…`
    link.append(title, snippet)
    results.append(link)
  })
})
search?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    search.value = ''
    search.dispatchEvent(new Event('input'))
  }
  if (event.key === 'ArrowDown' && !results.hidden) {
    event.preventDefault()
    results.querySelector('a')?.focus()
  }
  if (event.key === 'Enter' && !results.hidden) results.querySelector('a')?.click()
})

if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.doc-toc a')]
  const observer = new IntersectionObserver((entries) => {
    const current = entries.find(entry => entry.isIntersecting)
    if (!current) return
    links.forEach(link => {
      if (decodeURIComponent(link.hash.slice(1)) === current.target.id) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    })
  }, { rootMargin: '-96px 0px -60% 0px' })
  document.querySelectorAll('.doc-content h2').forEach(heading => observer.observe(heading))
}
