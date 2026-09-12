import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { clearModelProvider, fetchModelConfig, updateModelProvider, verifyModelProvider } from './api.ts'
import type { ModelConfigSnapshot, ModelGroupItem, ModelProviderItem, ModelProviderUpdate } from './contracts.ts'

const EMPTY: ModelConfigSnapshot = { version: 1, groups: [] }

const styles: Record<string, CSSProperties> = {
  page: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0, overflow: 'auto', padding: 18, color: 'inherit', fontSize: 13, lineHeight: 1.5 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 20, lineHeight: 1.25 },
  subtitle: { margin: '4px 0 0', opacity: 0.68, maxWidth: 760 },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid rgba(127,127,127,.22)', paddingBottom: 8 },
  button: { border: '1px solid rgba(127,127,127,.34)', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '6px 11px' },
  primary: { border: '1px solid #2563eb', borderRadius: 8, background: '#2563eb', color: '#fff', cursor: 'pointer', font: 'inherit', padding: '7px 12px' },
  danger: { border: '1px solid rgba(239,68,68,.7)', borderRadius: 8, background: 'transparent', color: '#ef4444', cursor: 'pointer', font: 'inherit', padding: '6px 11px' },
  active: { background: 'rgba(37,99,235,.16)', borderColor: '#3b82f6' },
  disabled: { cursor: 'default', opacity: 0.5 },
  panel: { border: '1px solid rgba(127,127,127,.24)', borderRadius: 12, padding: 14, background: 'rgba(127,127,127,.045)' },
  panelTitle: { margin: '0 0 5px', fontSize: 15 },
  muted: { opacity: 0.68, fontSize: 12 },
  form: { display: 'grid', gap: 12, marginTop: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 },
  field: { display: 'grid', alignContent: 'start', gap: 4 },
  input: { boxSizing: 'border-box', width: '100%', minWidth: 160, border: '1px solid rgba(127,127,127,.34)', borderRadius: 8, background: 'rgba(127,127,127,.08)', color: 'inherit', font: 'inherit', padding: '8px 9px' },
  select: { boxSizing: 'border-box', width: '100%', border: '1px solid rgba(127,127,127,.34)', borderRadius: 8, background: 'rgba(127,127,127,.08)', color: 'inherit', font: 'inherit', padding: '8px 9px' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 99, background: 'rgba(127,127,127,.14)', padding: '2px 7px', fontSize: 11 },
  ok: { color: '#22c55e' },
  error: { color: '#ef4444' },
  warning: { borderLeft: '3px solid #f59e0b', padding: '9px 12px', background: 'rgba(245,158,11,.09)', borderRadius: '0 8px 8px 0' },
  info: { borderLeft: '3px solid #3b82f6', padding: '9px 12px', background: 'rgba(59,130,246,.08)', borderRadius: '0 8px 8px 0' },
  secretRow: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto', gap: 6 },
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function currentGroup(snapshot: ModelConfigSnapshot, groupId: string): ModelGroupItem | undefined {
  return snapshot.groups.find(item => item.id === groupId) ?? snapshot.groups[0]
}

function currentProvider(group: ModelGroupItem | undefined, providerId: string): ModelProviderItem | undefined {
  return group?.providers.find(item => item.id === providerId)
    ?? group?.providers.find(item => item.selected)
    ?? group?.providers[0]
}

