/** Browser-side projections of the MediaOps host API. */

export type LibraryKind = 'topic' | 'viral' | 'draft' | 'publication'

export interface TopicItem {
  id: string
  title: string
  angle?: string | undefined
  summary?: string | undefined
  content?: string | undefined
  tags?: string[] | undefined
  platforms?: string[] | undefined
  status?: string | undefined
  updatedAt?: string | undefined
}

export interface ViralItem {
  id: string
  title: string
  platform?: string | undefined
  author?: string | undefined
  summary?: string | undefined
  notes?: string | undefined
  url?: string | undefined
  hot?: string | number | undefined
  tags?: string[] | undefined
  updatedAt?: string | undefined
  lastSeenAt?: string | undefined
}

export interface DraftItem {
  id: string
  title: string
  topicId?: string | undefined
  body?: string | undefined
  platforms?: string[] | undefined
  status?: string | undefined
  updatedAt?: string | undefined
}

export interface PublicationItem {
  id: string
  draftId?: string | undefined
  title?: string | undefined
  platform?: string | undefined
  status?: string | undefined
  resultUrl?: string | undefined
  error?: string | undefined
  updatedAt?: string | undefined
  createdAt?: string | undefined
}

export interface Overview {
  skillCount?: number | undefined
  topicCount?: number | undefined
  viralCount?: number | undefined
  draftCount?: number | undefined
  publicationCount?: number | undefined
  publishedCount?: number | undefined
  version?: string | undefined
}

export interface WorkbenchSnapshot {
  overview: Overview
  topics: TopicItem[]
  viral: ViralItem[]
  drafts: DraftItem[]
  publications: PublicationItem[]
}

export type ModelFieldKind = 'text' | 'url' | 'select' | 'boolean'

export interface ModelFieldItem {
  key: string
  label: string
  required: boolean
  secret: boolean
  kind: ModelFieldKind
  choices?: string[] | undefined
  placeholder?: string | undefined
  help?: string | undefined
  value?: string | undefined
  configured?: boolean | undefined
}

export interface ModelProviderItem {
  id: string
  label: string
  capabilities: string[]
  enabled: boolean
  selected: boolean
  configured: boolean
  ready: boolean
  allowPrivateNetwork: boolean
  missingRequired: string[]
  fields: ModelFieldItem[]
  updatedAt?: string | undefined
}

export interface ModelGroupItem {
  id: 'image' | 'video' | 'music' | 'voice'
  label: string
  description: string
  selectedProvider?: string | undefined
  providers: ModelProviderItem[]
}

export interface ModelConfigSnapshot {
  version: number
  groups: ModelGroupItem[]
}

export type ModelSecretChange =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' }

export interface ModelProviderUpdate {
  enabled?: boolean | undefined
  allowPrivateNetwork?: boolean | undefined
  setAsDefault?: boolean | undefined
  values?: Record<string, string | boolean> | undefined
  secretChanges?: Record<string, ModelSecretChange> | undefined
}

export interface ModelValidationResult {
  configured: boolean
  ready: boolean
  errors: string[]
}

export interface LibraryReference {
  kind: LibraryKind
  id: string
  label: string
}

/** Safe, compact projection returned by the unified reference search endpoint. */
export interface ReferenceItem extends LibraryReference {
  description?: string | undefined
  hint?: string | undefined
  updatedAt?: string | undefined
}

/** Keep opaque trigger values deliberately small and strictly shaped. */
export function parseLibraryReference(value: string | undefined): LibraryReference | undefined {
  if (value === undefined || value.length > 4_096) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<LibraryReference>
    if (parsed.kind !== 'topic' && parsed.kind !== 'viral' && parsed.kind !== 'draft' && parsed.kind !== 'publication') return undefined
    if (typeof parsed.id !== 'string' || parsed.id === '' || parsed.id.length > 512) return undefined
    if (typeof parsed.label !== 'string' || parsed.label === '' || parsed.label.length > 512) return undefined
    return { kind: parsed.kind, id: parsed.id, label: parsed.label }
  } catch {
    return undefined
  }
}
