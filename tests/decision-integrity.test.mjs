import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessWindow,
  assessmentReviewReasons,
  currentDecision,
  decisionReviewReasons,
  reviewedLocation,
} from '../src/lib/decision-evidence.ts'
import { FORECAST_MAX_AGE, planVersion } from '../src/lib/planner.ts'

// Explicitly synthetic offline fixtures; these never enter production imports.
const date = '2026-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
const fetchedAt = new Date(now - 60_000).toISOString()
const delhi = {
  name: 'Fixture Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const pune = {
  name: 'Fixture Pune',
  state: 'Maharashtra',
  country: 'India',
  latitude: 18.5204,
  longitude: 73.8567,
  confirmed: true,
}
const activity = {
  id: 'walk',
  activity: 'Synthetic walk',
  place: 'Test park',
  start: '08:00',
  end: '09:00',
  days: [4],
  flexible: true,
  allowedStart: '07:00',
  allowedEnd: '12:00',
  indoorAvailable: true,
}
const plan = {
  name: 'Synthetic outdoor plan',
  configured: true,
  ruleMode: 'custom',
  threshold: 75,
  activities: [activity],
}
const point = (hour, value) => ({
  time: `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`,
  pm25: value,
  pm10: null,
})
const dashboard = (value = 74, overrides = {}) => ({
  location: delhi,
  forecast: {
    id: 'synthetic-forecast',
    fetchedAt,
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    source: 'Synthetic fixture',
    points: [point(8, value), point(10, 40)],
  },
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    cpcb: { status: 'no_data' },
    openaq: { status: 'no_data' },
  },
  policy: {
    date,
    version: 'policy-1',
    status: 'reviewed_guidance',
    message: '',
    records: [],
    sources: [],
  },
  ...overrides,
})
const decision = (value = 74, overrides = {}) => ({
  id: 'synthetic-decision',
  activityId: activity.id,
  activity: activity.activity,
  date,
  at: new Date(now).toISOString(),
  choice: 'outdoors',
  reason: 'Synthetic offline test decision',
  snapshotId: 'synthetic-snapshot',
  planVersion: planVersion(plan),
  threshold: plan.threshold,
  forecastId: 'synthetic-forecast',
  value,
  coverage: 'complete',
  policyVersion: 'policy-1',
  policyStatus: 'reviewed_guidance',
  sourceAt: fetchedAt,
  followThrough: 'unconfirmed',
  lifecycle: 'recorded',
  location: reviewedLocation(delhi),
  originalWindow: { start: activity.start, end: activity.end },
  originalAssessment: assessWindow(
    activity,
    [point(8, value)],
    date,
    75,
    now,
    fetchedAt,
  ),
  ...overrides,
})
const reasons = (
  record = decision(),
  data = dashboard(),
  place = delhi,
  at = now,
) => decisionReviewReasons(record, plan, data, place, at)

test('reviewed places retain coarse coordinates and distinguish city, state and nearby positions', () => {
  const location = reviewedLocation(delhi)
  assert.match(location.key, /^[a-f0-9]{32}$/)
  assert.equal(location.latitude, 28.6)
  assert.equal(location.longitude, 77.2)
  assert.equal(location.areaId, '28.6,77.2')
  assert.deepEqual(reviewedLocation({ ...delhi }), location)
  assert.equal(
    reviewedLocation({ ...delhi, name: ' FIXTURE DELHI ' }).key,
    location.key,
  )
  assert.notEqual(reviewedLocation(pune).key, location.key)
  assert.notEqual(
    reviewedLocation({ ...delhi, state: 'Other state' }).key,
    location.key,
  )
  const nearby = reviewedLocation({ ...delhi, latitude: 28.6141 })
  assert.equal(nearby.areaId, location.areaId)
  assert.notEqual(nearby.key, location.key)
  assert.ok(!JSON.stringify(location).includes('28.6139'))
})

test('Delhi actions never become current Pune or nearby-position actions', () => {
  const record = decision()
  assert.equal(currentDecision([record], date, activity.id, delhi), record)
  assert.equal(currentDecision([record], date, activity.id, pune), undefined)
  assert.equal(
    currentDecision([record], date, activity.id, {
      ...delhi,
      longitude: 77.2091,
    }),
    undefined,
  )
  assert.ok(
    reasons(record, dashboard(74, { location: pune }), pune).some((reason) =>
      /location has changed/.test(reason),
    ),
  )
})

