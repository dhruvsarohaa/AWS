import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { concentrationTimeComparison } from '../src/lib/concentration-time.ts'
import {
  createDecisionRecord,
  appendDecision,
  reopenDecision,
} from '../src/lib/decision-state.ts'
import { reviewedLocation } from '../src/lib/decision-evidence.ts'
import {
  createFavorite,
  deleteFavorite,
  renameFavorite,
  upsertFavorite,
} from '../src/lib/favorites.ts'
import { mergeLocalStates } from '../src/lib/local-backup.ts'
import { validLocalState } from '../src/lib/localRepository.ts'
import { activityEstimate } from '../src/lib/periods.ts'
import { FORECAST_MAX_AGE } from '../src/lib/planner.ts'
import { privateRecapExport, recap, validRecapDate } from '../src/lib/recap.ts'
import {
  appendSuggestionFeedback,
  clearReviewedFeedback,
  reviewFeedbackDeletion,
  validSuggestionFeedback,
} from '../src/lib/suggestion-feedback.ts'

// Synthetic offline domain and React-render evidence. No live-data or browser claim.
const date = '2026-10-10',
  now = Date.parse(`${date}T07:00:00+05:30`)
const place = {
  name: 'Synthetic Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const activity = {
  id: 'acceptance-walk',
  activity: 'Private fixture walk',
  place: 'Private grounds',
  start: '08:00',
  end: '10:00',
  days: [6],
  flexible: true,
  allowedStart: '07:00',
  allowedEnd: '13:00',
}
const plan = {
  name: 'Private fixture plan',
  threshold: 75,
  configured: true,
  ruleMode: 'custom',
  activities: [activity],
}
const location = reviewedLocation(place)
const points = () =>
  Array.from({ length: 24 }, (_, h) => ({
    time: `${date}T${String(h).padStart(2, '0')}:00:00+05:30`,
    pm25: h === 8 ? 100 : h === 9 ? 20 : 0,
    pm10: 50,
  }))
const dashboard = () => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: structuredClone(place),
  forecast: {
    id: 'b'.repeat(32),
    fetchedAt: new Date(now - 60_000).toISOString(),
    timezone: 'Asia/Kolkata',
    source: 'Synthetic regional fixture',
    grid: { latitude: 28.6, longitude: 77.2 },
    points: points(),
  },
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    cpcb: { status: 'no_data' },
    openaq: { status: 'no_data' },
  },
})
const record = (id = 'fixture-record', overrides = {}) => ({
  ...createDecisionRecord({
    activity,
    choice: 'rescheduled',
    snapshot: dashboard(),
    plan,
    place,
    date,
    reason: 'Private practical reason',
    start: '10:00',
    end: '11:00',
    now,
    id,
  }),
  ...overrides,
})
const state = (overrides = {}) => ({
  plan: structuredClone(plan),
  journal: [],
  oneOffs: [],
  dismissedAlerts: [],
  language: 'en',
  favorites: [],
  feedback: [],
  ...overrides,
})
const feedback = (overrides = {}) => ({
  id: 'feedback-1',
  assessmentId: 'assessment-1',
  decisionId: 'fixture-record',
  locationKey: location.key,
  date,
  activity: activity.activity,
  at: new Date(now).toISOString(),
  useful: false,
  reason: 'timing',
  note: 'Practical note',
  ...overrides,
})
const compare = (
  data = dashboard(),
  original = { start: '08:00', end: '10:00' },
  chosen = { start: '10:00', end: '11:00' },
  clock = now,
) => concentrationTimeComparison(data, date, original, chosen, clock)

