#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintSkillFrontmatterSources } from '../src/skill-lint.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillsRoot = resolve(process.argv[2] ?? join(packageRoot, 'skills', 'openclaw'))
const entries = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
const sources = await Promise.all(entries.map(async entry => {
  const path = join(skillsRoot, entry.name, 'SKILL.md')
  return { path, fallbackName: basename(dirname(path)), raw: await readFile(path, 'utf8') }
}))
const errors = lintSkillFrontmatterSources(sources)
if (errors.length > 0) {
  for (const error of errors) console.error(`${error.path}: ${error.message}`)
  process.exitCode = 1
} else {
  console.log(`frontmatter lint passed: ${sources.length} skills`)
}
