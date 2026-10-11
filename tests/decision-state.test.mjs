import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendDecision,
  createDecisionRecord,
  decisionsForReview,
  reopenDecision,
} from '../src/lib/decision-state.ts'
import { currentDecision } from '../src/lib/decision-evidence.ts'
import {
  DECISION_STATE_KEY,
  readJournal,
  writeDecisionDocument,
} from '../src/lib/storage.ts'
import { decisionSummary } from '../src/lib/summary.ts'
import { FORECAST_MAX_AGE } from '../src/lib/planner.ts'

// Synthetic, offline regression fixtures. No provider requests or production imports.
const date = '2026-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
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
  id: 'pe',
  activity: 'Synthetic PE',
  place: 'Fixture playground',
  start: '08:00',
  end: '09:00',
  days: [4],
  flexible: true,
  allowedStart: '07:00',
  allowedEnd: '12:00',
  indoorAvailable: true,
}
const plan = {
  name: 'Synthetic school',
  configured: true,
  ruleMode: 'custom',
  threshold: 75,
  activities: [activity],
}
const dashboard = (place = delhi, original = 90, chosen = 40) => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: {
    id: 'b'.repeat(32),
    fetchedAt: new Date(now - 60000).toISOString(),
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    source: 'Synthetic fixture',
    points: [
      { time: `${date}T08:00:00+05:30`, pm25: original, pm10: 110 },
      { time: `${date}T10:00:00+05:30`, pm25: chosen, pm10: 70 },
    ],
  },
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    cpcb: { status: 'no_data' },
    openaq: { status: 'no_data' },
  },
  policy: {
    date,
    version: 'fixture-policy',
    status: 'reviewed_guidance',
    message: 'Synthetic policy',
    records: [],
    sources: [],
  },
})
const record = (overrides = {}) =>
  createDecisionRecord({
    activity,
    choice: 'rescheduled',
    snapshot: dashboard(),
    plan,
    place: delhi,
    date,
    reason: 'Synthetic review reason',
    start: '10:00',
    end: '11:00',
    now,
    id: 'first',
    ...overrides,
  })
const state = (rows, place = delhi, data = dashboard(), clock = now) =>
  decisionsForReview(rows, date, plan, data, place, clock)
