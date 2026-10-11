import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityChoice,
  activityChoiceKey,
  activityForChart,
  activitySummary,
  activityViews,
} from '../src/lib/activity-view.ts'
import {
  activityDefinition,
  appendDecision,
  createDecisionRecord,
  decisionsForReview,
  reopenDecision,
} from '../src/lib/decision-state.ts'
import { reviewedLocation } from '../src/lib/decision-evidence.ts'
import { reviewReasonLabel } from '../src/lib/labels.ts'
import {
  FORECAST_MAX_AGE,
  pointsForDate,
  validatePlan,
} from '../src/lib/planner.ts'
import {
  evaluateReviewAlerts,
  reviewSignals,
} from '../src/lib/review-alerts.ts'
import { readJournal, writeDecisionDocument } from '../src/lib/storage.ts'
import { templates } from '../src/lib/templates.ts'
import { searchTimes, windowMean } from '../src/lib/time-search.ts'

// Synthetic, offline acceptance inputs. Never imported by the production app.
const date = '2026-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
const place = {
  name: 'Acceptance Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const otherPlace = {
  ...place,
  name: 'Acceptance Pune',
  state: 'Maharashtra',
  latitude: 18.5204,
  longitude: 73.8567,
}
const locationKey = reviewedLocation(place).key
const activity = {
  id: 'acceptance-pe',
  activity: 'Synthetic PE',
  place: 'Fixture grounds',
  start: '08:00',
  end: '09:00',
  days: [4],
  flexible: true,
  allowedStart: '07:00',
  allowedEnd: '12:00',
}
const plan = {
  name: 'Acceptance plan',
  configured: true,
  threshold: 75,
  ruleMode: 'custom',
  activities: [activity],
}
const rows = (value = 90) =>
  Array.from({ length: 24 }, (_, hour) => ({
    time: `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`,
    pm25: value,
    pm10: 110,
  }))
const dashboard = (points = rows(), at = now - 60_000) => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: structuredClone(place),
  forecast: {
    id: 'b'.repeat(32),
    fetchedAt: new Date(at).toISOString(),
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    source: 'Synthetic acceptance fixture',
    points,
  },
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    cpcb: { status: 'no_data' },
    openaq: { status: 'no_data' },
  },
  policy: {
    date,
    version: 'acceptance-policy',
    status: 'reviewed_guidance',
    message: 'Synthetic fixture policy',
    records: [],
    sources: [],
  },
})
const views = (overrides = {}) =>
  activityViews({
    plan,
    oneOffs: [],
    journal: [],
    dashboard: dashboard(),
    place,
    date,
    now,
    ...overrides,
  })
const find = (overrides = {}) =>
  searchTimes({
    points: rows(40),
    date,
    duration: 30,
    allowedStart: '08:00',
    allowedEnd: '11:00',
    threshold: 75,
    now,
    ...overrides,
  })
const record = (overrides = {}) =>
  createDecisionRecord({
    activity,
    choice: 'outdoors',
    snapshot: dashboard(),
    plan,
    place,
    date,
    reason: 'Synthetic recorded review',
    now,
    id: 'acceptance-record',
    ...overrides,
  })
const signals = (items) => reviewSignals(items, date, locationKey)
const storage = () => {
  const items = new Map()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  }
}

test('F01 ranks peak, weighted mean and earliest time without overlapping its three results', () => {
  const points = rows(500)
  points[8].pm25 = 60
  points[9].pm25 = 20
  points[10].pm25 = 60
  const result = find({
    points,
    duration: 60,
    allowedStart: '08:00',
    allowedEnd: '11:00',
  })
  assert.deepEqual(
    result.map((x) => x.start),
    ['09:00', '08:00', '10:00'],
  )
  assert.deepEqual(
    result.map((x) => x.value),
    [20, 60, 60],
  )
  assert.deepEqual(
    result.map((x) => x.mean),
    [20, 60, 60],
  )
})

