import { validateJourneyLibrary } from './r4-journeys.ts'
import type { JourneyLibrary } from './r4-journeys.ts'

export const JOURNEY_DATABASE = 'airday-local-journeys'
export const JOURNEY_CHANGE_EVENT = 'airday-journeys-changed'
export const JOURNEY_CLEAR_EVENT = 'airday-journeys-cleared'
const STORE = 'records',
  KEY = 'library'
let epoch = 0
let channel: BroadcastChannel | null = null
function changes() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(JOURNEY_DATABASE)
    channel.onmessage = (event) => {
      if (event.data?.clear) {
        epoch++
        window.dispatchEvent(new Event(JOURNEY_CLEAR_EVENT))
      }
      window.dispatchEvent(new Event(JOURNEY_CHANGE_EVENT))
    }
  }
  return channel
}
export const journeyStorageEpoch = () => epoch
const empty = (): JourneyLibrary => ({
  schemaVersion: 1,
  revision: 0,
  journeys: [],
})
async function open() {
  if (typeof indexedDB === 'undefined')
    throw new Error(
      'Journey storage is unavailable. Keep an export; this session is not saved.',
    )
  changes()
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(JOURNEY_DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () =>
      reject(
        new Error(
          'Journey storage could not be opened. Original data is preserved.',
        ),
      )
    request.onblocked = () =>
      reject(
        new Error(
          'Close another Airday tab before recovering journey storage.',
        ),
      )
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
export async function readOriginalJourneyBytes(): Promise<string> {
  const db = await open()
  try {
    return await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly'),
        request = transaction.objectStore(STORE).get(KEY)
      let value: unknown
      request.onsuccess = () => {
        value = request.result
      }
      transaction.oncomplete = () =>
        resolve(JSON.stringify(value ?? empty(), null, 2))
      transaction.onerror = () =>
        reject(new Error('Original journey data could not be read.'))
      transaction.onabort = transaction.onerror
    })
  } finally {
    db.close()
  }
}
export async function loadJourneyLibrary(): Promise<JourneyLibrary> {
  return validateJourneyLibrary(JSON.parse(await readOriginalJourneyBytes()))
}
/** One atomic optimistic write. A storage failure does not imply a successful save. */
export async function saveJourneyLibrary(
  library: JourneyLibrary,
  expectedRevision: number,
  expectedEpoch: number,
): Promise<JourneyLibrary> {
  const clean = validateJourneyLibrary(library)
  if (epoch !== expectedEpoch)
    throw new Error('Journey data was cleared; this draft cannot restore it.')
  const db = await open()
  try {
    const saved = await new Promise<JourneyLibrary>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        objectStore = transaction.objectStore(STORE),
        read = objectStore.get(KEY)
      let problem = 'Journey save failed. Keep an export of the unsaved draft.'
      const next = { ...clean, revision: expectedRevision + 1 }
      read.onsuccess = () => {
        try {
          const previous = validateJourneyLibrary(read.result ?? empty())
          if (
            previous.revision !== expectedRevision ||
            epoch !== expectedEpoch
          ) {
            problem =
              'Another tab changed or cleared journeys. Export your draft, then reload before saving.'
            transaction.abort()
            return
          }
          objectStore.put(next, KEY)
        } catch (error) {
          problem = error instanceof Error ? error.message : problem
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(next)
      transaction.onerror = () => reject(new Error(problem))
      transaction.onabort = transaction.onerror
    })
    changes()?.postMessage({ revision: saved.revision })
    window.dispatchEvent(new Event(JOURNEY_CHANGE_EVENT))
    return saved
  } finally {
    db.close()
  }
}
/** Called by the existing global Airday clear action. Keep a revision tombstone so old tabs cannot recreate private routes. */
export async function clearLocalJourneys(): Promise<void> {
  epoch++
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(JOURNEY_CLEAR_EVENT))
  changes()?.postMessage({ clear: true })
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        objectStore = transaction.objectStore(STORE),
        read = objectStore.get(KEY)
      read.onsuccess = () => {
        const previousRevision =
          Number.isSafeInteger(read.result?.revision) &&
          read.result.revision < Number.MAX_SAFE_INTEGER
            ? read.result.revision
            : Date.now()
        objectStore.put(
          { schemaVersion: 1, revision: previousRevision + 1, journeys: [] },
          KEY,
        )
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(
          new Error(
            'Journey data could not be cleared. Close other tabs and retry.',
          ),
        )
      transaction.onabort = transaction.onerror
    })
    window.dispatchEvent(new Event(JOURNEY_CHANGE_EVENT))
  } finally {
    db.close()
  }
}
