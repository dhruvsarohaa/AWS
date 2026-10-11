import type {
  Activity,
  ActivityDecision,
  DashboardData,
  DecisionRecord,
  OneOffPlan,
  OutdoorPlan,
  Place,
} from '../types.ts'
import {
  assessActivity,
  clockMinutes,
  FORECAST_MAX_AGE,
  pointsForDate,
  planVersion,
  timestampState,
} from './planner.ts'
import {
  currentDecision,
  decisionReviewReasons,
  reviewedLocation,
} from './decision-evidence.ts'
import { searchTimes } from './time-search.ts'

export type ActivityView = ReturnType<typeof assessActivity> & {
  contextPlan: OutdoorPlan
  oneOff: boolean
  current?: DecisionRecord
  latest?: DecisionRecord
  reasons: string[]
  alternatives: ReturnType<typeof searchTimes>
  unresolved: boolean
  chosen: ReturnType<typeof assessActivity>
  status:
    | 'preview'
    | 'recorded'
    | 'recheck'
    | 'reopened'
    | 'unavailable'
    | 'incomplete'
    | 'review'
    | 'ready'
    | 'passed'
}
export function activityViews(input: {
  plan: OutdoorPlan
  oneOffs: OneOffPlan[]
  journal: DecisionRecord[]
  dashboard: DashboardData | null
  place: Place
  date: string
  now: number
}): ActivityView[] {
  const weekday = new Date(`${input.date}T12:00:00Z`).getUTCDay(),
    key = reviewedLocation(input.place).key
  // A late response for another location must never evaluate this place's plan.
  const matchingDashboard =
    input.dashboard && reviewedLocation(input.dashboard.location).key === key
      ? input.dashboard
      : null
  const contexts = [
    { plan: input.plan, oneOff: false },
    ...input.oneOffs
      .filter((x) => x.date === input.date && x.locationKey === key)
      .map((x) => ({ plan: x.plan, oneOff: true })),
  ]
  const points = pointsForDate(
    matchingDashboard?.forecast?.points || [],
    input.date,
  )
  return contexts
    .flatMap((context) =>
      context.plan.activities
        .filter((a) => a.days.includes(weekday))
        .map((a) => {
          const original = assessActivity(
            a,
            points,
            input.date,
            context.plan.threshold,
            input.now,
          )
          const current = currentDecision(
            input.journal,
            input.date,
            a.id,
            input.place,
          )
          const latest = [...input.journal]
            .reverse()
            .find(
              (r) =>
                r.date === input.date &&
                r.activityId === a.id &&
                r.location?.key === key,
            )
          const effective = current?.chosenWindow
            ? assessActivity(
                { ...a, ...current.chosenWindow },
                points,
                input.date,
                context.plan.threshold,
                input.now,
              )
            : original
          const reasons = current
            ? decisionReviewReasons(
                current,
                context.plan,
                input.dashboard,
                input.place,
                input.now,
              )
            : []
          const personal = input.place.confirmed && context.plan.configured
          const freshness = timestampState(
            matchingDashboard?.forecast?.fetchedAt,
            input.now,
            FORECAST_MAX_AGE,
          )
          const unresolved = Boolean(personal && (!current || reasons.length))
          const status: ActivityView['status'] = !personal
            ? 'preview'
            : current
              ? reasons.length
                ? 'recheck'
                : 'recorded'
              : latest?.lifecycle === 'reopened'
                ? 'reopened'
                : effective.passed
                  ? 'passed'
                  : !matchingDashboard?.forecast || freshness !== 'fresh'
                    ? 'unavailable'
                    : original.coverage !== 'complete'
                      ? 'incomplete'
                      : original.review
                        ? 'review'
                        : 'ready'
          const alternatives =
            a.flexible &&
            !original.passed &&
            freshness === 'fresh' &&
            original.coverage === 'complete' &&
            original.value !== null
              ? searchTimes({
                  points,
                  date: input.date,
                  duration: clockMinutes(a.end) - clockMinutes(a.start),
                  allowedStart: a.allowedStart || a.start,
                  allowedEnd: a.allowedEnd || a.end,
                  threshold: context.plan.threshold,
                  now: input.now,
                  excludeStart: a.start,
                  lowerThan: original.value,
                })
              : []
          return {
            ...original,
            chosen: effective,
            passed: effective.passed,
            underway: effective.underway,
            contextPlan: context.plan,
            oneOff: context.oneOff,
            current,
            latest,
            reasons,
            alternatives,
            unresolved,
            status,
          }
        }),
    )
    .sort(
      (a, b) =>
        clockMinutes(a.current?.chosenWindow?.start || a.start) -
        clockMinutes(b.current?.chosenWindow?.start || b.start),
    )
}
export function activitySummary(
  views: ActivityView[],
  confirmed: boolean,
  configured: boolean,
  forecast: boolean,
) {
  const personalViews = views.filter((x) => x.status !== 'preview')
  const active = personalViews.filter((x) => !x.passed)
  const flagged = active.filter(
    (x) =>
      x.unresolved && (x.review || ['recheck', 'reopened'].includes(x.status)),
  )
  const incomplete = active.filter(
    (x) =>
      x.unresolved && (x.coverage !== 'complete' || x.status === 'unavailable'),
  )
  const firstAttention =
    flagged[0] || incomplete[0] || active.find((x) => x.unresolved)
  const kind = !confirmed
    ? 'location-preview'
    : !configured
      ? 'plan-preview'
      : !forecast
        ? 'loading'
        : !personalViews.length
          ? 'empty'
          : !active.length
            ? 'finished'
            : flagged.length
              ? 'review'
              : incomplete.length
                ? 'incomplete'
                : 'below-rule'
  return { active, flagged, incomplete, firstAttention, kind }
}
export function activityForChart(view?: ActivityView): Activity | undefined {
  return view && { ...view, ...(view.current?.chosenWindow || {}) }
}

/** Pending response choices belong to a reviewed activity context, not its ID alone. */
export function activityChoiceKey(
  view: ActivityView,
  date: string,
  locationKey: string,
) {
  return JSON.stringify([
    locationKey,
    date,
    view.id,
    planVersion(view.contextPlan),
    view.current?.id || '',
    view.latest?.lifecycle || '',
  ])
}

export function activityChoice(
  view: ActivityView,
  pending?: ActivityDecision,
): ActivityDecision {
  const choice = pending || view.current?.choice || 'outdoors'
  return choice === 'pending' ||
    (choice === 'rescheduled' && (!view.flexible || view.passed)) ||
    (choice === 'shortened' && view.passed)
    ? 'outdoors'
    : choice
}
