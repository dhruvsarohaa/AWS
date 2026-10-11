import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  assessActivity,
  clockMinutes,
  concentration,
  dateInIndia,
  FORECAST_MAX_AGE,
  formatTimestamp,
  MONITOR_MAX_AGE,
  pointsForDate,
  STARTER_PLAN,
  summarizeActivities,
  timestampState,
  validatePlan,
} from '../src/lib/planner.ts'

// These fixtures are offline test inputs. They are never imported by the app.
const date = '2026-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
const activity = {
  id: 'walk',
  start: '08:00',
  end: '10:00',
  activity: 'Walk',
  place: 'Park',
  days: [4],
}
const row = (hour, pm25, pm10 = 100) => ({
  time: `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`,
  pm25,
  pm10,
})

test('India date rolls over at 18:30 UTC and handles month boundaries', () => {
  assert.equal(dateInIndia(Date.parse('2026-10-08T18:29:59Z')), '2026-10-08')
  assert.equal(dateInIndia(Date.parse('2026-10-08T18:30:00Z')), '2026-10-09')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})
test('missing hours remain missing, and zero remains a real concentration', () => {
  const points = pointsForDate([row(8, 0), row(9, null)], date)
  assert.equal(points.length, 24)
  assert.equal(points[8].pm25, 0)
  assert.equal(points[9].pm25, null)
  assert.equal(points[10].pm25, null)
  assert.equal(concentration(0), '0')
  assert.equal(concentration(null), 'Not available')
})
test('invalid and negative concentrations are unavailable rather than plotted', () => {
  const points = pointsForDate(
    [row(8, -4), row(9, Infinity), row(10, NaN)],
    date,
  )
  assert.ok(points.every((point) => point.pm25 === null))
})
test('PM10 alone cannot complete a PM2.5 planning comparison', () => {
  const result = assessActivity(
    activity,
    pointsForDate([row(8, null), row(9, null)], date),
    date,
    75,
    now,
  )
  assert.equal(result.coverage, 'missing')
  assert.equal(result.review, false)
  assert.equal(result.value, null)
})
test('one available low value does not make a partial activity complete', () => {
  const result = assessActivity(
    activity,
    pointsForDate([row(8, 40)], date),
    date,
    75,
    now,
  )
  assert.equal(result.coverage, 'partial')
  assert.equal(result.available, 1)
  assert.equal(result.expected, 2)
  assert.equal(result.review, false)
})
test('a partial window retains an available above-rule warning', () => {
  const result = assessActivity(
    activity,
    pointsForDate([row(9, 90)], date),
    date,
    75,
    now,
  )
  assert.equal(result.coverage, 'partial')
  assert.equal(result.review, true)
  assert.equal(result.value, 90)
})
test('complete activity uses its highest value and excludes the end boundary', () => {
  const result = assessActivity(
    activity,
    pointsForDate([row(8, 70), row(9, 75), row(10, 999)], date),
    date,
    75,
    now,
  )
  assert.equal(result.coverage, 'complete')
  assert.equal(result.value, 75)
  assert.equal(result.review, false)
})
test('fractional activity times require every intersecting hourly window', () => {
  const result = assessActivity(
    { ...activity, start: '08:30', end: '09:15' },
    pointsForDate([row(8, 80), row(9, 40)], date),
    date,
    75,
    now,
  )
  assert.equal(result.expected, 2)
  assert.equal(result.coverage, 'complete')
  assert.equal(result.review, true)
})
test('activities are marked in progress and finished using India timestamps', () => {
  const points = pointsForDate([row(8, 90), row(9, 95)], date)
  assert.equal(
    assessActivity(
      activity,
      points,
      date,
      75,
      Date.parse(`${date}T08:30:00+05:30`),
    ).underway,
    true,
  )
  assert.equal(
    assessActivity(
      activity,
      points,
      date,
      75,
      Date.parse(`${date}T10:00:00+05:30`),
    ).passed,
    true,
  )
})
test('monitor age becomes stale as the client clock advances without new data', () => {
  const observedAt = new Date(now).toISOString()
  assert.equal(timestampState(observedAt, now + MONITOR_MAX_AGE), 'fresh')
  assert.equal(timestampState(observedAt, now + MONITOR_MAX_AGE + 1), 'stale')
})
test('unknown and unexpectedly future source timestamps are not recent', () => {
  assert.equal(timestampState(null, now), 'unknown')
  assert.equal(timestampState('invalid', now), 'unknown')
  assert.equal(
    timestampState(new Date(now + 6 * 60_000).toISOString(), now),
    'future',
  )
})
test('retrieval age is checked independently of observation age', () => {
  const at = new Date(now - FORECAST_MAX_AGE - 1).toISOString()
  assert.equal(timestampState(at, now, FORECAST_MAX_AGE), 'stale')
  assert.equal(timestampState(at, now), 'fresh')
})
test('relative timestamp copy changes with time instead of freezing', () => {
  const at = new Date(now).toISOString()
  assert.match(formatTimestamp(at, now), /just now/)
  assert.match(formatTimestamp(at, now + 5 * 60_000), /5 min ago/)
})
test('validation identifies the exact activity fields and rejects invalid clock ranges', () => {
  const errors = validatePlan({
    ...STARTER_PLAN,
    name: ' ',
    threshold: NaN,
    activities: [
      {
        ...activity,
        activity: '',
        place: '',
        start: '25:00',
        end: '10:00',
        days: [],
      },
    ],
  })
  assert.ok(errors['plan-name'])
  assert.ok(errors['plan-threshold'])
  assert.ok(errors['walk-name'])
  assert.ok(errors['walk-place'])
  assert.ok(errors['walk-start'])
  assert.ok(errors['walk-days'])
  assert.ok(Number.isNaN(clockMinutes('12:60')))
})
test('same-day editor rejects backwards and equal time windows', () => {
  for (const end of ['07:00', '08:00'])
    assert.ok(
      validatePlan({ ...STARTER_PLAN, activities: [{ ...activity, end }] })[
        'walk-end'
      ],
    )
  assert.deepEqual(validatePlan(STARTER_PLAN), {})
})
test('preview setup takes precedence over personal review counts', () => {
  const rows = [
    assessActivity(
      activity,
      pointsForDate([row(8, 100), row(9, 110)], date),
      date,
      75,
      now,
    ),
  ]
  assert.equal(
    summarizeActivities(false, true, true, rows).kind,
    'location-preview',
  )
  assert.equal(
    summarizeActivities(true, false, true, rows).kind,
    'plan-preview',
  )
  assert.equal(summarizeActivities(true, true, true, rows).kind, 'review')
})
test('summary cannot report below-rule when PM2.5 coverage is absent or partial', () => {
  for (const fixture of [[], [row(8, 40)]]) {
    const rows = [
      assessActivity(activity, pointsForDate(fixture, date), date, 75, now),
    ]
    assert.equal(summarizeActivities(true, true, true, rows).kind, 'incomplete')
  }
})
test('completed outdoor windows do not count as upcoming warnings', () => {
  const rows = [
    assessActivity(
      activity,
      pointsForDate([row(8, 100)], date),
      date,
      75,
      Date.parse(`${date}T12:00:00+05:30`),
    ),
  ]
  const summary = summarizeActivities(true, true, true, rows)
  assert.equal(summary.kind, 'finished')
  assert.equal(summary.flagged.length, 0)
  assert.equal(summary.firstAttention, undefined)
})
