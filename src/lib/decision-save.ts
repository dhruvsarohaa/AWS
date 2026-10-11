import type {
  DashboardData,
  DecisionRecord,
  OutdoorPlan,
  Place,
} from '../types.ts'
import { FORECAST_MAX_AGE, timestampState } from './planner.ts'
import { decisionReviewReasons } from './decision-evidence.ts'

export function freshPlanningEvidence(data: DashboardData | null, now: number) {
  return Boolean(
    data?.forecast &&
    data.sources.forecast?.status === 'live' &&
    timestampState(data.forecast.fetchedAt, now, FORECAST_MAX_AGE) === 'fresh',
  )
}

/** Recheck at save time; a dialog's frozen snapshot must not become a current
 * decision after its evidence expires or the latest comparison changes. */
export function decisionSaveReviewReasons(
  record: DecisionRecord,
  plan: OutdoorPlan,
  current: DashboardData | null,
  place: Place,
  now: number,
) {
  const reasons: string[] = []
  if (timestampState(record.sourceAt, now, FORECAST_MAX_AGE) !== 'fresh')
    reasons.push('The forecast reviewed in this editor is no longer fresh.')
  if (!freshPlanningEvidence(current, now))
    reasons.push(
      'A fresh, successfully retrieved forecast is required before recording.',
    )
  reasons.push(
    ...decisionReviewReasons(record, plan, current, place, now, {
      // Manual responses can be recorded honestly against unchanged gaps; they
      // remain unresolved under the default eligibility check. Time comparisons
      // still require complete evidence for the actual chosen window.
      requireCompleteCoverage: ['rescheduled', 'shortened'].includes(
        record.choice,
      ),
    }),
  )
  return [...new Set(reasons)]
}
