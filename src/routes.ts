import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { Topic } from './types.ts'
import { TREND_PLATFORMS, type TrendPlatform, TrendService } from './trends.ts'
import { MediaOpsService } from './service.ts'
import { ModelConfigStore, type ProviderUpdate } from './model-config.ts'
import { loadReferenceCandidates, loadReferenceText, REFERENCE_KINDS, type ReferenceKind } from './reference-routes.ts'

export { boundedReference } from './reference-routes.ts'

export const API_PREFIX = '/api/dsh-mediaops'
const MAX_BODY_BYTES = 1024 * 1024

export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('请求体超过 1 MiB')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

export function makeRoutes(service: MediaOpsService, trends: TrendService, maxReferenceChars: number, modelConfig?: ModelConfigStore): WebRoute[] {
  return [{
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) {
        writeJson(response, 403, { ok: false, error: 'forbidden: loopback and same-origin only' })
        return
      }
      const url = new URL(request.url ?? API_PREFIX, 'http://localhost')
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      try {
        if (request.method === 'GET' && path === '/overview') {
          writeJson(response, 200, await service.overview())
          return
        }
        if (request.method === 'GET' && path === '/references') {
          const items = await loadReferenceCandidates(service, url.searchParams.get('q') ?? '', Number(url.searchParams.get('limit') ?? 48))
          writeJson(response, 200, { ok: true, items, references: items })
          return
        }
        if (request.method === 'GET' && ['/topics', '/viral', '/drafts', '/publications'].includes(path)) {
          const routeKinds: Record<string, 'topics' | 'viralItems' | 'drafts' | 'publications'> = {
            '/topics': 'topics',
            '/viral': 'viralItems',
            '/drafts': 'drafts',
            '/publications': 'publications',
          }
          const kind = routeKinds[path]
          if (!kind) throw Object.assign(new Error('not found'), { statusCode: 404 })
          const items = await service.list(kind, url.searchParams.get('q') ?? '', Number(url.searchParams.get('limit') ?? 100))
          const key = kind === 'viralItems' ? 'viralItems' : kind
          writeJson(response, 200, { ok: true, items, [key]: items })
          return
        }
        if (request.method === 'GET' && path === '/capabilities') {
          writeJson(response, 200, await service.overview())
          return
        }
        if (request.method === 'GET' && path === '/model-config') {
          if (!modelConfig) throw Object.assign(new Error('多模态模型配置服务未启用'), { statusCode: 503 })
          writeJson(response, 200, await modelConfig.view())
          return
        }
        const modelProviderMatch = path.match(/^\/model-config\/([^/]+)\/([^/]+)$/)
        if (request.method === 'PUT' && modelProviderMatch) {
          if (!modelConfig) throw Object.assign(new Error('多模态模型配置服务未启用'), { statusCode: 503 })
          const groupId = decodeURIComponent(modelProviderMatch[1] ?? '')
          const providerId = decodeURIComponent(modelProviderMatch[2] ?? '')
          writeJson(response, 200, await modelConfig.updateProvider(groupId, providerId, await readJson(request) as ProviderUpdate))
          return
        }
        if (request.method === 'DELETE' && modelProviderMatch) {
          if (!modelConfig) throw Object.assign(new Error('多模态模型配置服务未启用'), { statusCode: 503 })
          const groupId = decodeURIComponent(modelProviderMatch[1] ?? '')
          const providerId = decodeURIComponent(modelProviderMatch[2] ?? '')
          writeJson(response, 200, await modelConfig.clearProvider(groupId, providerId))
          return
        }
        const modelVerifyMatch = path.match(/^\/model-config\/([^/]+)\/([^/]+)\/verify$/)
        if (request.method === 'POST' && modelVerifyMatch) {
          if (!modelConfig) throw Object.assign(new Error('多模态模型配置服务未启用'), { statusCode: 503 })
          const groupId = decodeURIComponent(modelVerifyMatch[1] ?? '')
          const providerId = decodeURIComponent(modelVerifyMatch[2] ?? '')
          // Deliberately offline: no paid generation and no credential egress.
          writeJson(response, 200, await modelConfig.validateProvider(groupId, providerId))
          return
        }
        if (request.method === 'GET' && path === '/trends') {
          const requested = (url.searchParams.get('platforms') ?? 'weibo,douyin,zhihu,rednote').split(',')
          const platforms = requested.filter((item): item is TrendPlatform => TREND_PLATFORMS.includes(item as TrendPlatform))
          writeJson(response, 200, await trends.discover(platforms, Number(url.searchParams.get('limit') ?? 10)))
          return
        }
        const referenceMatch = path.match(/^\/reference\/([^/]+)\/([^/]+)$/)
        if (request.method === 'GET' && referenceMatch) {
          const kind = decodeURIComponent(referenceMatch[1] ?? '')
          if (!REFERENCE_KINDS.includes(kind as ReferenceKind)) throw Object.assign(new Error('引用类型不存在'), { statusCode: 404 })
          const id = decodeURIComponent(referenceMatch[2] ?? '')
          const value = await loadReferenceText(service, kind as ReferenceKind, id, maxReferenceChars)
          if (value === undefined) throw Object.assign(new Error('引用记录不存在'), { statusCode: 404 })
          writeJson(response, 200, { ok: true, text: value })
          return
        }
        if (request.method === 'POST' && path === '/topics') {
          writeJson(response, 201, { ok: true, topic: await service.createTopic(await readJson(request) as Partial<Topic>) })
          return
        }
        if (request.method === 'POST' && path === '/viral') {
          writeJson(response, 201, { ok: true, viralItem: await service.saveViral(await readJson(request)) })
          return
        }
        if (request.method === 'POST' && path === '/drafts') {
          writeJson(response, 201, { ok: true, draft: await service.saveDraft(await readJson(request)) })
          return
        }
        const promoteMatch = path.match(/^\/viral\/([^/]+)\/promote$/)
        if (request.method === 'POST' && promoteMatch) {
          const id = decodeURIComponent(promoteMatch[1] ?? '')
          writeJson(response, 201, { ok: true, topic: await service.promoteViral(id, await readJson(request) as Partial<Topic>) })
          return
        }
        writeJson(response, 404, { ok: false, error: 'not found' })
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode ?? 400)
        writeJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }]
}
