import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { createTopic, fetchWorkbench, promoteViral } from './api.ts'
import type {
  DraftItem,
  PublicationItem,
  TopicItem,
  ViralItem,
  WorkbenchSnapshot,
} from './contracts.ts'

type TabId = 'overview' | 'topics' | 'viral' | 'drafts' | 'publications'

const EMPTY: WorkbenchSnapshot = {
  overview: {},
  topics: [],
  viral: [],
  drafts: [],
  publications: [],
}

const styles: Record<string, CSSProperties> = {
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    height: '100%',
    minHeight: 0,
    overflow: 'auto',
    padding: 18,
    color: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 20, lineHeight: 1.25 },
  subtitle: { margin: '4px 0 0', opacity: 0.68, maxWidth: 720 },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid rgba(127,127,127,.22)', paddingBottom: 8 },
  button: {
    border: '1px solid rgba(127,127,127,.34)',
    borderRadius: 8,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    padding: '6px 11px',
  },
  buttonPrimary: {
    border: '1px solid #2563eb',
    borderRadius: 8,
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    font: 'inherit',
    padding: '6px 12px',
  },
  buttonActive: { background: 'rgba(37,99,235,.16)', borderColor: '#3b82f6' },
  disabled: { cursor: 'default', opacity: 0.5 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 },
  metric: { border: '1px solid rgba(127,127,127,.24)', borderRadius: 12, padding: 12, background: 'rgba(127,127,127,.06)' },
  metricValue: { display: 'block', fontSize: 24, fontWeight: 650, lineHeight: 1.2 },
  metricLabel: { display: 'block', marginTop: 4, opacity: 0.65 },
  panel: { border: '1px solid rgba(127,127,127,.24)', borderRadius: 12, padding: 14, background: 'rgba(127,127,127,.045)' },
  panelTitle: { margin: '0 0 10px', fontSize: 15 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 },
  card: { border: '1px solid rgba(127,127,127,.22)', borderRadius: 10, padding: 12, minWidth: 0, background: 'rgba(127,127,127,.045)' },
  cardTitle: { margin: 0, fontSize: 14, overflowWrap: 'anywhere' },
  muted: { opacity: 0.66, fontSize: 12 },
  body: { margin: '7px 0', opacity: 0.86, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 99, background: 'rgba(127,127,127,.14)', padding: '2px 7px', fontSize: 11 },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    minWidth: 180,
    border: '1px solid rgba(127,127,127,.34)',
    borderRadius: 8,
    background: 'rgba(127,127,127,.08)',
    color: 'inherit',
    font: 'inherit',
    padding: '7px 9px',
  },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' },
  ok: { color: '#22c55e' },
  error: { color: '#ef4444' },
  empty: { border: '1px dashed rgba(127,127,127,.35)', borderRadius: 10, padding: 18, textAlign: 'center', opacity: 0.7 },
  callout: { borderLeft: '3px solid #3b82f6', padding: '9px 12px', background: 'rgba(59,130,246,.08)', borderRadius: '0 8px 8px 0' },
}

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'topics', label: '选题库' },
  { id: 'viral', label: '爆款库' },
  { id: 'drafts', label: '草稿' },
  { id: 'publications', label: '发布队列' },
]

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function StatusBadge({ value }: { value: string | undefined }) {
  return value === undefined ? null : <span style={styles.badge}>{value}</span>
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={styles.empty}>{children}</div>
}