function memoryStorage() {
  const values = new Map(),
    writes = []
  let blocked = false
  return {
    values,
    writes,
    block(value) {
      blocked = value
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      writes.push(key)
      if (blocked) throw new Error('Synthetic quota failure')
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('record construction retains distinct original and chosen assessments without changing its snapshot', () => {
  const evidence = dashboard(),
    before = structuredClone(evidence)
  const saved = record({ snapshot: evidence })
  assert.deepEqual(saved.originalWindow, { start: '08:00', end: '09:00' })
  assert.deepEqual(saved.chosenWindow, { start: '10:00', end: '11:00' })
  assert.equal(saved.originalAssessment.value, 90)
  assert.equal(saved.originalAssessment.review, true)
  assert.equal(saved.chosenAssessment.value, 40)
  assert.equal(saved.chosenAssessment.review, false)
  assert.equal(saved.value, 40)
  assert.equal(saved.policyStatus, 'reviewed_guidance')
  assert.equal(saved.location.latitude, 28.6)
  assert.equal(saved.location.longitude, 77.2)
  assert.deepEqual(evidence, before)
  assert.equal(state([saved]).eligible.length, 1)
})

test('saved decisions reload in their reviewed location and cannot become another city or coordinate choice', () => {
  const storage = memoryStorage(),
    saved = record()
  assert.equal(writeDecisionDocument([saved], storage), true)
  const reloaded = readJournal(storage)
  assert.equal(state(reloaded).eligible[0].id, saved.id)
  const otherCity = state(reloaded, pune, dashboard(pune))
  assert.equal(otherCity.current.length, 0)
  assert.equal(otherCity.eligible.length, 0)
  assert.equal(otherCity.historical[0].location.name, delhi.name)
  const moved = { ...delhi, latitude: delhi.latitude + 0.001 }
  assert.equal(state(reloaded, moved, dashboard(moved)).current.length, 0)
  assert.equal(state(reloaded).current[0].id, saved.id)
})

test('an unconfirmed location preview cannot share or submit a saved decision', () => {
  const preview = { ...delhi, confirmed: false }
  assert.equal(
    state([record()], preview, dashboard(preview)).eligible.length,
    0,
  )
})

test('chosen-window threshold crossings remove summary and submission eligibility in either direction', () => {
  for (const [previous, next] of [
    [74, 76],
    [76, 74],
  ]) {
    const saved = record({ snapshot: dashboard(delhi, 90, previous) })
    assert.equal(
      state([saved], delhi, dashboard(delhi, 90, previous)).eligible.length,
      1,
    )
    const changed = state([saved], delhi, dashboard(delhi, 90, next))
    assert.equal(changed.current[0].id, saved.id)
    assert.equal(changed.eligible.length, 0)
  }
})

test('forecast aging and guidance status changes remove current decision eligibility', () => {
  const saved = record(),
    evidence = dashboard()
  assert.equal(
    state([saved], delhi, evidence, now + FORECAST_MAX_AGE).eligible.length,
    0,
  )
  evidence.policy.status = 'verification_needed'
  assert.equal(state([saved], delhi, evidence).eligible.length, 0)
})

test('reopening survives reload and blocks old choices, summaries and submission until a fresh record', () => {
  const storage = memoryStorage(),
    first = record()
  const second = record({
    id: 'second',
    choice: 'indoors',
    reason: 'Synthetic replacement reason',
  })
  const replaced = appendDecision([first], second)
  assert.equal(replaced[0].lifecycle, 'superseded')
  assert.equal(replaced[0].supersededBy, 'second')
  const reopened = reopenDecision(replaced, 'second', now + 1000)
  assert.equal(writeDecisionDocument(reopened, storage), true)
  const reloaded = readJournal(storage)
  assert.equal(currentDecision(reloaded, date, activity.id, delhi), undefined)
  assert.equal(state(reloaded).current.length, 0)
  assert.equal(state(reloaded).eligible.length, 0)
  assert.equal(reloaded[1].choice, 'indoors')
  assert.equal(reloaded[1].lifecycle, 'reopened')
  assert.equal(reloaded[1].reason, 'Synthetic replacement reason')
  const next = appendDecision(reloaded, record({ id: 'third' }))
  assert.equal(state(next).eligible[0].id, 'third')
  assert.equal(next[1].lifecycle, 'reopened')
})

test('one failed write cannot partially persist a new action, reason or evidence', () => {
  const storage = memoryStorage(),
    first = record()
  storage.values.set(
    'airday-decisions',
    JSON.stringify({ [`${date}:pe`]: 'cancelled' }),
  )
  assert.equal(writeDecisionDocument([first], storage), true)
  const bytes = storage.values.get(DECISION_STATE_KEY)
  const next = appendDecision(
    [first],
    record({
      id: 'second',
      choice: 'indoors',
      reason: 'Synthetic second reason',
    }),
  )
  storage.block(true)
  assert.equal(writeDecisionDocument(next, storage), false)
  assert.equal(storage.values.get(DECISION_STATE_KEY), bytes)
  assert.deepEqual(storage.writes, [DECISION_STATE_KEY, DECISION_STATE_KEY])
  assert.equal(state(next).current[0].choice, 'indoors') // Complete session-only state.
  assert.equal(state(readJournal(storage)).current[0].choice, 'rescheduled')
  assert.equal(readJournal(storage)[0].reason, first.reason)
  storage.block(false)
  assert.equal(writeDecisionDocument(next, storage), true)
  assert.equal(
    state(readJournal(storage)).current[0].reason,
    'Synthetic second reason',
  )
})

test('failed reopening persistence retains a coherent prior record after reload and supports retry', () => {
  const storage = memoryStorage(),
    saved = record()
  writeDecisionDocument([saved], storage)
  const reopened = reopenDecision([saved], saved.id, now + 1000)
  storage.block(true)
  assert.equal(writeDecisionDocument(reopened, storage), false)
  assert.equal(state(reopened).eligible.length, 0)
  assert.equal(state(readJournal(storage)).eligible[0].id, saved.id)
  storage.block(false)
  assert.equal(writeDecisionDocument(reopened, storage), true)
  assert.equal(state(readJournal(storage)).eligible.length, 0)
})

test('legacy unscoped history stays exportable but old split choices cannot establish current decisions', () => {
  const storage = memoryStorage(),
    legacy = record()
  for (const key of [
    'location',
    'originalWindow',
    'chosenWindow',
    'originalAssessment',
    'chosenAssessment',
    'policyStatus',
    'lifecycle',
  ])
    delete legacy[key]
  storage.values.set('airday-journal', JSON.stringify([legacy]))
  storage.values.set(
    'airday-decisions',
    JSON.stringify({ [`${date}:pe`]: 'outdoors' }),
  )
  const rows = readJournal(storage)
  assert.equal(rows.length, 1)
  assert.equal(state(rows).eligible.length, 0)
  assert.equal(state(rows).historical[0].id, legacy.id)
  writeDecisionDocument(rows, storage)
  assert.equal(readJournal(storage)[0].location, undefined)
  writeDecisionDocument([], storage)
  assert.deepEqual(readJournal(storage), [])
})

test('invalid canonical state cannot drop a tombstone and resurrect an older action or legacy key', () => {
  for (const canonical of [
    '',
    '{broken',
    JSON.stringify({ schemaVersion: 2, records: [record()] }),
    JSON.stringify({
      schemaVersion: 3,
      records: [
        record(),
        {
          ...record({ id: 'second' }),
          lifecycle: 'reopened',
          location: { key: 'invalid' },
        },
      ],
    }),
  ]) {
    const storage = memoryStorage()
    storage.values.set('airday-journal', JSON.stringify([record()]))
    storage.values.set(DECISION_STATE_KEY, canonical)
    assert.deepEqual(readJournal(storage), [])
    assert.equal(storage.values.get(DECISION_STATE_KEY), canonical)
    assert.equal(writeDecisionDocument([record({ id: 'new' })], storage), false)
    assert.equal(storage.values.get(DECISION_STATE_KEY), canonical)
  }
})

test('English and Hindi summaries distinguish chosen and original peaks and retain reviewed place', () => {
  const saved = record()
  const english = decisionSummary(saved, 'en', { includePrivate: true })
  assert.match(english, /Location: Fixture Delhi, Delhi/)
  assert.match(english, /original window: 90 µg\/m³/)
  assert.match(english, /chosen window: 40 µg\/m³/)
  assert.match(english, /Chosen time: 10:00–11:00 IST/)
  assert.match(decisionSummary(saved, 'hi'), /चुनी गई अवधि.*: 40 µg\/m³/)
  const missing = {
    ...saved,
    originalAssessment: { ...saved.originalAssessment, value: null },
    chosenAssessment: { ...saved.chosenAssessment, value: 40 },
  }
  assert.match(decisionSummary(missing, 'en'), /original window: unavailable/)
})
