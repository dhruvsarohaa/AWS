import type {
  Activity,
  DashboardData,
  DecisionAssessment,
  DecisionRecord,
  ForecastPoint,
  OutdoorPlan,
  Place,
  ReviewedLocation,
} from '../types.ts'
import {
  assessActivity,
  clockMinutes,
  FORECAST_MAX_AGE,
  planVersion,
  pointsForDate,
  timestampState,
} from './planner.ts'

// A deterministic 128-bit local fingerprint, not a security token. Keeping the
// selected coordinates out of the key lets records retain only a coarse area.
export function localFingerprint(value: string) {
  let a = 1779033703,
    b = 3144134277,
    c = 1013904242,
    d = 2773480762
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index)
    a = b ^ Math.imul(a ^ character, 597399067)
    b = c ^ Math.imul(b ^ character, 2869860233)
    c = d ^ Math.imul(c ^ character, 951274213)
    d = a ^ Math.imul(d ^ character, 2716044179)
  }
  a = Math.imul(c ^ (a >>> 18), 597399067)
  b = Math.imul(d ^ (b >>> 22), 2869860233)
  c = Math.imul(a ^ (c >>> 17), 951274213)
  d = Math.imul(b ^ (d >>> 19), 2716044179)
  a ^= b ^ c ^ d
  b ^= a
  c ^= a
  d ^= a
  return [a, b, c, d]
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

export function reviewedLocation(place: Place): ReviewedLocation {
  const normalized = (value: string) =>
    value.trim().normalize('NFC').toLowerCase()
  const latitude = Math.round(place.latitude * 10) / 10
  const longitude = Math.round(place.longitude * 10) / 10
  return {
    key: localFingerprint(
      JSON.stringify([
        normalized(place.name),
        normalized(place.state),
        place.latitude,
        place.longitude,
      ]),
    ),
    areaId: `${latitude.toFixed(1)},${longitude.toFixed(1)}`,
    name: place.name.trim(),
    state: place.state.trim(),
    latitude,
    longitude,
  }
}

export function assessWindow(
  activity: Activity,
  points: ForecastPoint[],
  date: string,
  threshold: number,
  now: number,
  fetchedAt?: string,
): DecisionAssessment {
  const assessment = assessActivity(
    activity,
    pointsForDate(points, date),
    date,
    threshold,
    now,
  )
  return {
    value: assessment.value,
    coverage: assessment.coverage as DecisionAssessment['coverage'],
    review: assessment.review,
    freshness: timestampState(fetchedAt, now, FORECAST_MAX_AGE),
  }
}

export function assessmentReviewReasons(
  previous: DecisionAssessment,
  current: DecisionAssessment,
): string[] {
  const reasons: string[] = []
  if (previous.review !== current.review)
    reasons.push(
      current.review
        ? 'The forecast crossed above the review rule.'
        : 'The forecast returned to or below the review rule.',
    )
  if (previous.coverage !== current.coverage)
    reasons.push('Forecast coverage has changed.')
  if (previous.freshness !== current.freshness && current.freshness !== 'fresh')
    reasons.push(`Forecast freshness has changed to ${current.freshness}.`)
  if (previous.value === null || current.value === null) {
    if (previous.value !== current.value)
      reasons.push('Forecast availability has changed.')
  } else if (
    Math.abs(previous.value - current.value) >
    Math.max(5, Math.abs(previous.value) * 0.2)
  )
    reasons.push('The forecast peak has changed materially.')
  return reasons
}

function changesWindow(record: DecisionRecord) {
  return record.choice === 'rescheduled' || record.choice === 'shortened'
}

function validWindow(
  window: DecisionRecord['originalWindow'],
): window is NonNullable<DecisionRecord['originalWindow']> {
  return Boolean(
    window &&
    Number.isFinite(clockMinutes(window.start)) &&
    Number.isFinite(clockMinutes(window.end)) &&
    clockMinutes(window.end) > clockMinutes(window.start),
  )
}

function hasReviewedEvidence(record: DecisionRecord) {
  return Boolean(
    record.location?.key &&
    validWindow(record.originalWindow) &&
    record.originalAssessment &&
    typeof record.policyStatus === 'string' &&
    (!changesWindow(record) ||
      (validWindow(record.chosenWindow) && record.chosenAssessment)),
  )
}

