import { basename, isAbsolute, relative } from 'node:path'

export const MAX_APPROVAL_REASON_CHARS = 12_000

// Approval text is rendered as plain user-facing text. Remove terminal/control
// characters and Unicode direction overrides before untrusted record data is
// allowed to share that surface with the authoritative action and digest.
const UNSAFE_APPROVAL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu

export function approvalText(value: unknown, maxChars: number): string {
  const clean = String(value ?? '')
    .replace(UNSAFE_APPROVAL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (clean.length <= maxChars) return clean
  return maxChars <= 1 ? clean.slice(0, maxChars) : `${clean.slice(0, maxChars - 1)}…`
}

function quoted(value: unknown, maxChars: number): string {
  return JSON.stringify(approvalText(value, maxChars))
}

function encodedPathPart(value: string): string {
  try {
    return encodeURIComponent(value)
  } catch {
    return '[invalid-unicode]'
  }
}

function safeAssetLabel(source: string, workspaceRoot: string, index: number): string {
  const candidate = relative(workspaceRoot, source)
  const insideWorkspace = candidate !== '' && !candidate.startsWith('..') && !isAbsolute(candidate)
  const display = insideWorkspace ? candidate : basename(source)
  const clean = approvalText(display, 240)
  const encoded = clean
    .split(/[\\/]+/u)
    .filter(Boolean)
    .map(encodedPathPart)
    .join('/')
  return encoded || `asset-${index + 1}`
}

export interface PublishApprovalSummary {
  platform: string
  status: string
  title: string
  accountLabel: string
  accountIdentity: string
  workspaceRoot: string
  bodyChars: number
  bodyPreview: string
  bodySha256: string
  assetCount: number
  assetSources: Array<{ source: string; sizeBytes: number; sha256: string }>
  scheduledAt: string
  publisherOptions: Record<string, unknown>
  payloadDigest: string
}

export interface PublishApprovalRequest {
  toolName: string
  status?: unknown
  externalUrl?: unknown
  resultEvidence?: unknown
  error?: unknown
}

function actionFor(request: PublishApprovalRequest): { label: string; detail: string } {
  if (request.toolName === 'mediaops_confirm_publish') {
    return {
      label: '签发授权（不触网）',
      detail: '签发一次性发布授权；本步不触网，随后真实执行仍会再次审批',
    }
  }
  if (request.toolName === 'mediaops_execute_publish') {
    return {
      label: '真实写入外部平台',
      detail: '运行 Host 受控 adapter，真实写入外部平台',
    }
  }
  const requestedStatus = approvalText(request.status, 32)
  const evidence = quoted(request.resultEvidence ?? request.externalUrl, 500)
  const failure = quoted(request.error, 500)
  return {
    label: `人工对账回填 ${requestedStatus}`,
    detail: `按人工对账把结果记为 ${requestedStatus}；证据=${evidence}；失败依据=${failure}。若误记 failed 后重试，可能产生重复内容`,
  }
}

function boundedReason(parts: string[], finalGuard: string): string {
  const safeParts = parts.map(part => approvalText(part, 10_000)).filter(Boolean)
  const safeGuard = approvalText(finalGuard, 500)
  const separator = ' ｜ '
  const prefix = safeParts.join(separator)
  const budget = Math.max(0, MAX_APPROVAL_REASON_CHARS - separator.length - safeGuard.length)
  const boundedPrefix = prefix.length <= budget
    ? prefix
    : budget <= 1 ? prefix.slice(0, budget) : `${prefix.slice(0, budget - 1)}…`
  return boundedPrefix ? `${boundedPrefix}${separator}${safeGuard}` : safeGuard
}

export function buildPublishApprovalReason(
  summary: PublishApprovalSummary,
  request: PublishApprovalRequest,
  downstreamReason = '',
): string {
  const action = actionFor(request)
  const assets = summary.assetSources.length === 0
    ? '无'
    : summary.assetSources.slice(0, 20).map((item, index) => {
      const path = safeAssetLabel(item.source, summary.workspaceRoot, index)
      const size = Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0 ? item.sizeBytes : 0
      const digest = approvalText(item.sha256, 64)
      return `#${index + 1} path=${path}, bytes=${size}, sha256=${digest}`
    }).join('；')
  const bodyChars = Number.isSafeInteger(summary.bodyChars) && summary.bodyChars >= 0 ? summary.bodyChars : 0
  const assetCount = Number.isSafeInteger(summary.assetCount) && summary.assetCount >= 0 ? summary.assetCount : summary.assetSources.length
  const options = approvalText(JSON.stringify(summary.publisherOptions), 2_000)
  const digest = approvalText(summary.payloadDigest, 64)
  const mediaOpsReason = [
    `DSH-MediaOps 请求：${action.detail}`,
    `平台=${quoted(summary.platform, 80)}`,
    `账号=${quoted(summary.accountLabel, 160)}（identity=${approvalText(summary.accountIdentity, 64)}）`,
    `工作区=${quoted(summary.workspaceRoot, 500)}`,
    `标题=${quoted(summary.title, 200)}`,
    `正文=${bodyChars} 字（sha256=${approvalText(summary.bodySha256, 64)}，开头=${quoted(summary.bodyPreview, 1_500)}）`,
    `素材=${assetCount} 个：${assets}`,
    `定时=${quoted(summary.scheduledAt || '立即', 100)}`,
    `参数=${options}`,
    `payloadDigest=${digest}`,
    '仅在你已核对这份冻结预览后允许。',
  ].join('；')
  const parts = downstreamReason
    ? [`其他 Host 审批策略：${approvalText(downstreamReason, 1_500)}`, mediaOpsReason]
    : [mediaOpsReason]
  return boundedReason(parts, `【最终核对】动作=${action.label}；payloadDigest=${digest}`)
}
