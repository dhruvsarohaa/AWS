import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDecisionRecord,
  decisionsForReview,
} from '../src/lib/decision-state.ts'
import { decisionReviewReasons } from '../src/lib/decision-evidence.ts'
import { reviewReasonLabel } from '../src/lib/labels.ts'
import {
  decisionSaveReviewReasons,
  freshPlanningEvidence,
} from '../src/lib/decision-save.ts'
const now = Date.parse('2030-10-08T00:00:00+05:30')
const place = {
  name: 'SYNTHETIC Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6,
  longitude: 77.2,
  confirmed: true,
}
const activity = {
  id: 'walk',
  activity: 'SYNTHETIC walk',
  place: 'QA',
  start: '08:00',
  end: '09:00',
  days: [2],
  flexible: true,
  allowedStart: '07:00',
  allowedEnd: '12:00',
}
const plan = {
  name: 'QA',
  threshold: 75,
  configured: true,
  ruleMode: 'custom',
  activities: [activity],
}
const dashboard = () => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: {
    id: 'model',
    source: 'SYNTHETIC',
    fetchedAt: new Date(now).toISOString(),
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    points: [
      { time: '2030-10-08T08:00:00+05:30', pm25: 100, pm10: 150 },
      { time: '2030-10-08T10:00:00+05:30', pm25: 25, pm10: 50 },
    ],
  },
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    openaq: { status: 'no_data' },
    cpcb: { status: 'not_configured' },
  },
  policy: {
    date: '2030-10-08',
    version: 'QA',
    status: 'unverified',
    records: [],
    sources: [],
  },
})
const record = () =>
  createDecisionRecord({
    activity,
    choice: 'rescheduled',
    snapshot: dashboard(),
    plan,
    place,
    date: '2030-10-08',
    reason: 'QA',
    start: '10:00',
    end: '11:00',
    now,
  })
test('R0: unchanged fresh chosen evidence can save; a new snapshot ID alone is not a material change', () => {
  assert.deepEqual(
    decisionSaveReviewReasons(record(), plan, dashboard(), place, now),
    [],
  )
  assert.deepEqual(
    decisionSaveReviewReasons(
      record(),
      plan,
      { ...dashboard(), snapshotId: 'b'.repeat(32) },
      place,
      now,
    ),
    [],
  )
})
test('R0: a dialog expiring while open cannot save even if a new live retrieval repeats the same model', () => {
  const later = now + 2 * 3600000 + 1,
    current = dashboard()
  current.forecast.fetchedAt = new Date(later).toISOString()
  assert.equal(freshPlanningEvidence(current, later), true)
  assert.ok(
    decisionSaveReviewReasons(record(), plan, current, place, later).some((x) =>
      x.includes('editor is no longer fresh'),
    ),
  )
})
test('R0: unavailable, stale, future, unknown or missing forecast cannot save a decision', () => {
  for (const current of [
    null,
    { ...dashboard(), forecast: null },
    {
      ...dashboard(),
      sources: { ...dashboard().sources, forecast: { status: 'unavailable' } },
    },
    {
      ...dashboard(),
      forecast: {
        ...dashboard().forecast,
        fetchedAt: new Date(now - 4 * 3600000).toISOString(),
      },
    },
    {
      ...dashboard(),
      forecast: {
        ...dashboard().forecast,
        fetchedAt: new Date(now + 3600000).toISOString(),
      },
    },
  ]) {
    assert.equal(freshPlanningEvidence(current, now), false)
    assert.ok(
      decisionSaveReviewReasons(record(), plan, current, place, now).length,
    )
  }
})
test('R0: latest chosen threshold crossing, wrong place and changed guidance reject a frozen draft', () => {
  const crossed = dashboard()
  crossed.forecast.points[1].pm25 = 100
  assert.ok(
    decisionSaveReviewReasons(record(), plan, crossed, place, now).some((x) =>
      x.includes('crossed above'),
    ),
  )
  assert.ok(
    decisionSaveReviewReasons(
      record(),
      plan,
      { ...dashboard(), location: { ...place, name: 'Pune' } },
      place,
      now,
    ).some((x) => x.includes('different selected location')),
  )
  assert.ok(
    decisionSaveReviewReasons(
      record(),
      plan,
      { ...dashboard(), policy: { ...dashboard().policy, version: 'changed' } },
      place,
      now,
    ).some((x) => x.includes('guidance version')),
  )
})

