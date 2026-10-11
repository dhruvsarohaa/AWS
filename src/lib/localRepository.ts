import type { LocalState, OutdoorPlan } from '../types.ts'
import { validatePlan } from './planner.ts'
import { validPlace } from './contracts.ts'
import { reviewedLocation } from './decision-evidence.ts'
import { validLocalGroups } from './groups.ts'
import { validSuggestionFeedback } from './suggestion-feedback.ts'
import {
  hasDecisionStorageIssue,
  readJournal,
  readPlan,
  validDecisionRecords,
} from './storage.ts'

export type LocalDocument = {
  schemaVersion: 2
  revision: number
  state: LocalState
}
const DATABASE = 'airday-planning'
const STORE = 'documents'
const KEY = 'planning'
const RECOVERY_PREFIX = 'planning-recovery:'
const LEGACY_KEYS = [
  'airday-plan',
  'airday-school-plan',
  'airday-journal',
  'airday-decision-state',
] as const
export type LocalRecoverySource = {
  document: unknown
  legacy: Record<string, string | null>
  legacyUnavailable: boolean
}
export class LocalConflict extends Error {}
export class LocalRecovery extends Error {
  source?: LocalRecoverySource
  constructor(message: string, source?: LocalRecoverySource) {
    super(message)
    this.source = source
  }
}
function legacyRecoveryValues() {
  const legacy: Record<string, string | null> = {}
  let legacyUnavailable = false
  for (const key of LEGACY_KEYS) {
    try {
      legacy[key] = localStorage.getItem(key)
    } catch {
      legacy[key] = null
      legacyUnavailable = true
    }
  }
  return { legacy, legacyUnavailable }
}
function recoverySource(document: unknown): LocalRecoverySource {
  return {
    document: structuredClone(document ?? null),
    ...legacyRecoveryValues(),
  }
}
export function validLocalPlan(plan: unknown): plan is OutdoorPlan {
  if (!plan || typeof plan !== 'object') return false
  const p = plan as OutdoorPlan
  return (
    typeof p.name === 'string' &&
    typeof p.configured === 'boolean' &&
    (p.ruleMode === undefined || ['example', 'custom'].includes(p.ruleMode)) &&
    Number.isFinite(p.threshold) &&
    Array.isArray(p.activities) &&
    p.activities.every(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        a.id.length > 0 &&
        a.id.length <= 100 &&
        typeof a.activity === 'string' &&
        a.activity.length <= 100 &&
        typeof a.place === 'string' &&
        a.place.length <= 100 &&
        typeof a.start === 'string' &&
        typeof a.end === 'string' &&
        Array.isArray(a.days) &&
        (a.flexible === undefined || typeof a.flexible === 'boolean') &&
        (a.indoorAvailable === undefined ||
          typeof a.indoorAvailable === 'boolean') &&
        (a.intensity === undefined ||
          ['low', 'moderate', 'high'].includes(a.intensity)) &&
        (a.allowedStart === undefined || typeof a.allowedStart === 'string') &&
        (a.allowedEnd === undefined || typeof a.allowedEnd === 'string'),
    ) &&
    !Object.keys(validatePlan(p)).length
  )
}
function validLegacyState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as LocalState
  return (
    validLocalPlan(v.plan) &&
    validDecisionRecords(v.journal) &&
    ['en', 'hi'].includes(v.language) &&
    Array.isArray(v.dismissedAlerts) &&
    v.dismissedAlerts.length <= 200 &&
    v.dismissedAlerts.every((x) => typeof x === 'string' && x.length <= 2000) &&
    Array.isArray(v.oneOffs) &&
    v.oneOffs.length <= 100 &&
    new Set(v.oneOffs.map((x) => x?.id)).size === v.oneOffs.length &&
    v.oneOffs.every(
      (x) => !v.plan.activities.some((activity) => activity.id === x?.id),
    ) &&
    v.oneOffs.every(
      (x) =>
        x &&
        typeof x.id === 'string' &&
        typeof x.locationKey === 'string' &&
        /^[a-f0-9]{32}$/.test(x.locationKey) &&
        typeof x.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
        Number.isFinite(Date.parse(`${x.date}T12:00:00Z`)) &&
        new Date(`${x.date}T12:00:00Z`).toISOString().slice(0, 10) === x.date &&
        validLocalPlan(x.plan) &&
        x.plan.configured &&
        x.plan.activities.length === 1 &&
        x.plan.activities[0].id === x.id,
    )
  )
}
export function validLocalState(value: unknown): value is LocalState {
  if (!validLegacyState(value)) return false
  const v = value as LocalState
  return (
    Array.isArray(v.favorites) &&
    v.favorites.length <= 5 &&
    validLocalGroups(v.groups, v.favorites) &&
    new Set(v.favorites.map((f) => f?.id)).size === v.favorites.length &&
    v.favorites.every(
      (f) =>
        f &&
        /^[a-f0-9]{32}$/.test(f.id) &&
        typeof f.label === 'string' &&
        f.label.trim().length > 0 &&
        f.label.length <= 80 &&
        validPlace(f.place) &&
        f.place.confirmed === true &&
        !f.place.detected &&
        f.place.accuracyMeters === undefined &&
        f.place.detectedAt === undefined &&
        Math.abs(f.place.latitude * 10 - Math.round(f.place.latitude * 10)) <
          1e-7 &&
        Math.abs(f.place.longitude * 10 - Math.round(f.place.longitude * 10)) <
          1e-7 &&
        reviewedLocation(f.place).key === f.id,
    ) &&
    Array.isArray(v.feedback) &&
    v.feedback.length <= 200 &&
    new Set(v.feedback.map((f) => f?.id)).size === v.feedback.length &&
    new Set(v.feedback.map((f) => f?.assessmentId)).size ===
      v.feedback.length &&
    v.feedback.every((f) => {
      if (!validSuggestionFeedback(f)) return false
      const decision =
        f.decisionId && v.journal.find((d) => d.id === f.decisionId)
      return (
        !decision ||
        (decision.location?.key === f.locationKey &&
          decision.date === f.date &&
          decision.activity === f.activity)
      )
    })
  )
}
/** Explicit schema migration; an invalid/unknown document is never normalized to empty data. */
export function normalizeLocalBackup(
  version: unknown,
  value: unknown,
): LocalState | null {
  if (version === 2) return validLocalState(value) ? value : null
  if (version !== 1 || !validLegacyState(value)) return null
  const old = value as Omit<LocalState, 'favorites' | 'feedback'>
  if (
    'favorites' in (value as Record<string, unknown>) ||
    'feedback' in (value as Record<string, unknown>)
  )
    return null
  const next = { ...old, favorites: [], feedback: [] }
  return validLocalState(next) ? next : null
}
export function legacyLocalState(): LocalState {
  return {
    plan: readPlan(),
    journal: readJournal(),
    oneOffs: [],
    dismissedAlerts: [],
    language: 'en',
    favorites: [],
    feedback: [],
  }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false
    const fail = (message: string) => {
      failed = true
      clearTimeout(timeout)
      reject(new Error(message))
    }
    const timeout = setTimeout(
      () =>
        fail(
          'Browser storage did not open in time. This session can still be exported.',
        ),
      15000,
    )
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DATABASE, 1)
    } catch {
      fail(
        'Browser database is unavailable. This session can still be exported.',
      )
      return
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => fail('Browser database could not open.')
    request.onblocked = () =>
      fail('Close another Airday tab to finish opening storage.')
    request.onsuccess = () => {
      const db = request.result
      clearTimeout(timeout)
      if (failed) {
        db.close()
        return
      }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}
export async function loadLocalDocument(): Promise<LocalDocument> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        store = transaction.objectStore(STORE)
      let document: LocalDocument
      let invalidSource: LocalRecoverySource | undefined
      const request = store.get(KEY)
      request.onsuccess = () => {
        try {
          const existing = request.result
          if (existing !== undefined) {
            if (
              !existing ||
              typeof existing !== 'object' ||
              ![1, 2].includes(existing.schemaVersion) ||
              !Number.isSafeInteger(existing.revision) ||
              existing.revision < 0 ||
              !normalizeLocalBackup(existing.schemaVersion, existing.state) ||
              existing.revision >= Number.MAX_SAFE_INTEGER
            ) {
              invalidSource = recoverySource(existing)
              transaction.abort()
              return
            }
            if (existing.schemaVersion === 1) {
              store.put(existing, 'planning-v1-recovery')
              document = {
                schemaVersion: 2,
                revision: existing.revision + 1,
                state: normalizeLocalBackup(1, existing.state)!,
              }
              store.put(document, KEY)
            } else document = existing
          } else {
            const rawPlan =
              localStorage.getItem('airday-plan') ??
              localStorage.getItem('airday-school-plan')
            let validLegacy = !hasDecisionStorageIssue()
            let migratedPlan: OutdoorPlan | undefined
            try {
              if (rawPlan !== null) {
                const candidate = JSON.parse(rawPlan)
                if (!validLocalPlan(candidate)) validLegacy = false
                else migratedPlan = candidate
              }
            } catch {
              validLegacy = false
            }
            const oldJournal = localStorage.getItem('airday-journal')
            if (
              localStorage.getItem('airday-decision-state') == null &&
              oldJournal !== null
            ) {
              try {
                const rows = JSON.parse(oldJournal)
                if (!validDecisionRecords(rows)) validLegacy = false
              } catch {
                validLegacy = false
              }
            }
            if (!validLegacy) {
              invalidSource = recoverySource(null)
              transaction.abort()
              return
            }
            document = {
              schemaVersion: 2,
              revision: 0,
              state: {
                ...legacyLocalState(),
                ...(migratedPlan ? { plan: migratedPlan } : {}),
              },
            }
            if (!validLocalState(document.state)) {
              invalidSource = recoverySource(null)
              transaction.abort()
              return
            }
            // Migration commits once. Legacy bytes remain untouched for recovery.
            store.add(document, KEY)
          }
        } catch {
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(document)
      transaction.onabort = transaction.onerror = () =>
        reject(
          invalidSource
            ? new LocalRecovery(
                'Stored planning data needs recovery; original content is preserved.',
                invalidSource,
              )
            : new Error(
                'Browser planning storage could not load or commit. This session is not saved; retry loading stored data.',
              ),
        )
    })
  } finally {
    db.close()
  }
}
export async function writeLocalDocument(
  state: LocalState,
  expected: number,
): Promise<LocalDocument> {
  if (
    !validLocalState(state) ||
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected >= Number.MAX_SAFE_INTEGER
  )
    throw new LocalRecovery(
      'This planning document is not valid; it was not saved.',
    )
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        store = transaction.objectStore(STORE)
      const next: LocalDocument = {
        schemaVersion: 2,
        revision: expected + 1,
        state: structuredClone(state),
      }
      let conflict = false
      let invalidSource: LocalRecoverySource | undefined
      const request = store.get(KEY)
      request.onsuccess = () => {
        if (
          request.result !== undefined &&
          (request.result?.schemaVersion !== 2 ||
            !Number.isSafeInteger(request.result.revision) ||
            !validLocalState(request.result.state))
        ) {
          invalidSource = recoverySource(request.result)
          transaction.abort()
          return
        }
        if (
          request.result === undefined ||
          request.result.revision !== expected ||
          request.result.revision < 0
        ) {
          conflict = true
          transaction.abort()
          return
        }
        store.put(next, KEY)
      }
      transaction.oncomplete = () => resolve(next)
      transaction.onabort = transaction.onerror = () =>
        reject(
          invalidSource
            ? new LocalRecovery(
                'Stored planning data needs recovery; your change remains in this session.',
                invalidSource,
              )
            : conflict
              ? new LocalConflict(
                  'Another tab saved a newer version. Export this session or reload stored data before editing.',
                )
              : new Error(
                  'Browser saving failed. This complete change remains in this session.',
                ),
        )
    })
  } finally {
    db.close()
  }
}
/** Explicit reviewed replacement. Archive the damaged original in the same transaction. */
export async function recoverLocalDocument(
  state: LocalState,
  expectedSource: LocalRecoverySource,
): Promise<LocalDocument> {
  if (!validLocalState(state))
    throw new LocalRecovery(
      'The recovery replacement failed validation. Original stored data was not changed.',
    )
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        store = transaction.objectStore(STORE),
        request = store.get(KEY)
      let next: LocalDocument
      let failure: Error | undefined
      request.onsuccess = () => {
        try {
          const original = recoverySource(request.result)
          if (JSON.stringify(original) !== JSON.stringify(expectedSource)) {
            failure = new LocalConflict(
              'Stored data changed after the recovery was reviewed. Reload and review it again; the replacement was not applied.',
            )
            transaction.abort()
            return
          }
          const previousRevision = (
            original.document as Partial<LocalDocument> | null
          )?.revision
          next = {
            schemaVersion: 2,
            revision:
              Number.isSafeInteger(previousRevision) &&
              previousRevision! >= 0 &&
              previousRevision! < Number.MAX_SAFE_INTEGER
                ? previousRevision! + 1
                : 0,
            state: structuredClone(state),
          }
          store.add(
            { recoveredAt: new Date().toISOString(), ...original },
            RECOVERY_PREFIX + crypto.randomUUID(),
          )
          store.put(next, KEY)
        } catch {
          failure = new Error(
            'Recovery could not preserve the original content. No stored data was replaced; export recovery and try again.',
          )
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(next)
      transaction.onabort = transaction.onerror = () =>
        reject(
          failure ||
            new Error(
              'Recovery could not save its archive and replacement together. Original stored data was not changed.',
            ),
        )
    })
  } finally {
    db.close()
  }
}
/** Read-only recovery export: do not validate, normalize or overwrite damaged content. */
export async function readStoredRecovery() {
  const legacy = legacyRecoveryValues()
  const db = await openDatabase()
  try {
    const documents = await new Promise<{
      document: unknown
      migrationCopy: unknown
      recoveryCopies: Record<string, unknown>
    }>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly'),
        request = transaction.objectStore(STORE).get(KEY),
        copy = transaction.objectStore(STORE).get('planning-v1-recovery'),
        keys = transaction.objectStore(STORE).getAllKeys(),
        values = transaction.objectStore(STORE).getAll()
      transaction.oncomplete = () =>
        resolve({
          document: request.result ?? null,
          migrationCopy: copy.result ?? null,
          recoveryCopies: Object.fromEntries(
            keys.result.flatMap((key, index) =>
              typeof key === 'string' && key.startsWith(RECOVERY_PREFIX)
                ? [[key, values.result[index]]]
                : [],
            ),
          ),
        })
      request.onerror = transaction.onabort = () =>
        reject(new Error('Stored recovery document could not be read.'))
    })
    return {
      format: 'airday-stored-recovery',
      version: 2,
      ...documents,
      ...legacy,
    }
  } finally {
    db.close()
  }
}
export async function clearMigrationRecovery(): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.delete('planning-v1-recovery')
      const keys = store.getAllKeys()
      keys.onsuccess = () => {
        for (const key of keys.result)
          if (typeof key === 'string' && key.startsWith(RECOVERY_PREFIX))
            store.delete(key)
      }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            'Planning was cleared, but the migration recovery copy could not be deleted. Clear this site’s storage to finish.',
          ),
        )
    })
  } finally {
    db.close()
  }
}