test('small forecast crossings reopen review in both directions at the rule of 75', () => {
  assert.deepEqual(reasons(), [])
  assert.ok(
    reasons(decision(74), dashboard(76)).some((reason) =>
      /crossed above/.test(reason),
    ),
  )
  assert.ok(
    reasons(decision(76), dashboard(74)).some((reason) =>
      /returned to or below/.test(reason),
    ),
  )
  assert.ok(
    reasons(decision(76), dashboard(75)).some((reason) =>
      /returned to or below/.test(reason),
    ),
  )
  assert.deepEqual(reasons(decision(73), dashboard(74)), [])
})

test('shared assessment change rules preserve strict material boundaries and fresh recovery', () => {
  const assessment = (value) => ({
    value,
    coverage: 'complete',
    review: value > 75,
    freshness: 'fresh',
  })
  assert.ok(
    assessmentReviewReasons(assessment(74), assessment(76)).some((reason) =>
      /crossed above/.test(reason),
    ),
  )
  assert.ok(
    assessmentReviewReasons(assessment(76), assessment(74)).some((reason) =>
      /returned to or below/.test(reason),
    ),
  )
  assert.deepEqual(assessmentReviewReasons(assessment(20), assessment(25)), [])
  assert.ok(
    assessmentReviewReasons(assessment(20), assessment(26)).some((reason) =>
      /materially/.test(reason),
    ),
  )
  assert.deepEqual(assessmentReviewReasons(assessment(40), assessment(48)), [])
  assert.ok(
    assessmentReviewReasons(assessment(40), assessment(49)).some((reason) =>
      /materially/.test(reason),
    ),
  )
  assert.deepEqual(
    assessmentReviewReasons(
      { ...assessment(40), freshness: 'stale' },
      assessment(40),
    ),
    [],
  )
})

test('fresh forecasts becoming stale, future dated or unknown require review', () => {
  assert.ok(
    reasons(decision(), dashboard(), delhi, now + FORECAST_MAX_AGE).some(
      (reason) => /freshness.*stale/.test(reason),
    ),
  )
  const future = dashboard()
  future.forecast.fetchedAt = new Date(now + 6 * 60_000).toISOString()
  assert.ok(
    reasons(decision(), future).some((reason) =>
      /freshness.*future/.test(reason),
    ),
  )
  const unknown = dashboard()
  unknown.forecast.fetchedAt = 'invalid'
  assert.ok(
    reasons(decision(), unknown).some((reason) =>
      /freshness.*unknown/.test(reason),
    ),
  )
})

test('guidance status changes require review even when its version is identical', () => {
  const data = dashboard()
  data.policy.status = 'verification_needed'
  assert.equal(data.policy.version, decision().policyVersion)
  assert.ok(
    reasons(decision(), data).some((reason) =>
      /verification status has changed/.test(reason),
    ),
  )
  data.policy.date = '2026-10-09'
  assert.ok(
    reasons(decision(), data).some((reason) =>
      /guidance applies to a different date/.test(reason),
    ),
  )
})

test('rescheduled decisions reassess the chosen 10–11 window while 08–09 stays unchanged', () => {
  const chosenWindow = { start: '10:00', end: '11:00' }
  const record = decision(74, {
    choice: 'rescheduled',
    proposedStart: chosenWindow.start,
    proposedEnd: chosenWindow.end,
    chosenWindow,
    chosenAssessment: assessWindow(
      { ...activity, ...chosenWindow },
      [point(10, 40)],
      date,
      75,
      now,
      fetchedAt,
    ),
  })
  assert.deepEqual(reasons(record), [])
  const worse = dashboard()
  worse.forecast.points = [point(8, 74), point(10, 76)]
  assert.ok(
    reasons(record, worse).some((reason) =>
      /chosen window.*crossed above/.test(reason),
    ),
  )
  assert.deepEqual(reasons(record, dashboard(90)), [])
})

