import assert from 'node:assert/strict'
import { mkdtemp, mkdir, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { activityViews } from '../src/lib/activity-view.ts'
import { createDecisionRecord } from '../src/lib/decision-state.ts'
import { reviewedLocation } from '../src/lib/decision-evidence.ts'
import {
  evaluateReviewAlerts,
  reviewSignals,
} from '../src/lib/review-alerts.ts'

// React server rendering of synthetic acceptance states. This does not claim browser interaction coverage.
const date = '2026-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
const place = {
  name: 'Synthetic Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const activity = {
  id: 'fixture-pe',
  activity: 'Fixture PE',
  place: 'Fixture playground',
  start: '08:00',
  end: '10:00',
  days: [4],
}
const plan = {
  name: 'Fixture plan',
  configured: true,
  threshold: 75,
  ruleMode: 'custom',
  activities: [activity],
}
const dashboard = (points) => ({
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: {
    id: 'b'.repeat(32),
    fetchedAt: new Date(now - 60_000).toISOString(),
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    source: 'Synthetic fixture',
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
    version: 'fixture-policy',
    status: 'reviewed_guidance',
    message: 'Synthetic fixture',
    records: [],
    sources: [],
  },
})
const point = (hour, value) => ({
  time: `${date}T${hour}:00:00+05:30`,
  pm25: value,
  pm10: value,
})
const view = (data, journal = []) =>
  activityViews({
    plan,
    oneOffs: [],
    journal,
    dashboard: data,
    place,
    date,
    now,
  })
const noop = () => {}

const tempBase = join(process.cwd(), '.airday-test-temp')
await mkdir(tempBase, { recursive: true })
const directory = await mkdtemp(join(tempBase, 'timeline-render-'))
const rendererPath = join(directory, 'render.mjs')
await build({
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import ActivityTimeline from './src/components/ActivityTimeline.tsx'; import ReviewAlertList from './src/components/ReviewAlertList.tsx'; import DecisionEditor from './src/components/DecisionEditor.tsx'; export const timeline = props => renderToStaticMarkup(React.createElement(ActivityTimeline, props)); export const inbox = props => renderToStaticMarkup(React.createElement(ReviewAlertList, props)); export const editor = props => renderToStaticMarkup(React.createElement(DecisionEditor, props));`,
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
const { timeline, inbox, editor } = await import(
  pathToFileURL(rendererPath).href
)
test.after(async () => {
  await unlink(rendererPath)
  await rmdir(directory)
})
const renderTimeline = (data, language = 'en', journal = []) =>
  timeline({
    views: view(data, journal),
    language,
    disabled: false,
    onAction: noop,
    onInspect: noop,
    onReopen: noop,
    onFollowThrough: noop,
    date,
    data,
    now,
    onHistory: noop,
    feedback: [],
    locationKey: reviewedLocation(place).key,
    onFeedback: async () => 'saved',
  })
const renderEditor = (points, overrides = {}) =>
  editor({
    activity: {
      ...activity,
      flexible: true,
      allowedStart: '07:00',
      allowedEnd: '15:00',
    },
    choice: 'rescheduled',
    proposedStart: '10:00',
    proposedEnd: '12:00',
    evidenceLabel: 'Synthetic frozen evidence',
    date,
    language: 'en',
    points,
    threshold: 75,
    fetchedAt: new Date(now - 60_000).toISOString(),
    now,
    onClose: noop,
    onSave: async () => {},
    ...overrides,
  })

test('F02 rendered partial low window states full-window uncertainty instead of claiming the whole time is below-rule', () => {
  const markup = renderTimeline(dashboard([point('08', 0)]))
  assert.match(markup, /Incomplete forecast/)
  assert.match(markup, /does not have complete forecast data/)
  assert.match(markup, /Available low values cannot establish/)
  assert.doesNotMatch(markup, /The original window is at or below/)
  assert.match(markup, /available regional PM2.5 peak/)
})

test('F02 rendered partial high window keeps its warning and explicitly describes the missing data', () => {
  const markup = renderTimeline(dashboard([point('08', 90)]))
  assert.match(markup, /Available values exceed your rule/)
  assert.match(markup, /missing forecast data/)
  assert.match(markup, /Incomplete forecast/)
})

test('F17 timeline renders Hindi local re-review reasons while preserving user record reasons', () => {
  const before = dashboard([point('08', 74), point('09', 74)])
  const saved = createDecisionRecord({
    activity,
    choice: 'outdoors',
    snapshot: before,
    plan,
    place,
    date,
    now,
    id: 'render-record',
    reason: 'Keep this user note in its original language',
  })
  const current = dashboard([point('08', 76), point('09', 76)])
  const markup = renderTimeline(current, 'hi', [saved])
  assert.match(markup, /फिर समीक्षा करें/)
  assert.match(markup, /मूल समय के लिए: पूर्वानुमान आपकी समीक्षा सीमा से ऊपर/)
  assert.doesNotMatch(markup, /For the original window: The forecast crossed/)
  assert.match(markup, /Keep this user note in its original language/)
})

test('F17 review inbox renders Hindi deterministic reasons and provides activity-specific dismissal', () => {
  const before = dashboard([point('08', 74), point('09', 74)])
  const saved = createDecisionRecord({
    activity,
    choice: 'outdoors',
    snapshot: before,
    plan,
    place,
    date,
    now,
    id: 'inbox-record',
    reason: 'Synthetic note',
  })
  const current = dashboard([point('08', 76), point('09', 76)])
  const alerts = evaluateReviewAlerts(
    reviewSignals(view(current, [saved]), date, reviewedLocation(place).key),
    [],
  ).alerts
  const markup = inbox({
    alerts,
    language: 'hi',
    disabled: false,
    onDismiss: noop,
    onReview: noop,
  })
  assert.match(markup, /मूल समय के लिए: पूर्वानुमान आपकी समीक्षा सीमा से ऊपर/)
  assert.doesNotMatch(markup, /For the original window: The forecast crossed/)
  assert.match(markup, /aria-label="संदेश हटाएं: Fixture PE"/)
  assert.match(markup, /गतिविधि देखें/)
})

test('F02 decision editor previews the proposed actual window rather than its higher original peak', () => {
  const markup = renderEditor([
    point('08', 100),
    point('09', 100),
    point('10', 40),
    point('11', 20),
  ])
  assert.match(markup, /Chosen-window model peak: 40 µg\/m³ PM2.5/)
  assert.match(markup, /value="10:00"/)
  assert.match(markup, /value="12:00"/)
  assert.doesNotMatch(markup, /Chosen-window model peak: 100/)
  assert.match(markup, /Complete coverage/)
  assert.match(
    markup,
    /at or below your rule; this does not establish safe air/,
  )
  assert.doesNotMatch(markup, /incomplete data cannot establish/)
})

test('F02 decision editor treats complete zero and exact-threshold windows as valid below-rule comparisons', () => {
  for (const value of [0, 75]) {
    const markup = renderEditor([point('10', value), point('11', value)])
    assert.ok(markup.includes(`Chosen-window model peak: ${value} µg/m³ PM2.5`))
    assert.match(markup, /at or below your rule/)
    assert.match(markup, /this does not establish safe air/)
    assert.doesNotMatch(markup, /incomplete data cannot establish/)
  }
})

test('F02 decision editor distinguishes partial or missing chosen data from complete below-rule coverage', () => {
  for (const points of [[], [point('10', 0)]]) {
    const markup = renderEditor(points)
    assert.match(
      markup,
      /incomplete data cannot establish a complete comparison/,
    )
    assert.doesNotMatch(markup, /at or below your rule/)
    assert.match(markup, /No available values|Partial coverage/)
  }
})

test('F02 shortened editor uses its shorter chosen interval and keeps the source evidence label visible', () => {
  const markup = renderEditor([point('08', 100), point('09', 40)], {
    choice: 'shortened',
    proposedStart: '09:00',
    proposedEnd: '09:30',
  })
  assert.match(markup, /Chosen-window model peak: 40 µg\/m³ PM2.5/)
  assert.match(markup, /value="09:00"/)
  assert.match(markup, /value="09:30"/)
  assert.match(markup, /Synthetic frozen evidence/)
})

test('F17 decision editor complete and incomplete preview explanations are correctly distinct in Hindi', () => {
  const complete = renderEditor([point('10', 40), point('11', 40)], {
    language: 'hi',
  })
  assert.match(complete, /चुने समय का मॉडल अधिकतम: 40/)
  assert.match(complete, /आपकी सीमा के बराबर या नीचे/)
  assert.match(complete, /इससे सुरक्षित हवा साबित नहीं होती/)
  assert.doesNotMatch(complete, /अधूरा डेटा पूर्ण तुलना नहीं बताता/)
  const partial = renderEditor([point('10', 40)], { language: 'hi' })
  assert.match(partial, /अधूरा डेटा पूर्ण तुलना नहीं बताता/)
  assert.doesNotMatch(partial, /आपकी सीमा के बराबर या नीचे/)
})

test('F02 every newly rendered indoor editor starts with a fresh unchecked alternative confirmation', () => {
  for (let i = 0; i < 2; i++) {
    const markup = renderEditor([], { choice: 'indoors' })
    const checkbox = markup.match(/<input[^>]*data-field="indoor"[^>]*>/)?.[0]
    assert.ok(checkbox)
    assert.doesNotMatch(checkbox, /checked/)
    assert.match(markup, /Outdoor forecasts do not verify indoor air/)
    assert.match(markup, /maxLength="500"/)
  }
})
