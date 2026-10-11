import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearMigrationRecovery,
  loadLocalDocument,
  LocalConflict,
  LocalRecovery,
  normalizeLocalBackup,
  readStoredRecovery,
  recoverLocalDocument,
  validLocalState,
  writeLocalDocument,
} from '../src/lib/localRepository.ts'
import {
  assertLocalReplacementCurrent,
  mergeLocalStates,
  prepareLocalReplacement,
} from '../src/lib/local-backup.ts'
import { STARTER_PLAN } from '../src/lib/planner.ts'

// Fault-injectable serialized/atomic transaction model. It verifies repository
// invariants; actual IndexedDB and rendered controls need separate browser evidence.
function installStorage() {
  const descriptors = new Map(
    ['indexedDB', 'localStorage'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  )
  const data = new Map(),
    legacy = new Map()
  let queue = Promise.resolve(),
    upgraded = false,
    failCommit = false,
    failOpen = false
  const database = {
    close() {},
    createObjectStore() {},
    transaction(_name, mode) {
      const jobs = []
      let aborted = false,
        staged
      const transaction = {
        objectStore() {
          const request = (operation) => {
            const handle = {}
            jobs.push(() => {
              handle.result = operation()
              handle.onsuccess?.()
            })
            return handle
          }
          const entries = () =>
            [...staged.entries()].sort(([a], [b]) => a.localeCompare(b))
          return {
            get: (key) => request(() => structuredClone(staged.get(key))),
            getAllKeys: () => request(() => entries().map(([key]) => key)),
            getAll: () =>
              request(() =>
                entries().map(([, value]) => structuredClone(value)),
              ),
            put: (value, key) =>
              request(() => {
                staged.set(key, structuredClone(value))
                return key
              }),
            add: (value, key) =>
              request(() => {
                if (staged.has(key)) throw new Error('ConstraintError')
                staged.set(key, structuredClone(value))
                return key
              }),
            delete: (key) => request(() => staged.delete(key)),
          }
        },
        abort() {
          aborted = true
        },
      }
      queue = queue.then(async () => {
        await new Promise((resolve) => setImmediate(resolve))
        staged = new Map(structuredClone([...data.entries()]))
        try {
          for (const job of jobs) {
            if (aborted) break
            job()
          }
        } catch (error) {
          transaction.error = error
          aborted = true
        }
        if (mode === 'readwrite' && failCommit) {
          failCommit = false
          aborted = true
        }
        if (aborted) transaction.onabort?.()
        else {
          if (mode === 'readwrite') {
            data.clear()
            for (const [key, value] of staged) data.set(key, value)
          }
          transaction.oncomplete?.()
        }
      })
      return transaction
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = {}
        queueMicrotask(() => {
          if (failOpen) {
            failOpen = false
            request.onerror?.()
            return
          }
          request.result = database
          if (!upgraded) {
            upgraded = true
            request.onupgradeneeded?.()
          }
          request.onsuccess?.()
        })
        return request
      },
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => legacy.get(key) ?? null,
      setItem: (key, value) => legacy.set(key, value),
      removeItem: (key) => legacy.delete(key),
    },
  })
  return {
    data,
    legacy,
    failNextCommit() {
      failCommit = true
    },
    failNextOpen() {
      failOpen = true
    },
    restore() {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}
const state = (overrides = {}) => ({
  plan: structuredClone(STARTER_PLAN),
  journal: [],
  oneOffs: [],
  dismissedAlerts: [],
  language: 'en',
  favorites: [],
  feedback: [],
  ...overrides,
})
const row = (id, overrides = {}) => ({
  id,
  activityId: id,
  activity: 'Synthetic activity',
  snapshotId: 'a'.repeat(32),
  planVersion: 'synthetic',
  threshold: 75,
  date: '2026-10-10',
  reason: 'Synthetic reviewed reason',
  choice: 'indoors',
  followThrough: 'unconfirmed',
  at: '2026-10-10T03:00:00Z',
  ...overrides,
})

test('R0 valid legacy localStorage migrates once without changing original strings', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const plan = {
    ...structuredClone(STARTER_PLAN),
    name: 'Synthetic migrated plan',
    configured: true,
  }
  fixture.legacy.set('airday-plan', JSON.stringify(plan))
  fixture.legacy.set('airday-journal', JSON.stringify([row('migrated')]))
  const original = [...fixture.legacy.entries()]
  const first = await loadLocalDocument()
  assert.equal(first.schemaVersion, 2)
  assert.equal(first.revision, 0)
  assert.equal(first.state.plan.name, plan.name)
  assert.deepEqual(first.state.journal, [row('migrated')])
  assert.deepEqual([...fixture.legacy.entries()], original)
  assert.deepEqual(await loadLocalDocument(), first)
})

