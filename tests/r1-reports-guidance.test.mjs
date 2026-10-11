import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decisionCsv, reportDetails } from '../src/lib/reports.ts'
import { decisionSummary } from '../src/lib/summary.ts'
import { planningGuidance } from '../src/lib/guidance.ts'
import { activityViews } from '../src/lib/activity-view.ts'
import {
  createDecisionRecord,
  appendDecision,
  reopenDecision,
} from '../src/lib/decision-state.ts'

// Synthetic, offline acceptance fixtures. No network, provider secrets or AWS.
const date = '2030-10-08'
const now = Date.parse(`${date}T07:00:00+05:30`)
const place = {
  name: 'Private fixture place',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const activity = {
  id: 'fixture-activity',
  activity: 'Private fixture activity',
  place: 'Private fixture room',
  start: '08:00',
  end: '09:00',
  days: [2],
  flexible: true,
  allowedStart: '08:00',
  allowedEnd: '12:00',
  indoorAvailable: true,
}
const plan = {
  name: 'Private fixture plan',
  threshold: 75,
  activities: [activity],
  configured: true,
  ruleMode: 'custom',
}
const dashboard = (pm25 = 90) => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: {
    id: 'b'.repeat(32),
    source: 'SYNTHETIC FIXTURE FORECAST',
    fetchedAt: new Date(now).toISOString(),
    timezone: 'Asia/Kolkata',
    grid: { latitude: 28.6, longitude: 77.2 },
    points: Array.from({ length: 5 }, (_, i) => ({
      time: `${date}T${String(i + 8).padStart(2, '0')}:00:00+05:30`,
      pm25: i ? 40 : pm25,
      pm10: 100,
    })),
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
    status: 'verification_needed',
    message: 'Synthetic unverified policy',
    records: [],
    sources: [],
  },
})
function record(overrides = {}) {
  return createDecisionRecord({
    activity,
    choice: 'rescheduled',
    snapshot: dashboard(),
    plan,
    place,
    date,
    reason: 'Private fixture reason',
    start: '10:00',
    end: '11:00',
    now,
    id: 'fixture-record',
    ...overrides,
  })
}
function views(data = dashboard(), overrides = {}) {
  return activityViews({
    plan,
    oneOffs: [],
    journal: [],
    dashboard: data,
    place,
    date,
    now,
    ...overrides,
  })
}
// Parse actual quoted CSV, including embedded quotes, CRLF and multiline cells.
function parseCsv(text) {
  const rows = [],
    row = []
  let value = '',
    quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if (char === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(value)
      rows.push([...row])
      row.length = 0
      value = ''
      i++
    } else value += char
  }
  row.push(value)
  rows.push(row)
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(rows[0].map((key, i) => [key, values[i]])),
    )
}

