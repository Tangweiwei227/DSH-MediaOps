import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModelConfigStore } from '../src/model-config.ts'
import { ModelScriptRunner } from '../src/model-runner.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function runnerConfig(): ModelConfigStore {
  return {
    executionEnvironment: async () => ({
      providerId: 'openai-compatible',
      env: {
        IMG_BASE_URL: 'https://api.example.com/v1',
        IMG_MODEL: 'fixture-image',
        IMG_API_KEY: 'fixture-secret',
      },
      secrets: ['fixture-secret'],
      allowPrivateNetwork: false,
    }),
  } as unknown as ModelConfigStore
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for model runner fixture')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
}

describe('shared safe HTTP transport', () => {
  it('passes the Python SSRF, redirect, proxy and bounded-download tests', () => {
    const result = spawnSync('python3', [join(root, 'skills/shared/tests/test_safe_http.py')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('keeps voice ffmpeg output atomic and cleans conversion parts', () => {
    const script = String.raw`
import signal
import sys
import tempfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, ${JSON.stringify(join(root, 'skills/shared/scripts'))})
import voice_clone

class Result:
    def __init__(self, code): self.returncode = code

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / "source.wav"
    output = root / "voice.mp3"
    source.write_bytes(b"wav")
    output.write_bytes(b"old")

    def succeed(argv, **_kwargs):
        assert Path(argv[-1]) != output
        assert ".part" in Path(argv[-1]).name
        Path(argv[-1]).write_bytes(b"new-audio")
        return Result(0)

    with mock.patch("subprocess.run", side_effect=succeed):
        assert voice_clone._ffmpeg_convert_atomic(source, output)
    assert output.read_bytes() == b"new-audio"
    assert not list(root.glob(".*.part*"))

    def fail(argv, **_kwargs):
        Path(argv[-1]).write_bytes(b"partial")
        return Result(1)

    with mock.patch("subprocess.run", side_effect=fail):
        assert not voice_clone._ffmpeg_convert_atomic(source, output)
    assert output.read_bytes() == b"new-audio"
    assert not list(root.glob(".*.part*"))

    part = root / ".voice.signal.part.mp3"
    part.write_bytes(b"partial")
    voice_clone._ACTIVE_FFMPEG_PARTS.add(part)
    try:
        voice_clone._ffmpeg_sigterm(signal.SIGTERM, None)
    except SystemExit:
        pass
    assert not part.exists()
`
    const result = spawnSync('python3', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })
})

describe('durable model-run cleanup ownership', () => {
  it('never recovers a live foreign Host or an owner-less record, then recovers a confirmed-dead owner', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-mediaops-pending-owner-'))
    const dataDir = join(fixtureRoot, 'data')
    const workspace = join(fixtureRoot, 'workspace')
    const outputs = join(workspace, 'outputs')
    await Promise.all([mkdir(dataDir), mkdir(outputs, { recursive: true })])
    const runner = new ModelScriptRunner(runnerConfig(), dataDir)
    const foreignHost = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    try {
      await once(foreignHost, 'spawn')
      if (!foreignHost.pid) throw new Error('foreign Host fixture has no PID')
      await runner.cleanupTemporaryFiles(undefined, true)
      const pendingRoot = join(await realpath(dataDir), 'model-pending-runs')
      const canonicalWorkspace = await realpath(workspace)
      const canonicalOutputs = await realpath(outputs)
      const [workspaceInfo, outputsInfo] = await Promise.all([
        lstat(canonicalWorkspace, { bigint: true }),
        lstat(canonicalOutputs, { bigint: true }),
      ])
      const runId = '22222222-2222-4222-8222-222222222222'
      const part = join(outputs, `.dsh-mediaops-${runId}-foreign.part`)
      const recordPath = join(pendingRoot, `${runId}.json`)
      await writeFile(part, 'live-owner-partial')
      await writeFile(recordPath, JSON.stringify({
        version: 2,
        runId,
        workspace: canonicalWorkspace,
        workspaceDev: String(workspaceInfo.dev),
        workspaceIno: String(workspaceInfo.ino),
        outputsDev: String(outputsInfo.dev),
        outputsIno: String(outputsInfo.ino),
        ownerPid: foreignHost.pid,
        // An opaque identity is used when process-table start information is
        // unavailable; a live PID must make foreign recovery fail closed.
        ownerStartToken: 'a'.repeat(64),
        ownerStartTokenVerified: false,
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 })

      await runner.cleanupTemporaryFiles(undefined, true)
      expect(await readFile(part, 'utf8')).toBe('live-owner-partial')
      expect(await readFile(recordPath, 'utf8')).toContain(String(foreignHost.pid))

      const exited = once(foreignHost, 'exit')
      foreignHost.kill('SIGTERM')
      await exited
      await runner.cleanupTemporaryFiles(undefined, true)
      await expect(access(part)).rejects.toThrow()
      await expect(access(recordPath)).rejects.toThrow()

      const legacyRunId = '33333333-3333-4333-8333-333333333333'
      const legacyPart = join(outputs, `.dsh-mediaops-${legacyRunId}-legacy.part`)
      const legacyRecord = join(pendingRoot, `${legacyRunId}.json`)
      await writeFile(legacyPart, 'unowned-partial')
      await writeFile(legacyRecord, JSON.stringify({
        version: 1,
        runId: legacyRunId,
        workspace: canonicalWorkspace,
        workspaceDev: String(workspaceInfo.dev),
        workspaceIno: String(workspaceInfo.ino),
        outputsDev: String(outputsInfo.dev),
        outputsIno: String(outputsInfo.ino),
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 })
      const old = new Date(Date.now() - 3 * 60 * 60_000)
      await utimes(legacyPart, old, old)
      await runner.cleanupTemporaryFiles(undefined, true)
      expect(await readFile(legacyPart, 'utf8')).toBe('unowned-partial')
      expect(await readFile(legacyRecord, 'utf8')).toContain('"version":1')
    } finally {
      foreignHost.kill('SIGKILL')
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('keeps this Host active run through local and concurrent janitors, then force-recovers it in finally', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-mediaops-pending-active-'))
    const dataDir = join(fixtureRoot, 'data')
    const workspace = join(fixtureRoot, 'workspace')
    await Promise.all([mkdir(dataDir), mkdir(workspace)])
    const mockPython = join(fixtureRoot, 'mock-python')
    const release = join(workspace, 'release-child')
    await writeFile(mockPython, [
      '#!/bin/sh',
      'touch "$DSH_MEDIAOPS_WORKSPACE/outputs/.dsh-mediaops-$DSH_MEDIAOPS_MODEL_RUN_ID-active.part"',
      'while [ ! -f "$DSH_MEDIAOPS_WORKSPACE/release-child" ]; do sleep 0.05; done',
      'exit 0',
    ].join('\n'))
    await chmod(mockPython, 0o700)
    const previousPython = process.env.DSH_MEDIAOPS_PYTHON
    process.env.DSH_MEDIAOPS_PYTHON = mockPython
    const runner = new ModelScriptRunner(runnerConfig(), dataDir)
    const concurrentRunner = new ModelScriptRunner(runnerConfig(), dataDir)
    const exec = {}
    const args = ['text2img', '--prompt', 'x', '--output', 'outputs/result.png']
    const abort = new AbortController()
    let running: Promise<unknown> | undefined
    try {
      await runner.prepareApproved(exec, 'ai-image', args, workspace)
      running = runner.runApproved(exec, 'ai-image', args, workspace, abort.signal)
      const pendingRoot = join(await realpath(dataDir), 'model-pending-runs')
      await waitUntil(async () => {
        const pending = await readdir(pendingRoot)
        const outputNames = await readdir(join(workspace, 'outputs'))
        return pending.some(name => name.endsWith('.json')) && outputNames.some(name => name.endsWith('-active.part'))
      })
      const pendingBefore = await readdir(pendingRoot)
      const partBefore = (await readdir(join(workspace, 'outputs'))).find(name => name.endsWith('-active.part'))
      expect(partBefore).toBeTruthy()
      const old = new Date(Date.now() - 3 * 60 * 60_000)
      await utimes(join(workspace, 'outputs', partBefore as string), old, old)

      await runner.cleanupTemporaryFiles(undefined, true)
      await concurrentRunner.cleanupTemporaryFiles(undefined, true)
      expect(await readdir(pendingRoot)).toEqual(pendingBefore)
      expect(await readFile(join(workspace, 'outputs', partBefore as string), 'utf8')).toBe('')

      await writeFile(release, 'release')
      await expect(running).resolves.toMatchObject({ ok: true })
      running = undefined
      expect(await readdir(pendingRoot)).toEqual([])
      expect((await readdir(join(workspace, 'outputs'))).filter(name => name.endsWith('.part'))).toEqual([])
    } finally {
      await writeFile(release, 'release').catch(() => undefined)
      abort.abort()
      await running?.catch(() => undefined)
      if (previousPython === undefined) delete process.env.DSH_MEDIAOPS_PYTHON
      else process.env.DSH_MEDIAOPS_PYTHON = previousPython
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