test('F10 hourly hold uses exact fractional overlap and concentration × time units', () => {
  const r = activityEstimate(dashboard(), date, '08:45', '09:30')
  assert.equal(r.total, 35)
  assert.equal(r.duration, 0.75)
  assert.equal(r.covered, 0.75)
  assert.equal(r.complete, true)
})
test('F10 zero is a valid complete chosen estimate, not missing data', () => {
  const r = compare()
  assert.equal(r.originalValue, 120)
  assert.equal(r.chosenValue, 0)
  assert.equal(r.comparable, true)
})
test('F10 an incomplete original withholds its estimate and a complete comparison', () => {
  const d = dashboard()
  d.forecast.points[9].pm25 = null
  const r = compare(d)
  assert.equal(r.originalValue, null)
  assert.equal(r.chosenValue, null)
  assert.equal(r.comparable, false)
})
test('F10 an incomplete chosen window withholds comparison but preserves valid standalone original', () => {
  const d = dashboard()
  d.forecast.points[10].pm25 = null
  const r = compare(d)
  assert.equal(r.originalValue, 120)
  assert.equal(r.chosenValue, null)
  assert.equal(r.comparable, false)
})
test('F10 gaps and duplicate model hours cannot produce a complete estimate', () => {
  for (const mutate of [
    (d) => d.forecast.points.splice(9, 1),
    (d) => d.forecast.points.push(d.forecast.points[8]),
  ]) {
    const d = dashboard()
    mutate(d)
    assert.equal(compare(d).originalValue, null)
  }
})
test('F10 stale or unsuccessful retrieval withholds complete numeric estimates', () => {
  const old = dashboard()
  old.forecast.fetchedAt = new Date(now - FORECAST_MAX_AGE - 1).toISOString()
  for (const d of [
    old,
    ...['stale', 'unavailable', 'pending', 'unverified'].map((status) => ({
      ...dashboard(),
      sources: { ...dashboard().sources, forecast: { status } },
    })),
  ]) {
    const r = compare(d)
    assert.equal(r.originalValue, null)
    assert.equal(r.chosenValue, null)
  }
})
test('F10 invalid clocks, unknown and future retrieval times do not appear current', () => {
  assert.equal(
    compare(dashboard(), undefined, undefined, NaN).originalValue,
    null,
  )
  for (const at of [
    'invalid',
    new Date(now + 1).toISOString(),
    new Date(now + 360000).toISOString(),
  ]) {
    const d = dashboard()
    d.forecast.fetchedAt = at
    assert.equal(compare(d).originalValue, null)
  }
})
test('F10 absent data and malformed activity windows remain withheld without throwing', () => {
  assert.equal(compare(null).originalValue, null)
  for (const [d, a, b] of [
    ['2026-02-30', '08:00', '09:00'],
    [date, '25:00', '26:00'],
    [date, '08:00', '08:00'],
    [date, '10:00', '09:00'],
  ]) {
    assert.equal(activityEstimate(dashboard(), d, a, b).total, null)
  }
})
test('F10 incompatible pollutant metadata cannot be relabeled into PM2.5 estimates', () => {
  const d = dashboard()
  d.forecast.pollutants = {
    pm25: {
      schemaVersion: 1,
      unit: 'ppm',
      source: d.forecast.source,
      statistic: 'model_sample',
      stepMinutes: 60,
      values: d.forecast.points.map((p) => ({ time: p.time, value: p.pm25 })),
    },
  }
  assert.equal(compare(d).originalValue, null)
})
test('F10 indoor and cancelled decisions never invent an indoor dose of zero', () => {
  for (const choice of ['indoors', 'cancelled']) {
    const r = createDecisionRecord({
      activity,
      choice,
      snapshot: dashboard(),
      plan,
      place,
      date,
      reason: 'Fixture indoor review',
      now,
      id: `fixture-${choice}`,
    })
    assert.equal(r.modelEstimate.original, 120)
    assert.equal(r.modelEstimate.chosen, null)
  }
})
test('F10 frozen totals and source metadata stay unchanged after new forecast and timetable edits', () => {
  const d = dashboard(),
    a = structuredClone(activity),
    p = { ...plan, activities: [a] }
  const r = createDecisionRecord({
    activity: a,
    choice: 'rescheduled',
    snapshot: d,
    plan: p,
    place,
    date,
    reason: 'Fixture',
    start: '10:00',
    end: '11:00',
    now,
    id: 'frozen',
  })
  d.forecast.points[8].pm25 = 999
  a.start = '09:00'
  p.threshold = 5
  assert.equal(r.modelEstimate.original, 120)
  assert.equal(r.modelEstimate.chosen, 0)
  assert.equal(r.originalWindow.start, '08:00')
  assert.equal(r.threshold, 75)
})
test('F10 stale retained source produces no frozen comparable modeled totals', () => {
  const d = dashboard()
  d.sources.forecast.status = 'stale'
  const r = createDecisionRecord({
    activity,
    choice: 'rescheduled',
    snapshot: d,
    plan,
    place,
    date,
    reason: 'Fixture',
    start: '10:00',
    end: '11:00',
    now,
    id: 'old',
  })
  assert.equal(r.modelEstimate.original, null)
  assert.equal(r.modelEstimate.chosen, null)
})