const tempBase = join(process.cwd(), '.airday-test-temp')
await mkdir(tempBase, { recursive: true })
const tempDirectory = await mkdtemp(join(tempBase, 'report-render-'))
const rendererPath = join(tempDirectory, 'render.mjs')
await build({
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import HistoryView, { FrozenReport } from './src/components/HistoryView.tsx'; import GuidanceCard from './src/components/GuidanceCard.tsx'; export const reportMarkup = props => renderToStaticMarkup(React.createElement(FrozenReport, props)); export const historyMarkup = props => renderToStaticMarkup(React.createElement(HistoryView, props)); export const guidanceMarkup = props => renderToStaticMarkup(React.createElement(GuidanceCard, props));`,
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
const { reportMarkup, historyMarkup, guidanceMarkup } = await import(
  pathToFileURL(rendererPath).href
)
test.after(async () => {
  await unlink(rendererPath)
  await rmdir(tempDirectory)
})

test('F08 CSV, print and text summaries omit private labels/reasons by default and always exclude coordinates', () => {
  const saved = record()
  for (const output of [
    decisionCsv([saved]),
    decisionSummary(saved, 'en'),
    decisionSummary(saved, 'hi'),
    reportMarkup({ record: saved, language: 'en', sessionOnly: false }),
  ]) {
    for (const privateValue of [
      activity.activity,
      plan.name,
      place.name,
      saved.reason,
      place.latitude.toString(),
      place.longitude.toString(),
      saved.location.latitude.toString(),
      saved.location.longitude.toString(),
      saved.location.areaId,
    ])
      assert.ok(
        !output.includes(privateValue),
        `Private field leaked: ${privateValue}`,
      )
    assert.ok(output.includes(date))
    assert.ok(output.includes(saved.snapshotId))
  }
  const optedIn = [
    decisionCsv([saved], { includePrivate: true }),
    decisionSummary(saved, 'en', { includePrivate: true }),
    reportMarkup({
      record: saved,
      language: 'hi',
      sessionOnly: false,
      includePrivate: true,
    }),
  ]
  for (const output of optedIn) {
    for (const retained of [
      activity.activity,
      plan.name,
      place.name,
      saved.reason,
    ])
      assert.ok(output.includes(retained))
    assert.ok(!output.includes(saved.location.areaId))
  }
  const markup = historyMarkup({
    journal: [saved],
    language: 'en',
    sessionOnly: false,
    initialRecordId: saved.id,
  })
  assert.match(markup, /type="checkbox"/)
  assert.doesNotMatch(markup, /type="checkbox"[^>]*checked/)
  assert.doesNotMatch(markup, /class="print-report"[^>]*aria-hidden/)
  assert.match(
    markup,
    /Include private activity, plan and place names and my reasons in exports/,
  )
})

test('F08 frozen CSV/print/summary retain distinct windows, peaks, source, coverage and lifecycle after edits and reopening', () => {
  const mutablePlan = structuredClone(plan)
  const saved = record({ plan: mutablePlan })
  const csvBefore = decisionCsv([saved], { includePrivate: true })
  const printBefore = reportMarkup({
    record: saved,
    language: 'en',
    sessionOnly: false,
    includePrivate: true,
  })
  assert.equal([...printBefore.matchAll(/Recent retrieval at review/g)].length, 3)
  assert.doesNotMatch(printBefore, /Recent retrieval at review at review/)
  assert.doesNotMatch(
    reportMarkup({ record: saved, language: 'hi', sessionOnly: false }),
    /समीक्षा के समय ताज़ा डेटा समीक्षा के समय/,
  )
  mutablePlan.name = 'Changed current plan'
  mutablePlan.activities[0].activity = 'Changed current activity'
  mutablePlan.activities[0].start = '12:00'
  mutablePlan.threshold = 10
  assert.equal(decisionCsv([saved], { includePrivate: true }), csvBefore)
  assert.equal(
    reportMarkup({
      record: saved,
      language: 'en',
      sessionOnly: false,
      includePrivate: true,
    }),
    printBefore,
  )
  const parsed = parseCsv(csvBefore)[0]
  assert.equal(parsed.original_start_IST, '08:00')
  assert.equal(parsed.chosen_start_IST, '10:00')
  assert.equal(parsed.original_peak_ug_m3, '90')
  assert.equal(parsed.chosen_peak_ug_m3, '40')
  assert.equal(parsed.original_coverage, 'complete')
  assert.equal(parsed.forecast_source, 'SYNTHETIC FIXTURE FORECAST')
  assert.equal(parsed.guidance_status, 'verification_needed')
  assert.equal(parsed.rule_PM2_5_ug_m3, '75')
  const replaced = appendDecision([saved], record({ id: 'replacement' }))
  const reopened = reopenDecision(replaced, 'replacement', now + 1000)
  const lifecycleRows = parseCsv(decisionCsv(reopened))
  assert.equal(lifecycleRows[0].lifecycle, 'superseded')
  assert.equal(lifecycleRows[0].superseded_by, 'replacement')
  assert.equal(lifecycleRows[1].lifecycle, 'reopened')
  assert.equal(lifecycleRows[1].reopened_at, new Date(now + 1000).toISOString())
  assert.match(decisionSummary(reopened[0], 'en'), /Replaced by a later record/)
  assert.match(decisionSummary(reopened[1], 'hi'), /समीक्षा फिर शुरू/)
  assert.match(
    reportMarkup({ record: reopened[0], language: 'en', sessionOnly: false }),
    /Replaced by record/,
  )
})

test('F08 spreadsheet formulas are neutralized and Unicode, embedded quotes and multiline cells round-trip', () => {
  for (const prefix of [
    '=',
    '+',
    '-',
    '@',
    '\t',
    '\r',
    '\n',
    ' =',
    '\uFEFF=',
  ]) {
    const value = `${prefix}SUM(1,2)`
    const parsed = parseCsv(
      decisionCsv([{ ...record(), reason: value }], { includePrivate: true }),
    )[0]
    assert.equal(parsed.reason, `'${value}`)
  }
  const reason = 'कक्षा "A", पहली पंक्ति\r\nदूसरी पंक्ति'
  const output = decisionCsv([{ ...record(), reason }], {
    includePrivate: true,
  })
  assert.ok(output.startsWith('\uFEFF'))
  assert.equal(parseCsv(output)[0].reason, reason)
  const html = '<script>private fixture</script>'
  assert.doesNotMatch(
    reportMarkup({
      record: { ...record(), reason: html },
      language: 'en',
      sessionOnly: false,
      includePrivate: true,
    }),
    /<script>/,
  )
})

