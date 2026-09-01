import { createHash } from 'node:crypto'
import type { Publication, PublicationSnapshot, PublicationView } from './types.ts'

type SnapshotBase = Omit<PublicationSnapshot, 'payloadDigest'>

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

export function snapshotBase(snapshot: PublicationSnapshot | SnapshotBase): SnapshotBase {
  return {
    draftId: snapshot.draftId,
    draftRevision: snapshot.draftRevision,
    draftUpdatedAt: snapshot.draftUpdatedAt,
    workspaceRoot: snapshot.workspaceRoot,
    title: snapshot.title,
    body: snapshot.body,
    bodyPath: snapshot.bodyPath,
    bodySha256: snapshot.bodySha256,
    assets: [...snapshot.assets],
    assetManifest: snapshot.assetManifest.map(item => ({ ...item })),
    platform: snapshot.platform,
    accountLabel: snapshot.accountLabel,
    accountIdentity: snapshot.accountIdentity,
    scheduledAt: snapshot.scheduledAt,
    preflightEvidence: snapshot.preflightEvidence,
    publisherOptions: structuredClone(snapshot.publisherOptions),
  }
}

export function computeSnapshotDigest(snapshot: PublicationSnapshot | SnapshotBase): string {
  return createHash('sha256').update(JSON.stringify(stableValue(snapshotBase(snapshot)))).digest('hex')
}

export function makeSnapshot(input: SnapshotBase): PublicationSnapshot {
  const base = snapshotBase(input)
  return { ...base, payloadDigest: computeSnapshotDigest(base) }
}

export function toPublicationView(publication: Publication): PublicationView {
  return {
    id: publication.id,
    draftId: publication.draftId,
    platform: publication.platform,
    status: publication.status,
    skillName: publication.skillName,
    title: publication.snapshot.title,
    accountLabel: publication.snapshot.accountLabel,
    scheduledAt: publication.snapshot.scheduledAt,
    payloadDigest: publication.snapshot.payloadDigest,
    bodyChars: publication.snapshot.body.length,
    assetCount: publication.snapshot.assets.length,
    executionLeaseExpiresAt: publication.executionLeaseExpiresAt,
    expiresAt: publication.expiresAt,
    externalUrl: publication.externalUrl,
    resultEvidence: publication.resultEvidence,
    error: publication.error,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
  }
}