test('F09 latest decision replaces the prior dated choice instead of counting it twice', () => {
  const rows = appendDecision(
      [record('old')],
      record('new', { followThrough: 'completed' }),
    ),
    r = recap(rows, date, date, location.key)
  assert.equal(r.rows.length, 1)
  assert.equal(r.recorded.length, 1)
  assert.equal(r.reviewedScheduledMinutes, 120)
  assert.equal(r.chosenOutdoorMinutes, 60)
  assert.equal(r.reportedActions, 1)
})
test('F09 reopening the latest choice excludes its minutes without reviving superseded work', () => {
  const rows = reopenDecision(
      appendDecision([record('old')], record('new')),
      'new',
      now + 1,
    ),
    r = recap(rows, date, date, location.key)
  assert.equal(r.recorded.length, 0)
  assert.equal(r.unresolved, 1)
  assert.equal(r.chosenOutdoorMinutes, 0)
})
test('F09 canonical journal order is authoritative even when record clocks disagree', () => {
  const rows = [
    record('old', { at: new Date(now + 1000).toISOString() }),
    record('new', {
      at: new Date(now - 1000).toISOString(),
      choice: 'indoors',
    }),
  ]
  assert.equal(recap(rows, date, date, location.key).rows[0].id, 'new')
  assert.equal(recap(rows, date, date, location.key).chosenOutdoorMinutes, 0)
})
test('F09 place/date range filtering excludes unrelated retained choices', () => {
  const r = recap(
    [
      record(),
      record('elsewhere', { location: { ...location, key: 'c'.repeat(32) } }),
      record('yesterday', { date: '2026-10-09' }),
    ],
    date,
    date,
    location.key,
  )
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].id, 'fixture-record')
})
test('F09 weekly recap keeps distinct dated instances of the same activity', () => {
  const r = recap(
    [
      record(),
      record('yesterday', { date: '2026-10-09', followThrough: 'changed' }),
    ],
    '2026-10-04',
    date,
    location.key,
  )
  assert.equal(r.recorded.length, 2)
  assert.equal(r.changed, 1)
  assert.equal(r.unconfirmed, 1)
})
test('F09 empty or invalid ranges say no retained decisions rather than a measured daily total', () => {
  for (const [from, to] of [
    [date, date],
    ['2026-02-30', date],
    [date, '2026-10-09'],
  ]) {
    const r = recap([], from, to, location.key)
    assert.equal(r.rows.length, 0)
    assert.equal(r.reportedActions, 0)
  }
  assert.equal(validRecapDate('2026-02-30'), false)
  assert.equal(validRecapDate('2028-02-29'), true)
})
test('F09 missing chosen time is unknown, never backfilled with original scheduled minutes', () => {
  const r = recap(
    [record('legacy', { chosenWindow: undefined })],
    date,
    date,
    location.key,
  )
  assert.equal(r.recorded.length, 1)
  assert.equal(r.chosenOutdoorMinutes, 0)
  assert.equal(r.unknownPlannedMinutes, 1)
})
test('F09 older unscoped or incomplete records cannot count as fully reviewed activities', () => {
  const r = recap(
    [
      record('older', { originalWindow: undefined }),
      record('unscoped', { location: undefined }),
    ],
    date,
    date,
    location.key,
  )
  assert.equal(r.recorded.length, 0)
  assert.equal(r.unresolved, 1)
})
test('F20 reported completed actions count planned minutes separately from actual measured activity', () => {
  const r = recap(
    [
      record('one', { followThrough: 'completed' }),
      record('two', {
        activityId: 'other',
        choice: 'indoors',
        followThrough: 'completed',
      }),
      record('three', { activityId: 'changed', followThrough: 'changed' }),
    ],
    date,
    date,
    location.key,
  )
  assert.equal(r.reportedActions, 2)
  assert.equal(r.reportedPlannedOutdoorMinutes, 60)
  assert.equal(r.changed, 1)
  assert.equal('actualMinutes' in r, false)
})
test('F20 private recap exports frozen record provenance but no coordinates or nested raw records', () => {
  const rows = [record()],
    exported = privateRecapExport(rows, date, date, location, [feedback()]),
    serialized = JSON.stringify(exported)
  assert.equal(exported.records[0].snapshotId, 'a'.repeat(32))
  assert.equal(exported.records[0].modelEstimate.original, 120)
  assert.equal(exported.feedback.length, 1)
  assert.doesNotMatch(
    serialized,
    /latitude|longitude|accuracyMeters|detectedAt|28\.6139|77\.209/,
  )
  exported.records[0].originalWindow.start = '12:00'
  assert.equal(rows[0].originalWindow.start, '08:00')
})
test('F20 private recap exports only feedback for its selected place/date range', () => {
  const exported = privateRecapExport([], date, date, location, [
    feedback(),
    feedback({
      id: 'elsewhere',
      assessmentId: 'other',
      locationKey: 'c'.repeat(32),
    }),
    feedback({ id: 'old', assessmentId: 'older', date: '2026-10-09' }),
  ])
  assert.deepEqual(
    exported.feedback.map((f) => f.id),
    ['feedback-1'],
  )
})

