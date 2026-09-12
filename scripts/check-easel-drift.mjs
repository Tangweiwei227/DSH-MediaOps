#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import { promisify } from 'node:util'
import { access, lstat, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeCuratedSkillsDigest, verifyCuratedSkillsDigest } from '../src/curated-digest.ts'
import { lintSkillFrontmatterSources } from '../src/skill-lint.ts'

const execFile = promisify(execFileCallback)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(packageRoot, 'upstream', 'easel-snapshot.json')
const manifestSource = await readFile(manifestPath, 'utf8')
const manifest = JSON.parse(manifestSource)
const offline = process.argv.includes('--offline')
const updateCuratedDigest = process.argv.includes('--update-curated-digest')

async function inspectOfflineSnapshot({ verifyCuratedDigest = true } = {}) {
  const errors = []
  if (!/^[a-f0-9]{40}$/u.test(manifest.snapshotCommit)) errors.push('snapshotCommit 必须是完整的 40 位 Git commit')
  for (const [path, tree] of Object.entries(manifest.trees)) {
    if (!/^[a-f0-9]{40}$/u.test(String(tree))) errors.push(`${path} tree 必须是完整的 40 位 Git object id`)
  }
  for (const relativePath of ['NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/CAPABILITIES.md']) {
    const content = await readFile(join(packageRoot, relativePath), 'utf8')
    if (!content.includes(manifest.snapshotCommit)) errors.push(`${relativePath} 未声明固定 Easel snapshot commit`)
  }
  for (const relativePath of [
    'third_party_licenses/lucasygu-redbook-LICENSE',
    'third_party_licenses/white0dew-XiaohongshuSkills-LICENSE',
  ]) {
    await access(join(packageRoot, relativePath)).catch(() => errors.push(`缺少第三方许可证 ${relativePath}`))
  }
  const skillsRoot = join(packageRoot, 'skills', 'openclaw')
  const entries = (await readdir(skillsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory())
  const sources = await Promise.all(entries.map(async entry => ({
    path: join(skillsRoot, entry.name, 'SKILL.md'),
    fallbackName: entry.name,
    raw: await readFile(join(skillsRoot, entry.name, 'SKILL.md'), 'utf8'),
  })))
  if (sources.length !== manifest.expectedSkillCount) errors.push(`Skill 数量应为 ${manifest.expectedSkillCount}，实际为 ${sources.length}`)
  for (const error of lintSkillFrontmatterSources(sources)) errors.push(`${error.path}: ${error.message}`)
  const hostOnlySource = await readFile(join(packageRoot, 'src', 'skills.ts'), 'utf8')
  const modificationNotices = sources.filter(source => source.raw.includes('Modified by DSH-MediaOps')).length
  if (modificationNotices < manifest.minimumSkillModificationNotices) {
    errors.push(`DSH Skill 修改声明至少应有 ${manifest.minimumSkillModificationNotices} 处，实际为 ${modificationNotices}`)
  }
  const hostOnlyBlock = /HOST_ONLY_SKILLS\s*=\s*new Set\(\[([\s\S]*?)\]\)/u.exec(hostOnlySource)?.[1] ?? ''
  const observedHostOnly = [...hostOnlyBlock.matchAll(/'([^']+)'/gu)].map(match => match[1]).sort()
  const expectedHostOnly = [...manifest.hostOnlySkills].sort()
  if (JSON.stringify(observedHostOnly) !== JSON.stringify(expectedHostOnly)) {
    errors.push(`HOST_ONLY_SKILLS 与固定安全清单不一致: expected=${expectedHostOnly.join(',')} observed=${observedHostOnly.join(',')}`)
  }
  for (const skill of expectedHostOnly) {
    const source = sources.find(item => item.fallbackName === skill)
    if (!source) errors.push(`Host-only Skill 不存在: ${skill}`)
  }
  let curatedDigest
  try {
    curatedDigest = await computeCuratedSkillsDigest(packageRoot)
    if (verifyCuratedDigest) errors.push(...verifyCuratedSkillsDigest(curatedDigest, manifest.curatedDigest))
  } catch (error) {
    errors.push(`无法计算 curated Skill 树摘要: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { errors, sources, curatedDigest }
}

async function offlineChecks() {
  const { errors, sources, curatedDigest } = await inspectOfflineSnapshot()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    if (errors.some(error => error.includes('curatedDigest'))) {
      console.error('仅在逐项审阅 skills/openclaw 与 skills/shared 的合法变更后运行 `pnpm update:upstream:curated`。')
    }
    process.exitCode = 1
    return
  }
  console.log(`Easel snapshot safety passed: ${manifest.snapshotCommit} / ${sources.length} skills / ${curatedDigest.digest}`)
}

async function replaceManifestCuratedDigest(curatedDigest) {
  const directory = dirname(manifestPath)
  const directoryInfo = await lstat(directory)
  const manifestInfo = await lstat(manifestPath)
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || await realpath(directory) !== directory) {
    throw new Error(`snapshot manifest 目录必须是真实目录且不能是符号链接: ${directory}`)
  }
  if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) {
    throw new Error(`snapshot manifest 必须是普通文件且不能是符号链接: ${manifestPath}`)
  }

  const temporaryPath = join(directory, `.easel-snapshot-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporaryPath, 'wx', 0o644)
    try {
      const updated = `${JSON.stringify({ ...manifest, curatedDigest }, null, 2)}\n`
      await handle.writeFile(updated, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (await realpath(directory) !== directory) throw new Error('snapshot manifest 目录在写入期间发生变化')
    const currentInfo = await lstat(manifestPath)
    if (currentInfo.isSymbolicLink() || !currentInfo.isFile()) throw new Error('snapshot manifest 在写入期间变得不安全')
    if (await readFile(manifestPath, 'utf8') !== manifestSource) throw new Error('snapshot manifest 在写入期间被并发修改')
    await rename(temporaryPath, manifestPath)
    const directoryHandle = await open(directory, fileConstants.O_RDONLY)
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function updateSnapshotCuratedDigest() {
  const unsupportedArguments = process.argv.slice(2).filter(argument => argument !== '--update-curated-digest')
  if (unsupportedArguments.length > 0) {
    throw new Error(`--update-curated-digest 不能与其他参数组合: ${unsupportedArguments.join(' ')}`)
  }
  const { errors, curatedDigest } = await inspectOfflineSnapshot({ verifyCuratedDigest: false })
  if (errors.length > 0 || curatedDigest === undefined) {
    throw new Error(`其他 snapshot 安全校验未通过，拒绝更新摘要:\n${errors.join('\n')}`)
  }
  await replaceManifestCuratedDigest(curatedDigest)
  console.log(`已更新 curated Skill 树基线: ${curatedDigest.digest} / ${curatedDigest.fileCount} files / ${curatedDigest.totalBytes} bytes`)
  console.log('请检查 manifest diff，并在同一审阅提交中运行 `pnpm check:upstream:snapshot`；不要自动提交该变更。')
}

async function remoteCheck() {
  const ref = `refs/heads/${manifest.branch}`
  const { stdout } = await execFile('git', ['ls-remote', manifest.repository, ref], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  const head = stdout.trim().split(/\s+/u)[0] ?? ''
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error(`无法解析 Easel ${ref} 远端 commit`)
  if (head !== manifest.snapshotCommit) {
    console.error(`Easel upstream drift: pinned=${manifest.snapshotCommit} remote=${head}`)
    console.error('运行 `pnpm report:upstream` 生成只读候选报告；不要直接覆盖 skills/。')
    process.exitCode = 1
    return
  }
  console.log(`Easel upstream unchanged: ${head}`)
}

if (updateCuratedDigest) await updateSnapshotCuratedDigest()
else if (offline) await offlineChecks()
else await remoteCheck()
