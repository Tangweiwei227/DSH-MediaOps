/** Browser-side projections of the MediaOps host API. */

export type LibraryKind = 'topic' | 'viral'

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

export interface LibraryReference {
  kind: LibraryKind
  id: string
  label: string
}

/** Keep opaque trigger values deliberately small and strictly shaped. */
export function parseLibraryReference(value: string | undefined): LibraryReference | undefined {
  if (value === undefined || value.length > 4_096) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<LibraryReference>
    if (parsed.kind !== 'topic' && parsed.kind !== 'viral') return undefined
    if (typeof parsed.id !== 'string' || parsed.id === '' || parsed.id.length > 512) return undefined
    if (typeof parsed.label !== 'string' || parsed.label === '' || parsed.label.length > 512) return undefined
    return { kind: parsed.kind, id: parsed.id, label: parsed.label }
  } catch {
    return undefined
  }
}