test('R0 schema-1 migration is atomic, preserves exact original and is idempotent', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const oldState = state({ language: 'hi' })
  delete oldState.favorites
  delete oldState.feedback
  const original = { schemaVersion: 1, revision: 4, state: oldState }
  fixture.data.set('planning', structuredClone(original))
  fixture.failNextCommit()
  await assert.rejects(
    loadLocalDocument(),
    (error) =>
      !(error instanceof LocalRecovery) &&
      /could not load or commit/.test(error.message),
  )
  assert.deepEqual(fixture.data.get('planning'), original)
  assert.equal(fixture.data.has('planning-v1-recovery'), false)
  const migrated = await loadLocalDocument()
  assert.equal(migrated.revision, 5)
  assert.deepEqual(migrated.state, state({ language: 'hi' }))
  assert.deepEqual(fixture.data.get('planning-v1-recovery'), original)
  assert.deepEqual(await loadLocalDocument(), migrated)
  assert.deepEqual(fixture.data.get('planning-v1-recovery'), original)
})

test('R0 migration retains a valid unconfigured plan without substituting a starter schedule', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const plan = {
    ...structuredClone(STARTER_PLAN),
    name: 'Synthetic saved preview',
    activities: [STARTER_PLAN.activities[1]],
  }
  fixture.legacy.set('airday-plan', JSON.stringify(plan))
  assert.deepEqual((await loadLocalDocument()).state.plan, plan)
})

test('R0 empty corrupt legacy values remain authoritative and cannot silently fall back', async () => {
  for (const key of ['airday-plan', 'airday-school-plan', 'airday-journal']) {
    const fixture = installStorage()
    try {
      fixture.legacy.set(key, '')
      if (key === 'airday-plan')
        fixture.legacy.set('airday-school-plan', JSON.stringify(STARTER_PLAN))
      await assert.rejects(loadLocalDocument(), LocalRecovery)
      assert.equal(fixture.legacy.get(key), '')
      assert.equal(fixture.data.has('planning'), false)
    } finally {
      fixture.restore()
    }
  }
})

test('R0 concurrent expected-revision writes allow one winner and never mix documents', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const original = await loadLocalDocument()
  const left = state({ language: 'hi', journal: [row('left')] })
  const right = state({ journal: [row('right')] })
  const results = await Promise.allSettled([
    writeLocalDocument(left, original.revision),
    writeLocalDocument(right, original.revision),
  ])
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof LocalConflict,
    ).length,
    1,
  )
  const stored = await loadLocalDocument()
  assert.equal(stored.revision, 1)
  assert.deepEqual(stored.state, left)
})

test('R0 failed save preserves last durable state and a complete retry succeeds', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const original = await loadLocalDocument()
  const next = state({ journal: [row('atomic')], language: 'hi' })
  fixture.failNextCommit()
  await assert.rejects(
    writeLocalDocument(next, original.revision),
    /complete change remains in this session/,
  )
  assert.deepEqual(await loadLocalDocument(), original)
  const saved = await writeLocalDocument(next, original.revision)
  assert.deepEqual((await loadLocalDocument()).state, next)
  assert.equal(saved.revision, 1)
})

