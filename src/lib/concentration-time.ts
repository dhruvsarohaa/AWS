import type { DashboardData } from '../types.ts'
import { activityEstimate } from './periods.ts'
import { FORECAST_MAX_AGE, timestampState } from './planner.ts'

/** Current-model display only. Frozen historical totals remain on DecisionRecord. */
export function concentrationTimeComparison(
  data: DashboardData | null,
  date: string,
  originalWindow: { start: string; end: string },
  chosenWindow: { start: string; end: string } | undefined,
  now: number,
) {
  const original = activityEstimate(
    data,
    date,
    originalWindow.start,
    originalWindow.end,
  )
  const chosen = chosenWindow
    ? activityEstimate(data, date, chosenWindow.start, chosenWindow.end)
    : null
  const freshness = timestampState(
    data?.forecast?.fetchedAt,
    now,
    FORECAST_MAX_AGE,
  )
  const age = now - Date.parse(data?.forecast?.fetchedAt || '')
  const live =
    Number.isFinite(now) &&
    age >= 0 &&
    data?.sources.forecast?.status === 'live' &&
    freshness === 'fresh'
  const comparable = Boolean(
    live && original.complete && (!chosen || chosen.complete),
  )
  return {
    original,
    chosen,
    freshness,
    comparable,
    originalValue: live && original.complete ? original.total : null,
    chosenValue: comparable ? (chosen?.total ?? null) : null,
  }
}