test('shortened decisions detect a chosen-window crossing despite an unchanged original peak', () => {
  const original = { ...activity, end: '12:00' }
  const shortPlan = { ...plan, activities: [original] }
  const chosenWindow = { start: '10:00', end: '11:00' }
  const points = [point(8, 90), point(9, 70), point(10, 40), point(11, 50)]
  const record = decision(90, {
    choice: 'shortened',
    planVersion: planVersion(shortPlan),
    originalWindow: { start: '08:00', end: '12:00' },
    originalAssessment: assessWindow(
      original,
      points,
      date,
      75,
      now,
      fetchedAt,
    ),
    proposedStart: chosenWindow.start,
    proposedEnd: chosenWindow.end,
    chosenWindow,
    chosenAssessment: assessWindow(
      { ...original, ...chosenWindow },
      points,
      date,
      75,
      now,
      fetchedAt,
    ),
  })
  const before = dashboard()
  before.forecast.points = points
  assert.deepEqual(
    decisionReviewReasons(record, shortPlan, before, delhi, now),
    [],
  )
  const after = dashboard()
  after.forecast.points = points.map((row) =>
    row.time.includes('T10:') ? { ...row, pm25: 76 } : row,
  )
  assert.equal(
    assessWindow(original, after.forecast.points, date, 75, now, fetchedAt)
      .value,
    record.originalAssessment.value,
  )
  assert.ok(
    decisionReviewReasons(record, shortPlan, after, delhi, now).some((reason) =>
      /chosen window.*crossed above/.test(reason),
    ),
  )
})

test('missing hours and material changes are assessed for the retained window', () => {
  const missing = dashboard()
  missing.forecast.points = [point(10, 40)]
  assert.ok(
    reasons(decision(), missing).some((reason) => /coverage/.test(reason)),
  )
  assert.ok(
    reasons(decision(40), dashboard(49)).some((reason) =>
      /peak has changed materially/.test(reason),
    ),
  )
  assert.deepEqual(reasons(decision(40), dashboard(48)), [])
  const partial = assessWindow(
    { ...activity, end: '10:00' },
    [point(8, 40)],
    date,
    75,
    now,
    fetchedAt,
  )
  assert.equal(partial.coverage, 'partial')
  assert.equal(assessWindow(activity, [], date, 75, now).freshness, 'unknown')
  assert.equal(
    assessWindow(
      activity,
      [point(8, 40), point(8, 40)],
      date,
      75,
      now,
      fetchedAt,
    ).coverage,
    'complete',
  )
})

test('latest reopened, pending or superseded rows block older recorded actions', () => {
  const old = decision()
  for (const lifecycle of ['reopened', 'superseded']) {
    const latest = decision(74, {
      id: 'latest',
      lifecycle,
      reopenedAt: new Date(now + 1).toISOString(),
    })
    assert.equal(
      currentDecision([old, latest], date, activity.id, delhi),
      undefined,
    )
  }
  assert.equal(
    currentDecision(
      [old, decision(74, { id: 'pending', choice: 'pending' })],
      date,
      activity.id,
      delhi,
    ),
    undefined,
  )
  const reopened = { ...old, lifecycle: 'reopened' }
  const replacement = decision(74, { id: 'replacement', choice: 'indoors' })
  assert.equal(
    currentDecision([reopened, replacement], date, activity.id, delhi),
    replacement,
  )
})

test('legacy records require review and never inherit current location or chosen evidence', () => {
  const legacy = decision()
  delete legacy.location
  delete legacy.originalWindow
  delete legacy.originalAssessment
  delete legacy.policyStatus
  assert.ok(reasons(legacy).some((reason) => /legacy record/.test(reason)))
  assert.equal(currentDecision([legacy], date, activity.id, delhi), undefined)
  assert.equal(legacy.location, undefined)
  const changedWindowLegacy = decision(74, {
    choice: 'rescheduled',
    proposedStart: '10:00',
    proposedEnd: '11:00',
  })
  assert.ok(
    reasons(changedWindowLegacy).some((reason) =>
      /chosen window evidence was not retained/.test(reason),
    ),
  )
  assert.equal(
    currentDecision([changedWindowLegacy], date, activity.id, delhi),
    undefined,
  )
})