test('F01 fractional windows use overlap weights and include the peak of every intersecting hour', () => {
  const points = rows(500)
  points[8].pm25 = 100
  points[9].pm25 = 20
  const result = find({
    points,
    duration: 60,
    allowedStart: '08:45',
    allowedEnd: '09:45',
  })
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], {
    start: '08:45',
    end: '09:45',
    value: 100,
    mean: 40,
    review: true,
  })
  assert.equal(windowMean(pointsForDate(points, date), '08:45', '09:45'), 40)
})

test('F01 equal peaks rank by the lower overlap-weighted mean before earlier starts', () => {
  const points = rows(500)
  points[8].pm25 = 60
  points[9].pm25 = 20
  points[10].pm25 = 60
  const result = find({
    points,
    duration: 90,
    allowedStart: '08:00',
    allowedEnd: '11:00',
  })
  assert.equal(result[0].value, 60)
  assert.equal(result[0].mean, 100 / 3)
  assert.equal(result[0].start, '08:30')
})

test('F01 zero is a measured model value and qualifies; missing PM2.5 cannot be replaced by PM10', () => {
  const points = rows(null)
  points[8].pm25 = 0
  const result = find({ points, allowedStart: '08:00', allowedEnd: '09:00' })
  assert.deepEqual(
    result.map((x) => [x.value, x.mean, x.review]),
    [
      [0, 0, false],
      [0, 0, false],
    ],
  )
  assert.deepEqual(find({ points: rows(null) }), [])
  assert.deepEqual(
    find({ points, duration: 90, allowedStart: '08:00', allowedEnd: '09:30' }),
    [],
  )
})

test('F01 excludes negative, nonfinite and missing buckets instead of interpolating gaps', () => {
  for (const value of [null, -1, NaN, Infinity]) {
    const points = rows(40)
    points[8].pm25 = value
    assert.deepEqual(
      find({
        points,
        duration: 90,
        allowedStart: '08:00',
        allowedEnd: '09:30',
      }),
      [],
    )
    assert.equal(windowMean(points, '08:30', '09:00'), null)
  }
})

test('F01 allowed hours, duration and future starts are enforced at their exact boundaries', () => {
  const clock = Date.parse(`${date}T08:15:00+05:30`)
  const result = find({
    now: clock,
    allowedStart: '08:00',
    allowedEnd: '09:00',
    duration: 30,
  })
  assert.deepEqual(
    result.map((x) => [x.start, x.end]),
    [['08:30', '09:00']],
  )
  const fractional = find({
    allowedStart: '08:10',
    allowedEnd: '09:00',
    duration: 30,
  })
  assert.deepEqual(
    fractional.map((x) => [x.start, x.end]),
    [['08:10', '08:40']],
  )
})

test('F01 rejects invalid dates, rule values, clocks and durations instead of returning plausible times', () => {
  for (const overrides of [
    { date: '2026-02-30' },
    { date: '2026-13-08' },
    { date: 'not-a-date' },
    { now: NaN },
    { threshold: Infinity },
    { threshold: 0 },
    { threshold: 1001 },
    { duration: 0 },
    { duration: 14 },
    { duration: 241 },
    { duration: 30.5 },
    { allowedStart: '25:00' },
    { allowedEnd: '08:00' },
    { allowedEnd: '07:00' },
    { allowedEnd: '08:15' },
    { lowerThan: NaN },
  ])
    assert.deepEqual(find(overrides), [], JSON.stringify(overrides))
})

test('F01 respects the selected date, excludes an existing start and requires a strictly lower peak', () => {
  const points = rows(40)
  points[9].pm25 = 20
  points.push({ time: '2026-10-09T08:00:00+05:30', pm25: 0, pm10: 0 })
  const result = find({
    points,
    duration: 60,
    lowerThan: 40,
    excludeStart: '08:00',
  })
  assert.deepEqual(
    result.map((x) => [x.start, x.end, x.value]),
    [['09:00', '10:00', 20]],
  )
  assert.deepEqual(find({ lowerThan: 40 }), [])
})

