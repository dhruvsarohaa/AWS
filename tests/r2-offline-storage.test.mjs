import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearOfflineEvidence,
  readOfflineEvidence,
  saveOfflineEvidence,
} from '../src/lib/offlineEvidence.ts'
import { offlineAreaKey } from '../src/lib/public-evidence.ts'

// Serialized atomic/fault-injected storage model, not a native IndexedDB or browser proof.
function installOfflineDatabase() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const data = new Map()
  let queue = Promise.resolve(),
    upgraded = false,
    failedCommit = false,
    failedOpen = false,
    pauseOpen = false,
    resumeOpen
  const database = {
    close() {},
    createObjectStore() {},
    transaction(_store, mode) {
      const jobs = []
      let aborted = false,
        staged
      const tx = {
        objectStore() {
          const request = (operation) => {
            const handle = {}
            jobs.push(() => {
              handle.result = operation()
              handle.onsuccess?.()
            })
            return handle
          }
          return {
            get: (key) => request(() => structuredClone(staged.get(key))),
            getAll: () =>
              request(() =>
                [...staged.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([, row]) => structuredClone(row)),
              ),
            put: (value, key) =>
              request(() => {
                staged.set(key, structuredClone(value))
                return key
              }),
            delete: (key) => request(() => staged.delete(key)),
            clear: () => request(() => staged.clear()),
          }
        },
        abort() {
          aborted = true
        },
      }
      queue = queue.then(async () => {
        await new Promise((resolve) => setImmediate(resolve))
        staged = new Map(structuredClone([...data]))
        try {
          for (const job of jobs) {
            if (aborted) break
            job()
          }
        } catch (error) {
          tx.error = error
          aborted = true
        }
        if (mode === 'readwrite' && failedCommit) {
          failedCommit = false
          aborted = true
        }
        if (aborted) tx.onabort?.()
        else {
          if (mode === 'readwrite') {
            data.clear()
            for (const [key, value] of staged) data.set(key, value)
          }
          tx.oncomplete?.()
        }
      })
      return tx
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = {}
        const complete = () =>
          queueMicrotask(() => {
            if (failedOpen) {
              failedOpen = false
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
        if (pauseOpen) {
          pauseOpen = false
          resumeOpen = complete
        } else complete()
        return request
      },
    },
  })
  return {
    data,
    failNextCommit() {
      failedCommit = true
    },
    failNextOpen() {
      failedOpen = true
    },
    pauseNextOpen() {
      pauseOpen = true
    },
    resume() {
      resumeOpen?.()
      resumeOpen = undefined
    },
    restore() {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
      else delete globalThis.indexedDB
    },
  }
}

const clock = '2026-10-10T00:00:00Z'
const fixture = (name = 'SYNTHETIC Delhi') => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: {
    name,
    state: 'Delhi',
    country: 'India',
    latitude: 28.6139,
    longitude: 77.209,
    confirmed: true,
    detected: true,
    accuracyMeters: 4,
    detectedAt: clock,
  },
  forecast: {
    id: 'b'.repeat(32),
    source: 'SYNTHETIC regional model',
    timezone: 'Asia/Kolkata',
    fetchedAt: clock,
    grid: { latitude: 28.6, longitude: 77.2 },
    points: [{ time: '2026-10-10T08:00:00+05:30', pm25: 0, pm10: null }],
  },
  monitors: [
    {
      source: 'OpenAQ',
      station: 'SYNTHETIC station',
      latitude: 28.614,
      longitude: 77.21,
      distanceKm: 0.1,
      pollutant: 'PM2.5',
      value: 0,
      unit: 'µg/m³',
      observedAt: clock,
      stale: false,
      url: 'https://openaq.org',
      statistic: 'unknown',
      period: null,
    },
  ],
  sources: {
    forecast: { status: 'live' },
    openaq: { status: 'live' },
    cpcb: { status: 'not_configured' },
  },
})