function TopicCard({ item, onCopy }: { item: TopicItem; onCopy: (item: TopicItem) => void }) {
  return (
    <article style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={styles.cardTitle}>{item.title}</h3>
        <StatusBadge value={item.status} />
      </div>
      {item.angle !== undefined ? <div style={styles.body}>{item.angle}</div> : null}
      {item.summary !== undefined ? <div style={styles.muted}>{item.summary}</div> : null}
      <div style={{ ...styles.row, marginTop: 10 }}>
        {item.tags?.slice(0, 5).map((tag) => <span key={tag} style={styles.badge}>#{tag}</span>)}
        <button type="button" style={styles.button} onClick={() => onCopy(item)}>复制定位文本</button>
      </div>
      {formatTime(item.updatedAt) !== undefined ? <div style={{ ...styles.muted, marginTop: 8 }}>更新于 {formatTime(item.updatedAt)}</div> : null}
    </article>
  )
}

function ViralCard({ item, busy, onPromote }: { item: ViralItem; busy: boolean; onPromote: (item: ViralItem) => void }) {
  const href = safeUrl(item.url)
  return (
    <article style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={styles.cardTitle}>{item.title}</h3>
        {item.platform !== undefined ? <span style={styles.badge}>{item.platform}</span> : null}
      </div>
      {item.summary !== undefined ? <div style={styles.body}>{item.summary}</div> : null}
      <div style={styles.row}>
        {item.hot !== undefined ? <span style={styles.muted}>热度 {item.hot}</span> : null}
        {item.author !== undefined ? <span style={styles.muted}>作者 {item.author}</span> : null}
      </div>
      <div style={{ ...styles.row, marginTop: 10 }}>
        {href !== undefined ? <a href={href} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>查看来源</a> : null}
        <button
          type="button"
          disabled={busy}
          style={busy ? { ...styles.buttonPrimary, ...styles.disabled } : styles.buttonPrimary}
          onClick={() => onPromote(item)}
        >
          {busy ? '整理中…' : '整理为选题'}
        </button>
      </div>
    </article>
  )
}

function DraftCard({ item }: { item: DraftItem }) {
  return (
    <article style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={styles.cardTitle}>{item.title}</h3>
        <StatusBadge value={item.status} />
      </div>
      {item.body !== undefined ? <div style={styles.body}>{item.body.slice(0, 240)}{item.body.length > 240 ? '…' : ''}</div> : null}
      <div style={styles.row}>
        {item.platforms?.map((platform) => <span key={platform} style={styles.badge}>{platform}</span>)}
      </div>
    </article>
  )
}

function PublicationCard({ item }: { item: PublicationItem }) {
  const href = safeUrl(item.resultUrl)
  return (
    <article style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={styles.cardTitle}>{item.title ?? `发布任务 ${item.id.slice(0, 8)}`}</h3>
        <StatusBadge value={item.status} />
      </div>
      <div style={{ ...styles.row, marginTop: 8 }}>
        {item.platform !== undefined ? <span style={styles.badge}>{item.platform}</span> : null}
        {href !== undefined ? <a href={href} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>查看结果</a> : null}
      </div>
      {item.error !== undefined ? <div style={{ ...styles.error, marginTop: 8 }}>{item.error}</div> : null}
      {formatTime(item.updatedAt ?? item.createdAt) !== undefined
        ? <div style={{ ...styles.muted, marginTop: 8 }}>{formatTime(item.updatedAt ?? item.createdAt)}</div>
        : null}
    </article>
  )
}

export interface MediaOpsWorkbenchProps {
  compact?: boolean
}

/** Shared workbench used by both the conversation tab and settings navigation. */
export function MediaOpsWorkbench({ compact = false }: MediaOpsWorkbenchProps) {
  const [tab, setTab] = useState<TabId>('overview')
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [title, setTitle] = useState('')
  const [angle, setAngle] = useState('')
  const [tags, setTags] = useState('')
  const [creating, setCreating] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    try {
      const next = await fetchWorkbench(controller.signal)
      if (!controller.signal.aborted) {
        setSnapshot(next)
        setMessage(null)
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ kind: 'error', text: `读取 MediaOps 数据失败：${errorText(error)}` })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => controllerRef.current?.abort()
  }, [reload])

  const counts = useMemo(() => ({
    skills: snapshot.overview.skillCount ?? 112,
    topics: snapshot.overview.topicCount ?? snapshot.topics.length,
    viral: snapshot.overview.viralCount ?? snapshot.viral.length,
    drafts: snapshot.overview.draftCount ?? snapshot.drafts.length,
    published: snapshot.overview.publishedCount
      ?? snapshot.publications.filter((item) => item.status === 'published').length,
  }), [snapshot])

  const submitTopic = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (cleanTitle === '') {
      setMessage({ kind: 'error', text: '请先填写选题标题' })
      return
    }
    setCreating(true)
    setMessage(null)
    try {
      const topic = await createTopic({
        title: cleanTitle,
        angle: angle.trim() || undefined,
        tags: tags.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
      })
      setTitle('')
      setAngle('')
      setTags('')
      await reload()
      setMessage({ kind: 'ok', text: `已创建选题「${topic.title}」` })
      setTab('topics')
    } catch (error) {
      setMessage({ kind: 'error', text: `创建失败：${errorText(error)}` })
    } finally {
      setCreating(false)
    }
  }, [angle, reload, tags, title])

  const promote = useCallback(async (item: ViralItem) => {
    setPromoting(item.id)
    setMessage(null)
    try {
      const topic = await promoteViral(item.id)
      await reload()
      setMessage({ kind: 'ok', text: `已把「${item.title}」整理为选题「${topic.title}」` })
      setTab('topics')
    } catch (error) {
      setMessage({ kind: 'error', text: `整理失败：${errorText(error)}` })
    } finally {
      setPromoting(null)
    }
  }, [reload])

  const copyTopic = useCallback(async (item: TopicItem) => {
    const label = item.title.replace(/[\[\]()\r\n]/gu, ' ').slice(0, 160)
    const value = `@[${label}](dsh-mediaops:topic:${encodeURIComponent(item.id)})`
    try {
      if (navigator.clipboard === undefined) throw new Error('当前环境不支持剪贴板')
      await navigator.clipboard.writeText(value)
      setMessage({ kind: 'ok', text: `已复制「${item.title}」的定位文本；要发送完整结构化资料，请在对话输入框键入 @ 并从选题库选择` })
    } catch (error) {
      setMessage({ kind: 'error', text: `复制失败：${errorText(error)}` })
    }
  }, [])

  return (
    <main style={compact ? { ...styles.page, height: 'auto', padding: '4px 2px' } : styles.page} aria-label="DSH-MediaOps 工作台">
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>DSH-MediaOps</h1>
          <p style={styles.subtitle}>从爆款发现、选题沉淀、内容生产到审核发布，都可以直接在对话中完成。</p>
        </div>
        <div style={styles.row}>
          {snapshot.overview.version !== undefined ? <span style={styles.badge}>v{snapshot.overview.version}</span> : null}
          <button type="button" style={loading ? { ...styles.button, ...styles.disabled } : styles.button} disabled={loading} onClick={() => void reload()}>
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </header>

      <nav style={styles.tabs} aria-label="MediaOps 数据视图">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            style={tab === item.id ? { ...styles.button, ...styles.buttonActive } : styles.button}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {message !== null ? <div role="status" style={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</div> : null}

      {tab === 'overview' ? (
        <>
          <section style={styles.metrics} aria-label="MediaOps 概览数据">
            {[
              ['能力', counts.skills],
              ['选题', counts.topics],
              ['爆款', counts.viral],
              ['草稿', counts.drafts],
              ['已发布', counts.published],
            ].map(([label, value]) => (
              <div key={String(label)} style={styles.metric}>
                <strong style={styles.metricValue}>{value}</strong>
                <span style={styles.metricLabel}>{label}</span>
              </div>
            ))}
          </section>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>对话即工作台</h2>
            <div style={styles.callout}>
              在输入框键入 <strong>@</strong> 可引用选题库或爆款库；键入 <strong>/</strong> 可启动爆款发现、整理、创作、发布与盘点流程。发布流程会先生成预览，只有明确确认后才执行。
            </div>
          </section>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>快速创建选题</h2>
            <form style={styles.formGrid} onSubmit={(event) => void submitTopic(event)}>
              <label>
                <span style={styles.muted}>标题</span>
                <input style={styles.input} value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 团队如何做内容复盘" />
              </label>
              <label>
                <span style={styles.muted}>切入角度</span>
                <input style={styles.input} value={angle} maxLength={500} onChange={(event) => setAngle(event.target.value)} placeholder="受众、冲突或新鲜观点" />
              </label>
              <label>
                <span style={styles.muted}>标签</span>
                <input style={styles.input} value={tags} maxLength={300} onChange={(event) => setTags(event.target.value)} placeholder="AI, 内容运营" />
              </label>
              <button type="submit" disabled={creating} style={creating ? { ...styles.buttonPrimary, ...styles.disabled } : styles.buttonPrimary}>{creating ? '创建中…' : '创建'}</button>
            </form>
          </section>
        </>
      ) : null}

      {tab === 'topics' ? (
        <section>
          {snapshot.topics.length === 0 ? <Empty>选题库还是空的。可在概览中创建，或从爆款库整理。</Empty> : (
            <div style={styles.grid}>{snapshot.topics.map((item) => <TopicCard key={item.id} item={item} onCopy={copyTopic} />)}</div>
          )}
        </section>
      ) : null}

      {tab === 'viral' ? (
        <section>
          {snapshot.viral.length === 0 ? <Empty>爆款库还是空的。在对话框输入 `/`，选择「拉取今日爆款」开始发现。</Empty> : (
            <div style={styles.grid}>{snapshot.viral.map((item) => <ViralCard key={item.id} item={item} busy={promoting === item.id} onPromote={(value) => void promote(value)} />)}</div>
          )}
        </section>
      ) : null}

      {tab === 'drafts' ? (
        <section>
          {snapshot.drafts.length === 0 ? <Empty>暂无草稿。可在对话框 @ 一个选题，然后输入 `/` 并选择「基于选题创作」。</Empty> : (
            <div style={styles.grid}>{snapshot.drafts.map((item) => <DraftCard key={item.id} item={item} />)}</div>
          )}
        </section>
      ) : null}

      {tab === 'publications' ? (
        <section>
          {snapshot.publications.length === 0 ? <Empty>暂无发布任务。发布必须经过预览和明确确认。</Empty> : (
            <div style={styles.grid}>{snapshot.publications.map((item) => <PublicationCard key={item.id} item={item} />)}</div>
          )}
        </section>
      ) : null}
    </main>
  )
}
