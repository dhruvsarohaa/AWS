import type { LocalState } from '../types.ts'
import { validLocalState } from './localRepository.ts'

export type LocalReplacementReview = {
  mode: 'replace' | 'recover_session'
  current: LocalState
  replacement: LocalState
  mutation: number
  recoveryRequired: boolean
}

/** Freeze what the person reviewed; later renders must not change the replacement. */
export function prepareLocalReplacement(
  mode: LocalReplacementReview['mode'],
  current: LocalState,
  replacement: LocalState,
  mutation: number,
  recoveryRequired: boolean,
): LocalReplacementReview {
  if (!validLocalState(current) || !validLocalState(replacement))
    throw new Error(
      'Only a validated planning document can be reviewed for replacement.',
    )
  if (mode === 'recover_session' && !recoveryRequired)
    throw new Error(
      'Stored recovery is no longer required. Review the current data again.',
    )
  return structuredClone({
    mode,
    current,
    replacement,
    mutation,
    recoveryRequired,
  })
}

export function assertLocalReplacementCurrent(
  review: LocalReplacementReview,
  mutation: number,
  recoveryRequired: boolean,
): void {
  if (
    review.mutation !== mutation ||
    review.recoveryRequired !== recoveryRequired
  )
    throw new Error(
      'Planning data changed after this confirmation was opened. Cancel and review the current data again.',
    )
}

/** Merge histories without silently replacing differing evidence or lifecycle order. */
export function mergeLocalStates(
  current: LocalState,
  incoming: LocalState,
): LocalState {
  if (!validLocalState(current) || !validLocalState(incoming))
    throw new Error('Only validated complete planning documents can be merged.')
  const journal = new Map(current.journal.map((row) => [row.id, row]))
  const oneOffs = new Map(current.oneOffs.map((row) => [row.id, row]))
  const scope = (row: LocalState['journal'][number]) =>
    JSON.stringify([row.location?.key || 'legacy', row.date, row.activityId])
  const currentScopes = new Set(current.journal.map(scope))
  for (const row of incoming.journal) {
    if (
      journal.has(row.id) &&
      JSON.stringify(journal.get(row.id)) !== JSON.stringify(row)
    )
      throw new Error(
        'The same decision ID contains different evidence or lifecycle data. Use a reviewed replacement instead of merging.',
      )
    if (!journal.has(row.id) && currentScopes.has(scope(row)))
      throw new Error(
        'These backups contain overlapping history for the same dated activity. A merge cannot establish its lifecycle order. Review and replace a complete backup instead.',
      )
    journal.set(row.id, row)
  }
  for (const row of incoming.oneOffs) {
    if (
      oneOffs.has(row.id) &&
      JSON.stringify(oneOffs.get(row.id)) !== JSON.stringify(row)
    )
      throw new Error(
        'The same quick-activity ID contains different settings. Use a reviewed replacement instead of merging.',
      )
    oneOffs.set(row.id, row)
  }
  const next = {
    ...current,
    journal: [...journal.values()],
    oneOffs: [...oneOffs.values()],
    favorites: mergeItems(current.favorites, incoming.favorites),
    feedback: mergeItems(current.feedback, incoming.feedback),
    groups: mergeItems(current.groups || [], incoming.groups || []),
  }
  if (!validLocalState(next))
    throw new Error(
      'Merged data exceeds a local limit (200 decisions, 100 quick activities, five favorites, ten groups or 200 feedback entries), or contains conflicting/invalid evidence. No records were dropped.',
    )
  return next
}

function mergeItems<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const rows = new Map(current.map((row) => [row.id, row]))
  for (const row of incoming) {
    if (
      rows.has(row.id) &&
      JSON.stringify(rows.get(row.id)) !== JSON.stringify(row)
    )
      throw new Error(
        'The same saved item ID differs. Review a complete replacement instead.',
      )
    rows.set(row.id, row)
  }
  return [...rows.values()]
}
