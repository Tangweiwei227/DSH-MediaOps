export const MEDIA_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'kuaishou',
  'wechat-channels',
  'wechat-official',
  'zhihu',
  'bilibili',
] as const

export type MediaPlatform = (typeof MEDIA_PLATFORMS)[number]
export type TopicStatus = 'idea' | 'researching' | 'planned' | 'drafting' | 'ready' | 'published' | 'archived'
export type DraftStatus = 'draft' | 'review' | 'ready' | 'partially_published' | 'published' | 'archived'
export type PublicationStatus =
  | 'preview'
  | 'confirmed'
  | 'publishing'
  | 'submitted'
  | 'draft_created'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'cancelled'

export interface Topic {
  id: string
  title: string
  angle: string
  summary: string
  content: string
  tags: string[]
  platforms: MediaPlatform[]
  status: TopicStatus
  sourceViralIds: string[]
  references: string[]
  createdAt: string
  updatedAt: string
}

export interface ViralItem {
  id: string
  platform: string
  title: string
  url: string
  hot: string
  author: string
  summary: string
  notes: string
  tags: string[]
  source: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface Draft {
  id: string
  revision: number
  topicId: string
  title: string
  body: string
  platforms: MediaPlatform[]
  assets: string[]
  status: DraftStatus
  createdAt: string
  updatedAt: string
}

export interface PublicationSnapshot {
  draftId: string
  draftRevision: number
  draftUpdatedAt: string
  workspaceRoot: string
  title: string
  body: string
  bodyPath: string
  bodySha256: string
  assets: string[]
  assetManifest: Array<{
    source: string
    frozenPath: string
    sha256: string
    sizeBytes: number
  }>
  platform: MediaPlatform
  accountLabel: string
  /** Non-secret SHA-256 identity observed by the Host account probe. */
  accountIdentity: string
  scheduledAt: string
  preflightEvidence: string
  publisherOptions: Record<string, unknown>
  payloadDigest: string
}

export interface Publication {
  id: string
  draftId: string
  platform: MediaPlatform
  status: PublicationStatus
  skillName: string
  idempotencyKey: string
  confirmationTokenHash: string
  /** Host-only lease; never exposed as a tool argument. */
  executionLeaseId: string
  executionLeaseExpiresAt: string
  expiresAt: string
  snapshot: PublicationSnapshot
  externalUrl: string
  resultEvidence: string
  error: string
  createdAt: string
  updatedAt: string
}

/** Safe projection for tools and HTTP clients. Secrets and full post bodies stay host-side. */
export interface PublicationView {
  id: string
  draftId: string
  platform: MediaPlatform
  status: PublicationStatus
  skillName: string
  title: string
  accountLabel: string
  scheduledAt: string
  payloadDigest: string
  bodyChars: number
  assetCount: number
  executionLeaseExpiresAt: string
  expiresAt: string
  externalUrl: string
  resultEvidence: string
  error: string
  createdAt: string
  updatedAt: string
}

export interface MediaOpsState {
  version: 5
  topics: Topic[]
  viralItems: ViralItem[]
  drafts: Draft[]
  publications: Publication[]
}

export interface TrendItem {
  platform: string
  title: string
  url: string
  hot: string
  author: string
  summary: string
  rank: number
  source: string
}

export const EMPTY_STATE: MediaOpsState = {
  version: 5,
  topics: [],
  viralItems: [],
  drafts: [],
  publications: [],
}
