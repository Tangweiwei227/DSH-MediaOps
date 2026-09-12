import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURATED_DIGEST_ALGORITHM,
  computeCuratedSkillsDigest,
  verifyCuratedSkillsDigest,
} from '../src/curated-digest.ts'

const temporaryRoots: string[] = []

async function fixture(entries: Array<[string, string]>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-curated-digest-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'skills', 'openclaw'), { recursive: true })
  await mkdir(join(root, 'skills', 'shared'), { recursive: true })
  for (const [relativePath, content] of entries) {
    const path = join(root, ...relativePath.split('/'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('curated skills digest', () => {
  it('is deterministic across creation order and records its scope', async () => {
    const entries: Array<[string, string]> = [
      ['skills/openclaw/example/SKILL.md', '---\nname: example\n---\n'],
      ['skills/shared/scripts/helper.py', 'print("safe")\n'],
    ]
    const first = await computeCuratedSkillsDigest(await fixture(entries))
    const second = await computeCuratedSkillsDigest(await fixture([...entries].reverse()))

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      algorithm: CURATED_DIGEST_ALGORITHM,
      fileCount: 2,
      totalBytes: Buffer.byteLength(entries[0]![1]) + Buffer.byteLength(entries[1]![1]),
    })
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u)
  })

  it('detects changed content, renamed paths, additions, and deletions', async () => {
    const root = await fixture([
      ['skills/openclaw/example/SKILL.md', 'original\n'],
      ['skills/shared/helper.txt', 'shared\n'],
    ])
    const baseline = await computeCuratedSkillsDigest(root)

    await writeFile(join(root, 'skills/openclaw/example/SKILL.md'), 'changed\n', 'utf8')
    const contentChanged = await computeCuratedSkillsDigest(root)
    expect(verifyCuratedSkillsDigest(contentChanged, baseline)).toEqual(expect.arrayContaining([
      expect.stringContaining('digest 不匹配'),
    ]))

    await writeFile(join(root, 'skills/openclaw/example/SKILL.md'), 'original\n', 'utf8')
    await mkdir(join(root, 'skills/openclaw/renamed'), { recursive: true })
    await writeFile(join(root, 'skills/openclaw/renamed/SKILL.md'), 'original\n', 'utf8')
    await unlink(join(root, 'skills/openclaw/example/SKILL.md'))
    expect((await computeCuratedSkillsDigest(root)).digest).not.toBe(baseline.digest)

    await writeFile(join(root, 'skills/shared/added.txt'), 'new\n', 'utf8')
    expect(verifyCuratedSkillsDigest(await computeCuratedSkillsDigest(root), baseline)).toEqual(expect.arrayContaining([
      expect.stringContaining('fileCount 不匹配'),
      expect.stringContaining('totalBytes 不匹配'),
    ]))

    await unlink(join(root, 'skills/shared/added.txt'))
    await unlink(join(root, 'skills/shared/helper.txt'))
    expect(verifyCuratedSkillsDigest(await computeCuratedSkillsDigest(root), baseline)).toEqual(expect.arrayContaining([
      expect.stringContaining('fileCount 不匹配'),
      expect.stringContaining('totalBytes 不匹配'),
    ]))
  })

  it('rejects symlinks instead of hashing content outside the curated roots', async () => {
    const root = await fixture([
      ['skills/openclaw/example/SKILL.md', 'safe\n'],
      ['outside.txt', 'secret\n'],
    ])
    await symlink(join(root, 'outside.txt'), join(root, 'skills/shared/external.txt'))

    await expect(computeCuratedSkillsDigest(root)).rejects.toThrow(/符号链接/u)
  })

  it('rejects unsupported or incomplete manifest baselines', async () => {
    const root = await fixture([['skills/openclaw/example/SKILL.md', 'safe\n']])
    const observed = await computeCuratedSkillsDigest(root)

    expect(verifyCuratedSkillsDigest(observed, {
      algorithm: 'sha1',
      digest: observed.digest,
      fileCount: observed.fileCount,
      totalBytes: observed.totalBytes,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining(`algorithm 必须是 ${CURATED_DIGEST_ALGORITHM}`),
    ]))
    expect(verifyCuratedSkillsDigest(observed, undefined)).toEqual([
      'snapshot manifest 缺少 curatedDigest，无法验证 DSH 定制 Skill 树',
    ])
  })
})
