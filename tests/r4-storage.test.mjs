import assert from 'node:assert/strict'
import test from 'node:test'
import { newForegroundJourney } from '../src/lib/r4-journeys.ts'
import {
  clearLocalJourneys,
  journeyStorageEpoch,
  loadJourneyLibrary,
  readOriginalJourneyBytes,
  saveJourneyLibrary,
} from '../src/lib/r4-journey-store.ts'

// A fault-injectable asynchronous IndexedDB test surface. It models serialized atomic
// transactions, not browser persistence; rendered browser QA verifies real IndexedDB.
function installStorageSurface() {
  const originals = new Map(
    ['indexedDB', 'window', 'BroadcastChannel'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  )
  let value,
    transactionQueue = Promise.resolve(),
    failCommit = false,
    upgraded = false
  const target = new EventTarget()
  const database = {
    close() {},
    createObjectStore() {},
    transaction(_store, mode) {
      let request,
        aborted = false,
        replacement,
        put = false
      const transaction = {
        objectStore() {
          return {
            get() {
              request = {}
              return request
            },
            put(next) {
              replacement = structuredClone(next)
              put = true
            },
          }
        },
        abort() {
          aborted = true
        },
      }
      transactionQueue = transactionQueue.then(async () => {
        await new Promise((resolve) => setImmediate(resolve))
        request.result = structuredClone(value)
        request.onsuccess?.()
        await new Promise((resolve) => setImmediate(resolve))
        if (aborted || (mode === 'readwrite' && failCommit)) {
          failCommit = false
          transaction.onabort?.()
        } else {
          if (put) value = replacement
          transaction.oncomplete?.()
        }
      })
      return transaction
    },
  }
  Object.defineProperty(globalThis, 'window', {
    value: target,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: undefined,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open() {
        const request = {}
        queueMicrotask(() => {
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
    configurable: true,
  })
  return {
    seed(next) {
      value = structuredClone(next)
    },
    failNextCommit() {
      failCommit = true
    },
    snapshot() {
      return structuredClone(value)
    },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    },
  }
}
const completed = (name) => ({
  ...newForegroundJourney(name),
  status: 'completed',
})
test('R4 local transaction invariants preserve conflicting/failed/corrupt records and clear blocks stale writers', async (context) => {
  const fixture = installStorageSurface()
  context.after(() => fixture.restore())
  const initial = await loadJourneyLibrary(),
    epoch = journeyStorageEpoch()
  assert.deepEqual(initial, { schemaVersion: 1, revision: 0, journeys: [] })
  const firstJourney = completed('First fixture')
  const saved = await saveJourneyLibrary(
    { ...initial, journeys: [firstJourney] },
    0,
    epoch,
  )
  assert.equal(saved.revision, 1)
  // Two readers act on the same revision. Exactly one change commits.
  const left = completed('Left'),
    right = completed('Right')
  const concurrent = await Promise.allSettled([
    saveJourneyLibrary(
      { ...saved, journeys: [left, firstJourney] },
      saved.revision,
      epoch,
    ),
    saveJourneyLibrary(
      { ...saved, journeys: [right, firstJourney] },
      saved.revision,
      epoch,
    ),
  ])
  assert.equal(
    concurrent.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    concurrent.filter((result) => result.status === 'rejected').length,
    1,
  )
  const winner = await loadJourneyLibrary()
  assert.equal(winner.revision, 2)
  assert.equal(winner.journeys.length, 2)
  assert.equal(winner.journeys[0].id, left.id)
  // A failed durable commit does not silently replace either the last saved data or its version.
  fixture.failNextCommit()
  await assert.rejects(
    saveJourneyLibrary({ ...winner, journeys: [] }, winner.revision, epoch),
    /failed/,
  )
  assert.deepEqual(await loadJourneyLibrary(), winner)
  // Corrupt/unknown schemas remain exportable and refuse every normal write.
  const corrupt = {
    schemaVersion: 91,
    revision: 77,
    original: 'preserved recovery text',
    journeys: [{ invalid: true }],
  }
  fixture.seed(corrupt)
  await assert.rejects(loadJourneyLibrary(), /recovery/)
  assert.deepEqual(JSON.parse(await readOriginalJourneyBytes()), corrupt)
  await assert.rejects(saveJourneyLibrary(initial, 77, epoch), /recovery/)
  assert.deepEqual(fixture.snapshot(), corrupt)
  // Explicit clear is permitted for corrupt storage and leaves a supported empty revision tombstone.
  await clearLocalJourneys()
  const cleared = await loadJourneyLibrary()
  assert.equal(cleared.schemaVersion, 1)
  assert.equal(cleared.revision, 78)
  assert.deepEqual(cleared.journeys, [])
  await assert.rejects(
    saveJourneyLibrary(saved, saved.revision, epoch),
    /cleared/,
  )
  assert.deepEqual(await loadJourneyLibrary(), cleared)
  // A normal user write with the new epoch/revision still works after deletion.
  const afterClear = completed('New explicit fixture')
  const fresh = await saveJourneyLibrary(
    { ...cleared, journeys: [afterClear] },
    cleared.revision,
    journeyStorageEpoch(),
  )
  assert.equal(fresh.revision, 79)
  // Clear while a write is waiting invalidates it; its old draft cannot repopulate exact positions.
  const pending = saveJourneyLibrary(
    { ...fresh, journeys: [firstJourney, afterClear] },
    fresh.revision,
    journeyStorageEpoch(),
  )
  const pendingCheck = assert.rejects(pending, /changed or cleared/)
  await clearLocalJourneys()
  await pendingCheck
  assert.deepEqual((await loadJourneyLibrary()).journeys, [])
})