test('F01 excludes the end boundary bucket from a complete window', () => {
  const points = rows(40)
  points[9].pm25 = null
  const result = find({
    points,
    duration: 60,
    allowedStart: '08:00',
    allowedEnd: '09:00',
  })
  assert.equal(result[0].value, 40)
  assert.equal(result[0].mean, 40)
})

test('F02 every template validates and remains an illustrative preview until explicitly configured', () => {
  assert.deepEqual(Object.keys(templates).sort(), [
    'commute',
    'school',
    'walk',
    'work',
  ])
  for (const template of Object.values(templates)) {
    assert.deepEqual(validatePlan(template), {})
    assert.equal(template.configured, false)
    assert.equal(template.ruleMode, 'example')
    assert.ok(
      views({ plan: template }).every((view) => view.status === 'preview'),
    )
    const draft = structuredClone(template)
    draft.configured = true
    draft.threshold = 100
    assert.equal(template.threshold, 75)
    assert.deepEqual(validatePlan(draft), {})
    assert.ok(views({ plan: draft }).every((view) => view.status !== 'preview'))
  }
})

test('F02 preview activities never produce personal counts or alerts', () => {
  for (const overrides of [
    { place: { ...place, confirmed: false } },
    { plan: { ...plan, configured: false } },
  ]) {
    const result = views(overrides)
    assert.equal(result[0].status, 'preview')
    assert.equal(result[0].unresolved, false)
    assert.equal(activitySummary(result, true, true, true).flagged.length, 0)
    assert.deepEqual(evaluateReviewAlerts(signals(result), []).alerts, [])
  }
})

test('F02 mismatched-place evidence is withheld even before there is a saved decision', () => {
  const evidence = dashboard(rows(0))
  evidence.location = otherPlace
  const result = views({ dashboard: evidence })
  assert.equal(result[0].status, 'unavailable')
  assert.equal(result[0].value, null)
  assert.equal(result[0].coverage, 'missing')
  assert.deepEqual(result[0].alternatives, [])
})

test('F02 a rescheduled record survives reload, resolves review, sorts and highlights its chosen time', () => {
  const points = rows(90)
  points[10].pm25 = 40
  const evidence = dashboard(points)
  const saved = record({
    choice: 'rescheduled',
    start: '10:00',
    end: '11:00',
    snapshot: evidence,
  })
  const persistent = storage()
  assert.equal(writeDecisionDocument([saved], persistent), true)
  const journal = readJournal(persistent)
  const other = { ...activity, id: 'earlier', start: '09:00', end: '09:30' }
  const result = views({
    journal,
    dashboard: evidence,
    plan: { ...plan, activities: [activity, other] },
  })
  // A changed recurring plan requires re-review, but must preserve the actual chosen window.
  assert.equal(result[1].id, activity.id)
  assert.equal(result[1].chosen.value, 40)
  assert.deepEqual(
    [activityForChart(result[1]).start, activityForChart(result[1]).end],
    ['10:00', '11:00'],
  )
  const unchanged = views({ journal, dashboard: evidence })
  assert.equal(unchanged[0].status, 'recorded')
  assert.equal(unchanged[0].unresolved, false)
  assert.equal(activitySummary(unchanged, true, true, true).flagged.length, 0)
  assert.equal(journal[0].originalAssessment.value, 90)
})

test('F02 chosen upcoming time prevents an already-finished original time from finishing the plan', () => {
  const evidence = dashboard()
  const saved = record({
    choice: 'rescheduled',
    start: '10:00',
    end: '11:00',
    snapshot: evidence,
  })
  const result = views({
    journal: [saved],
    dashboard: evidence,
    now: Date.parse(`${date}T09:15:00+05:30`),
  })
  assert.equal(result[0].passed, false)
  assert.equal(result[0].underway, false)
  assert.notEqual(activitySummary(result, true, true, true).kind, 'finished')
})