test('R0 corrupt/unknown planning is recoverable only by explicit reviewed replacement', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const original = {
    schemaVersion: 99,
    revision: 7,
    privateOriginal: 'Synthetic original preserved',
    state: { broken: true },
  }
  fixture.data.set('planning', original)
  fixture.legacy.set('airday-journal', '{broken legacy data')
  let source
  await assert.rejects(loadLocalDocument(), (error) => {
    source = error.source
    return error instanceof LocalRecovery
  })
  assert.deepEqual(fixture.data.get('planning'), original)
  await assert.rejects(writeLocalDocument(state(), 7), LocalRecovery)
  const next = state({
    plan: { ...structuredClone(STARTER_PLAN), name: 'Reviewed recovery' },
  })
  const recovered = await recoverLocalDocument(next, source)
  assert.equal(recovered.revision, 8)
  assert.deepEqual(await loadLocalDocument(), recovered)
  const exported = await readStoredRecovery()
  const copies = Object.values(exported.recoveryCopies)
  assert.equal(copies.length, 1)
  assert.deepEqual(copies[0].document, original)
  assert.equal(copies[0].legacy['airday-journal'], '{broken legacy data')
  assert.equal(fixture.legacy.get('airday-journal'), '{broken legacy data')
  await clearMigrationRecovery()
  assert.equal(
    Object.keys((await readStoredRecovery()).recoveryCopies).length,
    0,
  )
  assert.deepEqual(await loadLocalDocument(), recovered)
})

test('R0 failed recovery commit saves neither replacement nor archive', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const original = { schemaVersion: 99, revision: 10, state: { broken: true } }
  fixture.data.set('planning', original)
  let source
  await assert.rejects(loadLocalDocument(), (error) => {
    source = error.source
    return error instanceof LocalRecovery
  })
  fixture.failNextCommit()
  await assert.rejects(
    recoverLocalDocument(state(), source),
    /Original stored data was not changed/,
  )
  assert.deepEqual(fixture.data.get('planning'), original)
  assert.equal(
    [...fixture.data.keys()].filter((key) =>
      key.startsWith('planning-recovery:'),
    ).length,
    0,
  )
})

test('R0 recovery refuses canonical or legacy content changed after review', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const original = { schemaVersion: 99, revision: 3 }
  fixture.data.set('planning', original)
  let source
  await assert.rejects(loadLocalDocument(), (error) => {
    source = error.source
    return error instanceof LocalRecovery
  })
  fixture.data.set('planning', { ...original, updated: 'Another tab' })
  await assert.rejects(recoverLocalDocument(state(), source), LocalConflict)
  fixture.data.set('planning', original)
  fixture.legacy.set('airday-plan', 'Changed original legacy bytes')
  await assert.rejects(recoverLocalDocument(state(), source), LocalConflict)
  assert.equal(
    [...fixture.data.keys()].filter((key) =>
      key.startsWith('planning-recovery:'),
    ).length,
    0,
  )
})

test('R0 oversized legacy journals are preserved and require recovery instead of silent truncation', async () => {
  for (const key of ['airday-journal', 'airday-decision-state']) {
    const fixture = installStorage()
    try {
      const rows = Array.from({ length: 201 }, (_, index) =>
        row('oversize-' + index),
      )
      const raw = JSON.stringify(
        key === 'airday-journal' ? rows : { schemaVersion: 3, records: rows },
      )
      fixture.legacy.set(key, raw)
      await assert.rejects(loadLocalDocument(), LocalRecovery)
      assert.equal(fixture.legacy.get(key), raw)
      assert.equal(fixture.data.has('planning'), false)
    } finally {
      fixture.restore()
    }
  }
})

test('R0 invalid backups and versions refuse normalization; v1 gains only declared defaults', () => {
  const old = state()
  delete old.favorites
  delete old.feedback
  assert.deepEqual(normalizeLocalBackup(1, old), state())
  assert.equal(normalizeLocalBackup(99, state()), null)
  assert.equal(normalizeLocalBackup(1, state()), null)
  assert.equal(
    normalizeLocalBackup(
      2,
      state({ journal: [row('bad', { snapshotId: 'invalid' })] }),
    ),
    null,
  )
  assert.equal(
    validLocalState(state({ oneOffs: [{ id: 'impossible' }] })),
    false,
  )
})

