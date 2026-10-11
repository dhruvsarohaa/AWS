import { hash } from './core.mjs'
import {
  assessWindow,
  assessmentReviewReasons,
} from '../src/lib/decision-evidence.ts'
export function subscribedAssessment(plan, activity, date, forecast, now) {
  return assessWindow(
    activity,
    forecast?.points || [],
    date,
    plan.threshold,
    now,
    forecast?.fetchedAt,
  )
}
export function reviewTransition(previous, current) {
  return previous
    ? assessmentReviewReasons(previous, current)
    : current.review
      ? ['initial_review_required']
      : []
}
export function activityEvent(
  sub,
  activity,
  date,
  current,
  episode,
  reasons,
  forecast,
  now,
) {
  return {
    id: hash([sub.sub, sub.generation, activity.id, date, episode]),
    sub: sub.sub,
    workspaceId: sub.workspaceId,
    generation: sub.generation,
    kind: 'review',
    date,
    activityId: activity.id,
    activity: activity.activity,
    start: activity.start,
    end: activity.end,
    assessment: current,
    reasons,
    evidenceAt: forecast?.fetchedAt || null,
    status: 'pending',
    preparedAt: new Date(now).toISOString(),
    expiresAt: Date.parse(`${date}T${activity.end}:00+05:30`),
  }
}
