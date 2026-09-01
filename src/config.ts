import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface Config {
  dataDir?: string
  trendCacheTtlMs?: number
  trendTimeoutMs?: number
  maxReferenceChars?: number
}

export const Config: z<Config> = z.object({
  dataDir: z.string().default(''),
  trendCacheTtlMs: z.number().step(1).min(5_000).max(3_600_000).default(60_000),
  trendTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(10_000),
  maxReferenceChars: z.number().step(1).min(1_000).max(50_000).default(12_000),
})

export interface ResolvedConfig {
  dataDir: string
  trendCacheTtlMs: number
  trendTimeoutMs: number
  maxReferenceChars: number
}

export function resolveConfig(config?: Config): ResolvedConfig {
  const dshRoot = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const configured = config?.dataDir?.trim()
  const environmentDataDir = process.env.DSH_MEDIAOPS_DATA_DIR?.trim()
  return {
    dataDir: resolve(configured || environmentDataDir || join(dshRoot, 'mediaops')),
    trendCacheTtlMs: config?.trendCacheTtlMs ?? 60_000,
    trendTimeoutMs: config?.trendTimeoutMs ?? 10_000,
    maxReferenceChars: config?.maxReferenceChars ?? 12_000,
  }
}
