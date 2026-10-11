import type { DashboardData, Place } from '../types.ts'
import { validDashboard } from './contracts.ts'
import { offlineAreaKey, publicOfflineEvidence } from './public-evidence.ts'
const DATABASE = 'airday-public-evidence',
  STORE = 'snapshots',
  VERSION = 1,
  MAX = 5
let generation = 0
const keyFor = offlineAreaKey
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let ended = false
    const request = indexedDB.open(DATABASE, VERSION),
      timer = setTimeout(() => {
        ended = true
        reject(new Error('Offline evidence storage timed out.'))
      }, 10000)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = request.onblocked = () => {
      ended = true
      clearTimeout(timer)
      reject(new Error('Offline evidence storage is unavailable.'))
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      if (ended) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
type Cached = {
  schemaVersion: 1
  savedAt: string
  key: string
  data: DashboardData
}
/** Dedicated, bounded public evidence cache. Never persist auth, workspace records, plans or exact detected GPS. */
export async function saveOfflineEvidence(data: DashboardData): Promise<void> {
  const sanitized = publicOfflineEvidence(data)
  if (!sanitized) return
  const started = generation
  const cached: Cached = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      key: keyFor(data.location),
      data: sanitized,
    },
    db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'),
        s = tx.objectStore(STORE),
        req = s.getAll()
      req.onsuccess = () => {
        if (started !== generation) {
          transactionAborted = true
          tx.abort()
          return
        }
        if (
          !Array.isArray(req.result) ||
          req.result.length > MAX ||
          !req.result.every(validCached)
        ) {
          tx.abort()
          return
        }
        const rows = (req.result as Cached[])
          .filter((r) => r.key !== cached.key)
          .sort((a, b) => a.savedAt.localeCompare(b.savedAt))
        while (rows.length >= MAX) {
          const oldest = rows.shift()
          if (oldest) s.delete(oldest.key)
        }
        s.put(cached, cached.key)
      }
      let transactionAborted = false
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () =>
        transactionAborted
          ? resolve()
          : reject(
              new Error(
                'Offline evidence could not save; existing bytes preserved.',
              ),
            )
    })
  } finally {
    db.close()
  }
}
function validCached(r: Cached) {
  return (
    !!r &&
    r.schemaVersion === 1 &&
    typeof r.key === 'string' &&
    typeof r.savedAt === 'string' &&
    Number.isFinite(Date.parse(r.savedAt)) &&
    validDashboard(r.data) &&
    keyFor(r.data.location) === r.key
  )
}
export async function readOfflineEvidence(
  place: Place,
): Promise<Cached | null> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'),
        req = tx.objectStore(STORE).get(keyFor(place))
      req.onsuccess = () => {
        const r = req.result as Cached | undefined
        if (r === undefined) {
          resolve(null)
          return
        }
        if (
          !validCached(r) ||
          r.key !== keyFor(place) ||
          !Number.isFinite(Date.parse(r.savedAt)) ||
          !validDashboard(r.data) ||
          keyFor(r.data.location) !== keyFor(place)
        ) {
          reject(
            new Error(
              'Cached evidence is unsupported; original bytes were preserved.',
            ),
          )
          return
        }
        const publicData = publicOfflineEvidence(r.data)
        if (!publicData) {
          reject(
            new Error(
              'Cached evidence could not be projected safely; original bytes preserved.',
            ),
          )
          return
        }
        resolve({
          schemaVersion: 1,
          key: r.key,
          savedAt: r.savedAt,
          data: publicData,
        })
      }
      req.onerror = tx.onabort = () =>
        reject(new Error('Offline evidence could not load.'))
    })
  } finally {
    db.close()
  }
}
export async function clearOfflineEvidence() {
  generation++
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () =>
        reject(new Error('Cached public evidence could not clear.'))
    })
  } finally {
    db.close()
  }
}