test('R0 recurring and quick activity IDs cannot collide in a stored or imported plan', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  const quickActivity = structuredClone(STARTER_PLAN.activities[0])
  const collision = state({
    oneOffs: [
      {
        id: quickActivity.id,
        locationKey: 'a'.repeat(32),
        date: '2026-10-10',
        plan: {
          ...structuredClone(STARTER_PLAN),
          configured: true,
          activities: [quickActivity],
        },
      },
    ],
  })
  assert.equal(validLocalState(collision), false)
  assert.equal(normalizeLocalBackup(2, collision), null)
  const original = { schemaVersion: 2, revision: 4, state: collision }
  fixture.data.set('planning', original)
  await assert.rejects(loadLocalDocument(), LocalRecovery)
  assert.deepEqual(fixture.data.get('planning'), original)
})

test('R0 backup merge preserves preferences, deduplicates exact evidence and rejects conflicting lifecycle/history', () => {
  const current = state({ language: 'hi', journal: [row('existing')] })
  const incoming = state({ journal: [row('existing'), row('new')] })
  const merged = mergeLocalStates(current, incoming)
  assert.equal(merged.language, 'hi')
  assert.deepEqual(
    merged.journal.map((item) => item.id),
    ['existing', 'new'],
  )
  assert.deepEqual(current.journal, [row('existing')])
  assert.throws(
    () =>
      mergeLocalStates(
        current,
        state({ journal: [row('existing', { lifecycle: 'reopened' })] }),
      ),
    /different evidence or lifecycle/,
  )
  assert.throws(
    () =>
      mergeLocalStates(
        current,
        state({ journal: [row('another', { activityId: 'existing' })] }),
      ),
    /overlapping history/,
  )
  const bounded = state({
    journal: Array.from({ length: 200 }, (_, index) => row('bounded-' + index)),
  })
  assert.throws(
    () => mergeLocalStates(bounded, state({ journal: [row('overflow')] })),
    /No records were dropped/,
  )
  assert.equal(bounded.journal.length, 200)
})

test('R0 unavailable database produces a retryable session error without overwriting originals', async (context) => {
  const fixture = installStorage()
  context.after(() => fixture.restore())
  fixture.failNextOpen()
  await assert.rejects(
    loadLocalDocument(),
    (error) =>
      !(error instanceof LocalRecovery) && /could not open/.test(error.message),
  )
  assert.equal(fixture.data.size, 0)
  assert.equal((await loadLocalDocument()).revision, 0)
})

test('R0 replacement confirmation freezes both reviewed documents and rejects later context changes', () => {
  const current = state({ language: 'hi' })
  const backup = state({ journal: [row('reviewed')] })
  const review = prepareLocalReplacement('replace', current, backup, 12, false)
  current.plan.name = 'Later current draft'
  backup.journal[0].reason = 'Later backup change'
  backup.journal.push(row('unreviewed'))
  assert.equal(review.current.plan.name, STARTER_PLAN.name)
  assert.equal(review.replacement.journal.length, 1)
  assert.equal(
    review.replacement.journal[0].reason,
    'Synthetic reviewed reason',
  )
  assert.doesNotThrow(() => assertLocalReplacementCurrent(review, 12, false))
  assert.throws(
    () => assertLocalReplacementCurrent(review, 13, false),
    /changed after this confirmation/,
  )
  assert.throws(
    () => assertLocalReplacementCurrent(review, 12, true),
    /changed after this confirmation/,
  )
})

test('R0 confirmation rejects invalid replacements and stale recovery requirements before saving', () => {
  assert.throws(
    () =>
      prepareLocalReplacement(
        'replace',
        state(),
        state({ language: 'unsupported' }),
        1,
        false,
      ),
    /validated planning document/,
  )
  assert.throws(
    () =>
      prepareLocalReplacement('recover_session', state(), state(), 1, false),
    /no longer required/,
  )
  const session = state({ journal: [row('session')] })
  const review = prepareLocalReplacement(
    'recover_session',
    session,
    session,
    1,
    true,
  )
  assert.notEqual(review.current, session)
  assert.notEqual(review.replacement, session)
  assert.deepEqual(review.current, review.replacement)
  assert.doesNotThrow(() => assertLocalReplacementCurrent(review, 1, true))
})