test('F19 local feedback accepts valid zero-upload bounded free text and useful=false', () => {
  const f = feedback({ note: 'x'.repeat(300) })
  assert.equal(validSuggestionFeedback(f), true)
  const rows = appendSuggestionFeedback([], f)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].useful, false)
  assert.equal(rows[0].note.length, 300)
})
test('F19 empty identifiers, malformed dates, bad enum/boolean and oversized context are rejected', () => {
  for (const patch of [
    { id: '' },
    { assessmentId: '' },
    { activity: ' ' },
    { decisionId: '' },
    { date: '2026-02-30' },
    { date: 'invalid' },
    { at: 'invalid' },
    { reason: 'diagnosis' },
    { useful: 'yes' },
    { note: 'x'.repeat(301) },
    { activity: 'x'.repeat(101) },
    { assessmentId: 'x'.repeat(301) },
    { locationKey: 'coords' },
  ])
    assert.equal(
      validSuggestionFeedback(feedback(patch)),
      false,
      JSON.stringify(patch),
    )
})
test('F19 repeated ID or assessment submit refuses without altering existing feedback', () => {
  const original = [feedback()],
    before = structuredClone(original)
  for (const f of [
    feedback({ id: 'next' }),
    feedback({ assessmentId: 'next' }),
  ])
    assert.throws(
      () => appendSuggestionFeedback(original, f),
      /already retained/,
    )
  assert.deepEqual(original, before)
})
test('F19 capacity rejects the 201st entry without dropping old feedback', () => {
  const original = Array.from({ length: 200 }, (_, i) =>
    feedback({ id: `f-${i}`, assessmentId: `a-${i}` }),
  )
  assert.throws(
    () =>
      appendSuggestionFeedback(
        original,
        feedback({ id: 'new', assessmentId: 'new' }),
      ),
    /limit reached/,
  )
  assert.equal(original.length, 200)
})
test('F19 appended entry whitelists context fields and trims the bounded note', () => {
  const rows = appendSuggestionFeedback(
    [],
    feedback({
      note: '  Practical note  ',
      latitude: place.latitude,
      healthDetails: 'extra',
    }),
  )
  assert.equal(rows[0].note, 'Practical note')
  assert.equal('latitude' in rows[0], false)
  assert.equal('healthDetails' in rows[0], false)
})
test('F19 conflicting duplicate assessment backups cannot silently merge into two submissions', () => {
  const a = state({ feedback: [feedback()] }),
    b = state({ feedback: [feedback({ id: 'different' })] })
  assert.equal(validLocalState(a), true)
  assert.throws(() => mergeLocalStates(a, b), /limit|conflicting|invalid/i)
  assert.equal(a.feedback.length, 1)
})
test('F19 repository validation rejects empty feedback context in stored or imported state', () => {
  for (const patch of [
    { id: '' },
    { assessmentId: '' },
    { decisionId: '' },
    { activity: ' ' },
  ])
    assert.equal(validLocalState(state({ feedback: [feedback(patch)] })), false)
})
test('F19 repository accepts feedback matching its retained dated decision', () => {
  assert.equal(
    validLocalState(state({ journal: [record()], feedback: [feedback()] })),
    true,
  )
})
test('F19 repository refuses feedback naming an existing decision from another date, place or activity', () => {
  for (const patch of [
    { date: '2026-10-09' },
    { locationKey: 'c'.repeat(32) },
    { activity: 'Another activity' },
  ])
    assert.equal(
      validLocalState(
        state({ journal: [record()], feedback: [feedback(patch)] }),
      ),
      false,
    )
})
test('F19 valid local feedback survives deletion or retention expiry of its referenced decision', () => {
  const retainedFeedback = feedback()
  assert.equal(
    validLocalState(state({ journal: [], feedback: [retainedFeedback] })),
    true,
  )
  assert.equal(
    validLocalState(
      state({ journal: [], feedback: [feedback({ decisionId: undefined })] }),
    ),
    true,
  )
})
test('F19 a backup merge cannot introduce conflicting feedback/decision context', () => {
  const a = state({ journal: [record()] }),
    b = state({ feedback: [feedback({ date: '2026-10-09' })] })
  assert.equal(validLocalState(a), true)
  assert.equal(validLocalState(b), true)
  assert.throws(() => mergeLocalStates(a, b), /invalid|conflicting/i)
  assert.equal(a.feedback.length, 0)
  assert.equal(b.feedback.length, 1)
})
test('F20 explicit reviewed feedback deletion leaves journal, plans and favorites intact', () => {
  const current = state({
      journal: [record()],
      feedback: [feedback()],
      favorites: [createFavorite(place, 'Home area')],
    }),
    reviewed = reviewFeedbackDeletion(current)
  const cleared = clearReviewedFeedback(current, reviewed)
  assert.equal(cleared.feedback.length, 0)
  assert.deepEqual(cleared.journal, current.journal)
  assert.deepEqual(cleared.favorites, current.favorites)
  assert.deepEqual(cleared.plan, current.plan)
  assert.equal(current.feedback.length, 1)
})
test('F20 changed state cannot be deleted using an outdated confirmation snapshot', () => {
  const current = state({ feedback: [feedback()] }),
    reviewed = reviewFeedbackDeletion(current)
  current.feedback.push(feedback({ id: 'new', assessmentId: 'new' }))
  assert.throws(() => clearReviewedFeedback(current, reviewed), /changed/)
  assert.equal(current.feedback.length, 2)
  assert.equal(reviewed.feedback.length, 1)
})