test('F02 re-review uses chosen-window threshold crossings and keeps frozen original evidence', () => {
  const old = rows(90)
  old[10].pm25 = 74
  const saved = record({
    choice: 'rescheduled',
    start: '10:00',
    end: '11:00',
    snapshot: dashboard(old),
  })
  const changed = structuredClone(old)
  changed[10].pm25 = 76
  const result = views({ journal: [saved], dashboard: dashboard(changed) })
  assert.equal(result[0].status, 'recheck')
  assert.equal(result[0].unresolved, true)
  assert.match(result[0].reasons.join(' '), /chosen window.*crossed above/)
  assert.equal(saved.chosenAssessment.value, 74)
  assert.equal(saved.originalAssessment.value, 90)
})

test('F02 reopening and replacement preserve history and resolve only a fresh recorded action', () => {
  const first = record()
  const reopened = reopenDecision([first], first.id, now + 1_000)
  const persistent = storage()
  writeDecisionDocument(reopened, persistent)
  const reloaded = readJournal(persistent)
  const result = views({ journal: reloaded })
  assert.equal(result[0].status, 'reopened')
  assert.equal(result[0].current, undefined)
  assert.equal(result[0].latest.lifecycle, 'reopened')
  assert.equal(result[0].unresolved, true)
  const next = appendDecision(
    reloaded,
    record({ id: 'replacement', choice: 'cancelled' }),
  )
  const resolved = views({ journal: next })[0]
  assert.equal(resolved.current.id, 'replacement')
  assert.equal(resolved.status, 'recorded')
  assert.equal(resolved.unresolved, false)
  assert.equal(next[0].lifecycle, 'reopened')
})

test('F02 one-off activities retain their own rules and are scoped by date and location', () => {
  const quick = { ...activity, id: 'quick', start: '10:00', end: '10:30' }
  const context = {
    ...plan,
    name: 'Quick activity',
    threshold: 100,
    activities: [quick],
  }
  const saved = record({ id: 'quick-record', activity: quick, plan: context })
  const oneOffs = [
    { id: quick.id, date, locationKey, plan: context },
    {
      id: 'other-place',
      date,
      locationKey: reviewedLocation(otherPlace).key,
      plan: context,
    },
    { id: 'other-day', date: '2026-10-09', locationKey, plan: context },
  ]
  const result = views({
    oneOffs,
    journal: [saved],
    plan: { ...plan, configured: false, activities: [] },
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].oneOff, true)
  assert.equal(result[0].contextPlan.threshold, 100)
  assert.equal(result[0].status, 'recorded')
  assert.equal(result[0].review, false)
})

test('F02 stale or future forecast retrievals cannot offer alternatives as current evidence', () => {
  for (const at of [now - FORECAST_MAX_AGE - 1, now + 6 * 60_000]) {
    const result = views({ dashboard: dashboard(rows(90), at) })
    assert.equal(result[0].status, 'unavailable')
    assert.deepEqual(result[0].alternatives, [])
    assert.equal(result[0].value, 90) // Retained evidence remains visible, with its old time.
  }
})

test('R0/F02 already-stale, future or unknown recorded evidence cannot resolve or make a decision eligible', () => {
  const evidenceCases = [
    dashboard(rows(), now - FORECAST_MAX_AGE - 1),
    dashboard(rows(), now + 6 * 60_000),
    {
      ...dashboard(),
      forecast: { ...dashboard().forecast, fetchedAt: 'invalid-source-time' },
    },
  ]
  for (const evidence of evidenceCases) {
    const saved = record({ snapshot: evidence })
    const result = views({ journal: [saved], dashboard: evidence })[0]
    assert.equal(result.status, 'recheck')
    assert.equal(result.unresolved, true)
    assert.match(
      result.reasons.join(' '),
      /Current forecast retrieval is (stale|future|unknown)/,
    )
    assert.deepEqual(
      decisionsForReview([saved], date, plan, evidence, place, now).eligible,
      [],
    )
    assert.ok(
      result.reasons.every(
        (reason) => !/[A-Za-z]/.test(reviewReasonLabel(reason, 'hi')),
      ),
    )
  }
})

