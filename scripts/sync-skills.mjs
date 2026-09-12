#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintSkillFrontmatterSources } from '../src/skill-lint.ts'

const execFile = promisify(execFileCallback)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(await readFile(join(packageRoot, 'upstream', 'easel-snapshot.json'), 'utf8'))

function argument(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? '' : process.argv[index + 1] ?? ''
}

const MAX_CANDIDATE_FILES = 20_000
const MAX_CANDIDATE_FILE_BYTES = 32 * 1024 * 1024
const MAX_CANDIDATE_TOTAL_BYTES = 256 * 1024 * 1024

async function walk(root, current = root, state = { files: 0, bytes: 0 }, depth = 0) {
  if (depth > 32) throw new Error(`候选快照目录层级超过 32: ${relative(root, current)}`)
  const files = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`候选快照包含符号链接: ${relative(root, path)}`)
    if (info.isDirectory()) files.push(...await walk(root, path, state, depth + 1))
    else if (info.isFile()) {
      state.files += 1
      state.bytes += info.size
      if (state.files > MAX_CANDIDATE_FILES) throw new Error(`候选快照文件数超过 ${MAX_CANDIDATE_FILES}`)
      if (info.size > MAX_CANDIDATE_FILE_BYTES) throw new Error(`候选单文件超过 32 MiB: ${relative(root, path)}`)
      if (state.bytes > MAX_CANDIDATE_TOTAL_BYTES) throw new Error('候选快照总大小超过 256 MiB')
      files.push(path)
    }
  }
  return files
}

async function ensureRealDirectory(path) {
  const absolute = resolve(path)
  const missing = []
  let cursor = absolute
  while (true) {
    const info = await lstat(cursor).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (info) {
      if (info.isSymbolicLink() || !info.isDirectory() || await realpath(cursor) !== cursor) {
        throw new Error(`报告输出目录不能经过符号链接: ${cursor}`)
      }
      break
    }
    const parent = dirname(cursor)
    if (parent === cursor || cursor === parse(cursor).root) throw new Error(`无法解析报告输出目录: ${absolute}`)
    missing.push(cursor)
    cursor = parent
  }
  for (const directory of missing.reverse()) {
    await mkdir(directory, { mode: 0o700 })
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory) {
      throw new Error(`报告输出目录创建后不安全: ${directory}`)
    }
  }
  return absolute
}