test('F04 favorites retain only rounded coordinates and a stable coarse identity', () => {
  const f = createFavorite(
    {
      ...place,
      detected: true,
      accuracyMeters: 4,
      detectedAt: new Date(now).toISOString(),
    },
    '  Home  ',
  )
  assert.equal(f.place.latitude, 28.6)
  assert.equal(f.place.longitude, 77.2)
  assert.equal(f.label, 'Home')
  assert.equal(f.id, reviewedLocation(f.place).key)
  assert.equal('detected' in f.place, false)
  assert.equal('accuracyMeters' in f.place, false)
  assert.equal('detectedAt' in f.place, false)
})
test('F04 unconfirmed/outside-India selections and blank/oversized names cannot save', () => {
  for (const p of [
    { ...place, confirmed: false },
    { ...place, country: 'Other' },
    { ...place, latitude: 0 },
    { ...place, longitude: NaN },
  ])
    assert.throws(() => createFavorite(p, 'Area'))
  for (const name of [' ', 'x'.repeat(81)])
    assert.throws(() => createFavorite(place, name))
})
test('F04 five-area limit allows an existing-area rename without changing list order', () => {
  const favorites = Array.from({ length: 5 }, (_, i) =>
      createFavorite(
        { ...place, name: `Area ${i}`, latitude: 28 + i },
        `Label ${i}`,
      ),
    ),
    before = structuredClone(favorites)
  const renamed = renameFavorite(favorites, favorites[2].id, 'New label')
  assert.equal(renamed.length, 5)
  assert.deepEqual(
    renamed.map((f) => f.id),
    favorites.map((f) => f.id),
  )
  assert.equal(renamed[2].label, 'New label')
  assert.deepEqual(favorites, before)
  assert.throws(
    () =>
      upsertFavorite(
        favorites,
        createFavorite({ ...place, name: 'Sixth' }, 'Sixth'),
      ),
    /Five/,
  )
})
test('F04 malformed precise/GPS favorite cannot bypass coarse-only save contract', () => {
  const f = createFavorite(place, 'Area')
  for (const bad of [
    { ...f, id: 'bad' },
    { ...f, place: { ...f.place, latitude: 28.6139 } },
    { ...f, place: { ...f.place, detected: true } },
  ])
    assert.throws(() => upsertFavorite([], bad))
})
test('F04 deleting a favorite frees a slot while leaving original decisions untouched', () => {
  const favorites = [createFavorite(place, 'Area')],
    journal = [record()],
    next = deleteFavorite(favorites, favorites[0].id)
  assert.equal(next.length, 0)
  assert.equal(favorites.length, 1)
  assert.equal(journal[0].location.key, location.key)
  assert.notEqual(location.key, favorites[0].id)
})
test('F04 backup merge preserves non-overlapping favorites but rejects conflicting names', () => {
  const home = createFavorite(place, 'Home'),
    work = createFavorite(
      { ...place, name: 'Work area', latitude: 28.7 },
      'Work',
    )
  const a = state({ favorites: [home] }),
    b = state({ favorites: [work] }),
    merged = mergeLocalStates(a, b)
  assert.equal(merged.favorites.length, 2)
  assert.deepEqual(a.favorites, [home])
  assert.throws(
    () =>
      mergeLocalStates(
        a,
        state({ favorites: [{ ...home, label: 'Different' }] }),
      ),
    /differs/,
  )
})

