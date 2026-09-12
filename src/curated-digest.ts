import { createHash } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

export const CURATED_DIGEST_ALGORITHM = 'sha256-dsh-mediaops-curated-v1'

const CURATED_ROOTS = ['skills/openclaw', 'skills/shared'] as const
const DEFAULT_MAX_FILES = 20_000
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_DEPTH = 32

export interface CuratedSkillsDigest {
  algorithm: typeof CURATED_DIGEST_ALGORITHM
  digest: string
  fileCount: number
  totalBytes: number
}

export interface CuratedDigestBaseline {
  algorithm?: unknown
  digest?: unknown
  fileCount?: unknown
  totalBytes?: unknown
}

interface CuratedDigestLimits {
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  maxDepth?: number
}

interface CuratedFile {
  absolutePath: string
  relativePath: string
  size: number
}

function pathBytes(path: string) {
  return Buffer.from(path, 'utf8')
}

function compareUtf8Paths(left: CuratedFile, right: CuratedFile) {
  return Buffer.compare(pathBytes(left.relativePath), pathBytes(right.relativePath))
}

function uint32(value: number) {
  const encoded = Buffer.allocUnsafe(4)
  encoded.writeUInt32BE(value)
  return encoded
}

function uint64(value: number) {
  const encoded = Buffer.allocUnsafe(8)
  encoded.writeBigUInt64BE(BigInt(value))
  return encoded
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
}

async function collectFiles(
  packageRoot: string,
  current: string,
  files: CuratedFile[],
  limits: Required<CuratedDigestLimits>,
  state: { totalBytes: number },
  depth = 0,
) {
  if (depth > limits.maxDepth) {
    throw new Error(`curated Skill 目录层级超过 ${limits.maxDepth}: ${relative(packageRoot, current)}`)
  }
  const directoryInfo = await lstat(current)
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error(`curated Skill 根路径必须是真实目录且不能是符号链接: ${relative(packageRoot, current)}`)
  }

  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = join(current, entry.name)
    const info = await lstat(absolutePath)
    const relativePath = relative(packageRoot, absolutePath).split(sep).join('/')
    if (info.isSymbolicLink()) throw new Error(`curated Skill 树包含符号链接: ${relativePath}`)
    if (info.isDirectory()) {
      await collectFiles(packageRoot, absolutePath, files, limits, state, depth + 1)
      continue
    }
    if (!info.isFile()) throw new Error(`curated Skill 树包含非普通文件: ${relativePath}`)
    if (info.size > limits.maxFileBytes) {
      throw new Error(`curated Skill 单文件超过 ${limits.maxFileBytes} bytes: ${relativePath}`)
    }
    files.push({ absolutePath, relativePath, size: info.size })
    state.totalBytes += info.size
    if (files.length > limits.maxFiles) throw new Error(`curated Skill 文件数超过 ${limits.maxFiles}`)
    if (state.totalBytes > limits.maxTotalBytes) {
      throw new Error(`curated Skill 总大小超过 ${limits.maxTotalBytes} bytes`)
    }
  }
}

async function hashFile(file: CuratedFile) {
  const before = await lstat(file.absolutePath)
  if (before.isSymbolicLink() || !before.isFile() || before.size !== file.size) {
    throw new Error(`curated Skill 文件在摘要期间发生变化: ${file.relativePath}`)
  }
  const noFollow = typeof fileConstants.O_NOFOLLOW === 'number' ? fileConstants.O_NOFOLLOW : 0
  const handle = await open(file.absolutePath, fileConstants.O_RDONLY | noFollow)
  const hash = createHash('sha256')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error(`curated Skill 文件在打开时发生变化: ${file.relativePath}`)
    }
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset)
      if (bytesRead === 0) throw new Error(`curated Skill 文件读取不完整: ${file.relativePath}`)
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    const after = await handle.stat()
    if (!sameFile(opened, after) || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) {
      throw new Error(`curated Skill 文件在读取时发生变化: ${file.relativePath}`)
    }
  } finally {
    await handle.close()
  }
  return hash.digest()
}

export async function computeCuratedSkillsDigest(
  packageRoot: string,
  configuredLimits: CuratedDigestLimits = {},
): Promise<CuratedSkillsDigest> {
  const canonicalPackageRoot = await realpath(resolve(packageRoot))
  const limits: Required<CuratedDigestLimits> = {
    maxFiles: configuredLimits.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: configuredLimits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: configuredLimits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxDepth: configuredLimits.maxDepth ?? DEFAULT_MAX_DEPTH,
  }
  const files: CuratedFile[] = []
  const state = { totalBytes: 0 }
  for (const root of CURATED_ROOTS) {
    await collectFiles(canonicalPackageRoot, join(canonicalPackageRoot, ...root.split('/')), files, limits, state)
  }
  files.sort(compareUtf8Paths)

  const treeHash = createHash('sha256')
  treeHash.update('DSH-MediaOps curated skill tree\0v1\0', 'utf8')
  for (const file of files) {
    const relativePath = pathBytes(file.relativePath)
    const contentDigest = await hashFile(file)
    treeHash.update(uint32(relativePath.length))
    treeHash.update(relativePath)
    treeHash.update(uint64(file.size))
    treeHash.update(contentDigest)
  }
  treeHash.update(uint32(files.length))
  treeHash.update(uint64(state.totalBytes))
  return {
    algorithm: CURATED_DIGEST_ALGORITHM,
    digest: `sha256:${treeHash.digest('hex')}`,
    fileCount: files.length,
    totalBytes: state.totalBytes,
  }
}

export function verifyCuratedSkillsDigest(
  observed: CuratedSkillsDigest,
  expected: CuratedDigestBaseline | undefined,
) {
  if (expected === undefined) {
    return ['snapshot manifest 缺少 curatedDigest，无法验证 DSH 定制 Skill 树']
  }
  const errors: string[] = []
  if (expected.algorithm !== CURATED_DIGEST_ALGORITHM) {
    errors.push(`curatedDigest.algorithm 必须是 ${CURATED_DIGEST_ALGORITHM}`)
  }
  if (typeof expected.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(expected.digest)) {
    errors.push('curatedDigest.digest 必须是 sha256:<64 位小写十六进制>')
  } else if (observed.digest !== expected.digest) {
    errors.push(`curatedDigest.digest 不匹配: expected=${expected.digest} observed=${observed.digest}`)
  }
  if (!Number.isSafeInteger(expected.fileCount) || Number(expected.fileCount) < 0) {
    errors.push('curatedDigest.fileCount 必须是非负安全整数')
  } else if (observed.fileCount !== expected.fileCount) {
    errors.push(`curatedDigest.fileCount 不匹配: expected=${expected.fileCount} observed=${observed.fileCount}`)
  }
  if (!Number.isSafeInteger(expected.totalBytes) || Number(expected.totalBytes) < 0) {
    errors.push('curatedDigest.totalBytes 必须是非负安全整数')
  } else if (observed.totalBytes !== expected.totalBytes) {
    errors.push(`curatedDigest.totalBytes 不匹配: expected=${expected.totalBytes} observed=${observed.totalBytes}`)
  }
  return errors
}