test('F08 zero is valid; missing/invalid and legacy evidence never become invented original/chosen peaks', () => {
  const zero = record({ snapshot: dashboard(0) })
  assert.equal(parseCsv(decisionCsv([zero]))[0].original_peak_ug_m3, '0')
  assert.match(decisionSummary(zero, 'en'), /original window: 0 µg\/m³/)
  assert.match(
    reportMarkup({ record: zero, language: 'hi', sessionOnly: false }),
    /0 µg\/m³/,
  )
  for (const invalid of [null, undefined, NaN, Infinity, -1]) {
    const missing = {
      ...zero,
      originalAssessment: { ...zero.originalAssessment, value: invalid },
    }
    assert.equal(parseCsv(decisionCsv([missing]))[0].original_peak_ug_m3, '')
    assert.match(decisionSummary(missing, 'en'), /original window: unavailable/)
  }
  const legacy = { ...zero, value: 123 }
  for (const key of [
    'originalAssessment',
    'chosenAssessment',
    'originalWindow',
    'chosenWindow',
    'location',
    'reviewedPlanName',
    'forecastSource',
    'sourceAt',
    'policyStatus',
    'lifecycle',
  ])
    delete legacy[key]
  const summary = decisionSummary(legacy, 'en', { includePrivate: true })
  assert.match(summary, /original window: unavailable/)
  assert.match(summary, /chosen window: unavailable/)
  assert.doesNotMatch(summary, /123 µg\/m³/)
  assert.equal(
    reportDetails(legacy, { includePrivate: true }).location,
    'Not retained (legacy)',
  )
  const print = reportMarkup({
    record: legacy,
    language: 'hi',
    sessionOnly: false,
    includePrivate: true,
  })
  assert.match(print, /दर्ज नहीं/)
  assert.doesNotMatch(print, /Not retained|Not available/)
})

test('F17 English and Hindi use computed above/at/below thresholds, missing coverage and stale states', () => {
  for (const language of ['en', 'hi']) {
    assert.equal(
      planningGuidance(views(dashboard(76)), language, true).code,
      'review',
    )
    for (const value of [75, 74, 0])
      assert.equal(
        planningGuidance(views(dashboard(value)), language, true).code,
        'ready',
      )
    assert.equal(
      planningGuidance(views(dashboard(null)), language, true).code,
      'incomplete',
    )
    assert.equal(planningGuidance(views(), language, false).code, 'stale')
    const partialPlan = { ...plan, activities: [{ ...activity, end: '10:00' }] }
    const partial = dashboard()
    partial.forecast.points[1].pm25 = null
    assert.equal(
      planningGuidance(views(partial, { plan: partialPlan }), language, true)
        .code,
      'incomplete',
    )
    assert.match(
      planningGuidance(views(dashboard(75)), language, true).prompt,
      language === 'en'
        ? /does not establish safe air/
        : /सुरक्षित हवा साबित नहीं/,
    )
    const staleMarkup = guidanceMarkup({
      views: views(),
      language,
      forecastFresh: false,
    })
    assert.match(staleMarkup, /lang="(?:en|hi)"/)
    assert.match(
      staleMarkup,
      language === 'en' ? /not medical advice/ : /चिकित्सा सलाह/,
    )
  }
})

test('F17 guidance offers only configured indoor choices and available constrained alternatives', () => {
  for (const language of ['en', 'hi']) {
    const available = planningGuidance(views(), language, true)
    assert.equal(available.code, 'review')
    assert.match(
      available.options,
      language === 'en'
        ? /Compare the available lower model windows/
        : /उपलब्ध कम मॉडल मान/,
    )
    assert.match(
      available.options,
      language === 'en'
        ? /marked an indoor option as available/
        : /अंदर का विकल्प उपलब्ध बताया/,
    )
    const constrainedPlan = {
      ...plan,
      activities: [{ ...activity, flexible: false, indoorAvailable: false }],
    }
    const constrained = planningGuidance(
      views(dashboard(), { plan: constrainedPlan }),
      language,
      true,
    )
    assert.match(
      constrained.options,
      language === 'en'
        ? /No lower model window is offered/
        : /कम मॉडल मान वाला समय उपलब्ध नहीं/,
    )
    assert.match(
      constrained.options,
      language === 'en'
        ? /No indoor alternative is configured/
        : /अंदर का विकल्प दर्ज नहीं/,
    )
  }
})

test('F17 previews, completed dates, recorded, reopened and changed evidence each have truthful bilingual prompts', () => {
  for (const language of ['en', 'hi']) {
    assert.equal(planningGuidance([], language, true).code, 'empty')
    assert.equal(
      planningGuidance(
        views(dashboard(), { place: { ...place, confirmed: false } }),
        language,
        true,
      ).code,
      'preview',
    )
    const saved = record()
    const reviewed = views(dashboard(), { journal: [saved] })
    assert.equal(planningGuidance(reviewed, language, true).code, 'recorded')
    const reopened = views(dashboard(), {
      journal: reopenDecision([saved], saved.id, now + 1000),
    })
    assert.equal(planningGuidance(reopened, language, true).code, 'reopened')
    const changed = dashboard()
    changed.forecast.points[2].pm25 = 100
    assert.equal(
      planningGuidance(views(changed, { journal: [saved] }), language, true)
        .code,
      'recheck',
    )
    const ended = views(dashboard(), {
      now: Date.parse(`${date}T13:00:00+05:30`),
    })
    assert.equal(planningGuidance(ended, language, true).code, 'finished')
  }
})