const tempBase = join(process.cwd(), '.airday-test-temp')
await mkdir(tempBase, { recursive: true })
const temp = await mkdtemp(join(tempBase, 'r2-personal-render-')),
  rendererPath = join(temp, 'render.mjs')
await build({
  stdin: {
    contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import PersonalProgress from './src/components/PersonalProgress.tsx';import FavoritePlaces from './src/components/FavoritePlaces.tsx';import SuggestionFeedback from './src/components/SuggestionFeedback.tsx';import ActivityTimeline from './src/components/ActivityTimeline.tsx';import {activityViews} from './src/lib/activity-view.ts';export const progress = props => renderToStaticMarkup(React.createElement(PersonalProgress,props));export const favorites = props => renderToStaticMarkup(React.createElement(FavoritePlaces,props));export const feedback = props => renderToStaticMarkup(React.createElement(SuggestionFeedback,props));export const timeline = props => renderToStaticMarkup(React.createElement(ActivityTimeline,{...props,views:activityViews(props)}));`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: rendererPath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom/*'],
  logLevel: 'silent',
})
const render = await import(pathToFileURL(rendererPath).href)
test.after(async () => {
  await unlink(rendererPath)
  await rmdir(temp)
})
const noop = () => {}
test('F09/F20 empty recap and Hindi privacy labels are available as readable text', () => {
  const html = render.progress({
    state: state(),
    place,
    language: 'hi',
    disabled: false,
    onCommit: noop,
  })
  assert.match(html, /दैनिक और साप्ताहिक सारांश/)
  assert.match(html, /पहले गतिविधि की समीक्षा करें/)
  assert.match(html, /निर्देशांक नहीं/)
})
test('F19 feedback free text is escaped, never executed as markup', () => {
  const f = feedback({
    note: '<script>alert(1)</script><img src=x onerror=alert(2)>',
  })
  const html = render.feedback({
    ...f,
    feedback: [f],
    disabled: false,
    language: 'en',
    onSave: noop,
  })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>|<img src=x/)
  assert.match(html, /Stored locally; not uploaded/)
})
test('F04 rounded favorite context warning and confirmed-location requirement are visible', () => {
  const html = render.favorites({
    places: [],
    place: { ...place, confirmed: false },
    data: null,
    language: 'en',
    disabled: false,
    onSave: noop,
    onSelect: noop,
  })
  assert.match(html, /Confirm a location first/)
  assert.match(html, /own review context/)
  assert.match(html, /original location in History/)
})
test('F10 rescheduled timeline compares original with chosen rather than chosen with itself', () => {
  const html = render.timeline({
    plan,
    oneOffs: [],
    journal: [record()],
    dashboard: dashboard(),
    data: dashboard(),
    place,
    date,
    now,
    language: 'en',
    disabled: false,
    feedback: [],
    locationKey: location.key,
    onFeedback: noop,
    onAction: noop,
    onInspect: noop,
    onReopen: noop,
    onFollowThrough: noop,
    onHistory: noop,
  })
  assert.match(html, /08:00–10:00: 120\.0/)
  assert.match(html, /10:00–11:00: 0\.0/)
  assert.match(html, /estimate reviewed earlier stays frozen in History/)
})