function partialManual(choice) {
  const current = dashboard()
  const context = { ...plan, activities: [{ ...activity, end: '10:00' }] }
  const saved = createDecisionRecord({
    activity: context.activities[0],
    choice,
    snapshot: current,
    plan: context,
    place,
    date: '2030-10-08',
    reason: 'Synthetic manual response to uncertain data',
    now,
  })
  return { current, context, saved }
}

test('R0: unchanged fresh partial manual responses can save but remain unresolved and ineligible', () => {
  for (const choice of ['indoors', 'cancelled', 'outdoors']) {
    const { current, context, saved } = partialManual(choice)
    assert.equal(saved.originalAssessment.coverage, 'partial')
    assert.deepEqual(
      decisionSaveReviewReasons(saved, context, current, place, now),
      [],
    )
    assert.ok(
      decisionReviewReasons(saved, context, current, place, now).some(
        (reason) => reason.includes('only partial PM2.5 coverage'),
      ),
    )
    assert.deepEqual(
      decisionsForReview([saved], '2030-10-08', context, current, place, now)
        .eligible,
      [],
    )
  }
})

test('R0: rescheduled or shortened comparisons still reject unchanged partial chosen windows', () => {
  for (const choice of ['rescheduled', 'shortened']) {
    const { current, context } = partialManual('outdoors')
    const saved = createDecisionRecord({
      activity: context.activities[0],
      choice,
      snapshot: current,
      plan: context,
      place,
      date: '2030-10-08',
      reason: 'Synthetic comparison with a gap',
      start: choice === 'rescheduled' ? '10:00' : '08:30',
      end: choice === 'rescheduled' ? '12:00' : '09:30',
      now,
    })
    assert.equal(saved.chosenAssessment.coverage, 'partial')
    assert.ok(
      decisionSaveReviewReasons(saved, context, current, place, now).some(
        (reason) => reason.includes('only partial PM2.5 coverage'),
      ),
    )
  }
})

test('R0: allowing manual partial records does not bypass later coverage changes or threshold crossings', () => {
  const { current, context, saved } = partialManual('indoors')
  const complete = structuredClone(current)
  complete.forecast.points.push({
    time: '2030-10-08T09:00:00+05:30',
    pm25: 100,
    pm10: 150,
  })
  assert.ok(
    decisionSaveReviewReasons(saved, context, complete, place, now).some(
      (reason) => reason.includes('coverage has changed'),
    ),
  )
  const returnedBelow = structuredClone(current)
  returnedBelow.forecast.points[0].pm25 = 74
  assert.ok(
    decisionSaveReviewReasons(saved, context, returnedBelow, place, now).some(
      (reason) => reason.includes('returned to or below'),
    ),
  )
})

test('F17: local stale-dialog and unsuccessful-retrieval save reasons render in Hindi', () => {
  const later = now + 2 * 3600000 + 1
  const repeatedFresh = dashboard()
  repeatedFresh.forecast.fetchedAt = new Date(later).toISOString()
  const unavailable = {
    ...dashboard(),
    sources: { ...dashboard().sources, forecast: { status: 'unavailable' } },
  }
  for (const reasons of [
    decisionSaveReviewReasons(record(), plan, repeatedFresh, place, later),
    decisionSaveReviewReasons(record(), plan, unavailable, place, now),
  ]) {
    assert.ok(reasons.length > 0)
    for (const reason of reasons) {
      const hindi = reviewReasonLabel(reason, 'hi')
      assert.match(hindi, /[\u0900-\u097f]/)
      assert.doesNotMatch(hindi.replaceAll('PM2.5', ''), /[A-Za-z]/)
      assert.equal(reviewReasonLabel(reason, 'en'), reason)
    }
  }
})