test('F21 storage save/read retains zeros and original source clocks while discarding exact location and private extras', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture()
    input.authToken = 'PRIVATE_SENTINEL'
    input.plan = { name: 'PRIVATE_SENTINEL' }
    input.forecast.points[0].private = 'PRIVATE_SENTINEL'
    await saveOfflineEvidence(input)
    const saved = [...db.data.values()][0],
      read = await readOfflineEvidence(input.location)
    assert.equal(saved.data.location.latitude, 28.6)
    assert.equal(read.data.location.longitude, 77.2)
    assert.equal(read.data.forecast.points[0].pm25, 0)
    assert.equal(read.data.monitors[0].value, 0)
    assert.equal(read.data.forecast.fetchedAt, clock)
    assert.equal(read.data.monitors[0].observedAt, clock)
    assert.equal(JSON.stringify(saved).includes('PRIVATE_SENTINEL'), false)
    assert.equal('accuracyMeters' in read.data.location, false)
  } finally {
    db.restore()
  }
})
test('F21 observations-only snapshots persist without inventing a forecast', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture()
    input.forecast = null
    await saveOfflineEvidence(input)
    const read = await readOfflineEvidence(input.location)
    assert.equal(read.data.forecast, null)
    assert.equal(read.data.monitors[0].value, 0)
  } finally {
    db.restore()
  }
})
test('F21 sixth area evicts the oldest saved time while keeping at most five public snapshots', async () => {
  const db = installOfflineDatabase()
  try {
    const areas = Array.from({ length: 6 }, (_, i) =>
      fixture(`SYNTHETIC area ${i}`),
    )
    for (const d of areas.slice(0, 5)) await saveOfflineEvidence(d)
    for (const [index, d] of areas.slice(0, 5).entries())
      db.data.get(offlineAreaKey(d.location)).savedAt =
        `2026-10-${String(20 - index).padStart(2, '0')}T00:00:00Z`
    await saveOfflineEvidence(areas[5])
    assert.equal(db.data.size, 5)
    assert.equal(await readOfflineEvidence(areas[4].location), null)
    assert.ok(await readOfflineEvidence(areas[0].location))
    assert.ok(await readOfflineEvidence(areas[5].location))
  } finally {
    db.restore()
  }
})
test('F21 same-area refresh replaces only its cached evidence and preserves the requested area scope', async () => {
  const db = installOfflineDatabase()
  try {
    const a = fixture(),
      b = fixture('SYNTHETIC Pune')
    b.location = {
      ...b.location,
      state: 'Maharashtra',
      latitude: 18.5204,
      longitude: 73.8567,
    }
    await saveOfflineEvidence(a)
    await saveOfflineEvidence(b)
    a.forecast.points[0].pm25 = 12
    await saveOfflineEvidence(a)
    assert.equal(db.data.size, 2)
    assert.equal(
      (await readOfflineEvidence(a.location)).data.forecast.points[0].pm25,
      12,
    )
    assert.equal(
      (await readOfflineEvidence(b.location)).data.forecast.points[0].pm25,
      0,
    )
    assert.equal(
      await readOfflineEvidence({ ...a.location, name: 'Other area' }),
      null,
    )
  } finally {
    db.restore()
  }
})
test('F21 reading a valid older envelope projects public fields without rewriting original stored bytes', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture(),
      key = offlineAreaKey(input.location)
    input.authToken = 'PRIVATE_SENTINEL'
    input.location.precisePosition = 'PRIVATE_SENTINEL'
    input.forecast.grid.private = 'PRIVATE_SENTINEL'
    const envelope = {
      schemaVersion: 1,
      savedAt: clock,
      key,
      data: input,
      privateWorkspace: 'PRIVATE_SENTINEL',
    }
    db.data.set(key, structuredClone(envelope))
    const read = await readOfflineEvidence(input.location)
    assert.equal(read.data.location.latitude, 28.6)
    assert.equal(JSON.stringify(read).includes('PRIVATE_SENTINEL'), false)
    assert.deepEqual(db.data.get(key), envelope)
  } finally {
    db.restore()
  }
})
test('F21 unsupported or corrupt cache bytes reject reads and writes without destructive repair', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture(),
      key = offlineAreaKey(input.location),
      bad = { schemaVersion: 99, savedAt: clock, key, data: input }
    db.data.set(key, structuredClone(bad))
    await assert.rejects(readOfflineEvidence(input.location), /unsupported/)
    await assert.rejects(saveOfflineEvidence(input), /preserved/)
    assert.deepEqual(db.data.get(key), bad)
  } finally {
    db.restore()
  }
})
test('F21 malformed pollutant units cannot enter the cache or be read as valid older evidence', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture(),
      key = offlineAreaKey(input.location)
    input.monitors[0].unit = 'AQI'
    await saveOfflineEvidence(input)
    assert.equal(db.data.size, 0)
    const bad = { schemaVersion: 1, savedAt: clock, key, data: input }
    db.data.set(key, structuredClone(bad))
    await assert.rejects(readOfflineEvidence(input.location), /unsupported/)
    assert.deepEqual(db.data.get(key), bad)
  } finally {
    db.restore()
  }
})
test('F21 a failed atomic save keeps the earlier complete snapshot intact', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture()
    await saveOfflineEvidence(input)
    const before = structuredClone([...db.data])
    input.forecast.points[0].pm25 = 80
    db.failNextCommit()
    await assert.rejects(saveOfflineEvidence(input), /preserved/)
    assert.deepEqual([...db.data], before)
  } finally {
    db.restore()
  }
})
test('F21 successful clear cannot be undone by a save waiting on an older database opening', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture()
    await saveOfflineEvidence(input)
    db.pauseNextOpen()
    const outstanding = saveOfflineEvidence(input)
    await clearOfflineEvidence()
    db.resume()
    await outstanding
    assert.equal(db.data.size, 0)
    assert.equal(await readOfflineEvidence(input.location), null)
  } finally {
    db.resume()
    db.restore()
  }
})
test('F21 failed clear keeps retained snapshots, and unavailable storage yields a recoverable error', async () => {
  const db = installOfflineDatabase()
  try {
    const input = fixture()
    await saveOfflineEvidence(input)
    const before = structuredClone([...db.data])
    db.failNextCommit()
    await assert.rejects(clearOfflineEvidence(), /could not clear/)
    assert.deepEqual([...db.data], before)
    db.failNextOpen()
    await assert.rejects(readOfflineEvidence(input.location), /unavailable/)
    assert.deepEqual([...db.data], before)
  } finally {
    db.restore()
  }
})