test('R0/F02 unchanged missing or partial original-window records remain unresolved instead of becoming ready', () => {
  const context = { ...plan, activities: [{ ...activity, end: '10:00' }] }
  for (const points of [
    [],
    [{ time: `${date}T08:00:00+05:30`, pm25: 0, pm10: 0 }],
  ]) {
    const evidence = dashboard(points)
    const saved = record({
      activity: context.activities[0],
      plan: context,
      snapshot: evidence,
    })
    const result = views({
      plan: context,
      journal: [saved],
      dashboard: evidence,
    })[0]
    assert.equal(result.status, 'recheck')
    assert.equal(result.unresolved, true)
    assert.match(
      result.reasons.join(' '),
      /original window: The current forecast window has (no usable|only partial)/,
    )
    assert.deepEqual(
      decisionsForReview([saved], date, context, evidence, place, now).eligible,
      [],
    )
    assert.ok(
      result.reasons.every(
        (reason) =>
          !/[A-Za-z]/.test(
            reviewReasonLabel(reason, 'hi').replaceAll('PM2.5', ''),
          ),
      ),
    )
  }
})

test('R0/F02 unchanged incomplete chosen-window records recheck the actual chosen window', () => {
  const context = { ...plan, activities: [{ ...activity, end: '10:00' }] }
  const points = rows()
  points[11].pm25 = null
  const evidence = dashboard(points)
  const saved = record({
    activity: context.activities[0],
    plan: context,
    snapshot: evidence,
    choice: 'rescheduled',
    start: '10:00',
    end: '12:00',
  })
  const result = views({
    plan: context,
    journal: [saved],
    dashboard: evidence,
  })[0]
  assert.equal(result.status, 'recheck')
  assert.match(
    result.reasons.join(' '),
    /chosen window: The current forecast window has only partial/,
  )
  assert.deepEqual(
    decisionsForReview([saved], date, context, evidence, place, now).eligible,
    [],
  )
})

test('R0/F02 complete fresh zero-valued recorded evidence can still resolve an activity', () => {
  const evidence = dashboard(rows(0))
  const saved = record({ snapshot: evidence })
  const result = views({ journal: [saved], dashboard: evidence })[0]
  assert.equal(result.status, 'recorded')
  assert.equal(result.unresolved, false)
  assert.deepEqual(result.reasons, [])
  assert.equal(
    decisionsForReview([saved], date, plan, evidence, place, now).eligible[0]
      .id,
    saved.id,
  )
})

test('F02 missing and partial windows never appear as below-rule-ready', () => {
  for (const points of [
    [],
    [{ time: `${date}T08:00:00+05:30`, pm25: 0, pm10: 0 }],
  ]) {
    const result = views({
      dashboard: dashboard(points),
      plan: { ...plan, activities: [{ ...activity, end: '10:00' }] },
    })
    assert.equal(result[0].status, 'incomplete')
    assert.equal(activitySummary(result, true, true, true).kind, 'incomplete')
  }
})

test('F02 removed activities stay in history without returning to the active timeline', () => {
  const saved = record()
  const result = views({ journal: [saved], plan: { ...plan, activities: [] } })
  assert.deepEqual(result, [])
  assert.equal(saved.activityId, activity.id)
  assert.equal(saved.reviewedActivity.start, '08:00')
})

