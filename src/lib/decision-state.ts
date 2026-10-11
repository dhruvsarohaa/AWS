import type {
  Activity,
  ActivityDecision,
  DashboardData,
  DecisionRecord,
  OutdoorPlan,
  Place,
} from '../types.ts'
import { planVersion, pointsForDate } from './planner.ts'
import { activityEstimate } from './periods.ts'
import {
  assessWindow,
  currentDecision,
  decisionReviewReasons,
  reviewedLocation,
} from './decision-evidence.ts'

/** An assessed view can contain earlier records; retain only the activity definition. */
export function activityDefinition(activity: Activity): Activity {
  return {
    id: activity.id,
    activity: activity.activity,
    place: activity.place,
    start: activity.start,
    end: activity.end,
    days: [...activity.days],
    ...(activity.flexible === undefined ? {} : { flexible: activity.flexible }),
    ...(activity.allowedStart === undefined
      ? {}
      : { allowedStart: activity.allowedStart }),
    ...(activity.allowedEnd === undefined
      ? {}
      : { allowedEnd: activity.allowedEnd }),
    ...(activity.indoorAvailable === undefined
      ? {}
      : { indoorAvailable: activity.indoorAvailable }),
    ...(activity.intensity === undefined
      ? {}
      : { intensity: activity.intensity }),
  }
}

export function createDecisionRecord(input: {
  activity: Activity
  choice: ActivityDecision
  snapshot: DashboardData
  plan: OutdoorPlan
  place: Place
  date: string
  reason: string
  start?: string
  end?: string
  now: number
  id?: string
}): DecisionRecord {
  if (
    input.choice === 'pending' ||
    !input.snapshot.snapshotId ||
    !input.reason.trim()
  )
    throw new Error('A recorded action needs a reason and evidence snapshot.')
  const originalWindow = {
    start: input.activity.start,
    end: input.activity.end,
  }
  const changesWindow = ['rescheduled', 'shortened'].includes(input.choice)
  if (changesWindow && (!input.start || !input.end))
    throw new Error('Chosen times are required.')
  const chosenWindow = changesWindow
    ? { start: input.start!, end: input.end! }
    : originalWindow
  const points = pointsForDate(
    input.snapshot.forecast?.points || [],
    input.date,
  )
  const originalAssessment = assessWindow(
    input.activity,
    points,
    input.date,
    input.plan.threshold,
    input.now,
    input.snapshot.forecast?.fetchedAt,
  )
  const chosenAssessment = assessWindow(
    { ...input.activity, ...chosenWindow },
    points,
    input.date,
    input.plan.threshold,
    input.now,
    input.snapshot.forecast?.fetchedAt,
  )
  const originalEstimate = activityEstimate(
    input.snapshot,
    input.date,
    originalWindow.start,
    originalWindow.end,
  )
  const chosenEstimate = activityEstimate(
    input.snapshot,
    input.date,
    chosenWindow.start,
    chosenWindow.end,
  )
  const comparable =
    input.snapshot.sources.forecast?.status === 'live' &&
    originalAssessment.freshness === 'fresh' &&
    chosenAssessment.freshness === 'fresh' &&
    originalEstimate.complete &&
    chosenEstimate.complete
  return {
    id: input.id || crypto.randomUUID(),
    activityId: input.activity.id,
    activity: input.activity.activity,
    date: input.date,
    at: new Date(input.now).toISOString(),
    choice: input.choice,
    reason: input.reason.trim(),
    proposedStart: changesWindow ? input.start : undefined,
    proposedEnd: changesWindow ? input.end : undefined,
    snapshotId: input.snapshot.snapshotId,
    planVersion: planVersion(input.plan),
    threshold: input.plan.threshold,
    forecastId: input.snapshot.forecast?.id,
    value: chosenAssessment.value,
    coverage: chosenAssessment.coverage,
    policyVersion: input.snapshot.policy?.version,
    policyStatus: input.snapshot.policy?.status || 'unknown',
    sourceAt: input.snapshot.forecast?.fetchedAt,
    location: reviewedLocation(input.place),
    originalWindow,
    chosenWindow,
    originalAssessment,
    chosenAssessment,
    lifecycle: 'recorded',
    followThrough: 'unconfirmed',
    reviewedActivity: activityDefinition(input.activity),
    reviewedPlanName: input.plan.name,
    forecastSource: input.snapshot.forecast?.source,
    modelEstimate: {
      version: 1,
      unit: 'µg·h/m³',
      method: 'hourly_sample_hold',
      original: comparable ? originalEstimate.total : null,
      chosen:
        comparable && !['indoors', 'cancelled'].includes(input.choice)
          ? chosenEstimate.total
          : null,
      originalCoveredHours: originalEstimate.covered,
      chosenCoveredHours: chosenEstimate.covered,
    },
  }
}
export function appendDecision(
  journal: DecisionRecord[],
  record: DecisionRecord,
) {
  return [
    ...journal.map((row) =>
      row.location?.key === record.location?.key &&
      row.date === record.date &&
      row.activityId === record.activityId &&
      row.lifecycle === 'recorded'
        ? { ...row, lifecycle: 'superseded' as const, supersededBy: record.id }
        : row,
    ),
    record,
  ].slice(-200)
}
export function reopenDecision(
  journal: DecisionRecord[],
  id: string,
  now: number,
) {
  return journal.map((row) =>
    row.id === id && row.lifecycle === 'recorded'
      ? {
          ...row,
          lifecycle: 'reopened' as const,
          reopenedAt: new Date(now).toISOString(),
        }
      : row,
  )
}

/** The card choice, shareable summary and workspace submission use this state. */
export function decisionsForReview(
  journal: DecisionRecord[],
  date: string,
  plan: OutdoorPlan,
  dashboard: DashboardData | null,
  place: Place,
  now: number,
) {
  const key = reviewedLocation(place).key
  const scoped = journal.filter(
    (row) => row.location?.key === key && row.date === date,
  )
  const current = scoped.filter(
    (row) =>
      currentDecision(journal, date, row.activityId, place)?.id === row.id,
  )
  const eligible =
    place.confirmed && plan.configured
      ? current.filter(
          (row) =>
            !decisionReviewReasons(row, plan, dashboard, place, now).length,
        )
      : []
  const historical = journal.filter(
    (row) => !current.some((active) => active.id === row.id),
  )
  return { scoped, current, eligible, historical }
}
