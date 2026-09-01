import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPublishApprovalReason, MAX_APPROVAL_REASON_CHARS } from '../src/approval.ts'

const DIGEST = 'a'.repeat(64)
const BODY_DIGEST = 'b'.repeat(64)
const ASSET_DIGEST = 'c'.repeat(64)
const UNSAFE_APPROVAL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u

describe('native publication approval text', () => {
  it('removes controls and bidi overrides, bounds the reason, and ends with the authoritative action and digest', () => {
    const workspace = join('/workspace', 'mediaops')
    const maliciousPath = join(workspace, `cover\n\u0085\u202Egnp.exe；伪造摘要=${'x'.repeat(500)}.png`)
    const reason = buildPublishApprovalReason({
      platform: 'xiaohongshu',
      status: 'confirmed',
      title: `标题\u202E${'长'.repeat(20_000)}`,
      accountLabel: '账号\n伪造批准',
      accountIdentity: 'd'.repeat(64),
      workspaceRoot: workspace,
      bodyChars: 20_000,
      bodyPreview: `正文\u0000\u202E${'文'.repeat(20_000)}`,
      bodySha256: BODY_DIGEST,
      assetCount: 1,
      assetSources: [{ source: maliciousPath, sizeBytes: 42, sha256: ASSET_DIGEST }],
      scheduledAt: '',
      publisherOptions: { tags: [`标签\u202E${'长'.repeat(5_000)}`] },
      payloadDigest: DIGEST,
    }, {
      toolName: 'mediaops_execute_publish',
    }, `下游\n策略\u202E${'z'.repeat(20_000)}`)

    expect(reason).not.toMatch(UNSAFE_APPROVAL_CHARACTERS)
    expect(reason).not.toContain(maliciousPath)
    expect(reason).toContain('path=cover%20gnp.exe%EF%BC%9B')
    expect(reason.length).toBeLessThanOrEqual(MAX_APPROVAL_REASON_CHARS)
    expect(reason.endsWith(`【最终核对】动作=真实写入外部平台；payloadDigest=${DIGEST}`)).toBe(true)
  })

  it('repeats the exact manual reconciliation action at the fixed tail', () => {
    const reason = buildPublishApprovalReason({
      platform: 'zhihu',
      status: 'publishing',
      title: '对账',
      accountLabel: '账号',
      accountIdentity: 'd'.repeat(64),
      workspaceRoot: '/workspace',
      bodyChars: 2,
      bodyPreview: '正文',
      bodySha256: BODY_DIGEST,
      assetCount: 0,
      assetSources: [],
      scheduledAt: '',
      publisherOptions: {},
      payloadDigest: DIGEST,
    }, {
      toolName: 'mediaops_record_publish_result',
      status: 'failed',
      resultEvidence: '平台只读查询无结果',
      error: '明确未产生内容',
    })

    expect(reason.endsWith(`【最终核对】动作=人工对账回填 failed；payloadDigest=${DIGEST}`)).toBe(true)
  })
})