test('F02 follow-through survives reload without changing the reviewed action or evidence', () => {
  const saved = { ...record({ choice: 'indoors' }), followThrough: 'completed' }
  const persistent = storage()
  writeDecisionDocument([saved], persistent)
  const result = views({ journal: readJournal(persistent) })[0]
  assert.equal(result.current.followThrough, 'completed')
  assert.equal(result.current.choice, 'indoors')
  assert.deepEqual(result.current.originalAssessment, saved.originalAssessment)
  assert.equal(result.unresolved, false)
})

test('F02 pending UI choices cannot leak across location, date, plan, saved record or reopening', () => {
  const base = views()[0]
  const key = activityChoiceKey(base, date, locationKey)
  assert.notEqual(activityChoiceKey(base, '2026-10-09', locationKey), key)
  assert.notEqual(
    activityChoiceKey(base, date, reviewedLocation(otherPlace).key),
    key,
  )
  assert.notEqual(
    activityChoiceKey(
      { ...base, contextPlan: { ...plan, threshold: 80 } },
      date,
      locationKey,
    ),
    key,
  )
  const saved = views({ journal: [record()] })[0]
  assert.notEqual(activityChoiceKey(saved, date, locationKey), key)
  const reopened = views({
    journal: reopenDecision([record()], 'acceptance-record', now + 1),
  })[0]
  assert.notEqual(
    activityChoiceKey(saved, date, locationKey),
    activityChoiceKey(reopened, date, locationKey),
  )
  assert.equal(activityChoice(base, 'cancelled'), 'cancelled')
  assert.equal(
    activityChoice({ ...base, passed: true }, 'rescheduled'),
    'outdoors',
  )
  assert.equal(
    activityChoice({ ...base, flexible: false }, 'rescheduled'),
    'outdoors',
  )
  assert.equal(
    activityChoice({ ...base, passed: true }, 'shortened'),
    'outdoors',
  )
})

test('R0/F02 frozen activity definitions never retain runtime views or nested earlier decisions', () => {
  const previous = record({
    id: 'private-earlier-record',
    reason: 'Private earlier history must not nest',
  })
  const extended = views({ journal: [previous] })[0]
  assert.ok(extended.current)
  const saved = record({ id: 'next-record', activity: extended })
  assert.deepEqual(saved.reviewedActivity, activity)
  for (const field of [
    'current',
    'latest',
    'contextPlan',
    'alternatives',
    'reasons',
    'status',
    'chosen',
    'available',
    'coverage',
    'value',
  ])
    assert.equal(field in saved.reviewedActivity, false, field)
  assert.doesNotMatch(
    JSON.stringify(saved),
    /private-earlier-record|Private earlier history must not nest/,
  )
  saved.reviewedActivity.days.push(0)
  assert.deepEqual(activity.days, [4])
  assert.deepEqual(extended.days, [4])
})

test('R0/F02 repeated re-recording stays bounded and keeps only the reviewed activity definition', () => {
  let previous = record({ id: 'record-00' })
  const baseLength = JSON.stringify(previous).length
  for (let i = 1; i <= 30; i++) {
    const runtimeView = views({ journal: [previous] })[0]
    previous = record({
      id: `record-${String(i).padStart(2, '0')}`,
      activity: runtimeView,
    })
    assert.deepEqual(previous.reviewedActivity, activity)
    assert.equal(JSON.stringify(previous).length, baseLength)
  }
})

test('R0/F02 activity projection preserves supported optional constraints without retaining extra fields', () => {
  const configured = {
    ...activity,
    indoorAvailable: true,
    intensity: 'high',
    flexible: false,
  }
  const projected = activityDefinition({
    ...configured,
    contextPlan: plan,
    current: record(),
    unknownRuntime: 'do not retain',
  })
  assert.deepEqual(projected, configured)
  assert.notEqual(projected.days, configured.days)
})