/** Journal order is retained, so a later lifecycle row blocks older actions. */
export function currentDecision(
  journal: DecisionRecord[],
  date: string,
  activityId: string,
  place: Place,
): DecisionRecord | undefined {
  const key = reviewedLocation(place).key
  const latest = [...journal]
    .reverse()
    .find(
      (record) =>
        record.date === date &&
        record.activityId === activityId &&
        record.location?.key === key,
    )
  return latest &&
    latest.lifecycle === 'recorded' &&
    latest.choice !== 'pending' &&
    hasReviewedEvidence(latest)
    ? latest
    : undefined
}

export function decisionReviewReasons(
  record: DecisionRecord,
  plan: OutdoorPlan,
  dashboard: DashboardData | null,
  place: Place,
  now: number,
  options: { requireCompleteCoverage?: boolean } = {},
): string[] {
  const reasons: string[] = []
  const key = reviewedLocation(place).key
  if (!record.location?.key)
    reasons.push(
      'The reviewed location was not retained. Review this legacy record again.',
    )
  else if (record.location.key !== key)
    reasons.push('The selected location has changed since this decision.')
  if (dashboard && reviewedLocation(dashboard.location).key !== key)
    reasons.push('Current evidence is for a different selected location.')
  if (record.planVersion !== planVersion(plan))
    reasons.push('The outdoor plan or review rule has changed.')

  const activity = plan.activities.find((item) => item.id === record.activityId)
  const retainedDate = Date.parse(`${record.date}T12:00:00+05:30`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
    !Number.isFinite(retainedDate) ||
    new Date(retainedDate).toISOString().slice(0, 10) !== record.date
  )
    reasons.push('The retained decision date is invalid.')
  else if (
    !activity ||
    !activity.days.includes(new Date(retainedDate).getUTCDay())
  )
    reasons.push(
      'This activity is no longer scheduled on the retained decision date.',
    )

  const policy = dashboard?.policy
  if (policy && policy.date !== record.date)
    reasons.push('The current guidance applies to a different date.')
  if (record.policyVersion !== policy?.version)
    reasons.push('The guidance version has changed.')
  if (typeof record.policyStatus !== 'string')
    reasons.push(
      'The reviewed guidance status was not retained. Review this legacy record again.',
    )
  else if (record.policyStatus !== (policy?.status ?? 'unknown'))
    reasons.push('The guidance verification status has changed.')

  const changedWindow = changesWindow(record)
  const window = changedWindow ? record.chosenWindow : record.originalWindow
  const before = changedWindow
    ? record.chosenAssessment
    : record.originalAssessment
  if (!validWindow(record.originalWindow) || !record.originalAssessment)
    reasons.push(
      'The original window evidence was not retained. Review this legacy record again.',
    )
  if (changedWindow && (!validWindow(window) || !before))
    reasons.push(
      'The chosen window evidence was not retained. Review this legacy record again.',
    )
  if (!activity || !validWindow(window) || !before) return reasons

  const current = assessWindow(
    { ...activity, start: window.start, end: window.end },
    dashboard?.forecast?.points ?? [],
    record.date,
    plan.threshold,
    now,
    dashboard?.forecast?.fetchedAt,
  )
  const label = changedWindow ? 'chosen window' : 'original window'
  // A record cannot make already-stale or already-incomplete evidence eligible
  // merely because its assessment has not changed since the user recorded it.
  if (current.freshness !== 'fresh')
    reasons.push(
      `For the ${label}: Current forecast retrieval is ${current.freshness}. Refresh before using this decision.`,
    )
  if (
    options.requireCompleteCoverage !== false &&
    current.coverage !== 'complete'
  )
    reasons.push(
      `For the ${label}: ${
        current.coverage === 'missing'
          ? 'The current forecast window has no usable PM2.5 values.'
          : 'The current forecast window has only partial PM2.5 coverage.'
      }`,
    )
  reasons.push(
    ...assessmentReviewReasons(before, current).map(
      (reason) => `For the ${label}: ${reason}`,
    ),
  )
  return reasons
}
