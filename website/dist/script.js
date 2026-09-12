const commands = {
  mention: {
    prompt: '把 @「一个人也能跑的 AI 内容流水线」 改写成 3 个适合我的差异化选题，先展示，不要入库。',
    result: '输入框保存稳定记录 ID；发送时才序列化成有长度限制、带来源声明的模型上下文。',
  },
  action: {
    prompt: '/拉取今日爆款：微博、抖音、小红书各 10 条，按账号匹配度排序，先不要入库。',
    result: 'Agent 调用趋势工具并逐个平台报告结果；来源失败不会被伪装为空榜或成功。',
  },
  publish: {
    prompt: '准备发布这份 ready 草稿。先给我完整冻结预览；等我确认后再申请审批。',
    result: 'Host 先做 dry-run 和载荷冻结。确认授权与真实执行是两次独立审批，回执可继续对账。',
  },
}

const header = document.querySelector('[data-header]')
const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 12)
window.addEventListener('scroll', syncHeader, { passive: true })
syncHeader()

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.command
    const next = commands[key]
    if (!next) return
    document.querySelectorAll('[data-command]').forEach((item) => {
      const active = item === button
      item.classList.toggle('is-active', active)
      item.setAttribute('aria-selected', String(active))
    })
    const prompt = document.querySelector('[data-command-prompt]')
    const result = document.querySelector('[data-command-result]')
    if (prompt) prompt.textContent = next.prompt
    if (result) result.textContent = next.result
  })
})

const toast = document.querySelector('[data-toast]')
let toastTimer
document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const target = document.querySelector(button.dataset.copy)
    if (!target) return
    const value = target.textContent.replace(/^\$\s*/, '').trim()
    try {
      await navigator.clipboard.writeText(value)
      button.textContent = '已复制'
      toast?.classList.add('is-visible')
      window.clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => {
        button.textContent = '复制命令'
        toast?.classList.remove('is-visible')
      }, 1800)
    } catch {
      button.textContent = '请手动复制'
    }
  })
})

const year = document.querySelector('[data-year]')
if (year) year.textContent = String(new Date().getFullYear())