test('F05 repeats deduplicate and a dismissed unchanged episode remains hidden after reload', () => {
  const input = signals(views())
  const first = evaluateReviewAlerts(input, [])
  assert.equal(first.alerts.length, 1)
  const id = first.alerts[0].id
  assert.equal(evaluateReviewAlerts(input, [], first.memory).alerts[0].id, id)
  assert.deepEqual(evaluateReviewAlerts(input, [id], first.memory).alerts, [])
  assert.deepEqual(evaluateReviewAlerts(input, [id]).alerts, [])
})

test('F05 above to below to above creates a new episode after dismissal', () => {
  const first = evaluateReviewAlerts(signals(views()), [])
  const dismissed = [first.alerts[0].id]
  const below = evaluateReviewAlerts(
    signals(views({ dashboard: dashboard(rows(74)) })),
    dismissed,
    first.memory,
  )
  assert.deepEqual(below.alerts, [])
  const back = evaluateReviewAlerts(
    signals(views({ dashboard: dashboard(rows(90)) })),
    dismissed,
    below.memory,
  )
  assert.equal(back.alerts.length, 1)
  assert.notEqual(back.alerts[0].id, dismissed[0])
})

test('F05 small forecast changes keep the dismissed episode hidden; accumulated material change reappears', () => {
  const first = evaluateReviewAlerts(signals(views()), [])
  const hidden = [first.alerts[0].id]
  const small = evaluateReviewAlerts(
    signals(views({ dashboard: dashboard(rows(95)) })),
    hidden,
    first.memory,
  )
  assert.deepEqual(small.alerts, [])
  const material = evaluateReviewAlerts(
    signals(views({ dashboard: dashboard(rows(109)) })),
    hidden,
    small.memory,
  )
  assert.equal(material.alerts.length, 1)
  assert.notEqual(material.alerts[0].id, hidden[0])
  assert.equal(first.memory.get(signals(views())[0].scope).value, 90) // Pure evaluator does not mutate earlier memory.
})

test('F05 missing, partial, stale and refreshed-above-rule episodes remain distinct', () => {
  const incompletePlan = {
    ...plan,
    activities: [{ ...activity, end: '10:00' }],
  }
  const partial = [{ time: `${date}T08:00:00+05:30`, pm25: 90, pm10: 100 }]
  const initial = evaluateReviewAlerts(
    signals(views({ plan: incompletePlan, dashboard: dashboard([]) })),
    [],
  )
  assert.equal(initial.alerts[0].status, 'incomplete')
  const hidden = [initial.alerts[0].id]
  const changed = evaluateReviewAlerts(
    signals(views({ plan: incompletePlan, dashboard: dashboard(partial) })),
    hidden,
    initial.memory,
  )
  assert.equal(changed.alerts[0].status, 'incomplete')
  assert.notEqual(changed.alerts[0].id, hidden[0])
  const stale = evaluateReviewAlerts(
    signals(
      views({
        plan: incompletePlan,
        dashboard: dashboard(rows(), now - FORECAST_MAX_AGE - 1),
      }),
    ),
    [],
    changed.memory,
  )
  assert.equal(stale.alerts[0].status, 'unavailable')
  const refreshed = evaluateReviewAlerts(
    signals(views({ plan: incompletePlan })),
    [stale.alerts[0].id],
    stale.memory,
  )
  assert.equal(refreshed.alerts[0].status, 'review')
  assert.notEqual(refreshed.alerts[0].id, stale.alerts[0].id)
})

test('F05 recording resolves an alert, reopening creates another, and finished windows stop alerting', () => {
  const saved = record()
  const first = evaluateReviewAlerts(signals(views()), [])
  const recorded = evaluateReviewAlerts(
    signals(views({ journal: [saved] })),
    [],
    first.memory,
  )
  assert.deepEqual(recorded.alerts, [])
  const reopened = evaluateReviewAlerts(
    signals(views({ journal: reopenDecision([saved], saved.id, now + 1000) })),
    [],
    recorded.memory,
  )
  assert.equal(reopened.alerts[0].status, 'reopened')
  const finished = evaluateReviewAlerts(
    signals(views({ now: Date.parse(`${date}T09:00:00+05:30`) })),
    [],
    first.memory,
  )
  assert.deepEqual(finished.alerts, [])
})

