import type { LocalState, SuggestionFeedback } from '../types.ts'

export const FEEDBACK_LIMIT = 200
const nonempty = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value

export function validSuggestionFeedback(
  value: unknown,
): value is SuggestionFeedback {
  if (!value || typeof value !== 'object') return false
  const f = value as SuggestionFeedback
  return (
    nonempty(f.id, 100) &&
    nonempty(f.assessmentId, 300) &&
    (f.decisionId === undefined || nonempty(f.decisionId, 100)) &&
    typeof f.locationKey === 'string' &&
    /^[a-f0-9]{32}$/.test(f.locationKey) &&
    typeof f.date === 'string' &&
    validDate(f.date) &&
    typeof f.at === 'string' &&
    Number.isFinite(Date.parse(f.at)) &&
    typeof f.useful === 'boolean' &&
    nonempty(f.activity, 100) &&
    ['timing', 'indoor_option', 'data', 'clear', 'other'].includes(f.reason) &&
    typeof f.note === 'string' &&
    f.note.length <= 300
  )
}

/** Bound and de-duplicate before the repository's atomic write. Never upload. */
export function appendSuggestionFeedback(
  current: SuggestionFeedback[],
  entry: SuggestionFeedback,
): SuggestionFeedback[] {
  if (!validSuggestionFeedback(entry))
    throw new Error(
      'This feedback has invalid or incomplete assessment context.',
    )
  if (
    current.some(
      (f) => f.id === entry.id || f.assessmentId === entry.assessmentId,
    )
  )
    throw new Error('Feedback is already retained for this assessment.')
  if (current.length >= FEEDBACK_LIMIT)
    throw new Error('Feedback limit reached. Export and clear feedback first.')
  const row: SuggestionFeedback = {
    id: entry.id,
    assessmentId: entry.assessmentId,
    ...(entry.decisionId === undefined ? {} : { decisionId: entry.decisionId }),
    locationKey: entry.locationKey,
    date: entry.date,
    activity: entry.activity,
    at: entry.at,
    useful: entry.useful,
    reason: entry.reason,
    note: entry.note.trim(),
  }
  return [...current, row]
}

export function reviewFeedbackDeletion(state: LocalState): LocalState {
  return structuredClone(state)
}

/** Do not delete from a document that changed since the person reviewed it. */
export function clearReviewedFeedback(
  current: LocalState,
  reviewed: LocalState,
): LocalState {
  if (JSON.stringify(current) !== JSON.stringify(reviewed))
    throw new Error(
      'Planning changed after this feedback deletion was reviewed.',
    )
  return { ...structuredClone(reviewed), feedback: [] }
}