async function writeReport(path, report) {
  const directory = await ensureRealDirectory(dirname(path))
  const existing = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing?.isSymbolicLink() || (existing !== undefined && !existing.isFile())) {
    throw new Error(`报告输出目标必须是普通文件且不能是符号链接: ${path}`)
  }
  const temporaryPath = join(directory, `.easel-report-${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(report, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    if (await realpath(directory) !== directory) throw new Error(`报告输出目录在写入期间发生变化: ${directory}`)
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function securityFindings(path, content) {
  const findings = []
  const relativePath = path.replaceAll('\\', '/')
  const segments = relativePath.split('/')
  const basename = segments.at(-1) ?? ''
  if (segments.some(segment => /^(?:credentials?|browser-profiles?|\.dsh-browser-profiles|\.easel-browser-profiles)$/iu.test(segment)) ||
      basename === '.env' || /^cookies?.*\.json$/iu.test(basename) || /^.*token[_-]?cache.*\.json$/iu.test(basename)) {
    findings.push(`敏感路径: ${relativePath}`)
  }
  for (const [label, pattern] of [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
    ['API key', /\bsk-[A-Za-z0-9]{32,}\b/u],
  ]) if (pattern.test(content)) findings.push(`${label}: ${relativePath}`)
  return findings
}

const upstreamPath = argument('--upstream')
const requestedRef = argument('--ref')
const outputPath = resolve(argument('--output') || join(packageRoot, '.artifacts', 'easel-upstream-report.md'))
const temporary = await mkdtemp(join(tmpdir(), 'dsh-mediaops-easel-'))
const clone = join(temporary, 'repo')

try {
  if (upstreamPath) {
    await execFile('git', ['clone', '--no-checkout', '--shared', resolve(upstreamPath), clone], { maxBuffer: 10 * 1024 * 1024 })
  } else {
    await execFile('git', ['clone', '--filter=blob:none', '--no-checkout', '--branch', manifest.branch, manifest.repository, clone], { maxBuffer: 10 * 1024 * 1024 })
  }
  const candidateRef = requestedRef || 'HEAD'
  const { stdout: candidateStdout } = await execFile('git', ['-C', clone, 'rev-parse', `${candidateRef}^{commit}`], { encoding: 'utf8' })
  const candidateCommit = candidateStdout.trim()
  try {
    await execFile('git', ['-C', clone, 'cat-file', '-e', `${manifest.snapshotCommit}^{commit}`])
  } catch {
    await execFile('git', ['-C', clone, 'fetch', '--depth=1', 'origin', manifest.snapshotCommit], { maxBuffer: 20 * 1024 * 1024 })
  }
  for (const [path, expectedTree] of Object.entries(manifest.trees)) {
    const { stdout } = await execFile('git', ['-C', clone, 'rev-parse', `${manifest.snapshotCommit}:${path}`], { encoding: 'utf8' })
    const observedTree = stdout.trim()
    if (observedTree !== expectedTree) {
      throw new Error(`固定 Easel snapshot 的 ${path} tree 不匹配: expected=${expectedTree} observed=${observedTree}`)
    }
  }
  await execFile('git', ['-C', clone, 'checkout', '--detach', candidateCommit], { maxBuffer: 20 * 1024 * 1024 })

  const candidateSkills = join(clone, 'skills', 'openclaw')
  const sizeState = { files: 0, bytes: 0 }
  const candidateFiles = [
    ...await walk(join(clone, 'skills', 'openclaw'), join(clone, 'skills', 'openclaw'), sizeState),
    ...await walk(join(clone, 'skills', 'shared'), join(clone, 'skills', 'shared'), sizeState),
  ]
  const entries = (await readdir(candidateSkills, { withFileTypes: true })).filter(entry => entry.isDirectory())
  const sources = await Promise.all(entries.map(async entry => ({
    path: join(candidateSkills, entry.name, 'SKILL.md'),
    fallbackName: entry.name,
    raw: await readFile(join(candidateSkills, entry.name, 'SKILL.md'), 'utf8'),
  })))
  const lintErrors = lintSkillFrontmatterSources(sources)
  const findings = []
  for (const path of candidateFiles) {
    const content = await readFile(path).then(buffer => buffer.includes(0) ? '' : buffer.toString('utf8'))
    findings.push(...securityFindings(relative(clone, path), content))
  }
  const { stdout: diff } = await execFile('git', [
    '-C', clone, 'diff', '--name-status', '--find-renames', manifest.snapshotCommit, candidateCommit,
    '--', 'skills/openclaw', 'skills/shared',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  const changed = diff.trim() === '' ? [] : diff.trim().split(/\r?\n/u)
  const report = `# Easel upstream candidate report\n\n` +
    `- Repository: ${manifest.repository}\n` +
    `- Pinned snapshot: \`${manifest.snapshotCommit}\`\n` +
    `- Candidate: \`${candidateCommit}\`\n` +
    `- Candidate skills: ${sources.length}\n` +
    `- Changed paths: ${changed.length}\n` +
    `- Frontmatter lint: ${lintErrors.length === 0 ? 'PASS' : `FAIL (${lintErrors.length})`}\n` +
    `- Sensitive-content gate: ${findings.length === 0 ? 'PASS' : `FAIL (${findings.length})`}\n\n` +
    `## Upstream changes\n\n${changed.length === 0 ? '_No upstream skill changes._' : `\`\`\`text\n${changed.join('\n')}\n\`\`\``}\n\n` +
    `## Frontmatter findings\n\n${lintErrors.length === 0 ? '_None._' : lintErrors.map(error => `- ${relative(clone, error.path)}: ${error.message}`).join('\n')}\n\n` +
    `## Security findings\n\n${findings.length === 0 ? '_None._' : findings.map(item => `- ${item}`).join('\n')}\n\n` +
    `## Mandatory manual review before adoption\n\n` +
    `- Do not copy this candidate over \`skills/\`; merge individual changes in a review branch.\n` +
    `- Re-apply and review every DSH-MediaOps modification notice and runtime-path rewrite.\n` +
    `- Re-audit HOST_ONLY_SKILLS and every new external-write path before enabling it.\n` +
    `- Review EASEL-META.md, NOTICE, THIRD_PARTY_NOTICES.md, vendored licenses and optional dependency licenses.\n` +
    `- Run secret/path scans, \`pnpm check\`, publisher self-tests, package-content scan and isolated install.\n` +
    `- Update upstream/easel-snapshot.json only in the same reviewed commit that adopts the candidate.\n`
  await writeReport(outputPath, report)
  console.log(`Easel candidate report: ${outputPath}`)
  if (lintErrors.length > 0 || findings.length > 0) process.exitCode = 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