test('F05 date and location changes do not share a dismissed alert', () => {
  const input = signals(views())
  const first = evaluateReviewAlerts(input, [])
  const hidden = [first.alerts[0].id]
  for (const scoped of [
    reviewSignals(views(), '2026-10-09', locationKey),
    reviewSignals(views(), date, reviewedLocation(otherPlace).key),
  ]) {
    const next = evaluateReviewAlerts(scoped, hidden, first.memory)
    assert.equal(next.alerts.length, 1)
    assert.notEqual(next.alerts[0].id, hidden[0])
  }
})

test('F05 malformed dismissal tokens cannot suppress a valid prompt and inactive session memory is bounded', () => {
  const input = signals(views())
  assert.equal(
    evaluateReviewAlerts(input, [`r1:${input[0].scope}:broken:-1:NaN`]).alerts
      .length,
    1,
  )
  const large = new Map(
    Array.from({ length: 501 }, (_, i) => [
      `unused-${i}`,
      { signature: 'x', cycle: 0, value: 1 },
    ]),
  )
  const result = evaluateReviewAlerts(input, [], large)
  assert.equal(result.memory.size, 1)
  assert.equal(large.size, 501)
})

test('F17 deterministic local re-review reasons are Hindi while original English and source text remain intact', () => {
  const reasons = [
    'The forecast crossed above the review rule.',
    'The forecast returned to or below the review rule.',
    'Forecast coverage has changed.',
    'Forecast availability has changed.',
    'The current forecast window has no usable PM2.5 values.',
    'The current forecast window has only partial PM2.5 coverage.',
    'The forecast peak has changed materially.',
    'The reviewed location was not retained. Review this legacy record again.',
    'The selected location has changed since this decision.',
    'Current evidence is for a different selected location.',
    'The outdoor plan or review rule has changed.',
    'The retained decision date is invalid.',
    'This activity is no longer scheduled on the retained decision date.',
    'The current guidance applies to a different date.',
    'The guidance version has changed.',
    'The reviewed guidance status was not retained. Review this legacy record again.',
    'The guidance verification status has changed.',
    'The original window evidence was not retained. Review this legacy record again.',
    'The chosen window evidence was not retained. Review this legacy record again.',
    ...['stale', 'future', 'unknown'].flatMap((freshness) => [
      `Forecast freshness has changed to ${freshness}.`,
      `For the chosen window: Forecast freshness has changed to ${freshness}.`,
      `Current forecast retrieval is ${freshness}. Refresh before using this decision.`,
      `For the original window: Current forecast retrieval is ${freshness}. Refresh before using this decision.`,
    ]),
    'For the chosen window: The forecast crossed above the review rule.',
    'For the original window: Forecast coverage has changed.',
  ]
  for (const reason of reasons) {
    const hindi = reviewReasonLabel(reason, 'hi')
    assert.equal(reviewReasonLabel(reason, 'en'), reason)
    assert.match(hindi, /[\u0900-\u097f]/)
    assert.doesNotMatch(hindi.replaceAll('PM2.5', ''), /[A-Za-z]/)
  }
  const changed = rows(90)
  const before = structuredClone(changed)
  before[10].pm25 = 74
  const saved = record({
    choice: 'rescheduled',
    start: '10:00',
    end: '11:00',
    snapshot: dashboard(before),
  })
  const actualReasons = views({
    journal: [saved],
    dashboard: dashboard(changed),
  })[0].reasons
  assert.ok(actualReasons.length > 0)
  assert.ok(
    actualReasons.every(
      (reason) => !/[A-Za-z]/.test(reviewReasonLabel(reason, 'hi')),
    ),
  )
  assert.equal(
    reviewReasonLabel('User note or provider diagnostic', 'hi'),
    'User note or provider diagnostic',
  )
})
