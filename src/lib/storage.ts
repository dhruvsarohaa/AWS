import { DEFAULT_PLACE, STARTER_PLAN, validatePlan } from './planner.ts'
import type { DecisionRecord, OutdoorPlan, Place } from '../types.ts'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const DECISION_STATE_KEY = 'airday-decision-state'
export type DecisionDocument = { schemaVersion: 3; records: DecisionRecord[] }
const decisions = new Set([
  'pending',
  'indoors',
  'outdoors',
  'cancelled',
  'rescheduled',
  'shortened',
])
export function readPlace(): Place {
  try {
    const saved = JSON.parse(localStorage.getItem('airday-place') || 'null')
    if (
      saved &&
      typeof saved.name === 'string' &&
      typeof saved.state === 'string' &&
      Number.isFinite(saved.latitude) &&
      Number.isFinite(saved.longitude) &&
      saved.latitude >= 6 &&
      saved.latitude <= 38 &&
      saved.longitude >= 68 &&
      saved.longitude <= 98
    ) {
      return {
        ...saved,
        confirmed: saved.confirmed !== false,
        accuracyMeters: Number.isFinite(saved.accuracyMeters)
          ? saved.accuracyMeters
          : undefined,
        detectedAt: Number.isFinite(Date.parse(saved.detectedAt))
          ? saved.detectedAt
          : undefined,
      }
    }
  } catch {
    /* Use the explicit Delhi preview if browser storage is unavailable. */
  }
  return { ...DEFAULT_PLACE }
}
export function readPlan(): OutdoorPlan {
  try {
    const saved = JSON.parse(
      localStorage.getItem('airday-plan') ||
        localStorage.getItem('airday-school-plan') ||
        'null',
    )
    if (
      saved?.configured &&
      typeof saved.name === 'string' &&
      Array.isArray(saved.activities) &&
      saved.activities.every(
        (item: Record<string, unknown>) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.activity === 'string' &&
          typeof item.place === 'string' &&
          typeof item.start === 'string' &&
          typeof item.end === 'string' &&
          Array.isArray(item.days),
      ) &&
      !Object.keys(validatePlan(saved)).length
    )
      return {
        ...saved,
        ruleMode: saved.ruleMode === 'example' ? 'example' : 'custom',
      }
  } catch {
    /* Recover using the labelled example schedule. */
  }
  return structuredClone(STARTER_PLAN)
}
export function writeStored(
  key: string,
  value: unknown,
  storage?: StorageLike,
): boolean {
  try {
    ;(storage ?? localStorage).setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
export function removeStored(key: string, storage?: StorageLike): boolean {
  try {
    ;(storage ?? localStorage).removeItem(key)
    return true
  } catch {
    return false
  }
}
export function readJournal(storage?: StorageLike): DecisionRecord[] {
  try {
    const target = storage ?? localStorage
    const canonical = target.getItem(DECISION_STATE_KEY)
    // A new-format document is authoritative. Never resurrect older split keys.
    if (canonical != null) return readCanonical(canonical) ?? []
    const rows = JSON.parse(target.getItem('airday-journal') || '[]')
    return Array.isArray(rows) ? rows.filter(validRow).slice(-200) : []
  } catch {
    return []
  }
}
function validRow(row: DecisionRecord) {
  return Boolean(
    row &&
    typeof row.id === 'string' &&
    typeof row.activityId === 'string' &&
    typeof row.snapshotId === 'string' &&
    /^[a-f0-9]{32}$/.test(row.snapshotId) &&
    typeof row.activity === 'string' &&
    typeof row.planVersion === 'string' &&
    Number.isFinite(row.threshold) &&
    ['unconfirmed', 'completed', 'changed'].includes(row.followThrough) &&
    typeof row.date === 'string' &&
    typeof row.reason === 'string' &&
    decisions.has(row.choice) &&
    Number.isFinite(Date.parse(row.at)) &&
    validDecisionProvenance(row),
  )
}
export function validDecisionRecords(rows: unknown): rows is DecisionRecord[] {
  return (
    Array.isArray(rows) &&
    rows.length <= 200 &&
    rows.every(validRow) &&
    new Set(rows.map((row) => row.id)).size === rows.length
  )
}
function readCanonical(raw: string): DecisionRecord[] | null {
  try {
    const document = JSON.parse(raw)
    if (document?.schemaVersion !== 3 || !Array.isArray(document.records))
      return null
    const rows: DecisionRecord[] = document.records
    // Never drop a corrupt latest/reopened row and revive an older active action.
    if (!validDecisionRecords(rows)) return null
    return rows
  } catch {
    return null
  }
}
export function hasDecisionStorageIssue(storage?: StorageLike) {
  try {
    const raw = (storage ?? localStorage).getItem(DECISION_STATE_KEY)
    return raw != null && readCanonical(raw) === null
  } catch {
    return true
  }
}
function validDecisionProvenance(row: DecisionRecord) {
  const e = row.modelEstimate
  if (
    e !== undefined &&
    (!e ||
      e.version !== 1 ||
      e.unit !== 'µg·h/m³' ||
      e.method !== 'hourly_sample_hold' ||
      ![e.original, e.chosen].every(
        (x) => x === null || (Number.isFinite(x) && x >= 0),
      ) ||
      ![e.originalCoveredHours, e.chosenCoveredHours].every(
        (x) => Number.isFinite(x) && x >= 0 && x <= 24,
      ))
  )
    return false
  if (row.kind && !['scheduled', 'one_off'].includes(row.kind)) return false
  if (
    row.reviewedPlanName !== undefined &&
    (typeof row.reviewedPlanName !== 'string' ||
      row.reviewedPlanName.length > 80)
  )
    return false
  if (
    row.forecastSource !== undefined &&
    (typeof row.forecastSource !== 'string' || row.forecastSource.length > 500)
  )
    return false
  if (row.reviewedActivity) {
    const a = row.reviewedActivity
    if (
      typeof a.id !== 'string' ||
      a.id !== row.activityId ||
      typeof a.activity !== 'string' ||
      typeof a.place !== 'string' ||
      typeof a.start !== 'string' ||
      typeof a.end !== 'string' ||
      !Array.isArray(a.days) ||
      Object.keys(
        validatePlan({
          name: 'Retained activity',
          configured: true,
          threshold: row.threshold,
          activities: [a],
        }),
      ).length
    )
      return false
  }
  // Keep old unscoped records for export. They cannot become current decisions.
  if (
    row.lifecycle &&
    !['recorded', 'reopened', 'superseded'].includes(row.lifecycle)
  )
    return false
  if (
    row.location &&
    (typeof row.location.key !== 'string' ||
      !/^[a-f0-9]{32}$/.test(row.location.key) ||
      typeof row.location.areaId !== 'string' ||
      typeof row.location.name !== 'string' ||
      typeof row.location.state !== 'string' ||
      !Number.isFinite(row.location.latitude) ||
      !Number.isFinite(row.location.longitude))
  )
    return false
  const validWindow = (window: { start: string; end: string } | undefined) =>
    !window ||
    (/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) &&
      window.end > window.start)
  const validAssessment = (assessment: DecisionRecord['chosenAssessment']) =>
    !assessment ||
    ((assessment.value === null ||
      (Number.isFinite(assessment.value) && assessment.value >= 0)) &&
      ['missing', 'partial', 'complete'].includes(assessment.coverage) &&
      typeof assessment.review === 'boolean' &&
      ['fresh', 'stale', 'future', 'unknown'].includes(assessment.freshness))
  return (
    validWindow(row.originalWindow) &&
    validWindow(row.chosenWindow) &&
    validAssessment(row.originalAssessment) &&
    validAssessment(row.chosenAssessment)
  )
}
export function writeDecisionDocument(
  rows: DecisionRecord[],
  storage?: StorageLike,
) {
  // Preserve unreadable canonical bytes for recovery rather than silently losing
  // historical actions on the next save. New records remain session-only.
  if (hasDecisionStorageIssue(storage)) return false
  // Web Storage setItem replaces one value atomically; choices derive from these rows.
  const document: DecisionDocument = {
    schemaVersion: 3,
    records: rows.slice(-200),
  }
  return writeStored(DECISION_STATE_KEY, document, storage)
}
