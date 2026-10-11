import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('local recovery restores a corrupt store and preserves the original bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'airday-operator-check-'))
  assert.ok(
    resolve(directory).startsWith(
      resolve(tmpdir()) + '\\airday-operator-check-',
    ) ||
      resolve(directory).startsWith(
        resolve(tmpdir()) + '/airday-operator-check-',
      ),
  )
  try {
    await mkdir(join(directory, '.airday-local'))
    await writeFile(
      join(directory, '.airday-local', 'state.json'),
      'synthetic corrupt bytes',
    )
    const backup = [
      {
        pk: 'WORKSPACE#test',
        sk: 'plan',
        version: 2,
        data: { name: 'SYNTHETIC RESTORE FIXTURE' },
      },
    ]
    await writeFile(join(directory, 'backup.json'), JSON.stringify(backup))
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/operator.mjs'),
        'restore',
        '--local',
        '--file',
        'backup.json',
        '--confirm',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      JSON.parse(
        await readFile(join(directory, '.airday-local', 'state.json'), 'utf8'),
      ),
      backup,
    )
    const files = await readdir(join(directory, '.airday-local', 'backups'))
    assert.equal(files.length, 1)
    assert.equal(
      await readFile(
        join(directory, '.airday-local', 'backups', files[0]),
        'utf8',
      ),
      'synthetic corrupt bytes',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('local operator mutations refuse an active API writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'airday-operator-check-'))
  assert.ok(
    resolve(directory).startsWith(
      resolve(tmpdir()) + '\\airday-operator-check-',
    ) ||
      resolve(directory).startsWith(
        resolve(tmpdir()) + '/airday-operator-check-',
      ),
  )
  try {
    await mkdir(join(directory, '.airday-local'))
    await writeFile(
      join(directory, '.airday-local', 'api.pid'),
      String(process.pid),
    )
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/operator.mjs'), 'pause', '--local'],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Stop pnpm dev before modifying file-backed evidence/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