export function ModelSettings() {
  const [snapshot, setSnapshot] = useState<ModelConfigSnapshot>(EMPTY)
  const [groupId, setGroupId] = useState('image')
  const [providerId, setProviderId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState(false)
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const group = useMemo(() => currentGroup(snapshot, groupId), [groupId, snapshot])
  const provider = useMemo(() => currentProvider(group, providerId), [group, providerId])

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    try {
      const next = await fetchModelConfig(controller.signal)
      if (!controller.signal.aborted) setSnapshot(next)
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ kind: 'error', text: `读取模型配置失败：${errorText(error)}` })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => controllerRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (!group) return
    if (group.id !== groupId) setGroupId(group.id)
    const next = currentProvider(group, providerId)
    if (!next) return
    if (next.id !== providerId) setProviderId(next.id)
  }, [group, groupId, providerId])

  useEffect(() => {
    if (!provider) return
    setValues(Object.fromEntries(provider.fields.filter(field => !field.secret).map(field => [field.key, field.value ?? ''])))
    setSecrets({})
    setEnabled(provider.enabled)
    setAllowPrivateNetwork(provider.allowPrivateNetwork)
  }, [group?.id, provider?.id, provider?.updatedAt])

  const selectGroup = useCallback((next: ModelGroupItem) => {
    setGroupId(next.id)
    setProviderId(next.selectedProvider ?? next.providers[0]?.id ?? '')
    setMessage(null)
  }, [])

  const save = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!group || !provider) return
    if (allowPrivateNetwork && !provider.allowPrivateNetwork && !window.confirm('允许私网后，该 provider 可以连接内网地址。只有在你信任此 API 端点时继续。')) return
    setSaving(true)
    setMessage(null)
    try {
      const update: ModelProviderUpdate = {
        enabled,
        allowPrivateNetwork,
        setAsDefault: true,
        values: Object.fromEntries(provider.fields.filter(field => !field.secret).map(field => [field.key, field.kind === 'boolean' ? values[field.key] === '1' : values[field.key] ?? ''])),
        secretChanges: Object.fromEntries(provider.fields.filter(field => field.secret).map(field => {
          const value = secrets[field.key]?.trim() ?? ''
          return [field.key, value ? { action: 'replace' as const, value } : { action: 'keep' as const }]
        })),
      }
      const next = await updateModelProvider(group.id, provider.id, update)
      setSnapshot(next)
      setSecrets({})
      setMessage({ kind: 'ok', text: `已安全保存 ${provider.label}，并设为${group.label}默认 provider` })
    } catch (error) {
      setMessage({ kind: 'error', text: `保存失败：${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [allowPrivateNetwork, enabled, group, provider, secrets, values])

  const clearSecret = useCallback(async (key: string, label: string) => {
    if (!group || !provider || !window.confirm(`确认清除 ${provider.label} 的 ${label}？清除后无法恢复。`)) return
    setSaving(true)
    setMessage(null)
    try {
      const next = await updateModelProvider(group.id, provider.id, { secretChanges: { [key]: { action: 'clear' } } })
      setSnapshot(next)
      setSecrets(current => ({ ...current, [key]: '' }))
      setMessage({ kind: 'ok', text: `已清除 ${label}` })
    } catch (error) {
      setMessage({ kind: 'error', text: `清除失败：${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [group, provider])

  const clearProvider = useCallback(async () => {
    if (!group || !provider || !window.confirm(`确认删除 ${provider.label} 的全部配置和凭证？此操作不可恢复。`)) return
    setSaving(true)
    setMessage(null)
    try {
      const next = await clearModelProvider(group.id, provider.id)
      setSnapshot(next)
      setSecrets({})
      setMessage({ kind: 'ok', text: `已删除 ${provider.label} 的全部配置` })
    } catch (error) {
      setMessage({ kind: 'error', text: `删除失败：${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [group, provider])

  const verify = useCallback(async () => {
    if (!group || !provider) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await verifyModelProvider(group.id, provider.id)
      setMessage(result.ready
        ? { kind: 'ok', text: '离线验证通过：必填项齐全、格式有效且 provider 已启用。实际连通性会在首次受控生成时验证。' }
        : { kind: 'error', text: `验证未通过：${result.errors.join('；') || '配置不完整'}` })
    } catch (error) {
      setMessage({ kind: 'error', text: `验证失败：${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [group, provider])

  return (
    <main style={styles.page} aria-label="DSH-MediaOps 多模态模型设置">
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>多模态模型</h1>
          <p style={styles.subtitle}>集中配置文生图、文生视频、音乐与云端语音 API。密钥只保存在本机 Host，不会回传浏览器、写入业务 state 或进入对话。</p>
        </div>
        <button type="button" disabled={loading} style={loading ? { ...styles.button, ...styles.disabled } : styles.button} onClick={() => void load()}>{loading ? '加载中…' : '刷新'}</button>
      </header>

      <div style={styles.info}>实际生成由 <code>mediaops_run_model_script</code> 受控执行：固定脚本、固定 argv 白名单、当前 workspace 路径约束，并在可能产生 API 费用前请求 DSH 原生审批。</div>

      <nav style={styles.tabs} aria-label="模型类别">
        {snapshot.groups.map(item => (
          <button key={item.id} type="button" aria-current={group?.id === item.id ? 'page' : undefined} style={group?.id === item.id ? { ...styles.button, ...styles.active } : styles.button} onClick={() => selectGroup(item)}>
            {item.label}
          </button>
        ))}
      </nav>

      {message ? <div role="status" style={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</div> : null}

      {!loading && !group ? <div style={styles.panel}>Host 没有返回可用模型类别。</div> : null}
      {group ? (
        <section style={styles.panel}>
          <div style={styles.between}>
            <div>
              <h2 style={styles.panelTitle}>{group.label}</h2>
              <div style={styles.muted}>{group.description}</div>
            </div>
            <label style={styles.field}>
              <span style={styles.muted}>Provider</span>
              <select style={styles.select} value={provider?.id ?? ''} onChange={event => setProviderId(event.target.value)}>
                {group.providers.map(item => <option key={item.id} value={item.id}>{item.label}{item.selected ? '（默认）' : ''}</option>)}
              </select>
            </label>
          </div>

          {provider ? (
            <form style={styles.form} onSubmit={event => void save(event)}>
              <div style={styles.row}>
                {provider.capabilities.map(item => <span key={item} style={styles.badge}>{item}</span>)}
                <span style={provider.ready ? styles.ok : styles.muted}>{provider.ready ? '● 可运行' : provider.configured ? '○ 配置未就绪' : '○ 未配置'}</span>
              </div>

              <div style={styles.grid}>
                {provider.fields.map(field => (
                  <label key={field.key} style={styles.field}>
                    <span>{field.label}{field.required ? ' *' : ''}</span>
                    {field.secret ? (
                      <div style={styles.secretRow}>
                        <input
                          type="password"
                          autoComplete="new-password"
                          style={styles.input}
                          value={secrets[field.key] ?? ''}
                          maxLength={32_768}
                          placeholder={field.configured ? '已配置；留空保持不变' : '输入后将安全保存'}
                          onChange={event => setSecrets(current => ({ ...current, [field.key]: event.target.value }))}
                        />
                        <button type="button" disabled={!field.configured || saving} style={!field.configured || saving ? { ...styles.button, ...styles.disabled } : styles.button} onClick={() => void clearSecret(field.key, field.label)}>清除</button>
                      </div>
                    ) : field.kind === 'select' ? (
                      <select style={styles.select} value={values[field.key] ?? ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}>
                        <option value="">自动 / 未设置</option>
                        {field.choices?.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                    ) : field.kind === 'boolean' ? (
                      <input type="checkbox" checked={values[field.key] === '1'} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.checked ? '1' : '' }))} />
                    ) : (
                      <input type={field.kind === 'url' ? 'url' : 'text'} style={styles.input} value={values[field.key] ?? ''} maxLength={8_192} placeholder={field.placeholder} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} />
                    )}
                    {field.help ? <span style={styles.muted}>{field.help}</span> : null}
                  </label>
                ))}
              </div>

              <label style={styles.row}>
                <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
                启用此 provider
              </label>
              <label style={styles.row}>
                <input type="checkbox" checked={allowPrivateNetwork} onChange={event => setAllowPrivateNetwork(event.target.checked)} />
                允许私有网络地址（仅自托管 API）
              </label>
              {allowPrivateNetwork ? <div style={styles.warning}>已允许该 provider 访问内网或 HTTP 端点。仅用于你控制并信任的自托管服务；公开 SaaS 不应开启。</div> : null}
              {provider.missingRequired.length > 0 ? <div style={styles.muted}>缺少：{provider.missingRequired.join('、')}</div> : null}

              <div style={styles.row}>
                <button type="submit" disabled={saving} style={saving ? { ...styles.primary, ...styles.disabled } : styles.primary}>{saving ? '处理中…' : '保存并设为默认'}</button>
                <button type="button" disabled={saving} style={saving ? { ...styles.button, ...styles.disabled } : styles.button} onClick={() => void verify()}>离线验证</button>
                <button type="button" disabled={saving || !provider.configured} style={saving || !provider.configured ? { ...styles.danger, ...styles.disabled } : styles.danger} onClick={() => void clearProvider()}>删除全部配置</button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
