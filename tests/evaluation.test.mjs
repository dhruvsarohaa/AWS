import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, periodForecast, metrics } from '../api/evaluation.mjs'
import {
  alternativeWindows,
  pointsForDate,
  validatePlan,
} from '../src/lib/planner.ts'
import { decisionSummary } from '../src/lib/summary.ts'
import { sharedPlan } from './fixtures.mjs'
const date = '2030-10-08',
  points = [100, 80, 20, 10, 40].map((pm25, index) => ({
    time: `${date}T${String(index + 8).padStart(2, '0')}:00:00+05:30`,
    pm25,
    pm10: 100,
  })),
  now = Date.parse(`${date}T06:00:00+05:30`)
test('alternatives keep duration and allowed times and require complete lower forecasts', () => {
  const activity = sharedPlan.activities[0],
    options = alternativeWindows(
      activity,
      pointsForDate(points, date),
      date,
      75,
      now,
    )
  assert.ok(options.length > 0)
  for (const option of options) {
    assert.equal(option.end.slice(3), option.start.slice(3))
    assert.ok(
      option.start >= activity.allowedStart &&
        option.end <= activity.allowedEnd,
    )
    assert.ok(option.value < 100)
    assert.equal(option.coverage, 'complete')
  }
  assert.deepEqual(
    alternativeWindows({ ...activity, flexible: false }, points, date, 75, now),
    [],
  )
  assert.deepEqual(
    alternativeWindows(activity, pointsForDate([], date), date, 75, now),
    [],
  )
})
test('infeasible flexible windows produce a specific validation error', () =>
  assert.ok(
    validatePlan({
      ...sharedPlan,
      activities: [{ ...sharedPlan.activities[0], allowedEnd: '07:30' }],
    })['walk-allowed-start'],
  ))
test('period mean approximation integrates samples and rejects missing segments', () => {
  const forecast = { points }
  const period = {
    start: `${date}T08:00:00+05:30`,
    end: `${date}T09:00:00+05:30`,
  }
  assert.equal(periodForecast(forecast, period), 90)
  assert.equal(
    periodForecast(
      { points: [{ ...points[0], pm25: null }, points[1]] },
      period,
    ),
    null,
  )
})
test('accuracy metrics report error direction and missed threshold crossings', () => {
  const result = metrics(
    [
      { predicted: 30, observed: 100 },
      { predicted: 100, observed: 40 },
    ],
    75,
  )
  assert.equal(result.bias, -5)
  assert.equal(result.mae, 65)
  assert.equal(result.missedCrossings, 1)
  assert.equal(result.falseCrossings, 1)
})
test('evaluation excludes hindsight forecasts and keeps held-out data separate', () => {
  const period = {
      start: `${date}T08:00:00+05:30`,
      end: `${date}T09:00:00+05:30`,
    },
    forecast = {
      points,
      grid: { latitude: 28.6, longitude: 77.2 },
      unit: 'µg/m³',
      fetchedAt: `${date}T07:00:00+05:30`,
    },
    observation = {
      period,
      pollutant: 'PM2.5',
      statistic: 'mean',
      unit: 'µg/m³',
      value: 100,
      latitude: 28.6,
      longitude: 77.2,
      originId: 'fixture',
      fetchedAt: `${date}T10:00:00+05:30`,
    }
  const report = evaluate([forecast], [observation], {
    threshold: 75,
    cutoff: `${date}T08:30:00+05:30`,
  })
  assert.equal(report.training.count, 0)
  assert.equal(report.holdout.count, 1)
  assert.equal(report.experimentalBiasCandidate.appliedToApp, false)
  const hindsight = evaluate(
    [{ ...forecast, fetchedAt: `${date}T09:30:00+05:30` }],
    [observation],
    { threshold: 75, cutoff: `${date}T08:30:00+05:30` },
  )
  assert.equal(hindsight.holdout.count, 0)
  assert.equal(hindsight.skipped.noProspectiveForecast, 1)
})
test('English/Hindi summaries preserve the reason and do not claim official AQI or orders', () => {
  const record = {
    activity: 'Fixture walk',
    date,
    choice: 'indoors',
    reason: 'SYNTHETIC TEST REASON',
    value: null,
    threshold: 75,
    snapshotId: 'fixture',
  }
  assert.match(decisionSummary(record, 'en'), /not a government order/)
  assert.match(
    decisionSummary(record, 'hi', { includePrivate: true }),
    /SYNTHETIC TEST REASON/,
  )
  assert.match(decisionSummary(record, 'hi'), /सरकारी आदेश नहीं/)
})
